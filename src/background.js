importScripts("shared/data.js");

const DATA_STORAGE_KEY = "hnLabelsData";
const STATUS_STORAGE_KEY = "hnLabelsDriveStatus";
const DRIVE_FILE_NAME = "hn-labels-data.json";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const {
  MAX_HISTORY_ENTRIES,
  countData,
  createEmptyData,
  createHistoryEntry,
  dataContentIsEqual,
  labelsAreEqual,
  mergeData,
  newestTimestamp,
  normalizeData,
  normalizeLabels,
  normalizeTimestamp
} = globalThis.HNLabelsData;
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

chrome.runtime.onStartup.addListener(() => {
  syncDriveIfConnected(false).catch((error) => {
    console.warn("HN Labels startup sync failed", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((response) => sendResponse({ ok: true, ...response }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "HN_LABELS_GET_STATE":
      syncDriveIfConnected(false).catch((error) => {
        console.warn("HN Labels background sync failed", error);
      });
      return {
        data: await getLocalData(),
        status: await getDriveStatus()
      };

    case "HN_LABELS_UPDATE_USER":
      return updateUserLabels(message);

    case "HN_LABELS_EXPORT_DATA":
      return exportUserData();

    case "HN_LABELS_IMPORT_DATA":
      return importUserData(message.payload);

    case "HN_LABELS_CONNECT_DRIVE":
      return syncDrive({ interactive: true, force: true });

    case "HN_LABELS_SYNC_NOW":
      return syncDrive({ interactive: Boolean(message.interactive), force: true });

    case "HN_LABELS_DISCONNECT_DRIVE":
      await disconnectDrive();
      return {
        data: await getLocalData(),
        status: await getDriveStatus()
      };

    default:
      throw new Error("Unknown HN Labels request.");
  }
}

async function exportUserData() {
  return {
    export: {
      app: "HN Labels",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      data: await getLocalData()
    },
    status: await getDriveStatus()
  };
}

async function importUserData(payload) {
  const importedData = normalizeImportPayload(payload);
  const localData = await getLocalData();
  const mergedData = mergeData(localData, importedData);
  mergedData.updatedAt = new Date().toISOString();

  await setLocalData(mergedData);
  await patchDriveStatus({
    dirty: true,
    lastError: ""
  });

  syncDriveIfConnected(false).catch((error) => {
    console.warn("HN Labels import sync failed", error);
  });

  return {
    data: await getLocalData(),
    status: await getDriveStatus(),
    imported: countData(importedData)
  };
}

function normalizeImportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Import file must contain a JSON object.");
  }

  const rawData = payload.data || payload;
  const data = normalizeData(rawData);

  if (
    Object.keys(data.labelsByUser).length === 0 &&
    Object.keys(data.historyByUser).length === 0
  ) {
    throw new Error("Import file does not contain HN Labels data.");
  }

  return addImportHistoryForBareLabels(data);
}

function addImportHistoryForBareLabels(data) {
  const nextData = normalizeData(data);
  const importedAt = nextData.updatedAt || new Date().toISOString();

  Object.entries(nextData.labelsByUser).forEach(([username, labels]) => {
    if (nextData.historyByUser[username]?.length > 0) {
      return;
    }

    nextData.historyByUser[username] = [
      {
        at: importedAt,
        action: "updated",
        labels,
        url: "",
        title: "Imported backup"
      }
    ];
  });

  return normalizeData(nextData);
}

async function updateUserLabels(message) {
  const username = String(message.username || "").trim();
  if (!username) {
    throw new Error("Missing Hacker News username.");
  }

  const data = await getLocalData();
  const labels = normalizeLabels(message.labels || []);
  const previousLabels = data.labelsByUser[username] || [];
  if (labelsAreEqual(previousLabels, labels)) {
    return {
      data,
      status: await getDriveStatus()
    };
  }

  if (labels.length > 0) {
    data.labelsByUser[username] = labels;
  } else {
    delete data.labelsByUser[username];
  }

  data.historyByUser[username] = [
    createHistoryEntry(labels, message.page),
    ...(data.historyByUser[username] || [])
  ].slice(0, MAX_HISTORY_ENTRIES);
  data.updatedAt = new Date().toISOString();

  await setLocalData(data);
  await patchDriveStatus({
    dirty: true,
    lastError: ""
  });

  syncDriveIfConnected(false).catch((error) => {
    console.warn("HN Labels auto-sync failed", error);
  });

  return {
    data: await getLocalData(),
    status: await getDriveStatus()
  };
}

async function syncDriveIfConnected(force) {
  const status = await getDriveStatus();
  if (!status.connected && !status.fileId) {
    return;
  }

  const lastSyncAt = Date.parse(status.lastSyncAt);
  const isFresh =
    Number.isFinite(lastSyncAt) && Date.now() - lastSyncAt < AUTO_SYNC_INTERVAL_MS;
  if (!force && isFresh && !status.dirty) {
    return;
  }

  await syncDrive({ interactive: false, force });
}

async function syncDrive({ interactive, force }) {
  try {
    return await syncDriveCore({ interactive, force });
  } catch (error) {
    await patchDriveStatus({
      lastError: error.message || String(error)
    });
    throw error;
  }
}

async function syncDriveCore({ interactive, force }) {
  const status = await getDriveStatus();
  const lastSyncAt = Date.parse(status.lastSyncAt);
  const isFresh =
    Number.isFinite(lastSyncAt) && Date.now() - lastSyncAt < AUTO_SYNC_INTERVAL_MS;
  if (!force && isFresh && !status.dirty) {
    return {
      data: await getLocalData(),
      status
    };
  }

  const token = await getAuthToken(interactive);
  const localData = await getLocalData();
  let existingFile = status.fileId
    ? { id: status.fileId }
    : await findDriveFile(token);

  if (!existingFile) {
    const createdFile = await createDriveFile(token, localData);
    const nextStatus = await patchDriveStatus({
      connected: true,
      dirty: false,
      fileId: createdFile.id,
      lastError: "",
      lastSyncAt: new Date().toISOString()
    });
    return {
      data: localData,
      status: nextStatus
    };
  }

  let remoteData = createEmptyData();
  try {
    remoteData = await downloadDriveData(token, existingFile.id);
  } catch (error) {
    if (!isDriveNotFoundError(error)) {
      throw error;
    }

    existingFile = await findDriveFile(token);
    if (!existingFile) {
      const createdFile = await createDriveFile(token, localData);
      const nextStatus = await patchDriveStatus({
        connected: true,
        dirty: false,
        fileId: createdFile.id,
        lastError: "",
        lastSyncAt: new Date().toISOString()
      });
      return {
        data: localData,
        status: nextStatus
      };
    }

    remoteData = await downloadDriveData(token, existingFile.id);
  }

  const mergedData = mergeData(localData, remoteData);
  const shouldUpload = status.dirty || !dataContentIsEqual(remoteData, mergedData);
  mergedData.updatedAt = shouldUpload
    ? new Date().toISOString()
    : newestTimestamp(localData.updatedAt, remoteData.updatedAt);

  if (shouldUpload) {
    try {
      await updateDriveFile(token, existingFile.id, mergedData);
    } catch (error) {
      if (!isDriveNotFoundError(error)) {
        throw error;
      }

      const createdFile = await createDriveFile(token, mergedData);
      await setLocalData(mergedData);
      const nextStatus = await patchDriveStatus({
        connected: true,
        dirty: false,
        fileId: createdFile.id,
        lastError: "",
        lastSyncAt: new Date().toISOString()
      });
      return {
        data: mergedData,
        status: nextStatus
      };
    }
  }

  await setLocalData(mergedData);
  const nextStatus = await patchDriveStatus({
    connected: true,
    dirty: false,
    fileId: existingFile.id,
    lastError: "",
    lastSyncAt: new Date().toISOString()
  });

  return {
    data: mergedData,
    status: nextStatus
  };
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken(
      {
        interactive,
        scopes: [DRIVE_APPDATA_SCOPE]
      },
      (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(error);
          return;
        }

        const token = typeof result === "string" ? result : result?.token;
        if (!token) {
          reject(new Error("Google Drive authorization did not return a token."));
          return;
        }

        resolve(token);
      }
    );
  });
}

async function findDriveFile(token) {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${DRIVE_FILE_NAME.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id,name,modifiedTime,version)"
  });
  const response = await driveFetch(token, `${DRIVE_FILES_URL}?${params}`);
  const body = await response.json();
  return body.files?.[0] || null;
}

async function createDriveFile(token, data) {
  const metadata = {
    name: DRIVE_FILE_NAME,
    parents: ["appDataFolder"]
  };
  const upload = createMultipartUpload(metadata, normalizeData(data));
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,modifiedTime,version"
  });
  const response = await driveFetch(token, `${DRIVE_UPLOAD_URL}?${params}`, {
    method: "POST",
    headers: {
      "Content-Type": upload.contentType
    },
    body: upload.body
  });
  return response.json();
}

async function updateDriveFile(token, fileId, data) {
  const metadata = {
    name: DRIVE_FILE_NAME
  };
  const upload = createMultipartUpload(metadata, normalizeData(data));
  const params = new URLSearchParams({
    uploadType: "multipart",
    fields: "id,name,modifiedTime,version"
  });
  const response = await driveFetch(
    token,
    `${DRIVE_UPLOAD_URL}/${encodeURIComponent(fileId)}?${params}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": upload.contentType
      },
      body: upload.body
    }
  );
  return response.json();
}

async function downloadDriveData(token, fileId) {
  const response = await driveFetch(
    token,
    `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`
  );
  const body = await response.json();
  return normalizeData(body);
}

async function driveFetch(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    await removeCachedToken(token);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const message = extractGoogleErrorMessage(errorText) || response.statusText;
    await patchDriveStatus({
      lastError: message
    });
    const error = new Error(
      `Google Drive request failed (${response.status}): ${message}`
    );
    error.status = response.status;
    throw error;
  }

  return response;
}

function isDriveNotFoundError(error) {
  return error?.status === 404 || String(error?.message || "").includes("(404)");
}

function createMultipartUpload(metadata, data) {
  const boundary = `hnlabels_${Date.now()}_${Math.random()
    .toString(16)
    .slice(2)}`;
  const metadataJson = JSON.stringify(metadata);
  const mediaJson = JSON.stringify(normalizeData(data), null, 2);
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadataJson,
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    mediaJson,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  return {
    body,
    contentType: `multipart/related; boundary=${boundary}`
  };
}

function extractGoogleErrorMessage(text) {
  try {
    const body = JSON.parse(text);
    return body.error?.message || "";
  } catch {
    return text.slice(0, 300);
  }
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

async function disconnectDrive() {
  if (chrome.identity.clearAllCachedAuthTokens) {
    await chrome.identity.clearAllCachedAuthTokens();
  }

  await patchDriveStatus({
    connected: false,
    fileId: "",
    lastError: "",
    lastSyncAt: ""
  });
}

async function getLocalData() {
  const items = await getFromStorage(chrome.storage.local, {
    [DATA_STORAGE_KEY]: createEmptyData()
  });
  return normalizeData(items[DATA_STORAGE_KEY]);
}

async function setLocalData(data) {
  await setInStorage(chrome.storage.local, {
    [DATA_STORAGE_KEY]: normalizeData(data)
  });
}

async function getDriveStatus() {
  const items = await getFromStorage(chrome.storage.local, {
    [STATUS_STORAGE_KEY]: createDefaultStatus()
  });
  return normalizeStatus(items[STATUS_STORAGE_KEY]);
}

async function patchDriveStatus(patch) {
  const current = await getDriveStatus();
  const next = normalizeStatus({
    ...current,
    ...patch
  });
  await setInStorage(chrome.storage.local, {
    [STATUS_STORAGE_KEY]: next
  });
  return next;
}

function getFromStorage(area, keys) {
  return new Promise((resolve, reject) => {
    area.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(items || {});
    });
  });
}

function setInStorage(area, items) {
  return new Promise((resolve, reject) => {
    area.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createDefaultStatus() {
  return {
    connected: false,
    dirty: false,
    fileId: "",
    lastError: "",
    lastSyncAt: ""
  };
}

function normalizeStatus(status) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    return createDefaultStatus();
  }

  return {
    connected: Boolean(status.connected),
    dirty: Boolean(status.dirty),
    fileId: typeof status.fileId === "string" ? status.fileId : "",
    lastError: typeof status.lastError === "string" ? status.lastError : "",
    lastSyncAt: normalizeTimestamp(status.lastSyncAt)
  };
}

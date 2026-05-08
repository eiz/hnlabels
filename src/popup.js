const CONNECT_BUTTON_ID = "connectButton";
const DIRTY_STATE_ID = "dirtyState";
const DISCONNECT_BUTTON_ID = "disconnectButton";
const ERROR_TEXT_ID = "errorText";
const EXPORT_BUTTON_ID = "exportButton";
const HISTORY_COUNT_ID = "historyCount";
const IMPORT_BUTTON_ID = "importButton";
const IMPORT_FILE_ID = "importFile";
const LAST_SYNC_ID = "lastSync";
const NOTICE_TEXT_ID = "noticeText";
const STATUS_TEXT_ID = "statusText";
const SYNC_BUTTON_ID = "syncButton";
const USER_COUNT_ID = "userCount";

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  [
    CONNECT_BUTTON_ID,
    DIRTY_STATE_ID,
    DISCONNECT_BUTTON_ID,
    ERROR_TEXT_ID,
    EXPORT_BUTTON_ID,
    HISTORY_COUNT_ID,
    IMPORT_BUTTON_ID,
    IMPORT_FILE_ID,
    LAST_SYNC_ID,
    NOTICE_TEXT_ID,
    STATUS_TEXT_ID,
    SYNC_BUTTON_ID,
    USER_COUNT_ID
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });

  elements[CONNECT_BUTTON_ID].addEventListener("click", () =>
    runAction({ type: "HN_LABELS_CONNECT_DRIVE" })
  );
  elements[SYNC_BUTTON_ID].addEventListener("click", () =>
    runAction({ type: "HN_LABELS_SYNC_NOW", interactive: true })
  );
  elements[DISCONNECT_BUTTON_ID].addEventListener("click", () =>
    runAction({ type: "HN_LABELS_DISCONNECT_DRIVE" })
  );
  elements[EXPORT_BUTTON_ID].addEventListener("click", exportJson);
  elements[IMPORT_BUTTON_ID].addEventListener("click", () => {
    elements[IMPORT_FILE_ID].click();
  });
  elements[IMPORT_FILE_ID].addEventListener("change", importJson);

  await refresh();
});

async function refresh() {
  try {
    const response = await sendRuntimeMessage({ type: "HN_LABELS_GET_STATE" });
    render(response.data, response.status);
  } catch (error) {
    renderError(error);
  }
}

async function runAction(message) {
  setBusy(true);
  clearMessages();
  try {
    const response = await sendRuntimeMessage(message);
    render(response.data, response.status);
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

async function exportJson() {
  setBusy(true);
  clearMessages();
  try {
    const response = await sendRuntimeMessage({ type: "HN_LABELS_EXPORT_DATA" });
    downloadJson(response.export);
    showNotice("Exported HN Labels JSON.");
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

async function importJson(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) {
    return;
  }

  setBusy(true);
  clearMessages();
  try {
    const payload = JSON.parse(await file.text());
    const response = await sendRuntimeMessage({
      type: "HN_LABELS_IMPORT_DATA",
      payload
    });
    render(response.data, response.status);
    showNotice(
      `Imported ${response.imported.users} users and ${response.imported.historyEntries} history entries.`
    );
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.error || "HN Labels request failed"));
        return;
      }
      resolve(response);
    });
  });
}

function downloadJson(payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `hn-labels-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function render(data, status) {
  const safeData = data || {};
  const safeStatus = status || {};
  const labelsByUser = safeData.labelsByUser || {};
  const historyByUser = safeData.historyByUser || {};
  const historyCount = Object.values(historyByUser).reduce(
    (total, entries) => total + (Array.isArray(entries) ? entries.length : 0),
    0
  );

  elements[USER_COUNT_ID].textContent = String(Object.keys(labelsByUser).length);
  elements[HISTORY_COUNT_ID].textContent = String(historyCount);
  elements[LAST_SYNC_ID].textContent = formatTimestamp(safeStatus.lastSyncAt);
  elements[DIRTY_STATE_ID].textContent = safeStatus.dirty ? "Yes" : "No";
  elements[STATUS_TEXT_ID].textContent = getStatusText(safeStatus);

  elements[CONNECT_BUTTON_ID].hidden = Boolean(safeStatus.connected);
  elements[DISCONNECT_BUTTON_ID].hidden = !safeStatus.connected;

  if (safeStatus.lastError) {
    showError(safeStatus.lastError);
  } else {
    clearError();
  }
}

function getStatusText(status) {
  if (status.connected && status.dirty) {
    return "Connected. Changes are waiting to sync.";
  }
  if (status.connected) {
    return "Connected to Google Drive.";
  }
  if (status.dirty) {
    return "Saved locally. Connect Drive to sync.";
  }
  return "Not connected to Google Drive.";
}

function renderError(error) {
  elements[STATUS_TEXT_ID].textContent = "Drive status unavailable.";
  showError(error.message || "Something went wrong.");
}

function showError(message) {
  elements[ERROR_TEXT_ID].textContent = message;
  elements[ERROR_TEXT_ID].hidden = false;
}

function clearError() {
  elements[ERROR_TEXT_ID].textContent = "";
  elements[ERROR_TEXT_ID].hidden = true;
}

function showNotice(message) {
  elements[NOTICE_TEXT_ID].textContent = message;
  elements[NOTICE_TEXT_ID].hidden = false;
}

function clearNotice() {
  elements[NOTICE_TEXT_ID].textContent = "";
  elements[NOTICE_TEXT_ID].hidden = true;
}

function clearMessages() {
  clearError();
  clearNotice();
}

function setBusy(isBusy) {
  [
    elements[CONNECT_BUTTON_ID],
    elements[SYNC_BUTTON_ID],
    elements[DISCONNECT_BUTTON_ID],
    elements[EXPORT_BUTTON_ID],
    elements[IMPORT_BUTTON_ID]
  ].forEach((button) => {
    button.disabled = isBusy;
  });
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

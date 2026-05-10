(function exposeSharedData(global) {
  const MAX_LABELS_PER_USER = 8;
  const MAX_LABEL_LENGTH = 80;
  const MAX_HISTORY_ENTRIES = 50;
  const MAX_HISTORY_TITLE_LENGTH = 160;
  const MAX_HISTORY_URL_LENGTH = 500;

  function createEmptyData() {
    return {
      schemaVersion: 1,
      labelsByUser: {},
      historyByUser: {},
      updatedAt: ""
    };
  }

  function normalizeData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return createEmptyData();
    }

    return {
      schemaVersion: 1,
      labelsByUser: normalizeLabelStore(data.labelsByUser),
      historyByUser: normalizeHistoryStore(data.historyByUser),
      updatedAt: normalizeTimestamp(data.updatedAt)
    };
  }

  function normalizeLabelStore(store) {
    if (!store || typeof store !== "object" || Array.isArray(store)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(store)
        .map(([user, labels]) => [String(user).trim(), normalizeLabels(labels)])
        .filter(([user, labels]) => user && labels.length > 0)
    );
  }

  function normalizeHistoryStore(store) {
    if (!store || typeof store !== "object" || Array.isArray(store)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(store)
        .map(([user, entries]) => [
          String(user).trim(),
          normalizeHistoryEntries(entries)
        ])
        .filter(([user, entries]) => user && entries.length > 0)
    );
  }

  function normalizeLabels(labels) {
    if (!Array.isArray(labels)) {
      return [];
    }

    const seen = new Set();
    return labels
      .map((label) => String(label).trim().replace(/\s+/g, " "))
      .map((label) => label.slice(0, MAX_LABEL_LENGTH))
      .filter(Boolean)
      .filter((label) => {
        const key = label.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, MAX_LABELS_PER_USER);
  }

  function normalizeHistoryEntries(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }

    return entries
      .map(normalizeHistoryEntry)
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, MAX_HISTORY_ENTRIES);
  }

  function normalizeHistoryEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const labels = normalizeLabels(entry.labels || []);

    return {
      at: normalizeTimestamp(entry.at) || new Date().toISOString(),
      action: labels.length > 0 ? "updated" : "cleared",
      labels,
      url: normalizeHistoryUrl(entry.url),
      title: normalizeHistoryTitle(entry.title || entry.url || "Hacker News")
    };
  }

  function normalizeTimestamp(value) {
    const parsedAt = Date.parse(value);
    return Number.isFinite(parsedAt) ? new Date(parsedAt).toISOString() : "";
  }

  function normalizeHistoryUrl(url) {
    const value =
      typeof url === "string" ? url.trim().slice(0, MAX_HISTORY_URL_LENGTH) : "";
    if (!value) {
      return "";
    }

    try {
      const baseUrl = global.location?.href;
      const parsedUrl = baseUrl ? new URL(value, baseUrl) : new URL(value);
      return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
        ? parsedUrl.href
        : "";
    } catch {
      return "";
    }
  }

  function normalizeHistoryTitle(title) {
    const value =
      typeof title === "string" ? title.trim().replace(/\s+/g, " ") : "";
    return (value || "Hacker News").slice(0, MAX_HISTORY_TITLE_LENGTH);
  }

  function createHistoryEntry(labels, page) {
    return {
      at: new Date().toISOString(),
      action: labels.length > 0 ? "updated" : "cleared",
      labels,
      url: normalizeHistoryUrl(page?.url),
      title: normalizeHistoryTitle(page?.title || page?.url || "Hacker News")
    };
  }

  function mergeData(leftData, rightData) {
    const left = normalizeData(leftData);
    const right = normalizeData(rightData);
    const historyByUser = {};
    const labelsByUser = {};
    const users = new Set([
      ...Object.keys(left.labelsByUser),
      ...Object.keys(right.labelsByUser),
      ...Object.keys(left.historyByUser),
      ...Object.keys(right.historyByUser)
    ]);

    users.forEach((username) => {
      const mergedHistory = mergeHistoryEntries(
        left.historyByUser[username],
        right.historyByUser[username]
      );
      if (mergedHistory.length > 0) {
        historyByUser[username] = mergedHistory;
        const labelsFromHistory = normalizeLabels(mergedHistory[0].labels);
        if (labelsFromHistory.length > 0) {
          labelsByUser[username] = labelsFromHistory;
        }
        return;
      }

      const labels = normalizeLabels(
        left.labelsByUser[username] || right.labelsByUser[username] || []
      );
      if (labels.length > 0) {
        labelsByUser[username] = labels;
      }
    });

    return normalizeData({
      labelsByUser,
      historyByUser,
      updatedAt: newestTimestamp(left.updatedAt, right.updatedAt)
    });
  }

  function mergeHistoryEntries(leftEntries = [], rightEntries = []) {
    const entriesByKey = new Map();
    [...normalizeHistoryEntries(leftEntries), ...normalizeHistoryEntries(rightEntries)]
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .forEach((entry) => {
        const key = [
          entry.at,
          entry.action,
          entry.url,
          entry.labels.join("\u0001")
        ].join("\u0002");
        if (!entriesByKey.has(key)) {
          entriesByKey.set(key, entry);
        }
      });

    return [...entriesByKey.values()].slice(0, MAX_HISTORY_ENTRIES);
  }

  function newestTimestamp(left, right) {
    const leftAt = Date.parse(left);
    const rightAt = Date.parse(right);
    if (!Number.isFinite(leftAt)) {
      return Number.isFinite(rightAt) ? new Date(rightAt).toISOString() : "";
    }
    if (!Number.isFinite(rightAt)) {
      return new Date(leftAt).toISOString();
    }
    return new Date(Math.max(leftAt, rightAt)).toISOString();
  }

  function countData(data) {
    const normalizedData = normalizeData(data);
    const historyEntries = Object.values(normalizedData.historyByUser).reduce(
      (total, entries) => total + entries.length,
      0
    );

    return {
      users: Object.keys(normalizedData.labelsByUser).length,
      historyEntries
    };
  }

  function labelsAreEqual(leftLabels, rightLabels) {
    return (
      leftLabels.length === rightLabels.length &&
      leftLabels.every((label, index) => label === rightLabels[index])
    );
  }

  function dataContentIsEqual(leftData, rightData) {
    const left = normalizeData(leftData);
    const right = normalizeData(rightData);
    delete left.updatedAt;
    delete right.updatedAt;
    return JSON.stringify(left) === JSON.stringify(right);
  }

  global.HNLabelsData = {
    MAX_HISTORY_ENTRIES,
    countData,
    createEmptyData,
    createHistoryEntry,
    dataContentIsEqual,
    labelsAreEqual,
    mergeData,
    newestTimestamp,
    normalizeData,
    normalizeHistoryTitle,
    normalizeHistoryUrl,
    normalizeLabels,
    normalizeTimestamp
  };
})(globalThis);

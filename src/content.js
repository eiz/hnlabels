const DATA_STORAGE_KEY = "hnLabelsData";
const MAX_LABELS_PER_USER = 8;
const MAX_LABEL_LENGTH = 80;
const MAX_HISTORY_ENTRIES = 50;
const MAX_HISTORY_TITLE_LENGTH = 160;
const MAX_HISTORY_URL_LENGTH = 500;
const USER_SELECTOR = "a.hnuser[href^='user?id=']";

let labelsByUser = {};
let historyByUser = {};
let activePopover = null;

init().catch((error) => {
  console.error("HN Labels failed to initialize", error);
});

async function init() {
  applyData(await loadLocalData());
  renderAllUsers();
  observePageChanges();
  listenForStorageChanges();
  hydrateFromBackground();
}

async function hydrateFromBackground() {
  try {
    const response = await sendRuntimeMessage({ type: "HN_LABELS_GET_STATE" });
    if (response?.data) {
      applyData(response.data);
      renderAllUsers();
    }
  } catch (error) {
    console.warn("HN Labels background state is unavailable", error);
  }
}

async function loadLocalData() {
  const items = await getFromStorage(chrome.storage.local, {
    [DATA_STORAGE_KEY]: createEmptyData()
  });
  return normalizeData(items[DATA_STORAGE_KEY]);
}

function getFromStorage(area, defaults) {
  return new Promise((resolve, reject) => {
    area.get(defaults, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(items);
    });
  });
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

function createEmptyData() {
  return {
    schemaVersion: 1,
    labelsByUser: {},
    historyByUser: {},
    updatedAt: ""
  };
}

function applyData(data) {
  const normalizedData = normalizeData(data);
  labelsByUser = normalizedData.labelsByUser;
  historyByUser = normalizedData.historyByUser;
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
    const parsedUrl = new URL(value, location.href);
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

function parseLabels(rawValue) {
  return normalizeLabels(rawValue.split(","));
}

function renderAllUsers(root = document) {
  root.querySelectorAll(USER_SELECTOR).forEach(renderUser);
}

function renderUser(userLink) {
  const username = getUsername(userLink);
  if (!username) {
    return;
  }

  const existingRoot = getExistingRoot(userLink);
  const labelsRoot = existingRoot || createLabelsRoot(username);
  const userLabels = labelsByUser[username] || [];
  labelsRoot.dataset.hnLabelsUser = username;
  labelsRoot.replaceChildren(
    ...userLabels.map((label) => createLabelPill(label, username)),
    createEditButton(username)
  );

  if (!existingRoot) {
    userLink.insertAdjacentElement("afterend", labelsRoot);
  }
}

function getUsername(userLink) {
  const nameFromText = userLink.textContent.trim();
  if (nameFromText) {
    return nameFromText;
  }

  const id = new URL(userLink.href, location.href).searchParams.get("id");
  return id ? id.trim() : "";
}

function getExistingRoot(userLink) {
  const next = userLink.nextElementSibling;
  return next?.classList.contains("hn-labels-root") ? next : null;
}

function createLabelsRoot(username) {
  const root = document.createElement("span");
  root.className = "hn-labels-root";
  root.dataset.hnLabelsUser = username;
  return root;
}

function createLabelPill(label, username) {
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "hn-label-pill";
  pill.textContent = label;
  pill.title = `Show edit history for ${username}`;
  pill.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openHistoryPopover(username, pill);
  });
  return pill;
}

function createStaticLabelPill(label) {
  const pill = document.createElement("span");
  pill.className = "hn-label-pill hn-label-pill-static";
  pill.textContent = label;
  pill.title = label;
  return pill;
}

function createEditButton(username) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hn-label-edit";
  button.textContent = labelsByUser[username]?.length ? "edit" : "+ tag";
  button.title = `Edit labels for ${username}`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openEditPopover(username, button);
  });
  return button;
}

function openEditPopover(username, anchor) {
  closePopover();

  const popover = document.createElement("form");
  popover.className = "hn-label-popover";
  popover.innerHTML = `
    <div class="hn-label-popover-title"></div>
    <input class="hn-label-input" type="text" autocomplete="off" />
    <div class="hn-label-help">Comma-separated labels. Leave blank to clear.</div>
    <div class="hn-label-error" hidden></div>
    <div class="hn-label-actions">
      <button class="hn-label-button" type="button" data-action="cancel">Cancel</button>
      <button class="hn-label-button" type="button" data-action="clear">Clear</button>
      <button class="hn-label-button hn-label-button-primary" type="submit">Save</button>
    </div>
  `;

  const title = popover.querySelector(".hn-label-popover-title");
  const input = popover.querySelector(".hn-label-input");
  title.textContent = `Labels for ${username}`;
  input.value = labelsByUser[username]?.join(", ") || "";

  popover.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveLabelsFromPopover(popover, username, parseLabels(input.value));
  });

  popover.addEventListener("click", async (event) => {
    const action = event.target?.dataset?.action;
    if (action === "cancel") {
      closePopover();
    }
    if (action === "clear") {
      await saveLabelsFromPopover(popover, username, []);
    }
  });

  showPopover(popover, anchor);
  input.focus();
  input.select();
}

async function saveLabelsFromPopover(popover, username, labels) {
  const submitButtons = popover.querySelectorAll("button");
  submitButtons.forEach((button) => {
    button.disabled = true;
  });

  try {
    await updateUserLabels(username, labels);
    closePopover();
  } catch (error) {
    setPopoverError(popover, error.message || "Unable to save labels.");
    submitButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function setPopoverError(popover, message) {
  const error = popover.querySelector(".hn-label-error");
  if (!error) {
    return;
  }

  error.textContent = message;
  error.hidden = false;
}

function openHistoryPopover(username, anchor) {
  closePopover();

  const popover = document.createElement("div");
  popover.className = "hn-label-popover hn-label-history-popover";
  popover.dataset.hnLabelsPopover = "history";
  popover.dataset.hnLabelsUser = username;
  renderHistoryPopoverContent(popover, username, anchor);
  showPopover(popover, anchor);
}

function renderHistoryPopoverContent(popover, username, anchor) {
  const title = document.createElement("div");
  title.className = "hn-label-popover-title";
  title.textContent = `History for ${username}`;

  const current = createCurrentLabelsSection(username);
  const sectionTitle = document.createElement("div");
  sectionTitle.className = "hn-label-section-title";
  sectionTitle.textContent = "Edit history";
  const actions = createHistoryActions(username, anchor);

  popover.replaceChildren(
    title,
    current,
    sectionTitle,
    createHistoryList(username),
    actions
  );
}

function createHistoryActions(username, anchor) {
  const actions = document.createElement("div");
  actions.className = "hn-label-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "hn-label-button hn-label-button-primary";
  editButton.textContent = "Edit labels";
  editButton.addEventListener("click", () => openEditPopover(username, anchor));

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hn-label-button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", closePopover);

  actions.append(editButton, closeButton);
  return actions;
}

function createCurrentLabelsSection(username) {
  const section = document.createElement("div");
  section.className = "hn-label-current";

  const label = document.createElement("span");
  label.className = "hn-label-current-label";
  label.textContent = "Current:";
  section.append(label);

  const labels = labelsByUser[username] || [];
  if (labels.length === 0) {
    const empty = document.createElement("span");
    empty.className = "hn-label-muted";
    empty.textContent = "None";
    section.append(empty);
    return section;
  }

  labels.forEach((userLabel) => {
    section.append(createStaticLabelPill(userLabel));
  });
  return section;
}

function createHistoryList(username) {
  const list = document.createElement("div");
  list.className = "hn-label-history-list";

  const entries = historyByUser[username] || [];
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hn-label-empty";
    empty.textContent = "No edits recorded yet.";
    list.append(empty);
    return list;
  }

  entries.forEach((entry) => {
    list.append(createHistoryItem(entry));
  });
  return list;
}

function createHistoryItem(entry) {
  const item = document.createElement("div");
  item.className = "hn-label-history-item";

  const meta = document.createElement("div");
  meta.className = "hn-label-history-meta";
  meta.textContent = `${formatTimestamp(entry.at)} - ${
    entry.action === "cleared" ? "cleared labels" : "saved labels"
  }`;

  const labels = document.createElement("div");
  labels.className = "hn-label-history-labels";
  labels.textContent =
    entry.labels.length > 0 ? entry.labels.join(", ") : "No labels";

  const page = document.createElement("div");
  page.className = "hn-label-history-page";
  appendPageSource(page, entry);

  item.append(meta, labels, page);
  return item;
}

function appendPageSource(container, entry) {
  if (!entry.url) {
    container.textContent = "From: page not recorded";
    return;
  }

  const link = document.createElement("a");
  link.href = entry.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = entry.title || entry.url;
  link.title = entry.url;
  container.append("From: ", link);
}

async function updateUserLabels(username, labels) {
  const normalizedLabels = normalizeLabels(labels);
  const previousLabels = labelsByUser[username] || [];
  if (labelsAreEqual(previousLabels, normalizedLabels)) {
    renderAllUsers();
    return;
  }

  const response = await sendRuntimeMessage({
    type: "HN_LABELS_UPDATE_USER",
    username,
    labels: normalizedLabels,
    page: {
      url: normalizeHistoryUrl(location.href),
      title: normalizeHistoryTitle(document.title || location.href)
    }
  });

  if (response?.data) {
    applyData(response.data);
  }
  renderAllUsers();
}

function labelsAreEqual(leftLabels, rightLabels) {
  return (
    leftLabels.length === rightLabels.length &&
    leftLabels.every((label, index) => label === rightLabels[index])
  );
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function showPopover(popover, anchor) {
  document.body.append(popover);
  positionPopover(popover, anchor);
  activePopover = popover;

  requestAnimationFrame(() => {
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
  });
}

function positionPopover(popover, anchor) {
  const anchorRect = anchor.getBoundingClientRect();
  const spacing = 6;
  const maxLeft = window.innerWidth - popover.offsetWidth - spacing;
  const left = Math.max(spacing, Math.min(anchorRect.left, maxLeft));
  const belowTop = anchorRect.bottom + spacing;
  const aboveTop = anchorRect.top - popover.offsetHeight - spacing;
  const top =
    belowTop + popover.offsetHeight < window.innerHeight
      ? belowTop
      : Math.max(spacing, aboveTop);

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
  document.removeEventListener("mousedown", closeOnOutsideClick);
  document.removeEventListener("keydown", closeOnEscape);
}

function closeOnOutsideClick(event) {
  if (activePopover && !activePopover.contains(event.target)) {
    closePopover();
  }
}

function closeOnEscape(event) {
  if (event.key === "Escape") {
    closePopover();
  }
}

function observePageChanges() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches?.(USER_SELECTOR)) {
            renderUser(node);
          }
          renderAllUsers(node);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function listenForStorageChanges() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[DATA_STORAGE_KEY]) {
      return;
    }

    applyData(changes[DATA_STORAGE_KEY].newValue);
    renderAllUsers();

    if (
      activePopover?.dataset.hnLabelsPopover === "history" &&
      activePopover.dataset.hnLabelsUser
    ) {
      const username = activePopover.dataset.hnLabelsUser;
      renderHistoryPopoverContent(activePopover, username, activePopover);
    }
  });
}

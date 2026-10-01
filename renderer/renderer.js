const addWrap = document.getElementById("addWrap");
const addBtn = document.getElementById("addBtn");
const addMenu = document.getElementById("addMenu");
const settingsWrap = document.getElementById("settingsWrap");
const settingsBtn = document.getElementById("settingsBtn");
const settingsMenu = document.getElementById("settingsMenu");
const clearQueueBtn = document.getElementById("clearQueueBtn");
const clearSkippedBtn = document.getElementById("clearSkippedBtn");
const clearFailedBtn = document.getElementById("clearFailedBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const cancelAllBtn = document.getElementById("cancelAllBtn");
const clearFailuresBtn = document.getElementById("clearFailuresBtn");
const dropzone = document.getElementById("dropzone");
const emptyState = document.getElementById("emptyState");
const tableWrap = document.getElementById("tableWrap");
const fileBody = document.getElementById("fileBody");
const rowMenu = document.getElementById("rowMenu");
const badge = document.getElementById("badge");
const failBadge = document.getElementById("failBadge");
const filesTab = document.getElementById("filesTab");
const logTab = document.getElementById("logTab");
const filesPanel = document.getElementById("filesPanel");
const logPanel = document.getElementById("logPanel");
const logList = document.getElementById("logList");
const convertBtn = document.getElementById("convertBtn");
const overall = document.getElementById("overall");
const overallFill = document.getElementById("overallFill");
const overallLabel = document.getElementById("overallLabel");
const saveAsSelect = document.getElementById("saveAs");
const deleteOriginal = document.getElementById("deleteOriginal");
const cleanNames = document.getElementById("cleanNames");
const sevenZipHint = document.getElementById("sevenZipHint");

let state = {
  items: [],
  saveAs: "cbz",
  deleteOriginal: true,
  cleanNames: true,
  running: false,
  sevenZipMissing: false,
};

let rowMenuId = null;
let activeTab = "files";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(ms) {
  if (!ms) return "—";
  return `${(ms / 1000).toFixed(1)} sec.`;
}

function statusClass(status) {
  return (
    {
      Waiting: "wait",
      Converting: "run",
      Done: "done",
      Failed: "fail",
      Skipped: "skip",
    }[status] || "wait"
  );
}

function rowCaption(item) {
  if (item.reason) return item.reason;
  if (state.cleanNames && item.outputName) return item.outputName;
  return item.folder;
}

function setActiveTab(tab) {
  activeTab = tab === "log" ? "log" : "files";
  const onFiles = activeTab === "files";
  filesTab.classList.toggle("is-active", onFiles);
  logTab.classList.toggle("is-active", !onFiles);
  filesTab.setAttribute("aria-selected", onFiles ? "true" : "false");
  logTab.setAttribute("aria-selected", onFiles ? "false" : "true");
  filesPanel.hidden = !onFiles;
  logPanel.hidden = onFiles;
}

function renderFailureLog(failedItems) {
  clearFailuresBtn.disabled = failedItems.length === 0;
  clearFailedBtn.disabled = failedItems.length === 0;

  if (!failedItems.length) {
    logList.innerHTML = `
      <div class="empty" id="logEmpty">
        <p>No failures</p>
        <p class="empty-hint">Convert errors will appear here</p>
      </div>
    `;
    return;
  }

  logList.innerHTML = failedItems
    .map(
      (item) => `
      <article class="log-entry">
        <div class="log-entry-head">
          <div class="log-entry-name">${escapeHtml(item.name)}</div>
          <div class="log-entry-time">${formatTime(item.elapsed)}</div>
        </div>
        <div class="log-entry-path" title="${escapeHtml(item.path || item.folder || "")}">${escapeHtml(item.path || item.folder || "")}</div>
        <pre class="log-entry-reason">${escapeHtml(item.reason || "Unknown error")}</pre>
      </article>
    `
    )
    .join("");
}

function render() {
  const items = state.items || [];
  const total = items.length;
  const done = items.filter((item) => item.status === "Done").length;
  const skipped = items.filter((item) => item.status === "Skipped").length;
  const failedItems = items.filter((item) => item.status === "Failed");
  const failed = failedItems.length;
  const waiting = items.filter((item) => item.status === "Waiting").length;
  const converting = items.filter((item) => item.status === "Converting").length;
  const activeItems = items.filter((item) => item.status !== "Skipped");
  const activeTotal = activeItems.length;
  const progressSum = activeItems.reduce((sum, item) => {
    if (item.status === "Done") return sum + 100;
    return sum + (item.progress || 0);
  }, 0);
  const overallPct = activeTotal ? Math.round(progressSum / activeTotal) : 0;

  emptyState.hidden = total > 0;
  tableWrap.hidden = total === 0;
  badge.hidden = total === 0;
  badge.textContent = String(total);
  failBadge.hidden = failed === 0;
  failBadge.textContent = String(failed);
  sevenZipHint.hidden = !state.sevenZipMissing;
  convertBtn.disabled =
    state.sevenZipMissing || (waiting === 0 && converting === 0 && !state.running);
  convertBtn.classList.toggle("is-stop", state.running);
  convertBtn.textContent = state.running ? "Stop" : "Convert";
  clearQueueBtn.disabled = waiting === 0 && skipped === 0;
  clearSkippedBtn.disabled = skipped === 0;
  clearAllBtn.disabled = total === 0 || converting === total;
  cancelAllBtn.disabled = !state.running && converting === 0;
  overall.hidden = total === 0;
  overallFill.style.width = `${overallPct}%`;
  overallLabel.textContent = state.running
    ? `${done + failed} / ${activeTotal} · ${overallPct}%`
    : `${done} converted · ${skipped} skipped · ${failed} failed · ${waiting} waiting`;

  if (saveAsSelect.value !== state.saveAs) saveAsSelect.value = state.saveAs;
  deleteOriginal.checked = state.deleteOriginal;
  cleanNames.checked = state.cleanNames;

  fileBody.innerHTML = items
    .map(
      (item) => `
      <tr class="${item.status === "Converting" ? "is-active" : ""}">
        <td class="col-name">
          <div class="file-name">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="file-path">${escapeHtml(rowCaption(item))}</span>
          </div>
        </td>
        <td class="col-status"><span class="status ${statusClass(item.status)}" title="${escapeHtml(item.reason || "")}">${item.status}</span></td>
        <td class="col-progress">
          <div class="progress-cell">
            <div class="bar"><span style="width:${item.progress || 0}%"></span></div>
            <span class="pct">${item.progress || 0}%</span>
          </div>
        </td>
        <td class="col-time">${formatTime(item.elapsed)}</td>
        <td class="col-action">
          <div class="row-actions">
            <button type="button" class="more-btn${rowMenuId === item.id ? " is-open" : ""}" data-row-menu="${item.id}" aria-label="More actions" aria-haspopup="menu" aria-expanded="${rowMenuId === item.id ? "true" : "false"}">⋯</button>
            <button type="button" class="remove-btn" data-remove="${item.id}" aria-label="Remove">×</button>
          </div>
        </td>
      </tr>
    `
    )
    .join("");

  renderFailureLog(failedItems);

  if (rowMenuId != null && !items.some((item) => item.id === rowMenuId)) {
    closeRowMenu();
  }
}

function applyState(next) {
  if (!next) return;
  state = next;
  render();
}

function closeAddMenu() {
  addMenu.hidden = true;
  addWrap.classList.remove("is-open");
}

function closeSettingsMenu() {
  settingsMenu.hidden = true;
  settingsWrap.classList.remove("is-open");
  settingsBtn.setAttribute("aria-expanded", "false");
}

function closeRowMenu() {
  rowMenu.hidden = true;
  rowMenuId = null;
  fileBody.querySelectorAll(".more-btn.is-open").forEach((button) => {
    button.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  });
}

function openRowMenu(button, id) {
  closeAddMenu();
  closeSettingsMenu();
  rowMenuId = id;
  const rect = button.getBoundingClientRect();
  rowMenu.hidden = false;
  rowMenu.style.top = `${rect.bottom + 4}px`;
  rowMenu.style.right = `${window.innerWidth - rect.right}px`;
  rowMenu.style.left = "auto";
  fileBody.querySelectorAll(".more-btn").forEach((btn) => {
    const open = Number(btn.dataset.rowMenu) === id;
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

async function clearFailures() {
  applyState(await window.converter.clearFailed());
}

filesTab.addEventListener("click", () => setActiveTab("files"));
logTab.addEventListener("click", () => setActiveTab("log"));

clearFailuresBtn.addEventListener("click", async () => {
  await clearFailures();
});

addBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = addMenu.hidden;
  closeSettingsMenu();
  closeRowMenu();
  addMenu.hidden = !open;
  addWrap.classList.toggle("is-open", open);
});

addMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  closeAddMenu();
  if (button.dataset.add === "files") applyState(await window.converter.selectFiles());
  if (button.dataset.add === "folder") applyState(await window.converter.selectFolder());
});

settingsBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = settingsMenu.hidden;
  closeAddMenu();
  closeRowMenu();
  settingsMenu.hidden = !open;
  settingsWrap.classList.toggle("is-open", open);
  settingsBtn.setAttribute("aria-expanded", open ? "true" : "false");
});

settingsMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-settings]");
  if (!button || button.disabled) return;
  closeSettingsMenu();
  if (button.dataset.settings === "clear") applyState(await window.converter.clearQueue());
  if (button.dataset.settings === "clear-skipped") applyState(await window.converter.clearSkipped());
  if (button.dataset.settings === "clear-failed") await clearFailures();
  if (button.dataset.settings === "clear-all") applyState(await window.converter.clearAll());
  if (button.dataset.settings === "cancel") applyState(await window.converter.stop());
});

rowMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-row-action]");
  if (!button) return;
  const id = rowMenuId;
  closeRowMenu();
  if (button.dataset.rowAction === "reveal" && id != null) {
    await window.converter.revealItem(id);
  }
});

document.addEventListener("click", (event) => {
  if (!addWrap.contains(event.target)) closeAddMenu();
  if (!settingsWrap.contains(event.target)) closeSettingsMenu();
  if (!rowMenu.contains(event.target) && !event.target.closest("[data-row-menu]")) {
    closeRowMenu();
  }
});

fileBody.addEventListener("click", async (event) => {
  const menuButton = event.target.closest("[data-row-menu]");
  if (menuButton) {
    event.stopPropagation();
    const id = Number(menuButton.dataset.rowMenu);
    if (rowMenuId === id && !rowMenu.hidden) {
      closeRowMenu();
      return;
    }
    openRowMenu(menuButton, id);
    return;
  }

  const button = event.target.closest("[data-remove]");
  if (!button) return;
  closeRowMenu();
  applyState(await window.converter.remove(Number(button.dataset.remove)));
});

convertBtn.addEventListener("click", async () => {
  if (state.running) {
    applyState(await window.converter.stop());
    return;
  }
  applyState(await window.converter.start());
});

saveAsSelect.addEventListener("change", async () => {
  applyState(await window.converter.setSaveAs(saveAsSelect.value));
});

deleteOriginal.addEventListener("change", async () => {
  applyState(await window.converter.setDeleteOriginal(deleteOriginal.checked));
});

cleanNames.addEventListener("change", async () => {
  applyState(await window.converter.setCleanNames(cleanNames.checked));
});

document.querySelectorAll("[data-win]").forEach((button) => {
  button.addEventListener("click", () => {
    window.converter.windowControl(button.dataset.win);
  });
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-drag");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-drag");
});

dropzone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-drag");
  const paths = [...event.dataTransfer.files]
    .map((file) => window.converter.pathForFile(file))
    .filter(Boolean);
  applyState(await window.converter.addDroppedPaths(paths));
});

window.converter.onQueueUpdated(applyState);
window.converter.getState().then(applyState);
setActiveTab("files");
render();

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { canConvert } = require("./src/convert-map");
const { convertFile, find7zip } = require("./src/convert-engine");
const { plannedOutputName } = require("./src/comic-name");

let mainWindow = null;
let items = [];
let nextId = 1;
let saveAs = "cbz";
let deleteOriginal = true;
let cleanNames = true;
let running = false;
let stopRequested = false;
let abortController = null;
let sevenZip = find7zip();
let sendTimer = null;

function getState() {
  return {
    items,
    saveAs,
    deleteOriginal,
    cleanNames,
    running,
    sevenZip,
    sevenZipMissing: !sevenZip,
  };
}

function sendState(immediate = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const emit = () => {
    sendTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("queue-updated", getState());
  };
  if (immediate) {
    if (sendTimer) {
      clearTimeout(sendTimer);
      sendTimer = null;
    }
    emit();
    return;
  }
  if (sendTimer) return;
  sendTimer = setTimeout(emit, 80);
}

function mappedStatus(filePath) {
  const result = canConvert(filePath, saveAs);
  if (result.ok) return { status: "Waiting", reason: "" };
  if (cleanNames && /^Already a /i.test(result.reason)) {
    if (outputNameFor(filePath) === path.basename(filePath)) {
      return { status: "Skipped", reason: "name already clean" };
    }
    return { status: "Waiting", reason: "" };
  }
  return { status: "Skipped", reason: result.reason };
}

function outputNameFor(filePath) {
  return plannedOutputName(path.basename(filePath), saveAs, {
    cleanNames,
    folderName: path.dirname(filePath),
  });
}

function refreshOutputNames() {
  for (const item of items) {
    if (item.status === "Done") continue;
    item.outputName = outputNameFor(item.path);
  }
}

function reevaluateQueue() {
  for (const item of items) {
    if (item.status === "Done" || item.status === "Failed" || item.status === "Converting") continue;
    const mapped = mappedStatus(item.path);
    item.status = mapped.status;
    item.reason = mapped.reason;
    if (item.status === "Skipped") {
      item.progress = 0;
      item.elapsed = 0;
    }
  }
  refreshOutputNames();
}

async function walkFiles(root) {
  const found = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(full);
    }
  }
  const stat = await fs.stat(root);
  if (stat.isFile()) return [root];
  await walk(root);
  return found;
}

async function addPaths(paths) {
  const existing = new Set(items.map((item) => item.path));
  for (const raw of paths) {
    if (!raw) continue;
    let files;
    try {
      files = await walkFiles(raw);
    } catch {
      continue;
    }
    for (const filePath of files) {
      if (existing.has(filePath)) continue;
      existing.add(filePath);
      const mapped = mappedStatus(filePath);
      items.push({
        id: nextId++,
        path: filePath,
        name: path.basename(filePath),
        folder: path.dirname(filePath),
        status: mapped.status,
        reason: mapped.reason,
        outputName: outputNameFor(filePath),
        progress: 0,
        elapsed: 0,
        detail: "",
      });
    }
  }
  sendState(true);
}

async function processQueue() {
  sevenZip = find7zip();
  if (!sevenZip) {
    running = false;
    sendState(true);
    return;
  }

  running = true;
  stopRequested = false;
  sendState(true);

  try {
    while (!stopRequested) {
      const next = items.find((item) => item.status === "Waiting");
      if (!next) break;

      next.status = "Converting";
      next.progress = 0;
      next.elapsed = 0;
      next.reason = "";
      const started = Date.now();
      sendState(true);
      abortController = new AbortController();

      try {
        const result = await convertFile({
          sourcePath: next.path,
          saveAs,
          deleteOriginal,
          cleanNames,
          sevenZip,
          signal: abortController.signal,
          onProgress: (pct) => {
            next.progress = pct;
            next.elapsed = Date.now() - started;
            sendState();
          },
        });
        if (!items.includes(next)) continue;
        next.status = "Done";
        next.progress = 100;
        next.elapsed = Date.now() - started;
        next.detail = result.detail;
        next.path = result.dest;
        next.name = path.basename(result.dest);
        next.folder = path.dirname(result.dest);
        next.outputName = path.basename(result.dest);
      } catch (err) {
        if (!items.includes(next)) continue;
        next.elapsed = Date.now() - started;
        if (stopRequested || err.message === "cancelled") {
          next.status = "Waiting";
          next.progress = 0;
          next.elapsed = 0;
        } else if (err.name === "SkipError") {
          next.status = "Skipped";
          next.reason = err.message;
          next.progress = 0;
        } else {
          next.status = "Failed";
          next.reason = err.message || String(err);
        }
      } finally {
        abortController = null;
        sendState(true);
      }
    }
  } finally {
    running = false;
    stopRequested = false;
    sendState(true);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 820,
    minHeight: 520,
    frame: false,
    backgroundColor: "#ececec",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  sevenZip = find7zip();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

ipcMain.on("window-control", (_event, action) => {
  if (!mainWindow) return;
  if (action === "min") mainWindow.minimize();
  if (action === "max") {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
  if (action === "close") mainWindow.close();
});

ipcMain.handle("get-state", () => getState());

ipcMain.handle("select-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Archives", extensions: ["cbr", "rar", "cb7", "cbz", "zip"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (!result.canceled) await addPaths(result.filePaths);
  return getState();
});

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (!result.canceled) await addPaths(result.filePaths);
  return getState();
});

ipcMain.handle("add-paths", async (_event, paths) => {
  await addPaths(Array.isArray(paths) ? paths : []);
  return getState();
});

ipcMain.handle("set-save-as", (_event, value) => {
  saveAs = value === "cbz" ? "cbz" : "zip";
  reevaluateQueue();
  sendState(true);
  return getState();
});

ipcMain.handle("set-delete-original", (_event, value) => {
  deleteOriginal = Boolean(value);
  sendState(true);
  return getState();
});

ipcMain.handle("set-clean-names", (_event, value) => {
  cleanNames = Boolean(value);
  reevaluateQueue();
  sendState(true);
  return getState();
});

ipcMain.handle("remove", (_event, id) => {
  const item = items.find((entry) => entry.id === id);
  if (!item) return getState();
  if (item.status === "Converting") {
    stopRequested = false;
    if (abortController) abortController.abort();
  }
  items = items.filter((entry) => entry.id !== id);
  sendState(true);
  return getState();
});

ipcMain.handle("reveal-item", (_event, id) => {
  const item = items.find((entry) => entry.id === id);
  if (item?.path) shell.showItemInFolder(item.path);
});

ipcMain.handle("clear-queue", () => {
  items = items.filter((item) => item.status !== "Waiting" && item.status !== "Skipped");
  sendState(true);
  return getState();
});

ipcMain.handle("clear-skipped", () => {
  items = items.filter((item) => item.status !== "Skipped");
  sendState(true);
  return getState();
});

ipcMain.handle("clear-failed", () => {
  items = items.filter((item) => item.status !== "Failed");
  sendState(true);
  return getState();
});

ipcMain.handle("clear-all", () => {
  items = items.filter((item) => item.status === "Converting");
  sendState(true);
  return getState();
});

ipcMain.handle("stop", () => {
  stopRequested = true;
  if (abortController) abortController.abort();
  sendState(true);
  return getState();
});

ipcMain.handle("start", async () => {
  if (running) {
    stopRequested = true;
    if (abortController) abortController.abort();
    sendState(true);
    return getState();
  }
  sevenZip = find7zip();
  if (!sevenZip) {
    sendState(true);
    return getState();
  }
  processQueue();
  return getState();
});

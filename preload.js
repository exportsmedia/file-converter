const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("converter", {
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  addDroppedPaths: (paths) => ipcRenderer.invoke("add-paths", paths),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || "";
    }
  },
  setSaveAs: (value) => ipcRenderer.invoke("set-save-as", value),
  setDeleteOriginal: (value) => ipcRenderer.invoke("set-delete-original", value),
  setCleanNames: (value) => ipcRenderer.invoke("set-clean-names", value),
  start: () => ipcRenderer.invoke("start"),
  stop: () => ipcRenderer.invoke("stop"),
  remove: (id) => ipcRenderer.invoke("remove", id),
  revealItem: (id) => ipcRenderer.invoke("reveal-item", id),
  clearQueue: () => ipcRenderer.invoke("clear-queue"),
  clearSkipped: () => ipcRenderer.invoke("clear-skipped"),
  clearFailed: () => ipcRenderer.invoke("clear-failed"),
  clearAll: () => ipcRenderer.invoke("clear-all"),
  getState: () => ipcRenderer.invoke("get-state"),
  windowControl: (action) => ipcRenderer.send("window-control", action),
  onQueueUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("queue-updated", listener);
    return () => ipcRenderer.removeListener("queue-updated", listener);
  },
});

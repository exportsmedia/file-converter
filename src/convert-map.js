(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ConvertMap = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CONVERT_MAP = {
    zip: [".cbr", ".rar", ".cb7"],
    cbz: [".cbr", ".rar", ".cb7"],
  };

  function extensionOf(name) {
    const base = String(name || "").split(/[/\\]/).pop() || "";
    const index = base.lastIndexOf(".");
    return index === -1 ? "" : base.slice(index).toLowerCase();
  }

  function canConvert(fileName, saveAs) {
    const ext = extensionOf(fileName);
    const target = String(saveAs || "zip").toLowerCase().replace(/^\./, "");
    const sources = CONVERT_MAP[target] || [];
    const targetExt = `.${target}`;

    if (!ext) {
      return { ok: false, reason: `Can't convert this file to ${target.toUpperCase()}` };
    }
    if (ext === targetExt) {
      return { ok: false, reason: `Already a ${target.toUpperCase()} file` };
    }
    if (!sources.includes(ext)) {
      return { ok: false, reason: `Can't convert ${ext} to ${target.toUpperCase()}` };
    }
    return { ok: true, reason: "" };
  }

  function outputPath(sourcePath, saveAs) {
    const target = String(saveAs || "zip").toLowerCase().replace(/^\./, "");
    return String(sourcePath).replace(/\.[^./\\]+$/i, `.${target}`);
  }

  return { CONVERT_MAP, extensionOf, canConvert, outputPath };
});

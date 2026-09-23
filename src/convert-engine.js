const { spawn } = require("child_process");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { canConvert, outputPath, extensionOf } = require("./convert-map");
const { cleanComicStem } = require("./comic-name");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const JUNK_NAMES = new Set(["__macosx", "thumbs.db", ".ds_store", "desktop.ini", ".apdisk"]);
const COMICINFO = "comicinfo.xml";
const ZIP_MAGICS = [Buffer.from("PK\x03\x04"), Buffer.from("PK\x05\x06"), Buffer.from("PK\x07\x08")];
const SEVEN_ZIP_CANDIDATES = [
  "C:\\Program Files\\7-Zip\\7z.exe",
  "C:\\Program Files (x86)\\7-Zip\\7z.exe",
  "/usr/bin/7z",
  "/usr/local/bin/7z",
  "/opt/homebrew/bin/7z",
  "/opt/homebrew/bin/7zz",
  "/usr/local/bin/7zz",
  "/usr/bin/7zz",
  "/usr/bin/7za",
];

class ConvertError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConvertError";
  }
}

class SkipError extends Error {
  constructor(message) {
    super(message);
    this.name = "SkipError";
  }
}

function find7zip() {
  for (const candidate of SEVEN_ZIP_CANDIDATES) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  const names = process.platform === "win32" ? ["7z.exe"] : ["7z", "7zz", "7za"];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of names) {
      const exe = path.join(dir, name);
      if (fsSync.existsSync(exe)) return exe;
    }
  }
  return null;
}

function naturalKey(name) {
  return String(name)
    .split(/(\d+)/)
    .map((part) => (part && /^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function compareNatural(a, b) {
  const left = naturalKey(a);
  const right = naturalKey(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

async function readMagic(filePath, size = 8) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(size);
    const result = await handle.read(buffer, 0, size, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function isZipFile(filePath) {
  const magic = await readMagic(filePath, 4);
  return ZIP_MAGICS.some((sig) => magic.subarray(0, sig.length).equals(sig));
}

function isJunkPath(filePath, root) {
  return path
    .relative(root, filePath)
    .split(path.sep)
    .some((part) => JUNK_NAMES.has(part.toLowerCase()));
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
  await walk(root);
  return found;
}

function uniqueArcname(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let index = 2;
  while (used.has(`${stem}_${index}${ext}`)) index += 1;
  const candidate = `${stem}_${index}${ext}`;
  used.add(candidate);
  return candidate;
}

async function collectComicFiles(extractRoot) {
  const all = await walkFiles(extractRoot);
  const candidates = all.filter((filePath) => {
    if (isJunkPath(filePath, extractRoot)) return false;
    const ext = path.extname(filePath).toLowerCase();
    return IMAGE_EXTS.has(ext) || path.basename(filePath).toLowerCase() === COMICINFO;
  });
  candidates.sort((a, b) => {
    const byName = compareNatural(path.basename(a), path.basename(b));
    return byName !== 0 ? byName : compareNatural(path.relative(extractRoot, a), path.relative(extractRoot, b));
  });
  const used = new Set();
  return candidates.map((filePath) => ({
    source: filePath,
    arcname: uniqueArcname(path.basename(filePath), used),
  }));
}

function run7z(sevenZip, args, { cwd, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZip, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const onChunk = (buf) => {
      const text = buf.toString("utf8");
      stdout += text;
      const matches = [...text.matchAll(/(\d{1,3})\s*%/g)];
      if (matches.length && onProgress) {
        onProgress(Number(matches[matches.length - 1][1]));
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", (buf) => {
      stderr += buf.toString("utf8");
      onChunk(buf);
    });
    const onAbort = () => child.kill();
    if (signal) {
      if (signal.aborted) child.kill();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", (err) => {
      reject(new ConvertError(`could not run 7-Zip: ${err.message}`));
    });
    child.on("close", (code) => {
      if (signal?.aborted) {
        reject(new ConvertError("cancelled"));
        return;
      }
      if (code === 0 || code === 1) {
        resolve({ stdout, stderr, code });
        return;
      }
      const lines = (stderr || stdout).trim().split(/\r?\n/).filter(Boolean);
      reject(new ConvertError(`7-Zip failed (${lines[lines.length - 1] || `exit ${code}`})`));
    });
  });
}

async function extractArchive(sevenZip, archive, dest, onProgress, signal) {
  await fs.mkdir(dest, { recursive: true });
  await run7z(sevenZip, ["x", archive, `-o${dest}`, "-y", "-bd", "-bsp1"], { onProgress, signal });
}

async function writeZip(sevenZip, dest, files, onProgress, signal) {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "fc-zip-"));
  try {
    for (const file of files) {
      await fs.copyFile(file.source, path.join(stage, file.arcname));
    }
    if (fsSync.existsSync(dest)) await fs.unlink(dest);
    await run7z(sevenZip, ["a", "-tzip", "-y", "-bd", "-bsp1", dest, "*"], {
      cwd: stage,
      onProgress,
      signal,
    });
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

function parseListedFiles(stdout) {
  const names = [];
  const filePart = String(stdout)
    .split(/\r?\n----------\s*\r?\n/)
    .slice(1)
    .join("\n----------\n");
  if (!filePart) return names;
  for (const block of `\n${filePart}`.split(/\nPath = /)) {
    const lines = block.split(/\r?\n/);
    const first = (lines[0] || "").trim();
    if (!first) continue;
    const folderLine = lines.find((line) => /^Folder = /.test(line.trim()));
    if (folderLine && folderLine.includes("+")) continue;
    if (first.endsWith("/") || first.endsWith("\\")) continue;
    names.push(path.basename(first.replace(/\\/g, "/")));
  }
  return names;
}

async function verifyZip(sevenZip, dest, expectedNames) {
  const stat = await fs.stat(dest).catch(() => null);
  if (!stat || stat.size <= 0) throw new ConvertError("output archive is missing or empty");
  await run7z(sevenZip, ["t", "-tzip", dest]);
  const listed = await run7z(sevenZip, ["l", "-slt", "-tzip", dest]);
  const names = parseListedFiles(listed.stdout);
  if (expectedNames.length !== names.length) {
    throw new ConvertError(
      `archive contents do not match (expected ${expectedNames.length} entries, got ${names.length})`
    );
  }
}

function scaleProgress(pct, start, end) {
  return start + ((end - start) * pct) / 100;
}

function targetExt(saveAs) {
  return String(saveAs || "zip").toLowerCase().replace(/^\./, "");
}

function resolveOutputPath(sourcePath, saveAs, { cleanNames = false, comicInfo } = {}) {
  if (!cleanNames) return outputPath(sourcePath, saveAs);
  const stem = cleanComicStem(path.basename(sourcePath), comicInfo);
  return path.join(path.dirname(sourcePath), `${stem}.${targetExt(saveAs)}`);
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function assertDestFree(dest) {
  if (fsSync.existsSync(dest)) {
    throw new SkipError(`${path.basename(dest)} already exists`);
  }
}

async function peekComicInfo(sevenZip, archivePath, signal) {
  if (!sevenZip) return null;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fc-info-"));
  try {
    try {
      await run7z(sevenZip, ["e", archivePath, "-tzip", `-o${tmp}`, "-y", "-bd", "-r", "ComicInfo.xml"], {
        signal,
      });
    } catch {
      return null;
    }
    const files = await walkFiles(tmp);
    const infoFile = files.find((file) => path.basename(file).toLowerCase() === COMICINFO);
    return infoFile ? await fs.readFile(infoFile) : null;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function renameMatchingFile({ sourcePath, saveAs, sevenZip, onProgress = () => {}, signal }) {
  const report = (pct) => onProgress(Math.max(0, Math.min(100, Math.round(pct))));
  report(10);
  const comicInfo = await peekComicInfo(sevenZip, sourcePath, signal);
  report(40);
  const dest = resolveOutputPath(sourcePath, saveAs, { cleanNames: true, comicInfo });
  if (samePath(dest, sourcePath)) {
    throw new SkipError("name already clean");
  }
  assertDestFree(dest);
  report(70);
  await fs.rename(sourcePath, dest);
  report(100);
  return { dest, detail: `renamed to ${path.basename(dest)}` };
}

async function convertFile({
  sourcePath,
  saveAs = "zip",
  deleteOriginal = true,
  cleanNames = true,
  sevenZip,
  onProgress = () => {},
  signal,
}) {
  const ext = extensionOf(sourcePath);
  const target = `.${targetExt(saveAs)}`;
  if (ext === target) {
    if (!cleanNames) {
      throw new SkipError(`Already a ${targetExt(saveAs).toUpperCase()} file`);
    }
    return renameMatchingFile({ sourcePath, saveAs, sevenZip, onProgress, signal });
  }

  const check = canConvert(sourcePath, saveAs);
  if (!check.ok) throw new SkipError(check.reason);

  const report = (pct) => onProgress(Math.max(0, Math.min(100, Math.round(pct))));
  const zipLike = await isZipFile(sourcePath);

  if (zipLike) {
    const dest = resolveOutputPath(sourcePath, saveAs, { cleanNames });
    assertDestFree(dest);
    report(20);
    await fs.copyFile(sourcePath, dest);
    report(80);
    if (sevenZip) await run7z(sevenZip, ["t", "-tzip", dest], { signal });
    if (deleteOriginal) await fs.unlink(sourcePath);
    report(100);
    return { dest, detail: `already ZIP, wrote ${path.basename(dest)}` };
  }

  if (!sevenZip) {
    throw new ConvertError("7-Zip is required to extract this archive");
  }

  if (!cleanNames) assertDestFree(outputPath(sourcePath, saveAs));

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fc-extract-"));
  let dest = resolveOutputPath(sourcePath, saveAs, { cleanNames });
  let partial = `${dest}.partial.zip`;
  try {
    if (fsSync.existsSync(partial)) await fs.unlink(partial);
    report(5);
    await extractArchive(sevenZip, sourcePath, tmp, (pct) => report(scaleProgress(pct, 10, 70)), signal);
    const files = await collectComicFiles(tmp);
    if (!files.length) throw new ConvertError("no pages (or ComicInfo.xml) found after extract");
    if (!files.some((file) => IMAGE_EXTS.has(extensionOf(file.arcname)))) {
      throw new ConvertError("archive extracted but contained no image pages");
    }
    if (cleanNames) {
      const infoFile = files.find((file) => file.arcname.toLowerCase() === COMICINFO);
      const comicInfo = infoFile ? await fs.readFile(infoFile.source) : null;
      dest = resolveOutputPath(sourcePath, saveAs, { cleanNames, comicInfo });
      partial = `${dest}.partial.zip`;
    }
    assertDestFree(dest);
    if (fsSync.existsSync(partial)) await fs.unlink(partial);
    report(72);
    await writeZip(sevenZip, partial, files, (pct) => report(scaleProgress(pct, 72, 92)), signal);
    await verifyZip(sevenZip, partial, files.map((file) => file.arcname));
    report(96);
    await fs.rename(partial, dest);
    if (deleteOriginal) await fs.unlink(sourcePath);
    report(100);
    const pages = files.filter((file) => IMAGE_EXTS.has(extensionOf(file.arcname))).length;
    return { dest, detail: `${pages} pages, wrote ${path.basename(dest)}` };
  } catch (err) {
    await fs.unlink(partial).catch(() => {});
    throw err;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

module.exports = {
  ConvertError,
  SkipError,
  find7zip,
  convertFile,
  isZipFile,
  parseListedFiles,
  resolveOutputPath,
};

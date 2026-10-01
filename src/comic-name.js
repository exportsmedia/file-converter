const path = require("path");

const YEAR_RE = /^(19|20)\d{2}$/;
const ISSUE_RANGE_RE = /^(\d{1,4})\s*-\s*(\d{1,4})$/;
const ISSUE_NUMBER_RE = /^(\d{1,4})(\.\d+)?$/;
const ISSUE_OF_RE = /^(\d{1,4})\s*OF\s*(\d{1,4})$/i;
const ISSUE_OF_ONLY_RE = /^OF\s*\d{1,4}$/i;
const ISSUE_AT_END_RE =
  /^(.*?)[\s_]+(?:#|no\.?\s*)?(\d{1,4}(?:\.\d+)?|\d{1,4}\s*-\s*\d{1,4})$/i;
const VOLUME_PREFIX_RE = /(?:^|[\s._-])(vol\.?|volume|v)$/i;
const PAREN_OR_BRACKET_RE = /[([].*?[\])]/g;
const ORPHAN_ISSUE_MARKER_RE = /(?:^|[\s_]+)(?:#|no\.?\s*)$/i;
const SCANNER_SITE_TOKEN_RE =
  /(?:^|[\s_]+)(?:GetComics(?:\.INFO)?|[A-Za-z][\w-]*\.(?:INFO|COM|NET|ORG|TO|CC))(?=[\s_]|$)/gi;
const WINDOWS_ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
const XML_TAG_RE = (tag) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");

function decodeXmlText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

function bufferToXml(input) {
  if (input == null) return "";
  if (!Buffer.isBuffer(input)) return String(input);
  if (input.length >= 2 && input[0] === 0xff && input[1] === 0xfe) {
    return input.toString("utf16le");
  }
  if (input.length >= 2 && input[0] === 0xfe && input[1] === 0xff) {
    const swapped = Buffer.from(input);
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    return input.toString("utf8");
  }
  if (input.length > 4 && input[1] === 0 && input[3] === 0) {
    return input.toString("utf16le");
  }
  return input.toString("utf8");
}

function xmlTag(xml, tag) {
  const match = String(xml || "").match(XML_TAG_RE(tag));
  return match ? decodeXmlText(match[1]) : "";
}

function padDigits(value) {
  return String(parseInt(value, 10)).padStart(3, "0");
}

function padIssue(raw) {
  const text = String(raw || "")
    .trim()
    .replace(/^#/, "");
  if (!text) return "";
  const ofMatch = text.match(ISSUE_OF_RE);
  if (ofMatch) return padDigits(ofMatch[1]);
  const range = text.match(ISSUE_RANGE_RE);
  if (range) return `${padDigits(range[1])}-${padDigits(range[2])}`;
  const number = text.match(ISSUE_NUMBER_RE);
  if (number) return `${padDigits(number[1])}${number[2] || ""}`;
  return text;
}

function sanitizeStem(stem) {
  let value = String(stem || "")
    .replace(WINDOWS_ILLEGAL, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!value) return "comic";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) return `_${value}`;
  return value;
}

function formatComicName({ series, number, year }) {
  const seriesName = sanitizeStem(series);
  if (!seriesName || seriesName === "comic") return "";
  const issue = padIssue(number);
  const yearText = YEAR_RE.test(String(year || "").trim()) ? String(year).trim() : "";
  let stem = issue ? `${seriesName} ${issue}` : seriesName;
  if (yearText) stem = `${stem} (${yearText})`;
  return sanitizeStem(stem);
}

function parseComicInfo(input) {
  const xml = bufferToXml(input);
  if (!xml || !/<comicinfo\b/i.test(xml)) return null;
  const series = xmlTag(xml, "Series");
  if (!series) return null;
  return {
    series,
    number: xmlTag(xml, "Number"),
    year: xmlTag(xml, "Year"),
  };
}

function nameFromComicInfo(input) {
  const parsed = parseComicInfo(input);
  if (!parsed) return "";
  return formatComicName(parsed);
}

function yearFromGroups(groups) {
  for (const group of groups) {
    const inner = String(group || "").trim();
    if (YEAR_RE.test(inner)) return inner;
    const range = inner.match(/^(19|20)\d{2}\s*-\s*(19|20)\d{2}$/);
    if (range) return inner.slice(0, 4);
  }
  return "";
}

function issueFromGroups(groups) {
  let issue = "";
  for (const group of groups) {
    const trimmed = String(group || "").trim();
    if (!trimmed) continue;
    const compact = trimmed.replace(/\s+/g, "");
    if (YEAR_RE.test(compact)) continue;
    if (ISSUE_OF_ONLY_RE.test(trimmed)) continue;
    const ofMatch = trimmed.match(ISSUE_OF_RE);
    if (ofMatch) {
      issue = ofMatch[1];
      continue;
    }
    if (ISSUE_NUMBER_RE.test(compact) || ISSUE_RANGE_RE.test(compact)) issue = compact;
  }
  return issue;
}

function isIssueLike(text) {
  const value = String(text || "")
    .trim()
    .replace(/^#/, "");
  if (!value) return false;
  if (ISSUE_OF_RE.test(value)) return true;
  const compact = value.replace(/\s+/g, "");
  return ISSUE_NUMBER_RE.test(compact) || ISSUE_RANGE_RE.test(compact);
}

function issueFromText(text) {
  const value = String(text || "")
    .trim()
    .replace(/^#/, "");
  const ofMatch = value.match(ISSUE_OF_RE);
  if (ofMatch) return ofMatch[1];
  return value.replace(/\s+/g, "");
}

function stripOrphanIssueMarker(text) {
  return String(text || "")
    .replace(ORPHAN_ISSUE_MARKER_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripScannerTags(text) {
  return String(text || "")
    .replace(SCANNER_SITE_TOKEN_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripExtension(fileName) {
  const base = String(fileName || "")
    .split(/[/\\]/)
    .pop() || "";
  return base.replace(/\.[^./\\]+$/i, "");
}

function folderBasename(folderName) {
  if (!folderName) return "";
  const base = path.basename(String(folderName).replace(/[/\\]+$/, ""));
  return base && base !== "." && base !== ".." ? base : "";
}

function parseStemParts(stem) {
  const text = String(stem || "").replace(/_+/g, " ");
  const groups = [...text.matchAll(PAREN_OR_BRACKET_RE)].map((match) =>
    match[0].slice(1, -1)
  );
  const year = yearFromGroups(groups);
  let number = issueFromGroups(groups);
  let series = stripScannerTags(
    text
      .replace(PAREN_OR_BRACKET_RE, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

  if (!number) {
    const issueMatch = series.match(ISSUE_AT_END_RE);
    if (issueMatch && !VOLUME_PREFIX_RE.test(issueMatch[1].trim())) {
      series = issueMatch[1].trim();
      number = issueMatch[2].replace(/\s+/g, "");
    }
  }

  series = stripOrphanIssueMarker(series);

  if (!number && isIssueLike(series)) {
    number = issueFromText(series);
    series = "";
  }

  return { series, number, year };
}

function parseFolderParts(folderName) {
  const stem = folderBasename(folderName).replace(/_+/g, " ");
  if (!stem) return { series: "", year: "" };
  const groups = [...stem.matchAll(PAREN_OR_BRACKET_RE)].map((match) =>
    match[0].slice(1, -1)
  );
  const year = yearFromGroups(groups);
  // Keep non-year paren text out of the series, but do not treat trailing
  // collection ranges (#001 - #713) as an issue number.
  let series = stem
    .replace(PAREN_OR_BRACKET_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  series = stripOrphanIssueMarker(series);
  return { series, year };
}

function nameFromFilename(fileName, folderName) {
  const parsed = parseStemParts(stripExtension(fileName));
  let { series, number, year } = parsed;

  if (!series || isIssueLike(series)) {
    if (isIssueLike(series) && !number) {
      number = issueFromText(series);
    }
    const folderParts = parseFolderParts(folderName);
    if (folderParts.series) {
      series = folderParts.series;
      if (!year && folderParts.year) year = folderParts.year;
    } else if (isIssueLike(series)) {
      series = "";
    }
  }

  return formatComicName({ series, number, year });
}

function cleanComicStem(fileName, comicInfo, folderName) {
  return nameFromComicInfo(comicInfo) || nameFromFilename(fileName, folderName);
}

function targetExt(saveAs) {
  return String(saveAs || "zip").toLowerCase().replace(/^\./, "");
}

function plannedOutputName(fileName, saveAs, { cleanNames = false, folderName } = {}) {
  const ext = targetExt(saveAs);
  if (!cleanNames) {
    return stripExtension(fileName) + `.${ext}`;
  }
  const folder = folderName || (fileName && fileName !== path.basename(fileName)
    ? path.dirname(fileName)
    : "");
  return `${cleanComicStem(path.basename(fileName), null, folder)}.${ext}`;
}

module.exports = {
  cleanComicStem,
  formatComicName,
  nameFromComicInfo,
  nameFromFilename,
  parseComicInfo,
  plannedOutputName,
  sanitizeStem,
};

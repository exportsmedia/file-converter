const YEAR_RE = /^(19|20)\d{2}$/;
const ISSUE_RANGE_RE = /^(\d{1,4})\s*-\s*(\d{1,4})$/;
const ISSUE_NUMBER_RE = /^(\d{1,4})(\.\d+)?$/;
const ISSUE_AT_END_RE =
  /^(.*?)[\s_]+(?:#|no\.?\s*)?(\d{1,4}(?:\.\d+)?|\d{1,4}\s*-\s*\d{1,4})$/i;
const VOLUME_PREFIX_RE = /(?:^|[\s._-])(vol\.?|volume|v)$/i;
const PAREN_OR_BRACKET_RE = /[([].*?[\])]/g;
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

function stripExtension(fileName) {
  const base = String(fileName || "")
    .split(/[/\\]/)
    .pop() || "";
  return base.replace(/\.[^./\\]+$/i, "");
}

function nameFromFilename(fileName) {
  const stem = stripExtension(fileName).replace(/_+/g, " ");
  const groups = [...stem.matchAll(PAREN_OR_BRACKET_RE)].map((match) =>
    match[0].slice(1, -1)
  );
  const year = yearFromGroups(groups);
  const stripped = stem
    .replace(PAREN_OR_BRACKET_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const issueMatch = stripped.match(ISSUE_AT_END_RE);
  if (issueMatch && !VOLUME_PREFIX_RE.test(issueMatch[1].trim())) {
    return formatComicName({
      series: issueMatch[1],
      number: issueMatch[2].replace(/\s+/g, ""),
      year,
    });
  }
  return formatComicName({ series: stripped, year });
}

function cleanComicStem(fileName, comicInfo) {
  return nameFromComicInfo(comicInfo) || nameFromFilename(fileName);
}

function targetExt(saveAs) {
  return String(saveAs || "zip").toLowerCase().replace(/^\./, "");
}

function plannedOutputName(fileName, saveAs, { cleanNames = false } = {}) {
  const ext = targetExt(saveAs);
  if (!cleanNames) {
    return stripExtension(fileName) + `.${ext}`;
  }
  return `${cleanComicStem(fileName)}.${ext}`;
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

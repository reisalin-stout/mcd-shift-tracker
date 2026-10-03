import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Minimal RFC-4180 CSV parser (handles quotes, escaped quotes, newlines in cells).
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, ""); // strip BOM
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Reads a CSV file into an array of objects keyed by lower-cased, trimmed header.
// Fully empty rows are dropped.
export function readCsvObjects(filePath) {
  const [header = [], ...data] = parseCsv(fs.readFileSync(filePath, "utf8"));
  const keys = header.map((h) => h.trim().toLowerCase());
  return data
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

// "1,5" / "1.5" / "" -> number (empty or invalid -> fallback)
export function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

// "Pomodori a Fette" -> "pomodori-a-fette"
export function slugify(text) {
  return text
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// dev/importer/config.json: { "spreadsheetId": "...", "keepTemp": true | false, "skipDownload": true | false }
export function loadImporterConfig() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "config.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

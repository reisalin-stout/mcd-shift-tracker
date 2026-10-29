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

// Importer settings come from the project's .env.local (the same private file the app uses for Firebase):
//   SPREADSHEET_ID, IMPORT_KEEP_TEMP (true/false), IMPORT_SKIP_DOWNLOAD (true/false), IMPORT_SKIP_UPLOAD (true/false)
// Variables already set in the environment win over the file, so CI or a one-off `SPREADSHEET_ID=... npm run update` works too.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const truthy = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
export function loadImporterConfig() {
  const file = path.join(ROOT, ".env.local");
  if (fs.existsSync(file)) process.loadEnvFile(file); // does not overwrite variables that are already set
  return {
    spreadsheetId: (process.env.SPREADSHEET_ID || "").trim(),
    keepTemp: truthy(process.env.IMPORT_KEEP_TEMP),
    skipDownload: truthy(process.env.IMPORT_SKIP_DOWNLOAD),
    skipUpload: truthy(process.env.IMPORT_SKIP_UPLOAD),
  };
}

// ---- Tab schemas -----------------------------------------------------------
// Simple tabs are described, not coded: an object of columns -> rules, run by parseTable().
//   const fields = { slug: slug(), category: text({ ref: "categories" }), yield: number() };
// The column header is the field name (case-insensitive; `column: "Other"` to read another one).
// Rules (options in { }):
//   text()    the cell as written
//   number()  a number ("1,5" and "1.5" both work); invalid or empty gives `fallback` (default 0)
//   slug()    text that is required and unique: the row's identity
//   required  rows with an empty value are skipped with a warning
//   unique    rows repeating an earlier value are skipped with a warning
//   ref       "<key>": the value must be a slug of that other tab; unknown ones are only warned about (see table())
//   check     (value) => message or nothing: a warning for suspicious values, the row is kept
export const text = (o = {}) => ({ kind: "text", ...o });
export const number = (o = {}) => ({ kind: "number", fallback: 0, ...o });
export const slug = (o = {}) => text({ required: true, unique: true, ...o });

export function parseTable(filePath, fields, tag) {
  const [header = [], ...rows] = parseCsv(fs.readFileSync(filePath, "utf8"));
  const columns = header.map((h) => h.trim().toLowerCase());
  const rules = Object.entries(fields).map(([name, rule]) => [name, rule, (rule.column ?? name).toLowerCase()]);
  for (const [, rule, column] of rules) {
    if (rule.required && !columns.includes(column)) throw new Error(`${tag} the tab has no "${column}" column`);
  }

  const seen = Object.fromEntries(rules.map(([name]) => [name, new Set()]));
  const out = [];
  for (const row of readCsvObjects(filePath)) {
    const item = {};
    let problem = "";
    for (const [name, rule, column] of rules) {
      const raw = row[column] ?? "";
      let value = rule.kind === "number" ? toNumber(raw, null) : raw;
      if (value === null || value === "") {
        if (rule.required) { problem = `no ${column}`; break; }
        value = rule.kind === "number" ? rule.fallback : "";
      } else if (rule.unique && seen[name].has(value)) { problem = `duplicate ${column} "${value}"`; break; }
      const message = rule.check?.(value);
      if (message) console.warn(`  ${tag} ${row[rules[0][2]] || "row"}: ${message}`);
      item[name] = value;
    }
    if (problem) { console.warn(`  ${tag} row skipped: ${problem}`); continue; }
    for (const [name, rule] of rules) if (rule.unique) seen[name].add(item[name]);
    out.push(item);
  }
  return out;
}

// A parser for a tab described by a schema: { tab, key, parse, check }.
// check(db) lists the values of `ref` fields that are not slugs of the referenced tab.
export function table(tab, key, fields, options = {}) {
  const refs = Object.entries(fields).filter(([, rule]) => rule.ref);
  return {
    tab,
    key,
    ...options,
    parse: (filePath) => parseTable(filePath, fields, `[${key}]`),
    check: (db) =>
      refs.flatMap(([name, rule]) => {
        const known = slugSet(db[rule.ref]);
        const unknown = [...new Set((db[key] || []).map((r) => r[name]).filter((v) => v && !known.has(v)))];
        return unknown.length ? [`${key}.${name} uses unknown ${rule.ref} slug(s): ${unknown.join(", ")}`] : [];
      }),
  };
}

// A parser for a tab that is just a list of slugs: stores ["a", "b", ...]
export const slugList = (tab, key, options = {}) => ({
  tab,
  key,
  ...options,
  parse: (filePath) => parseTable(filePath, { slug: slug() }, `[${key}]`).map((r) => r.slug),
});

// Set of slugs of a parsed tab, whether it is a list of slugs or of objects with a slug
export const slugSet = (list = []) => new Set(list.map((r) => (typeof r === "string" ? r : r.slug)));

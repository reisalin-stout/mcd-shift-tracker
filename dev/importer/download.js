// Downloads every tab of the spreadsheet as its own CSV into dev/importer/temp
// Can be run on its own:  node dev/importer/download.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Config ----------------------------------------------------------------
const KEY_FILE = path.resolve(__dirname, "./credentials.json");
const CONFIG_FILE = path.resolve(__dirname, "./config.json"); // { "spreadsheetId": "..." }
export const TEMP_DIR = path.resolve(__dirname, "temp");

function loadSpreadsheetId() {
  if (process.env.SPREADSHEET_ID) return process.env.SPREADSHEET_ID; // optional override
  if (!fs.existsSync(CONFIG_FILE)) throw new Error(`Config not found: ${CONFIG_FILE}`);
  const { spreadsheetId } = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  if (!spreadsheetId || spreadsheetId.startsWith("PUT_YOUR")) {
    throw new Error(`Set "spreadsheetId" in ${CONFIG_FILE}`);
  }
  return spreadsheetId;
}

// ---- Helpers ---------------------------------------------------------------
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

// Keep the sheet name as-is, only strip characters that are illegal in filenames.
function fileNameFor(sheetName) {
  return `${sheetName.replace(/[\\/:*?"<>|]/g, "_")}.csv`;
}

// Sheet names with spaces/special characters must be quoted in A1 notation.
function quoteSheetName(title) {
  return `'${title.replace(/'/g, "''")}'`;
}

// ---- Main ------------------------------------------------------------------
export async function downloadAll() {
  if (!fs.existsSync(KEY_FILE)) throw new Error(`Credentials not found: ${KEY_FILE}`);
  const spreadsheetId = loadSpreadsheetId();

  // Loaded lazily so --skip-download works even without googleapis installed
  const { google } = await import("googleapis");

  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = meta.data.sheets.map((s) => s.properties.title);

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: titles.map(quoteSheetName),
    // Raw values: numbers come through as plain numbers regardless of the
    // sheet's locale (avoids "1.234,5" style formatting issues)
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  // Start clean so stale CSVs from deleted tabs don't linger
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  for (const f of fs.readdirSync(TEMP_DIR)) {
    if (f.endsWith(".csv")) fs.unlinkSync(path.join(TEMP_DIR, f));
  }

  return titles.map((name, i) => {
    const rows = res.data.valueRanges[i].values || [];
    const filePath = path.join(TEMP_DIR, fileNameFor(name));
    fs.writeFileSync(filePath, toCsv(rows), "utf8");
    console.log(`Downloaded "${name}" -> ${path.relative(process.cwd(), filePath)} (${rows.length} rows)`);
    return { name, filePath };
  });
}

// Run directly: node dev/importer/download.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  downloadAll().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

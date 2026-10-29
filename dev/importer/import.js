// Main entry:  node dev/importer/import.js   (no command-line options, everything is set in .env.local)
//   1. downloads each tab of the Google Sheet as CSV into dev/importer/temp (or, with "skipDownload": true
//      (env var IMPORT_SKIP_DOWNLOAD in .env.local), uses the CSVs already in temp)
//   2. runs the matching parser (parsers/<tab>.js) for each tab and checks the result
//   3. backs up the current src/database.json into dev/database/, named after its last-modified time
//   4. writes the freshly imported data to src/database.json
//   5. parsers with a push() step send their changes back to the sheet (the Dictionary tab: new slugs + Status),
//      unless IMPORT_SKIP_UPLOAD=true or IMPORT_SKIP_DOWNLOAD=true (the CSVs may be out of date)
//   6. deletes the CSVs from dev/importer/temp, unless IMPORT_KEEP_TEMP=true in .env.local
// If the download or the parsing fails (or a required tab yields nothing), nothing is touched and temp is kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { downloadAll, TEMP_DIR } from "./download.js";
import { loadImporterConfig } from "./utils.js";

// Register one parser per tab type here.
// Order matters: a parser can use what the ones before it imported (the dictionary uses everything).
import categories from "./parsers/categories.js";
import products from "./parsers/products.js";
import areas from "./parsers/areas.js";
import tasks from "./parsers/tasks.js";
import buildups from "./parsers/buildups.js";
import types from "./parsers/types.js";
import timeframes from "./parsers/timeframes.js";
import dayparts from "./parsers/dayparts.js";
import dictionary from "./parsers/dictionary.js";
const parsers = [categories, products, areas, tasks, buildups, types, timeframes, dayparts, dictionary];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DB_FILE = path.join(ROOT, "src/database.json"); // the file the app reads
const STRUCTURE_FILE = path.join(ROOT, "src/structure.json");
const BACKUP_DIR = path.join(ROOT, "dev/database");
const rel = (p) => path.relative(process.cwd(), p);

const pad = (n) => String(n).padStart(2, "0");
// 2026-10-03_14-05-09 (local time)
const stamp = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
const normalize = (s) => s.replace(/\r\n/g, "\n");

// A parser is { tab, key, parse(filePath, { db, parsers, sheets }), required?, push?(options), check?(db) }
// (see parsers/; most are built with table() / slugList() from utils.js). Parsers run in registry order.
function parseSheets(sheets) {
  const db = {};
  for (const sheet of sheets) {
    if (!parsers.some((p) => p.tab.toLowerCase() === sheet.name.toLowerCase())) console.warn(`No parser for tab "${sheet.name}", skipped`);
  }
  for (const parser of parsers) {
    const sheet = sheets.find((s) => s.name.toLowerCase() === parser.tab.toLowerCase());
    if (!sheet) continue; // a missing required tab is reported by check()
    console.log(`Parsing "${sheet.name}"...`);
    const data = parser.parse(sheet.filePath, { db, parsers, sheets });
    if (data !== undefined) db[parser.key] = data;
  }
  return db;
}

// Throws if the result is unusable (so a good database.json is never replaced by an empty one);
// only warns about things that are wrong but do not make the data unusable.
function check(db) {
  for (const p of parsers) {
    if (p.required !== false && !db[p.key]?.length) throw new Error(`Nothing imported for "${p.tab}" (missing or empty tab), src/database.json left untouched`);
  }
  for (const p of parsers) for (const warning of p.check?.(db) ?? []) console.warn(warning);

  // The app shows a red banner for stock ids that do not exist, so warn here first
  if (fs.existsSync(STRUCTURE_FILE)) {
    const slugs = new Set(db.products.map((p) => p.slug));
    const structure = JSON.parse(fs.readFileSync(STRUCTURE_FILE, "utf8"));
    const missing = new Set();
    for (const dp of Object.values(structure))
      for (const [key, area] of Object.entries(dp))
        if (key !== "info") for (const slug of area.stock || []) if (!slugs.has(slug)) missing.add(slug);
    if (missing.size) {
      const list = [...missing];
      console.warn(`structure.json uses ${list.length} product slug(s) that are not in the imported data: ${list.slice(0, 12).join(", ")}${list.length > 12 ? ", ..." : ""}`);
    }
  }
}

// Copies src/database.json to dev/database/database-<last modified time>.json
function backupCurrent() {
  if (!fs.existsSync(DB_FILE)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const base = `database-${stamp(fs.statSync(DB_FILE).mtime)}`;
  let target = path.join(BACKUP_DIR, `${base}.json`);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(BACKUP_DIR, `${base}-${n}.json`);
  fs.copyFileSync(DB_FILE, target);
  return target;
}

function cleanTemp(sheets) {
  for (const s of sheets) fs.rmSync(s.filePath, { force: true });
  if (fs.existsSync(TEMP_DIR) && fs.readdirSync(TEMP_DIR).length === 0) fs.rmdirSync(TEMP_DIR);
  console.log("Cleaned up temp files");
}

// Options come from .env.local (IMPORT_SKIP_DOWNLOAD, IMPORT_KEEP_TEMP); the parameters only exist to override them in tests
export async function run({
  skipDownload = loadImporterConfig().skipDownload === true,
  skipUpload = loadImporterConfig().skipUpload === true,
  keepTemp = loadImporterConfig().keepTemp === true,
  download = downloadAll,
} = {}) {
  let sheets;
  if (skipDownload) {
    if (!fs.existsSync(TEMP_DIR)) throw new Error(`IMPORT_SKIP_DOWNLOAD is true but ${rel(TEMP_DIR)} does not exist: put the CSVs there or set it to false`);
    sheets = fs
      .readdirSync(TEMP_DIR)
      .filter((f) => f.endsWith(".csv"))
      .map((f) => ({ name: path.basename(f, ".csv"), filePath: path.join(TEMP_DIR, f) }));
  } else {
    sheets = await download();
  }

  const db = parseSheets(sheets);
  check(db);
  const next = JSON.stringify(db, null, 2) + "\n";

  if (fs.existsSync(DB_FILE) && normalize(fs.readFileSync(DB_FILE, "utf8")) === next) {
    console.log("src/database.json is already up to date, nothing written");
  } else {
    const backup = backupCurrent();
    if (backup) console.log(`Backed up the previous database to ${rel(backup)}`);
    fs.writeFileSync(DB_FILE, next, "utf8");
    console.log(`Wrote ${rel(DB_FILE)} (${Object.entries(db).map(([key, list]) => `${list.length} ${key}`).join(", ")})`);
  }

  // Send the parsers' own changes back to the sheet (only after everything above succeeded)
  for (const parser of parsers) {
    if (parser.push) {
      await parser.push({
        upload: !skipDownload && !skipUpload,
        skipReason: skipDownload ? "IMPORT_SKIP_DOWNLOAD is true, the CSVs may be out of date" : "IMPORT_SKIP_UPLOAD is true",
      });
    }
  }

  // keepTemp (IMPORT_KEEP_TEMP) true: keep the CSVs for debugging; false: delete them
  if (keepTemp) console.log(`Kept temp files in ${rel(TEMP_DIR)} (IMPORT_KEEP_TEMP is true in .env.local)`);
  else cleanTemp(sheets);
}

// Run directly: node dev/importer/import.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

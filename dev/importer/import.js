// Main entry:  node dev/importer/import.js   (no command-line options, everything is set in config.json)
//   1. downloads each tab of the Google Sheet as CSV into dev/importer/temp (or, with "skipDownload": true
//      in dev/importer/config.json, uses the CSVs already in temp)
//   2. runs the matching parser for each tab and checks the result
//   3. backs up the current src/database.json into dev/database/, named after its last-modified time
//   4. writes the freshly imported data to src/database.json
//   5. deletes the CSVs from dev/importer/temp, unless "keepTemp": true in dev/importer/config.json
// If the download or the parsing fails (or yields no categories/products), nothing is touched and temp is kept.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { downloadAll, TEMP_DIR } from "./download.js";
import { loadImporterConfig } from "./utils.js";

// Register one parser per tab type here.
import categories from "./parsers/categories.js";
import products from "./parsers/products.js";
const parsers = [categories, products];

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

function parseSheets(sheets) {
  const db = {};
  for (const sheet of sheets) {
    const parser = parsers.find((p) => p.tab.toLowerCase() === sheet.name.toLowerCase());
    if (!parser) {
      console.warn(`No parser for tab "${sheet.name}", skipped`);
      continue;
    }
    console.log(`Parsing "${sheet.name}"...`);
    db[parser.key] = parser.parse(sheet.filePath);
  }
  return db;
}

// Throws if the result is unusable (so a good database.json is never replaced by an empty one);
// only warns about things that are wrong but do not make the data unusable.
function check(db) {
  for (const p of parsers) {
    if (!db[p.key]?.length) throw new Error(`Nothing imported for "${p.tab}" (missing or empty tab), src/database.json left untouched`);
  }
  const known = new Set(db.categories.map((c) => c.slug));
  const unknown = new Set(db.products.map((p) => p.category).filter((c) => !known.has(c)));
  if (unknown.size) console.warn(`Products use unknown categories: ${[...unknown].join(", ")}`);

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

// Options come from dev/importer/config.json (skipDownload, keepTemp); the parameters only exist to override them in tests
export async function run({
  skipDownload = loadImporterConfig().skipDownload === true,
  keepTemp = loadImporterConfig().keepTemp === true,
  download = downloadAll,
} = {}) {
  let sheets;
  if (skipDownload) {
    if (!fs.existsSync(TEMP_DIR)) throw new Error(`skipDownload is true but ${rel(TEMP_DIR)} does not exist: put the CSVs there or set skipDownload to false`);
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
    console.log(`Wrote ${rel(DB_FILE)} (${db.categories.length} categories, ${db.products.length} products)`);
  }

  // keepTemp (config.json) true: keep the CSVs for debugging; false: delete them
  if (keepTemp) console.log(`Kept temp files in ${rel(TEMP_DIR)} (keepTemp is true in dev/importer/config.json)`);
  else cleanTemp(sheets);
}

// Run directly: node dev/importer/import.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

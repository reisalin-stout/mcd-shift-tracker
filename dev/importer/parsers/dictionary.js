import fs from "node:fs";
import { parseCsv } from "../utils.js";
import { KEY_FILE, loadSpreadsheetId, quoteSheetName } from "../download.js";

// The Dictionary tab holds the translations of every slug in the database.
// Columns: Slug, Status, Type, then one column per language (Subtype, Order, Note are kept if the tab has them).
//
// A run collects every slug seen in the imported data (each parser's own list, see collectSlugs) and updates the tab:
//   - slugs it does not know yet are appended (empty translations, Type = the key of the tab they were found in)
//   - Status is set on every row:
//       active   = the slug is in the database and has a translation for every language
//       missing  = the slug is in the database but a translation is still empty
//       outdated = the slug is in the Dictionary but not in the database any more
//   - the result is written back to the Google Sheet (push) and saved in database.json (key "dictionary")
// Rows are never deleted and their content is never changed except Status. With REORDER on, the rows are also put in
// the order of the database (tab by tab in the order of the parsers, then the order of each tab); outdated rows go last.
//
// Two steps, so a failed import never touches the sheet: parse() computes the new tab, push() uploads it
// (import.js calls push() only after the checks passed and database.json was written).

export const REORDER = true; // false: keep the rows where they are (new ones at the end)
export const LANGUAGES = ["Italian"]; // translation columns of the tab: add a language here to add a column

const STATUS = { active: "active", outdated: "outdated", missing: "missing" };
const STATUS_COLUMN = "Status";

const lower = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase();
const trimRow = (row) => {
  const r = row.map((c) => String(c ?? ""));
  while (r.length && r[r.length - 1] === "") r.pop();
  return r;
};

// Every slug of the imported data: Map<slug, { type }>: the slugs of each parser's list (strings or objects with a
// slug), with the parser's key as type.
export function collectSlugs(db, parsers) {
  const found = new Map();
  for (const p of parsers) {
    if (p.key === "dictionary" || !db[p.key]) continue;
    for (const r of db[p.key]) {
      const slug = typeof r === "string" ? r : r.slug;
      if (slug && !found.has(slug)) found.set(slug, { type: p.key });
    }
  }
  return found;
}

// csvText: the downloaded Dictionary tab. Returns
//   values  = the whole tab as a matrix (header + rows), ready to upload
//   entries = the same data as objects, for database.json
//   changed = false when the tab already looks like that
export function buildDictionary(csvText, found) {
  let rows = parseCsv(csvText).map(trimRow);
  if (!rows.length || rows[0].length === 0) rows = [["Slug"]];
  const original = rows.map((r) => [...r]);

  const header = rows[0].map((h) => h.trim());
  let data = rows.slice(1).filter((r) => r.some((c) => c.trim() !== ""));

  const slugCol = header.findIndex((h) => lower(h) === "slug");
  if (slugCol === -1) throw new Error('The "Dictionary" tab has no Slug column');

  // Status goes right after Slug, language columns at the end, when they do not exist yet
  if (!header.some((h) => lower(h) === "status")) {
    header.splice(slugCol + 1, 0, STATUS_COLUMN);
    data = data.map((r) => {
      const copy = [...r];
      while (copy.length < slugCol + 1) copy.push("");
      copy.splice(slugCol + 1, 0, "");
      return copy;
    });
  }
  for (const lang of LANGUAGES) if (!header.some((h) => lower(h) === lower(lang))) header.push(lang);

  const col = (name) => header.findIndex((h) => lower(h) === lower(name));
  const statusCol = col("status");
  const langCols = LANGUAGES.map(col);
  const width = header.length;
  data = data.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));

  const known = new Set();
  const counts = { active: 0, missing: 0, outdated: 0 };
  const outdated = [];
  for (const row of data) {
    const slug = row[slugCol].trim();
    if (!slug) continue;
    if (known.has(slug)) console.warn(`  [dictionary] duplicate slug "${slug}" in the Dictionary tab`);
    known.add(slug);

    const translated = langCols.every((c) => row[c].trim() !== "");
    const status = !found.has(slug) ? STATUS.outdated : translated ? STATUS.active : STATUS.missing;
    row[statusCol] = status;
    counts[status]++;
    if (status === STATUS.outdated) outdated.push(slug);
  }

  const added = [];
  for (const [slug, info] of found) {
    if (known.has(slug)) continue;
    const row = Array(width).fill("");
    row[slugCol] = slug;
    row[statusCol] = STATUS.missing;
    if (col("type") !== -1) row[col("type")] = info.type;
    data.push(row);
    added.push(slug);
    counts.missing++;
  }

  if (REORDER) {
    // found is in database order already (parser by parser, each tab in its own order); unknown slugs (outdated) go last, in their old order
    const rank = new Map([...found.keys()].map((slug, i) => [slug, i]));
    const at = (row) => rank.get(row[slugCol].trim()) ?? Number.MAX_SAFE_INTEGER;
    data.sort((a, b) => at(a) - at(b)); // stable: ties keep their current order
  }

  const values = [header, ...data];
  const changed = JSON.stringify(values.map(trimRow)) !== JSON.stringify(original.map(trimRow));

  const entries = data
    .filter((r) => r[slugCol].trim())
    .map((r) => {
      const entry = { slug: r[slugCol].trim(), status: r[statusCol], type: col("type") === -1 ? "" : r[col("type")].trim() };
      if (col("subtype") !== -1) entry.subtype = r[col("subtype")].trim();
      if (col("order") !== -1) {
        const order = r[col("order")].trim();
        entry.order = order !== "" && Number.isFinite(Number(order)) ? Number(order) : null;
      }
      if (col("note") !== -1) entry.note = r[col("note")].trim();
      entry.translations = Object.fromEntries(LANGUAGES.map((l, i) => [l, r[langCols[i]].trim()]));
      return entry;
    });

  return { values, entries, changed, summary: { ...counts, added, outdated } };
}

// Order is written as a number (like the rest of the sheet); everything else as plain text (RAW),
// so slugs and notes are never turned into formulas or dates.
function toSheetValues(values) {
  const orderCol = values[0].findIndex((h) => lower(h) === "order");
  return values.map((row, r) =>
    row.map((cell, c) => (r > 0 && c === orderCol && cell.trim() !== "" && Number.isFinite(Number(cell)) ? Number(cell) : cell)),
  );
}

export async function uploadDictionary(spreadsheetId, sheetName, values) {
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"], // read + write (download.js only needs read)
  });
  const sheets = google.sheets({ version: "v4", auth });

  // values.update fails outside the sheet's grid, so grow the grid first when rows/columns were added
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties)" });
  const props = meta.data.sheets.map((s) => s.properties).find((p) => p.title === sheetName);
  if (!props) throw new Error(`Tab "${sheetName}" not found in the spreadsheet`);
  const needRows = values.length;
  const needCols = Math.max(...values.map((r) => r.length));
  const { rowCount, columnCount } = props.gridProperties;
  if (needRows > rowCount || needCols > columnCount) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: props.sheetId,
                gridProperties: { rowCount: Math.max(rowCount, needRows), columnCount: Math.max(columnCount, needCols) },
              },
              fields: "gridProperties.rowCount,gridProperties.columnCount",
            },
          },
        ],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: toSheetValues(values) },
  });
}

let pending = null; // the new tab prepared by parse(), sent by push()

export default {
  tab: "Dictionary",
  key: "dictionary",

  // ctx.db = everything parsed so far, ctx.parsers = the registered parsers (to know where each slug comes from)
  parse(filePath, ctx = { db: {}, parsers: [], sheets: [] }) {
    const own = ctx.sheets.find((s) => s.filePath === filePath);
    const found = collectSlugs(ctx.db, ctx.parsers);
    const { values, entries, changed, summary } = buildDictionary(fs.readFileSync(filePath, "utf8"), found);
    pending = { sheetName: own?.name ?? "Dictionary", values, changed };

    const list = (a) => `${a.slice(0, 12).join(", ")}${a.length > 12 ? `, ... (+${a.length - 12})` : ""}`;
    console.log(`  [dictionary] ${summary.active} active, ${summary.missing} missing, ${summary.outdated.length} outdated`);
    if (summary.added.length) console.log(`  [dictionary] ${summary.added.length} new slug(s) need a translation: ${list(summary.added)}`);
    if (summary.outdated.length) console.log(`  [dictionary] ${summary.outdated.length} outdated slug(s): ${list(summary.outdated)}`);
    return entries;
  },

  // Writes the Dictionary tab back to the Google Sheet. Never throws: the database import does not depend on it.
  async push({ upload = true, skipReason = "" } = {}) {
    if (!pending) return;
    const { sheetName, values, changed } = pending;
    pending = null;
    if (!upload) return console.log(`Dictionary tab not updated${skipReason ? ` (${skipReason})` : ""}`);
    if (!changed) return console.log("Dictionary tab is already up to date");
    try {
      await uploadDictionary(loadSpreadsheetId(), sheetName, values);
      console.log(`Updated the "${sheetName}" tab in the Google Sheet`);
    } catch (err) {
      console.warn(`Could not update the Google Sheet: ${err.message}`);
      if (/permission|403|forbidden/i.test(err.message)) {
        console.warn("  The service account needs Editor access to the spreadsheet (Share, add the client_email from credentials.json as Editor)");
      }
    }
  },
};

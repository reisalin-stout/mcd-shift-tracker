// Private-file stripper: turns the owner's private JSON files into harmless templates with the SAME KEYS but
// blanked values, so the repo (and zips) can show which keys the project needs without any secret.
//
// Two files are handled (see TARGETS below):
//   dev/importer/credentials.json  ->  dev/importer/credentials.example.json   (Google service-account key)
//   dev/importer/config.json       ->  dev/importer/config.example.json        (importer settings, incl. the spreadsheet id)
//
//   node dev/credentials/stripper.js
//     rewrites every template whose real file exists. It runs automatically before `npm run build` and
//     `npm run update`. If a real file does not exist (a fresh clone, the GitHub Actions build) that target is
//     skipped with a one-line note and its template is left alone. It never fails.
//
// The compressor (dev/compressor/compressor.js) imports TARGETS and stripFile() to put stripped copies into
// normal zips, or nothing at all in private zips.
//
// Stripping rules: strings become "", numbers 0, booleans false, null stays null, arrays and objects keep their
// structure. Exception: the keys in a target's `keep` set hold public constants (not secrets), so their values
// are kept as a record of the expected defaults.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");

// The same public constants appear in every Google service-account key, so they are not secrets
const KEEP_CREDENTIALS = new Set(["type", "auth_uri", "token_uri", "auth_provider_x509_cert_url", "universe_domain"]);

// rel = path of the real (private, git-ignored) file; template = path of its committed, blanked copy
export const TARGETS = [
  { name: "credentials", rel: "dev/importer/credentials.json", template: "dev/importer/credentials.example.json", keep: KEEP_CREDENTIALS },
  { name: "config", rel: "dev/importer/config.json", template: "dev/importer/config.example.json", keep: new Set() },
];
export const abs = (rel) => path.join(ROOT, rel);

export function strip(value, keep = new Set(), key = "") {
  if (keep.has(key) && typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => strip(v, keep));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v, keep, k)]));
  if (typeof value === "string") return "";
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  return null;
}

export const stripFile = (file, keep) => strip(JSON.parse(fs.readFileSync(file, "utf8")), keep);
export const toJson = (obj) => JSON.stringify(obj, null, 2) + "\n";

// Writes the target's template next to the real file. Returns "missing" | "unchanged" | "updated".
export function writeTemplate(target) {
  const source = abs(target.rel), out = abs(target.template);
  if (!fs.existsSync(source)) return "missing";
  const next = toJson(stripFile(source, target.keep));
  if (fs.existsSync(out) && fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") === next) return "unchanged";
  fs.writeFileSync(out, next, "utf8");
  return "updated";
}

// Run directly: node dev/credentials/stripper.js (warns, never fails the npm script that calls it)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const t of TARGETS) {
    try {
      const result = writeTemplate(t);
      if (result === "updated") console.log(`Template updated: ${t.template}`);
      else if (result === "missing") console.log(`No ${t.rel} found, ${t.name} template left as it is`);
    } catch (err) {
      console.warn(`Could not update the ${t.name} template: ${err.message}`);
    }
  }
}

// Private-file stripper: turns the owner's private JSON files into harmless templates with the SAME KEYS but
// blanked values, so the repo (and zips) can show which keys the project needs without any secret.
//
// Two files are handled (see TARGETS below):
//   dev/importer/credentials.json  ->  dev/importer/credentials.example.json   (Google service-account key, JSON)
//   .env.local                     ->  .env.local.example                      (Firebase settings, spreadsheet id, importer
//                                                                                options: KEY=value lines)
//
//   node dev/credentials/stripper.js
//     rewrites every template whose real file exists. It runs automatically before `npm run build` and
//     `npm run update`. If a real file does not exist (a fresh clone, the GitHub Actions build) that target is
//     skipped with a one-line note and its template is left alone. It never fails.
//
// The compressor (dev/compressor/compressor.js) imports TARGETS (and LEGACY_PRIVATE) to know which real files must
// never go into a normal zip; only `npm run zip:all` adds them, on purpose.
//
// Stripping rules: JSON: strings become "", numbers 0, booleans false, null stays null, arrays and objects keep their
// structure. .env files: every `KEY=value` becomes `KEY=`; comments and blank lines are kept as they are.
// Exception: the keys in a target's `keep` set hold public constants (not secrets), so their values are kept as a
// record of the expected defaults.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "../..");

// The same public constants appear in every Google service-account key, so they are not secrets
const KEEP_CREDENTIALS = new Set(["type", "auth_uri", "token_uri", "auth_provider_x509_cert_url", "universe_domain"]);
// The mock login domain is the same for everyone and not a secret
const KEEP_ENV = new Set(["VITE_AUTH_EMAIL_DOMAIN"]);

// rel = path of the real (private, git-ignored) file; template = path of its committed, blanked copy
export const TARGETS = [
  { name: "credentials", rel: "dev/importer/credentials.json", template: "dev/importer/credentials.example.json", keep: KEEP_CREDENTIALS },
  { name: "env", rel: ".env.local", template: ".env.local.example", keep: KEEP_ENV, format: "env" },
];
// Real private files that are no longer used but may still lie around on a machine: never zip them either
export const LEGACY_PRIVATE = ["dev/importer/config.json"];
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

export const toJson = (obj) => JSON.stringify(obj, null, 2) + "\n";

// .env text: `KEY=value` -> `KEY=` (a `keep` key keeps its value); comments, blank lines and anything else stay
const ENV_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const envKeys = (text) => text.replace(/\r\n/g, "\n").split("\n").map((l) => l.match(ENV_LINE)?.[2]).filter(Boolean);
export function stripEnv(text, keep = new Set()) {
  return (
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => {
        const m = line.match(ENV_LINE);
        if (!m) return line;
        return keep.has(m[2]) ? `${m[1]}${m[2]}=${m[3].trim()}` : `${m[1]}${m[2]}=`;
      })
      .join("\n")
      .replace(/\n*$/, "\n")
  );
}

// The stripped text of a private file (JSON or .env, depending on the target), ready to be written.
// For .env files the existing template is the master for comments and key order (the real file usually has none), so
// regenerating never wipes the documentation: template keys stay, and keys only the real file has are appended.
export function renderTemplate(target, sourcePath, existingTemplate = "") {
  const raw = fs.readFileSync(sourcePath, "utf8");
  if (target.format !== "env") return toJson(strip(JSON.parse(raw), target.keep));
  if (!existingTemplate) return stripEnv(raw, target.keep);
  const known = new Set(envKeys(existingTemplate));
  const extra = envKeys(raw).filter((k) => !known.has(k));
  return stripEnv(existingTemplate, target.keep).replace(/\n$/, "") + (extra.length ? `\n\n# Added from .env.local\n${extra.map((k) => `${k}=`).join("\n")}` : "") + "\n";
}

// Writes the target's template next to the real file. Returns "missing" | "unchanged" | "updated".
export function writeTemplate(target) {
  const source = abs(target.rel), out = abs(target.template);
  if (!fs.existsSync(source)) return "missing";
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  const next = renderTemplate(target, source, current);
  if (current === next) return "unchanged";
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

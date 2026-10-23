// Zips the project with ONLY the paths listed in dev/compressor/include.json, so the zip is small and
// contains no node_modules, dist, backups, etc.
//   npm run zip                (or: node dev/compressor/compressor.js)
//   npm run zip:private        (also: npm run zip -- --private; the old names --nocredentials / --noconfig and
//                               npm run zip:nocredentials still work and mean exactly the same thing)
//
// The zip is always written to dev/compressor/output.zip (git-ignored) and never contains itself.
//
// include.json:
//   include  files or folders (relative to the project root); folders are added recursively
//   exclude  files or folders to leave out even if they are inside an included folder
//
// Always skipped, whatever include.json says: node_modules and .git folders, every file named credentials.json
// and dev/importer/config.json (the real private files must never end up in a zip).
//
// Private files (dev/importer/credentials.json and dev/importer/config.json, see dev/credentials/stripper.js):
//   normal zip   gets STRIPPED copies at their real paths (same keys, blanked values), so the required keys are
//                on record. Do not unzip such a zip back over the project: it would overwrite the real files.
//   private zip  gets NEITHER file, only the committed credentials.example.json and config.example.json. Use this
//                one for every zip that leaves your machine or comes back over the project.
// No npm dependencies: the zip file is written with node:zlib.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { TARGETS, abs as absOf, stripFile, toJson } from "../credentials/stripper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "include.json"), "utf8"));
const OUTPUT = path.join(__dirname, "output.zip");
// `npm run zip -- --private` passes an argument; `npm run zip --private` sets an npm env variable
const flag = (name) => process.argv.includes(`--${name}`) || process.env[`npm_config_${name}`] === "true";
const privateZip = ["private", "nocredentials", "noconfig"].some(flag);

const NEVER_DIRS = new Set(["node_modules", ".git"]);
const NEVER_FILES = new Set(["credentials.json"]);
const NEVER_PATHS = new Set(TARGETS.map((t) => t.rel)); // the real private files, by path
const norm = (p) => p.split(path.sep).join("/").replace(/^\.\//, "").replace(/\/+$/, "");
const excluded = (config.exclude || []).map(norm);
const isExcluded = (rel) => excluded.some((e) => rel === e || rel.startsWith(e + "/"));
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// ---- collect files ----
// relative path (forward slashes) -> { abs } for a file on disk, or { data, mtime } for generated content
const files = new Map();
const skipped = [];
function collect(rel) {
  const abs = path.join(ROOT, rel);
  const base = path.basename(rel);
  if (isExcluded(rel)) return skipped.push(rel);
  const st = fs.lstatSync(abs);
  if (st.isDirectory()) {
    if (NEVER_DIRS.has(base)) return skipped.push(rel + "/");
    for (const name of fs.readdirSync(abs).sort()) collect(`${rel}/${name}`);
  } else if (st.isFile()) {
    if (NEVER_FILES.has(base) || NEVER_PATHS.has(rel) || abs === OUTPUT) return skipped.push(rel);
    files.set(rel, { abs });
  }
}
for (const entry of config.include || []) {
  const rel = norm(entry);
  const abs = path.resolve(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) fail(`"${entry}" is outside the project`);
  if (!fs.existsSync(abs)) console.warn(`Not found, skipped: ${entry}`);
  else collect(rel);
}
if (!files.size) fail("Nothing to zip: check dev/compressor/include.json");

// ---- private files: stripped copies (never the real files), or nothing in a private zip ----
const privateNotes = [];
if ([...files.keys()].some((k) => k.startsWith("dev/importer/"))) {
  for (const t of TARGETS) {
    if (privateZip) {
      privateNotes.push(`${t.name}: no ${t.rel} added (private zip, only ${path.basename(t.template)})`);
      continue;
    }
    // Strip the real file if present, else the committed example, so the zip works on a fresh clone too
    const source = [t.rel, t.template].map(absOf).find((p) => fs.existsSync(p));
    try {
      if (!source) throw new Error(`neither ${path.basename(t.rel)} nor ${path.basename(t.template)} exists`);
      files.set(t.rel, { data: Buffer.from(toJson(stripFile(source, t.keep)), "utf8"), mtime: new Date() });
      privateNotes.push(`${t.name}: stripped ${t.rel} added (keys only, no private values)`);
    } catch (err) {
      privateNotes.push(`${t.name}: no ${t.rel} added (${err.message})`);
    }
  }
}

// ---- minimal zip writer ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const dosTime = (d) => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = (d) => (Math.max(d.getFullYear() - 1980, 0) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

const parts = [];
const central = [];
let offset = 0;
let totalSize = 0;
for (const [rel, item] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const data = item.data ?? fs.readFileSync(item.abs);
  const mtime = item.mtime ?? fs.statSync(item.abs).mtime;
  totalSize += data.length;
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const name = Buffer.from(rel, "utf8");
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
  local.writeUInt16LE(useDeflate ? 8 : 0, 8); // method
  local.writeUInt16LE(dosTime(mtime), 10);
  local.writeUInt16LE(dosDate(mtime), 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, name, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by
  local.copy(entry, 6, 4, 30); // version needed .. extra length (same fields as the local header)
  entry.writeUInt16LE(0, 32); // comment length
  entry.writeUInt16LE(0, 34); // disk number
  entry.writeUInt16LE(0, 36); // internal attributes
  entry.writeUInt32LE(0, 38); // external attributes
  entry.writeUInt32LE(offset, 42); // offset of the local header
  central.push(entry, name);
  offset += local.length + name.length + body.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.size, 8);
end.writeUInt16LE(files.size, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

fs.writeFileSync(OUTPUT, Buffer.concat([...parts, centralBuf, end]));

// ---- summary ----
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`Zipped ${files.size} files (${kb(totalSize)}) into ${path.relative(process.cwd(), OUTPUT) || OUTPUT} (${kb(fs.statSync(OUTPUT).size)})`);
console.log(`Mode: ${privateZip ? "PRIVATE zip" : "normal zip (stripped copies of private files, do not unzip over the project)"}`);
for (const n of privateNotes) console.log(`Private files, ${n}`);
if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);

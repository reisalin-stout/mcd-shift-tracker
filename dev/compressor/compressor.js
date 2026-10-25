// Zips the project from git's point of view. No npm dependencies (the zip is written with node:zlib). Needs a git repository.
//
//   npm run zip          Everything git knows about (tracked files + new, not yet committed ones) minus what .gitignore
//                        excludes. Contains no secrets. Written to dev/compressor/output.zip. The default: use this one.
//   npm run zip:private  The same + the git-ignored paths in ALSO_INCLUDE (the importer CSVs), still without secrets.
//                        Written to dev/compressor/output.zip. For sending debugging material while editing the data lists.
//   npm run zip:all      The same as zip:private + the REAL private files (.env.local, dev/importer/credentials.json).
//                        Written to dev/compressor/output-all.zip, a different file on purpose. For moving the whole
//                        folder privately; never commit it, never send it to anyone you do not fully trust.
//
// Both zip files are git-ignored (dev/compressor/*.zip) and never contain themselves.
//
// zip and zip:private never contain a real private file, even one committed by mistake: node_modules and .git, every
// file named credentials.json, .env.local and any other .env file that is not a .example template, and the old
// dev/importer/config.json are skipped (the committed .example templates travel instead).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TARGETS, LEGACY_PRIVATE } from "../credentials/stripper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
// `npm run zip -- --all` passes an argument; `npm run zip --all` sets an npm env variable
const flag = (name) => process.argv.includes(`--${name}`) || process.env[`npm_config_${name}`] === "true";
const MODE = flag("all") ? "all" : flag("private") ? "private" : "default";
const OUTPUT = path.join(__dirname, MODE === "all" ? "output-all.zip" : "output.zip");

// Git-ignored paths added in zip:private and zip:all, because whoever receives the zip needs them (skipped when missing).
// Keep this list tiny: it is the only thing to maintain.
const ALSO_INCLUDE = ["dev/importer/temp"]; // the importer's CSVs (they exist when IMPORT_KEEP_TEMP=true)

const NEVER_DIRS = new Set(["node_modules", ".git"]);
const NEVER_FILES = new Set(["credentials.json"]);
const NEVER_PATHS = new Set([...TARGETS.map((t) => t.rel), ...LEGACY_PRIVATE]); // the real private files, by path
const isPrivateEnv = (base) => /^\.env(\..+)?$/.test(base) && !base.endsWith(".example"); // .env, .env.local, .env.production.local ...
function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ---- collect files ----
// relative path (forward slashes) -> { abs } for a file on disk
const files = new Map();
const skipped = [];
function collect(rel) {
  const abs = path.join(ROOT, rel);
  const base = path.basename(rel);
  const st = fs.lstatSync(abs);
  if (st.isDirectory()) {
    if (NEVER_DIRS.has(base)) return skipped.push(rel + "/");
    for (const name of fs.readdirSync(abs).sort()) collect(`${rel}/${name}`);
  } else if (st.isFile()) {
    if (NEVER_FILES.has(base) || isPrivateEnv(base) || NEVER_PATHS.has(rel) || abs.startsWith(__dirname + path.sep + "output")) return skipped.push(rel);
    files.set(rel, { abs });
  }
}

// git's own view of the project: tracked + untracked-but-not-ignored files, minus tracked files that .gitignore now matches
function gitFiles() {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  try {
    git("rev-parse", "--is-inside-work-tree");
  } catch {
    fail("The zip commands need a git repository (and git installed): run them in your clone.");
  }
  const ignoredButTracked = new Set(git("ls-files", "-z", "--cached", "--ignored", "--exclude-standard"));
  return [...new Set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard"))].filter((f) => !ignoredButTracked.has(f));
}

for (const rel of gitFiles()) {
  if (rel.split("/").includes("node_modules") || !fs.existsSync(path.join(ROOT, rel))) continue; // tracked but deleted
  collect(rel);
}
if (MODE !== "default") for (const rel of ALSO_INCLUDE) if (fs.existsSync(path.join(ROOT, rel))) collect(rel);
const includedSecrets = [];
if (MODE === "all") {
  for (const t of TARGETS) { // the real private files, added on purpose (only in this mode)
    if (fs.existsSync(path.join(ROOT, t.rel))) { files.set(t.rel, { abs: path.join(ROOT, t.rel) }); includedSecrets.push(t.rel); }
  }
}
if (!files.size) fail("Nothing to zip: git lists no files");

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
console.log(
  MODE === "all"
    ? `Mode: ALL. CONTAINS REAL PRIVATE FILES (${includedSecrets.join(", ") || "none found"}): keep it private, never commit or publish it.`
    : `Mode: ${MODE === "private" ? "PRIVATE (git files + ALSO_INCLUDE)" : "DEFAULT (git files)"}, no real private files.`,
);
if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);

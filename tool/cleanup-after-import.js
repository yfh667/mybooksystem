// cleanup-after-import.js — tidy a project folder after running convert-mineru
// or import-paper/textbook. Archives the long-term MinerU assets into _source/,
// deletes one-off intermediate dumps, and removes the redundant outer images/
// folder when qmd/<chapter>/images/ holds the active copy.
//
// Usage:
//   node tool/cleanup-after-import.js [<project-folder>]
//
// If no argument given, uses PROJECT_ROOT env var, else cwd if cwd has
// _quarto.yml, else __dirname/.. (same resolution as the other scripts).
//
// Does NOT touch _book/, _pdf/, .quarto/, watcher logs — those are runtime
// artifacts that the watcher manages. Stop the watcher first and delete those
// manually if you need to.

const fs   = require('fs');
const path = require('path');

const cliArg = process.argv[2];
const PROJECT_ROOT = cliArg
  ? path.resolve(cliArg)
  : (process.env.PROJECT_ROOT
      ? path.resolve(process.env.PROJECT_ROOT)
      : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
          ? process.cwd()
          : path.join(__dirname, '..')));

if (!fs.existsSync(path.join(PROJECT_ROOT, '_quarto.yml'))) {
  console.error(`No _quarto.yml at ${PROJECT_ROOT} — not a project root.`);
  process.exit(1);
}
console.log(`Cleanup target: ${PROJECT_ROOT}`);

// --- Discover the MinerU basename(s) ------------------------------------
const rootEntries = fs.readdirSync(PROJECT_ROOT);
const basenames = new Set();
for (const f of rootEntries) {
  const m1 = f.match(/^(.+)_origin\.pdf$/);
  const m2 = f.match(/^(.+)_content_list\.json$/);
  const m3 = f.match(/^(.+)_layout\.pdf$/);
  const m4 = f.match(/^(.+)_middle\.json$/);
  const m5 = f.match(/^(.+)_model\.json$/);
  for (const m of [m1, m2, m3, m4, m5]) if (m) basenames.add(m[1]);
}

if (basenames.size === 0) {
  console.log('No MinerU artifacts at the project root.');
} else {
  console.log(`Detected MinerU basename(s): ${[...basenames].join(', ')}`);
}

// --- Helpers ------------------------------------------------------------
let archivedCount = 0, deletedCount = 0, bytesSaved = 0;
const sourceDir = path.join(PROJECT_ROOT, '_source');

function ensureSourceDir() {
  if (!fs.existsSync(sourceDir)) {
    fs.mkdirSync(sourceDir, { recursive: true });
    console.log(`Created _source/`);
  }
}

function archive(rel) {
  const src = path.join(PROJECT_ROOT, rel);
  if (!fs.existsSync(src)) return;
  ensureSourceDir();
  const dst = path.join(sourceDir, rel);
  fs.renameSync(src, dst);
  archivedCount++;
  console.log(`  archived  ${rel} -> _source/${rel}`);
}

function deleteFile(rel) {
  const fp = path.join(PROJECT_ROOT, rel);
  if (!fs.existsSync(fp)) return;
  const size = fs.statSync(fp).size;
  fs.unlinkSync(fp);
  deletedCount++;
  bytesSaved += size;
  console.log(`  deleted   ${rel} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

// --- Process each MinerU basename --------------------------------------
for (const base of basenames) {
  // Long-term keepers → _source/
  archive(`${base}.md`);
  archive(`${base}_content_list.json`);
  archive(`${base}_origin.pdf`);

  // One-off intermediates → delete
  deleteFile(`${base}_content_list_v2.json`);
  deleteFile(`${base}_middle.json`);
  deleteFile(`${base}_layout.pdf`);
  deleteFile(`${base}_model.json`);
}

// --- Outer images/ deduplication ---------------------------------------
const outerImages = path.join(PROJECT_ROOT, 'images');
const qmdImages   = path.join(PROJECT_ROOT, 'qmd', 'paper', 'images');

function dirSize(d) {
  let total = 0;
  for (const f of fs.readdirSync(d)) {
    const fp = path.join(d, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) total += dirSize(fp);
    else total += st.size;
  }
  return total;
}

if (fs.existsSync(outerImages) && fs.statSync(outerImages).isDirectory() &&
    fs.existsSync(qmdImages)   && fs.statSync(qmdImages).isDirectory()) {
  const outer = fs.readdirSync(outerImages).sort();
  const inner = fs.readdirSync(qmdImages).sort();
  const sameList = outer.length === inner.length && outer.every((f, i) => f === inner[i]);
  let sameContent = sameList;
  if (sameContent) {
    // sanity-check a handful of file sizes
    for (const f of outer.slice(0, 5)) {
      const oSize = fs.statSync(path.join(outerImages, f)).size;
      const iSize = fs.statSync(path.join(qmdImages,   f)).size;
      if (oSize !== iSize) { sameContent = false; break; }
    }
  }
  if (sameContent) {
    const size = dirSize(outerImages);
    fs.rmSync(outerImages, { recursive: true, force: true });
    bytesSaved += size;
    deletedCount++;
    console.log(`  deleted   images/ (duplicate of qmd/paper/images, ${(size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log(`  kept      images/ — content differs from qmd/paper/images, refusing to delete`);
  }
}

// --- Summary -----------------------------------------------------------
console.log(`\nDone. archived=${archivedCount} deleted=${deletedCount} saved=${(bytesSaved / 1024 / 1024).toFixed(2)} MB\n`);
console.log(`The following runtime/build artifacts are NOT touched by this script:`);
console.log(`  _book/  _pdf/  .quarto/  index.aux  index.log  index.pdf  index.tex  index.toc  watcher.*`);
console.log(`If you want those gone too, stop the watcher first (tool\\stop.cmd) and delete manually.`);

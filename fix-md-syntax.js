// fix-md-syntax.js — normalize MinerU-style markdown in existing .qmd files:
//   * \(...\)  → $...$
//   * \[...\]  → $$...$$
//   * <details><summary>label</summary>…</details>  → just the inner content
//
// Use this on a project that was imported BEFORE the normalizations were added
// to import-paper.js.
//
// Usage:
//   node tool/fix-md-syntax.js            (rewrites every .qmd under qmd/)
//   node tool/fix-md-syntax.js <file>     (rewrites a single .qmd)

const fs   = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const target = process.argv[2];

function normalize(txt) {
  // Math delimiters
  txt = txt.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);
  txt = txt.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`);

  // Strip <details><summary>...</summary>...</details> wrappers, keep inner content
  txt = txt.replace(/<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/g, '$1');
  txt = txt.replace(/<\/?details>/g, '');
  txt = txt.replace(/<summary>[^<]*<\/summary>/g, '');

  return txt;
}

function fixOne(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const next = normalize(txt);
  if (next !== txt) {
    fs.writeFileSync(file, next);
    return true;
  }
  return false;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.qmd')) out.push(p);
  }
}

let touched = 0, scanned = 0;
if (target) {
  scanned = 1;
  if (fixOne(path.resolve(target))) touched++;
} else {
  const qmdRoot = path.join(PROJECT_ROOT, 'qmd');
  if (!fs.existsSync(qmdRoot)) {
    console.error(`No qmd/ directory at ${qmdRoot}`);
    process.exit(1);
  }
  const files = [];
  walk(qmdRoot, files);
  for (const f of files) {
    scanned++;
    if (fixOne(f)) touched++;
  }
}
console.log(`fix-md-syntax: scanned ${scanned} file(s), rewrote ${touched}.`);

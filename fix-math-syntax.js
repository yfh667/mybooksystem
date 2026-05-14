// fix-math-syntax.js — convert MinerU-style \(...\) and \[...\] math delimiters
// in existing .qmd files to standard markdown $...$ and $$...$$, which Pandoc
// renders correctly for both HTML and PDF.
//
// Usage:
//   node tool/fix-math-syntax.js            (rewrites every .qmd under qmd/)
//   node tool/fix-math-syntax.js <file>     (rewrites a single .qmd)

const fs   = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const target = process.argv[2];

function fixOne(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const before = txt;
  txt = txt.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);
  txt = txt.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`);
  if (txt !== before) {
    fs.writeFileSync(file, txt);
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
console.log(`fix-math-syntax: scanned ${scanned} file(s), rewrote ${touched}.`);

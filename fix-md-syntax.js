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

function htmlTableToPipe(table) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(table)) !== null) {
    const cells = [];
    const cellRe = /<(t[dh])[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(m[1])) !== null) {
      const txt = c[2]
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
      cells.push(txt);
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return table;
  const maxCols = Math.max(...rows.map(r => r.length));
  for (const r of rows) while (r.length < maxCols) r.push('');
  const sep = Array(maxCols).fill('---');
  const out = [];
  out.push('| ' + rows[0].join(' | ') + ' |');
  out.push('| ' + sep.join(' | ') + ' |');
  for (let i = 1; i < rows.length; i++) out.push('| ' + rows[i].join(' | ') + ' |');
  return '\n' + out.join('\n') + '\n';
}

function normalize(txt) {
  // Math delimiters
  txt = txt.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);
  txt = txt.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`);

  // Strip <details><summary>...</summary>...</details> wrappers, keep inner content
  txt = txt.replace(/<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/g, '$1');
  txt = txt.replace(/<\/?details>/g, '');
  txt = txt.replace(/<summary>[^<]*<\/summary>/g, '');

  // Convert raw HTML tables to markdown pipe-tables
  txt = txt.replace(/<table[\s\S]*?<\/table>/gi, htmlTableToPipe);

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

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

function normalize(txt, file) {
  // Repair: previous runs of this script wrapped inline citations in $...$ or
  // $$...$$ which Pandoc-LaTeX could not handle. Undo those.
  txt = txt.replace(/\$\\\[\[(\d+)\]\(#ref-(\d+)\)\\\]\$/g, '\\[[$1](#ref-$2)\\]');
  txt = txt.replace(/\$\[(\d+)\]\$/g, '[$1]');
  txt = txt.replace(/\n?\$\$\s*\\?\[?\[(\d+)\]\(#ref-(\d+)\)\\?\]?\s*\$\$\n?/g, '\\[[$1](#ref-$2)\\]');
  txt = txt.replace(/\n?\$\$\s*\[(\d+)\]\s*\$\$\n?/g, '[$1]');

  // Math delimiters — but if the content is just a citation pattern (bare or
  // already-linked), MinerU mis-wrapped a citation as math; strip the wrapper
  // rather than converting it to $...$ / $$...$$.
  const looksLikeCitation = s => {
    const t = s.trim();
    if (/^\[?\d+\]?(\s*[,;\-–]\s*\[?\d+\]?)*$/.test(t)) return true;
    if (/^\[\d+\]\(#ref-\d+\)$/.test(t)) return true;
    return false;
  };
  // \(...\) with citation content: strip wrapper, leave bare [N] for the linker.
  // \[...\] with citation content: KEEP wrapper — those are escaped brackets that
  // render as the IEEE-style "[N]" markers in the final output.
  txt = txt.replace(/\\\(([\s\S]+?)\\\)/g, (full, m) => looksLikeCitation(m) ? m : `$${m}$`);
  txt = txt.replace(/\\\[([\s\S]+?)\\\]/g, (full, m) => looksLikeCitation(m) ? full : `\n$$\n${m.trim()}\n$$\n`);

  // Repair: previous runs of this script may have stripped the outer \[...\]
  // brackets, leaving bare "[N](#ref-N)" citation links without IEEE-style
  // brackets. Re-wrap them.
  txt = txt.replace(/(?<!\\\[)\[(\d+)\]\(#ref-(\d+)\)(?!\\\])/g, '\\[[$1](#ref-$2)\\]');

  // Strip <details><summary>...</summary>...</details> wrappers, keep inner content
  txt = txt.replace(/<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/g, '$1');
  txt = txt.replace(/<\/?details>/g, '');
  txt = txt.replace(/<summary>[^<]*<\/summary>/g, '');

  // Convert raw HTML tables to markdown pipe-tables
  txt = txt.replace(/<table[\s\S]*?<\/table>/gi, htmlTableToPipe);

  // Drop MinerU's auto-generated Mermaid blocks (figure already inserted as image)
  txt = txt.replace(/```mermaid[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n');

  // Hyperlink citations. Files whose name contains "references" are treated as
  // the bibliography: each [N] at line start becomes a {#ref-N} anchor.
  // Other files: [N] in body text becomes \[[N](#ref-N)\].
  const isRefs = /references/i.test(path.basename(file));
  if (isRefs) {
    txt = txt.replace(/(^|\n)\[(\d+)\](?!\{#ref-)/g, (_, p, n) => `${p}[${n}]{#ref-${n}}`);
  } else {
    txt = txt.replace(/\[(\d+)\](?!\(#ref-|\{#ref-)/g, (_, n) => `\\[[${n}](#ref-${n})\\]`);
  }

  return txt;
}

function fixOne(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const next = normalize(txt, file);
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

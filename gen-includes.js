// Folder-first convention:
//   Every content unit X is stored as <some-path>/X/X.qmd
//   Its subsections are sibling folders inside <some-path>/X/  (each a <name>/<name>.qmd unit)
//   Quarto's `{{< include >}}` resolves nested paths relative to the TOP-LEVEL chapter
//   file's directory, so we always emit paths relative to chapterDir.

const fs = require('fs');
const path = require('path');

// gen-includes.js lives in tool/; qmd/ is at the project root (one level up).
const ROOT_QMD = path.join(__dirname, '..', 'qmd');
const BEGIN = '<!-- AUTO-INCLUDES-BEGIN -->';
const END   = '<!-- AUTO-INCLUDES-END -->';

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function processQmd(qmdFile, chapterDir) {
  // qmdFile = .../<name>/<name>.qmd
  const dir = path.dirname(qmdFile);
  // siblings of qmdFile inside dir: each subfolder Y holds Y/Y.qmd
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const subFolders = entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  let includes = [];
  for (const sub of subFolders) {
    const candidate = path.join(dir, sub, sub + '.qmd');
    if (isFile(candidate)) {
      const rel = path.relative(chapterDir, candidate).split(path.sep).join('/');
      includes.push(rel);
      processQmd(candidate, chapterDir);
    }
  }
  updateMarkers(qmdFile, includes);
}

function updateMarkers(file, includes) {
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return; }

  const block = includes.map(p => `{{< include ${p} >}}`).join('\n');
  const replacement = block.length > 0
    ? `${BEGIN}\n${block}\n${END}`
    : `${BEGIN}\n${END}`;

  if (content.includes(BEGIN) && content.includes(END)) {
    const esc = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(esc(BEGIN) + '[\\s\\S]*?' + esc(END));
    const next = content.replace(re, replacement);
    if (next !== content) fs.writeFileSync(file, next, 'utf8');
  } else if (includes.length > 0) {
    const next = content.trimEnd() + '\n\n' + replacement + '\n';
    fs.writeFileSync(file, next, 'utf8');
  }
}

if (!isDir(ROOT_QMD)) { console.log('No qmd/ folder, skipping.'); process.exit(0); }

// Top-level chapter detection: each immediate subfolder Y of qmd/ that contains Y/Y.qmd
const chapterFolders = fs.readdirSync(ROOT_QMD, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

let count = 0;
for (const folder of chapterFolders) {
  const chapter = path.join(ROOT_QMD, folder, folder + '.qmd');
  if (isFile(chapter)) {
    processQmd(chapter, path.dirname(chapter));
    count++;
  }
}
console.log(`gen-includes: processed ${count} chapter file(s).`);

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

function findContentUnits(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const childDir = path.join(dir, entry.name);
    const qmdFile = path.join(childDir, entry.name + '.qmd');
    if (isFile(qmdFile)) out.push(qmdFile);
    findContentUnits(childDir, out);
  }
  return out;
}

function hasContentUnitAncestor(qmdFile) {
  let dir = path.dirname(path.dirname(qmdFile));
  while (dir.startsWith(ROOT_QMD) && dir !== ROOT_QMD) {
    const parentName = path.basename(dir);
    if (isFile(path.join(dir, parentName + '.qmd'))) return true;
    dir = path.dirname(dir);
  }
  return false;
}

if (!isDir(ROOT_QMD)) { console.log('No qmd/ folder, skipping.'); process.exit(0); }

const chapters = findContentUnits(ROOT_QMD)
  .filter(qmdFile => !hasContentUnitAncestor(qmdFile))
  .sort();

let count = 0;
for (const chapter of chapters) {
  processQmd(chapter, path.dirname(chapter));
  count++;
}
console.log(`gen-includes: processed ${count} chapter file(s).`);

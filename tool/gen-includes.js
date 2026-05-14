// Folder-first convention:
//   Every content unit X is stored as <some-path>/X/X.qmd
//   Its subsections are sibling folders inside <some-path>/X/  (each a <name>/<name>.qmd unit)
//   Quarto's `{{< include >}}` resolves nested paths relative to the TOP-LEVEL chapter
//   file's directory, so we always emit paths relative to chapterDir.

const fs = require('fs');
const path = require('path');

// Project root resolution:
//   - PROJECT_ROOT env var if set (central tool/ mode), else __dirname/..
//     (legacy embedded mode where tool/ is inside the project).
const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
      ? process.cwd()
      : path.join(__dirname, '..'));
const ROOT_QMD = path.join(PROJECT_ROOT, 'qmd');
const QUARTO_YML = path.join(PROJECT_ROOT, '_quarto.yml');
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

function relProject(file) {
  return path.relative(PROJECT_ROOT, file).split(path.sep).join('/');
}

function updateQuartoChapters(chapters) {
  if (!isFile(QUARTO_YML)) return 'no-yml';

  const chapterItems = chapters.map(relProject).sort();
  const yml = fs.readFileSync(QUARTO_YML, 'utf8');
  const lines = yml.split(/\r?\n/);
  const chaptersIdx = lines.findIndex(line => /^\s{2}chapters\s*:/.test(line));
  if (chaptersIdx < 0) return 'no-chapters';

  let endIdx = chaptersIdx + 1;
  while (endIdx < lines.length) {
    const line = lines[endIdx];
    if (line.trim() === '') break;
    if (/^\s{4}-\s+/.test(line) || /^\s{4,}#/.test(line)) {
      endIdx++;
      continue;
    }
    if (/^\s{2}\S/.test(line) || /^\S/.test(line)) break;
    endIdx++;
  }

  const existingItems = lines
    .slice(chaptersIdx + 1, endIdx)
    .map(line => line.match(/^\s{4}-\s+(.+?)\s*$/))
    .filter(Boolean)
    .map(match => match[1]);

  // Keep non-qmd manual entries, but make qmd/ chapter entries reflect the
  // folder-first source tree exactly. This removes stale moved/deleted chapters.
  const manualItems = existingItems
    .filter(item => item !== 'index.qmd' && !item.startsWith('qmd/'));

  const nextItems = ['index.qmd', ...manualItems, ...chapterItems];
  const seen = new Set();
  const replacement = nextItems
    .filter(item => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .map(item => `    - ${item}`);

  const currentBlock = lines.slice(chaptersIdx + 1, endIdx);
  if (currentBlock.join('\n') === replacement.join('\n')) return 'unchanged';

  lines.splice(chaptersIdx + 1, endIdx - chaptersIdx - 1, ...replacement);
  fs.writeFileSync(QUARTO_YML, lines.join('\n'), 'utf8');
  return 'updated';
}

if (!isDir(ROOT_QMD)) { console.log('No qmd/ folder, skipping.'); process.exit(0); }

const chapters = findContentUnits(ROOT_QMD)
  .filter(qmdFile => !hasContentUnitAncestor(qmdFile))
  .sort();

const ymlStatus = updateQuartoChapters(chapters);

let count = 0;
for (const chapter of chapters) {
  processQmd(chapter, path.dirname(chapter));
  count++;
}
console.log(`gen-includes: processed ${count} chapter file(s); _quarto.yml ${ymlStatus}.`);

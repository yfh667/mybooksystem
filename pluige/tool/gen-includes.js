// Chapter/content convention:
//   Top level: qmd/ai/ai.qmd is the only qmd allowed directly in qmd/ai/.
//   From the second level down, folders are containers and may hold many qmds:
//     qmd/ai/demo/simple.qmd
//     qmd/ai/demo/test.qmd
//   A qmd file X.qmd owns the sibling folder X/:
//     qmd/ai/demo/test.qmd includes entry qmds under qmd/ai/demo/test/.
//   Legacy folder-first units are also supported:
//     qmd/paper/01-chapter/01-chapter.qmd owns qmd/paper/01-chapter/.
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
const NO_AUTO_INCLUDES = '<!-- QmdTool: no-auto-includes -->';

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function shouldSkipDir(name) {
  return name.startsWith('.') ||
    name.startsWith('_') ||
    /\.bad-import(?:-|$)/.test(name) ||
    /(?:^|[-_])backup(?:[-_]|$)/i.test(name);
}

function targetHeadingLevel(qmdFile, chapterDir) {
  const rel = path.relative(chapterDir, qmdFile);
  const parts = rel.split(path.sep).filter(Boolean);
  return Math.max(1, parts.length);
}

function normalizeHeadingFloor(qmdFile, minTargetLevel) {
  if (minTargetLevel <= 1) return;

  let content = '';
  try { content = fs.readFileSync(qmdFile, 'utf8'); } catch { return; }

  const lines = content.split(/\r?\n/);
  const headingRe = /^(\uFEFF?)(#{1,6})(\s+.*)$/;
  const fenceRe = /^\s{0,3}(```+|~~~+)/;
  let inFence = false;
  let minLevel = 7;

  for (const line of lines) {
    if (fenceRe.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = line.match(headingRe);
    if (match) minLevel = Math.min(minLevel, match[2].length);
  }

  if (minLevel === 7 || minLevel >= minTargetLevel) return;

  const shift = minTargetLevel - minLevel;
  inFence = false;
  const next = lines.map(line => {
    if (fenceRe.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const match = line.match(headingRe);
    if (!match) return line;
    const level = Math.min(6, match[2].length + shift);
    return match[1] + '#'.repeat(level) + match[3];
  }).join('\n');

  if (next !== content) fs.writeFileSync(qmdFile, next, 'utf8');
}

function hasTopLevelHeading(content) {
  const fenceRe = /^\s{0,3}(```+|~~~+)/;
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (fenceRe.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^\uFEFF?#\s+/.test(line)) return true;
  }
  return false;
}

function insertAfterYaml(content, heading) {
  const lines = content.split(/\r?\n/);
  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line === '---');
    if (end > 0) {
      lines.splice(end + 1, 0, '', heading, '');
      return lines.join('\n');
    }
  }
  return heading + '\n\n' + content;
}

function ensureChapterHeading(qmdFile, chapterDir) {
  if (path.resolve(path.dirname(qmdFile)) !== path.resolve(chapterDir)) return;

  let content = '';
  try { content = fs.readFileSync(qmdFile, 'utf8'); } catch { return; }
  if (hasTopLevelHeading(content)) return;

  const title = path.basename(chapterDir);
  fs.writeFileSync(qmdFile, insertAfterYaml(content, '# ' + title), 'utf8');
}

function processQmd(qmdFile, chapterDir) {
  const dir = path.dirname(qmdFile);
  ensureChapterHeading(qmdFile, chapterDir);
  normalizeHeadingFloor(qmdFile, targetHeadingLevel(qmdFile, chapterDir));
  let content = '';
  try { content = fs.readFileSync(qmdFile, 'utf8'); } catch {}
  if (content.includes(NO_AUTO_INCLUDES)) {
    updateMarkers(qmdFile, []);
    return;
  }

  const isChapter = path.resolve(dir) === path.resolve(chapterDir);
  const isFolderNamedUnit = path.basename(dir) === path.basename(qmdFile, path.extname(qmdFile));
  const childRoot = isChapter
    ? chapterDir
    : isFolderNamedUnit
      ? dir
    : path.join(dir, path.basename(qmdFile, path.extname(qmdFile)));

  const childQmds = isDir(childRoot)
    ? collectEntryQmds(childRoot, qmdFile, { allowRootQmds: !isChapter })
    : [];

  const includes = childQmds.map(candidate => {
    processQmd(candidate, chapterDir);
    return path.relative(chapterDir, candidate).split(path.sep).join('/');
  });
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

function listQmdFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) listQmdFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.qmd')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function hasOwningQmdAncestor(qmdFile, scanRoot, ignoredOwner) {
  const scanRootResolved = path.resolve(scanRoot);
  const ignoredResolved = ignoredOwner ? path.resolve(ignoredOwner) : null;
  let dir = path.dirname(qmdFile);

  while (dir.startsWith(scanRootResolved)) {
    // New style: sibling owner, e.g. demo/test.qmd owns demo/test/.
    const siblingOwner = path.join(path.dirname(dir), path.basename(dir) + '.qmd');
    const siblingOwnerResolved = path.resolve(siblingOwner);
    if (isFile(siblingOwner) && siblingOwnerResolved !== ignoredResolved) return true;

    // Legacy style: folder-named owner, e.g. 01-chapter/01-chapter.qmd owns
    // everything below 01-chapter/.
    const folderNamedOwner = path.join(dir, path.basename(dir) + '.qmd');
    const folderNamedOwnerResolved = path.resolve(folderNamedOwner);
    if (
      isFile(folderNamedOwner) &&
      folderNamedOwnerResolved !== ignoredResolved &&
      path.resolve(qmdFile) !== folderNamedOwnerResolved
    ) {
      return true;
    }

    if (path.resolve(dir) === scanRootResolved) break;
    dir = path.dirname(dir);
  }
  return false;
}

function collectEntryQmds(scanRoot, ignoredOwner, options = {}) {
  const allowRootQmds = Boolean(options.allowRootQmds);
  const scanRootResolved = path.resolve(scanRoot);
  const ignoredResolved = ignoredOwner ? path.resolve(ignoredOwner) : null;

  return listQmdFiles(scanRoot)
    .filter(file => path.resolve(file) !== ignoredResolved)
    .filter(file => allowRootQmds || path.resolve(path.dirname(file)) !== scanRootResolved)
    .filter(file => !hasOwningQmdAncestor(file, scanRoot, ignoredOwner))
    .sort();
}

function findChapters() {
  const chapters = [];
  for (const entry of fs.readdirSync(ROOT_QMD, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (shouldSkipDir(entry.name)) continue;
    const chapterDir = path.join(ROOT_QMD, entry.name);
    const chapterFile = path.join(chapterDir, entry.name + '.qmd');
    if (isFile(chapterFile)) chapters.push(chapterFile);
  }
  return chapters.sort();
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

const chapters = findChapters();

const ymlStatus = updateQuartoChapters(chapters);

let count = 0;
for (const chapter of chapters) {
  processQmd(chapter, path.dirname(chapter));
  count++;
}
console.log(`gen-includes: processed ${count} chapter file(s); _quarto.yml ${ymlStatus}.`);

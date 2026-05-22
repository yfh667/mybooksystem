// QmdTool include policy:
//   - Every top-level folder under qmd/ has exactly one direct entry qmd.
//   - Other qmd files live under that folder's main/ directory.
//   - Include paths are written manually by the user.
//   - Heading levels are never changed automatically.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
      ? process.cwd()
      : path.join(__dirname, '..'));
const ROOT_QMD = path.join(PROJECT_ROOT, 'qmd');

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function listQmdFiles(dir, out = []) {
  if (!isDir(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listQmdFiles(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.qmd')) out.push(full);
  }
  return out;
}

function topLevelFolderStatus() {
  if (!isDir(ROOT_QMD)) return [];
  return fs.readdirSync(ROOT_QMD, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map(entry => {
      const folder = path.join(ROOT_QMD, entry.name);
      const directQmds = fs.readdirSync(folder, { withFileTypes: true })
        .filter(child => child.isFile() && child.name.toLowerCase().endsWith('.qmd'))
        .map(child => child.name);
      return { name: entry.name, directQmds };
    });
}

if (!isDir(ROOT_QMD)) {
  console.log('gen-includes: no qmd/ folder, skipping.');
  process.exit(0);
}

const qmdCount = listQmdFiles(ROOT_QMD).length;
const invalidFolders = topLevelFolderStatus().filter(item => item.directQmds.length !== 1);

if (invalidFolders.length > 0) {
  for (const item of invalidFolders) {
    console.log(
      `gen-includes: structure warning: qmd/${item.name} has ${item.directQmds.length} direct qmd file(s): ` +
      `${item.directQmds.join(', ') || '(none)'}`
    );
  }
}

console.log(
  `gen-includes: manual mode; scanned ${qmdCount} qmd file(s); ` +
  'no include, heading, or _quarto.yml changes.'
);

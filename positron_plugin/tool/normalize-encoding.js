// Normalize project text files to UTF-8 without BOM.
//
// Quarto can mis-detect chapter titles when a .qmd starts with a UTF-8 BOM
// before the first heading. This script removes BOM bytes from text files
// before render.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
      ? process.cwd()
      : path.join(__dirname, '..'));

const TEXT_EXT = new Set(['.qmd', '.md', '.yml', '.yaml', '.bib', '.csl']);
const SKIP_DIRS = new Set(['.git', '.quarto', '.qmdtool', '_book', '_pdf', 'node_modules']);

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function listTextFiles(dir, out = []) {
  if (!isDir(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listTextFiles(path.join(dir, entry.name), out);
    } else if (entry.isFile() && TEXT_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

let changed = 0;

for (const file of listTextFiles(PROJECT_ROOT)) {
  const bytes = fs.readFileSync(file);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fs.writeFileSync(file, bytes.subarray(3));
    changed++;
  }
}

console.log(`normalize-encoding: removed UTF-8 BOM from ${changed} file(s).`);

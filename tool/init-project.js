// init-project.js — bootstrap a new Quarto book project at <target-dir>.
//
// Result inside <target-dir>:
//   tool/                  ← copy of THIS tool/ folder (watch-render, serve, etc.)
//   _quarto.yml            ← minimal book config
//   index.qmd              ← Preface placeholder
//   qmd/                   ← empty, ready for `node tool/import-paper.js` or manual content
//   .vscode/settings.json  ← paste-image behavior
//   .gitignore             ← excludes _book/, _pdf/, log files, etc.
//
// Usage:
//   node tool/init-project.js <target-dir>            (uses local tool/ as source)
//   node tool/init-project.js <target-dir> --git      (git clone tool from GitHub)

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const useGit = args.includes('--git');
const target = args.find(a => !a.startsWith('--'));
if (!target) {
  console.error('Usage: node init-project.js <target-dir> [--git]');
  process.exit(1);
}

const targetAbs = path.resolve(target);
const TOOL_REPO = 'https://github.com/yfh667/mybooksystem.git';

console.log(`Bootstrapping Quarto book project at: ${targetAbs}`);
fs.mkdirSync(targetAbs, { recursive: true });

// ---------- tool/ ----------
const targetTool = path.join(targetAbs, 'tool');
if (fs.existsSync(targetTool)) {
  console.log(`  tool/ already exists, skipping.`);
} else if (useGit) {
  console.log(`  Cloning tool/ from ${TOOL_REPO}...`);
  execSync(`git clone --depth=1 "${TOOL_REPO}" "${targetTool}"`, { stdio: 'inherit' });
  // remove .git so it's not a nested repo (user can re-init if they want)
  fs.rmSync(path.join(targetTool, '.git'), { recursive: true, force: true });
} else {
  console.log(`  Copying tool/ from ${__dirname}...`);
  copyDirRecursive(__dirname, targetTool, name => name === '.git' || name === 'node_modules');
}

// ---------- _quarto.yml ----------
const ymlPath = path.join(targetAbs, '_quarto.yml');
if (!fs.existsSync(ymlPath)) {
  const projectName = path.basename(targetAbs);
  fs.writeFileSync(ymlPath, `project:
  type: book
  output-dir: _book

editor:
  render-on-save: false

book:
  title: "${projectName}"
  author: "Your Name"
  date: today
  chapters:
    - index.qmd

bibliography: references.bib
csl: ieee.csl
link-citations: true
link-bibliography: true
suppress-bibliography: true

format:
  html:
    theme: [cosmo]
    toc: true
    number-sections: true
    search: true
    include-in-header:
      - tool/autoreload.html
  pdf:
    pdf-engine: xelatex
    mainfont: "Times New Roman"
    documentclass: scrreprt
    toc: true
    number-sections: true
    include-in-header:
      text: |
        \\usepackage{xeCJK}
        \\setCJKmainfont{SimSun}
`);
  console.log('  Wrote _quarto.yml');
}

// ---------- index.qmd ----------
const indexPath = path.join(targetAbs, 'index.qmd');
if (!fs.existsSync(indexPath)) {
  fs.writeFileSync(indexPath, `# Preface {.unnumbered}

This is the home page of the book. Add chapters via \`node tool/import-paper.js\` or
manually by creating folders under \`qmd/\` and listing them in \`_quarto.yml\`.
`);
  console.log('  Wrote index.qmd');
}

// ---------- qmd/ ----------
const qmdDir = path.join(targetAbs, 'qmd');
if (!fs.existsSync(qmdDir)) {
  fs.mkdirSync(qmdDir);
  console.log('  Created qmd/');
}

// ---------- .vscode/settings.json ----------
const vscodeDir = path.join(targetAbs, '.vscode');
const settingsPath = path.join(vscodeDir, 'settings.json');
if (!fs.existsSync(settingsPath)) {
  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(settingsPath, `{
  "markdown.copyFiles.destination": {
    "**/*.qmd": "images/\${fileName}",
    "**/*.md":  "images/\${fileName}"
  },
  "markdown.editor.filePaste.enabled": true,
  "markdown.editor.drop.enabled": true,
  "markdown.editor.filePaste.copyIntoWorkspace": "mediaFiles",
  "markdown.editor.drop.copyIntoWorkspace": "mediaFiles"
}
`);
  console.log('  Wrote .vscode/settings.json');
}

// ---------- references.bib (empty stub) ----------
const bibPath = path.join(targetAbs, 'references.bib');
if (!fs.existsSync(bibPath)) {
  fs.writeFileSync(bibPath, '');
  console.log('  Wrote references.bib (empty)');
}

// ---------- ieee.csl ----------
const cslLocal = path.join(__dirname, '..', 'ieee.csl');
const cslPath  = path.join(targetAbs, 'ieee.csl');
if (!fs.existsSync(cslPath) && fs.existsSync(cslLocal)) {
  fs.copyFileSync(cslLocal, cslPath);
  console.log('  Copied ieee.csl');
}

// ---------- .gitignore ----------
const giPath = path.join(targetAbs, '.gitignore');
if (!fs.existsSync(giPath)) {
  fs.writeFileSync(giPath, `# Quarto outputs
_book/
_pdf/
.quarto/
.quarto-preview.*.log

# Runtime artifacts
.watcher.lock
.watcher-status.json
watcher.log
watcher.err.log
server.log
server.err.log

# OS / editor
.DS_Store
Thumbs.db
`);
  console.log('  Wrote .gitignore');
}

console.log(`
Done. Next steps:

  1.  Open ${targetAbs} in Positron
  2.  Import a paper (optional):
        cd "${targetAbs}"
        node tool/import-paper.js <some.md> <chapter-slug>
        (then add the line printed below into _quarto.yml under book.chapters)
  3.  Double-click  tool/start.cmd  to launch live preview
  4.  Open Simple Browser at  http://localhost:4321/split
`);

// -----------------------------------------------------------------------
function copyDirRecursive(src, dest, skipFn) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipFn && skipFn(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d, skipFn);
    else fs.copyFileSync(s, d);
  }
}

// convert-mineru.js — turn a MinerU output folder into a Quarto project,
// auto-detect paper vs textbook, run the right importer.
//
// Usage:
//   node tool/convert-mineru.js <target-folder>
//
// The target folder should already contain MinerU output:
//   test.md (or any *.md), test_content_list.json, images/, ...
//
// What it does:
//   1. Finds the .md file in the target folder.
//   2. Bootstraps the folder as a Quarto project if not already
//      (copies _quarto.yml, index.qmd, references.bib, ieee.csl,
//       autoreload.html, .vscode/settings.json from the
//       central mukuai folder, but NOT the tool/ folder).
//   3. Auto-detects which importer to use:
//        - has any H2 (## ...) heading → import-paper.js
//        - only H1 headings              → import-textbook.js
//   4. Runs the importer with chapter slug "paper".
//   5. Prints the watcher start command.

const fs   = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const target = path.resolve(process.argv[2] || '.');
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  console.error(`Folder not found: ${target}`);
  process.exit(1);
}
console.log(`Target: ${target}`);

// 1. Find the .md
const mds = fs.readdirSync(target).filter(f => f.toLowerCase().endsWith('.md'));
if (mds.length === 0) {
  console.error('No .md file in target folder.');
  console.error('Drop a MinerU-output markdown here first.');
  process.exit(1);
}
if (mds.length > 1) {
  console.log(`Multiple .md files found, picking the largest:`);
  mds.forEach(f => console.log('  ' + f));
}
const md = path.join(
  target,
  mds.sort((a, b) =>
    fs.statSync(path.join(target, b)).size - fs.statSync(path.join(target, a)).size)[0]
);
console.log(`Source:  ${md}`);

// 2. Bootstrap if needed
const TOOL_DIR = __dirname;
if (!fs.existsSync(path.join(target, '_quarto.yml'))) {
  console.log('Bootstrapping project (copying templates from mukuai)...');
  const newProj = path.join(TOOL_DIR, 'new-project.cmd');
  // shell: true is required so cmd.exe handles the .cmd extension on Windows
  const r = spawnSync(newProj, [target], { stdio: 'inherit', shell: true });
  if (r.status !== 0 || !fs.existsSync(path.join(target, '_quarto.yml'))) {
    console.error('Bootstrap failed. Re-run manually:');
    console.error(`  "${newProj}" "${target}"`);
    process.exit(1);
  }
} else {
  console.log('Project already bootstrapped (found _quarto.yml).');
}

// 3. Auto-detect importer
const content = fs.readFileSync(md, 'utf8');
const lines = content.split(/\r?\n/);
const h1 = lines.filter(l => /^#\s/.test(l)).length;
const h2 = lines.filter(l => /^##\s/.test(l)).length;
const h3 = lines.filter(l => /^###\s/.test(l)).length;
console.log(`Headings detected:  H1=${h1}  H2=${h2}  H3=${h3}`);

const importer = (h2 > 0 || h3 > 0)
  ? 'import-paper.js'
  : 'import-textbook.js';
console.log(`Using importer:   ${importer}`);

// 4. Run importer
const importPath = path.join(TOOL_DIR, importer);
const result = spawnSync(
  'node',
  [importPath, md, 'paper'],
  {
    cwd: target,
    stdio: 'inherit',
    env: { ...process.env, PROJECT_ROOT: target },
  }
);
if (result.status !== 0) {
  console.error(`\nImporter exited with code ${result.status}.`);
  process.exit(result.status);
}

// 5. Next steps
const startCmd = path.join(TOOL_DIR, 'start.cmd');
console.log(`
========================================================================
Done. To start live preview for this project:

  "${startCmd}" "${target}"

Then open Simple Browser in Positron at:
  http://localhost:4321/split
========================================================================
`);

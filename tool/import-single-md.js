// import-single-md.js - import one well-formed Markdown file as one QmdTool chapter.
//
// Usage:
//   cd C:\Users\Administrator\Desktop\my-new-knowledge
//   node C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\import-single-md.js "C:\path\to\textbook.md" ga-book
//
// Run from another folder:
//   node C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\import-single-md.js "C:\path\to\quarto_book" ga-book --project "C:\Users\Administrator\Desktop\my-new-knowledge"
//
// Folder input is also supported. If the input is a folder, this script picks
// textbook.md first, otherwise the largest .md file directly inside that folder.
//
// Example:
//   node C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\import-single-md.js "C:\Users\Administrator\Desktop\TEXTBOOK\gptbook\textbook_GA_workspace_full\quarto_book" ga-book

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
const projectArg = projectIndex >= 0 ? args[projectIndex + 1] : '';
if (projectIndex >= 0) args.splice(projectIndex, 2);

const [inputArg, slugArg] = args;

if (!inputArg) {
  console.error('Usage: node import-single-md.js <source.md-or-folder> [chapter-slug]');
  process.exit(1);
}

const PROJECT_ROOT = projectArg
  ? path.resolve(projectArg)
  : process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : process.cwd();

const TOOL_DIR = __dirname;
const REPO_ROOT = path.resolve(TOOL_DIR, '..');
const QUARTO_YML = path.join(PROJECT_ROOT, '_quarto.yml');
const QMD_ROOT = path.join(PROJECT_ROOT, 'qmd');

function isDir(file) {
  try { return fs.statSync(file).isDirectory(); } catch { return false; }
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function pickMarkdown(input) {
  const resolved = path.resolve(input);
  if (isFile(resolved)) {
    if (!resolved.toLowerCase().endsWith('.md')) {
      throw new Error(`Input file is not .md: ${resolved}`);
    }
    return resolved;
  }
  if (!isDir(resolved)) {
    throw new Error(`Input not found: ${resolved}`);
  }

  const files = fs.readdirSync(resolved)
    .filter(name => name.toLowerCase().endsWith('.md'))
    .map(name => path.join(resolved, name))
    .filter(isFile);

  if (files.length === 0) throw new Error(`No .md file found directly in: ${resolved}`);

  const textbook = files.find(file => path.basename(file).toLowerCase() === 'textbook.md');
  if (textbook) return textbook;

  return files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
}

function firstMarkdownTitle(mdFile) {
  const content = fs.readFileSync(mdFile, 'utf8');
  const match = content.match(/^\s*#\s+(.+?)\s*$/m);
  return match ? match[1].replace(/\s+#+\s*$/, '').trim() : 'Imported Markdown Book';
}

function copyFileIfExists(source, dest) {
  if (!isFile(source) || isFile(dest)) return false;
  fs.copyFileSync(source, dest);
  return true;
}

function bootstrapProjectIfNeeded(title) {
  if (isFile(QUARTO_YML)) return false;

  fs.mkdirSync(QMD_ROOT, { recursive: true });
  if (!isFile(path.join(PROJECT_ROOT, 'index.qmd'))) {
    fs.writeFileSync(
      path.join(PROJECT_ROOT, 'index.qmd'),
      `# ${title}\n\n`,
      'utf8',
    );
  }
  if (!isFile(path.join(PROJECT_ROOT, 'references.bib'))) {
    fs.writeFileSync(path.join(PROJECT_ROOT, 'references.bib'), '', 'utf8');
  }

  copyFileIfExists(path.join(REPO_ROOT, 'ieee.csl'), path.join(PROJECT_ROOT, 'ieee.csl'));
  copyFileIfExists(path.join(TOOL_DIR, 'autoreload.html'), path.join(PROJECT_ROOT, 'autoreload.html'));

  const yml = `project:
  type: book
  output-dir: _book

editor:
  render-on-save: false

execute:
  eval: false
  echo: true

book:
  title: "${title.replace(/"/g, '\\"')}"
  author: "Your Name"
  date: today
  chapters:
    - index.qmd

bibliography: references.bib
csl: ieee.csl
link-citations: true
link-bibliography: true
suppress-bibliography: false

format:
  html:
    theme: [cosmo]
    toc: true
    number-sections: false
    search: true
    include-in-header:
      - autoreload.html
  pdf:
    pdf-engine: xelatex
    mainfont: "Times New Roman"
    documentclass: scrreprt
    toc: true
    number-sections: false
    include-in-header:
      text: |
        \\usepackage{xeCJK}
        \\setCJKmainfont{SimSun}
        \\usepackage{fvextra}
        \\fvset{breaklines=true,breakanywhere=true}
`;
  fs.writeFileSync(QUARTO_YML, yml, 'utf8');
  return true;
}

function slugify(value) {
  const base = String(value || 'imported-md')
    .replace(/\.[^.]+$/, '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'imported-md';
}

function copyDir(source, dest) {
  if (!isDir(source)) return 0;
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      count++;
    }
  }
  return count;
}

function normalizeMarkdown(content) {
  return content
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/]\(image\//g, '](images/')
    .replace(/]\(\.\/image\//g, '](images/')
    .replace(/]\(\.\/images\//g, '](images/');
}

function ensureNoAutoIncludes(content) {
  if (content.includes('QmdTool: no-auto-includes')) return content;
  const lines = content.split(/\r?\n/);

  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line === '---');
    if (end > 0) {
      lines.splice(end + 1, 0, '<!-- QmdTool: no-auto-includes -->', '');
      return lines.join('\n');
    }
  }

  const firstHeading = lines.findIndex(line => /^#{1,6}\s+/.test(line));
  if (firstHeading >= 0) {
    lines.splice(firstHeading + 1, 0, '<!-- QmdTool: no-auto-includes -->');
    return lines.join('\n');
  }

  lines.unshift('# Imported Markdown', '<!-- QmdTool: no-auto-includes -->', '');
  return lines.join('\n');
}

function addChapterToQuarto(relChapter) {
  const yml = fs.readFileSync(QUARTO_YML, 'utf8');
  if (new RegExp(`^\\s*-\\s+${escapeRegExp(relChapter)}\\s*$`, 'm').test(yml)) {
    return 'unchanged';
  }

  const lines = yml.split(/\r?\n/);
  const chaptersIdx = lines.findIndex(line => /^\s{2}chapters\s*:/.test(line));
  if (chaptersIdx < 0) {
    throw new Error(`Cannot find book.chapters in ${QUARTO_YML}`);
  }

  let insertIdx = chaptersIdx + 1;
  while (insertIdx < lines.length && /^\s{4}-\s+/.test(lines[insertIdx])) {
    insertIdx++;
  }

  lines.splice(insertIdx, 0, `    - ${relChapter}`);
  fs.writeFileSync(QUARTO_YML, lines.join('\n'), 'utf8');
  return 'updated';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

try {
  const sourceMd = pickMarkdown(inputArg);
  const bootstrapped = bootstrapProjectIfNeeded(firstMarkdownTitle(sourceMd));
  const sourceDir = path.dirname(sourceMd);
  const slug = slugify(slugArg || path.basename(sourceMd, path.extname(sourceMd)));
  const chapterDir = path.join(QMD_ROOT, slug);
  const chapterFile = path.join(chapterDir, `${slug}.qmd`);
  const relChapter = path.relative(PROJECT_ROOT, chapterFile).split(path.sep).join('/');

  fs.mkdirSync(chapterDir, { recursive: true });

  const original = fs.readFileSync(sourceMd, 'utf8');
  const qmd = ensureNoAutoIncludes(normalizeMarkdown(original)).trimEnd() + '\n';
  fs.writeFileSync(chapterFile, qmd, 'utf8');

  const imagesCopied = copyDir(path.join(sourceDir, 'images'), path.join(chapterDir, 'images')) +
    copyDir(path.join(sourceDir, 'image'), path.join(chapterDir, 'images'));
  const ymlStatus = addChapterToQuarto(relChapter);

  console.log(`Imported source : ${sourceMd}`);
  console.log(`Chapter qmd     : ${chapterFile}`);
  console.log(`Images copied   : ${imagesCopied}`);
  console.log(`Bootstrapped    : ${bootstrapped ? 'yes' : 'no'}`);
  console.log(`_quarto.yml     : ${ymlStatus}`);
  console.log('');
  console.log('Render example:');
  console.log(`  cd ${PROJECT_ROOT}`);
  console.log('  quarto render --to html');
} catch (err) {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
}

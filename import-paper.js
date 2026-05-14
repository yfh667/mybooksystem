// import-paper.js — convert a MinerU-style single .md (with sibling images/ folder)
// into our Quarto book's folder-first chapter layout.
//
// Usage:
//   node tool/import-paper.js <source.md> <chapter-slug>
//
// Example:
//   node tool/import-paper.js "C:/Users/.../Performance_Analysis.md" isowc-paper
//
// Result:
//   qmd/<chapter-slug>/<chapter-slug>.qmd           ← title + abstract
//   qmd/<chapter-slug>/01-introduction/...          ← each H2 → folder
//   qmd/<chapter-slug>/02-system-model/...
//   qmd/<chapter-slug>/02-system-model/01-foo/...   ← each H3 → nested folder
//   qmd/<chapter-slug>/images/                      ← all images copied here
//
// Image paths in the source .md (e.g. images/abc.jpg) keep working because Quarto
// resolves include paths relative to the TOP-LEVEL chapter file, and images/ sits
// right next to that chapter file.

const fs   = require('fs');
const path = require('path');

const [, , srcPath, chapterSlug] = process.argv;
if (!srcPath || !chapterSlug) {
  console.error('Usage: node import-paper.js <source.md> <chapter-slug>');
  process.exit(1);
}
if (!fs.existsSync(srcPath)) {
  console.error('Source not found: ' + srcPath);
  process.exit(1);
}

const PROJECT_ROOT  = path.join(__dirname, '..');
const srcDir        = path.dirname(srcPath);
const srcImagesDir  = path.join(srcDir, 'images');
const chapterRoot   = path.join(PROJECT_ROOT, 'qmd', chapterSlug);
const chapterImages = path.join(chapterRoot, 'images');

// -----------------------------------------------------------------------
// Parse markdown into a heading tree
// -----------------------------------------------------------------------
function parse(md) {
  const lines = md.split(/\r?\n/);
  const root = { level: 0, title: '(root)', body: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const node = { level: m[1].length, title: m[2].trim(), body: [], children: [] };
      while (stack.length > 1 && stack[stack.length - 1].level >= node.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].body.push(line);
    }
  }
  return root;
}

// -----------------------------------------------------------------------
// Slugify a heading title for use as folder name
// -----------------------------------------------------------------------
function slugify(title, idx) {
  let s = title.toLowerCase();
  // Strip a leading "I.", "II.", "1.", "A.", "B." style numbering
  s = s.replace(/^(?:[ivxlcdm]+|[a-z]|[0-9]+)[\.\)]\s+/i, '');
  // Replace anything not alphanumeric with hyphen
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  // Truncate at word boundary if too long
  if (s.length > 35) {
    s = s.slice(0, 35).replace(/-[^-]*$/, '');
  }
  if (!s) s = 'section';
  return `${String(idx + 1).padStart(2, '0')}-${s}`;
}

// -----------------------------------------------------------------------
// Write a node + its children to disk
// -----------------------------------------------------------------------
function writeNode(node, dir, fileSlug, depth) {
  fs.mkdirSync(dir, { recursive: true });

  const headingHash = '#'.repeat(Math.min(6, Math.max(1, depth + 1)));
  // depth 0 → "#" (chapter), depth 1 → "##" (section), depth 2 → "###" (sub-section)
  // Use the source heading level directly if it's reasonable; else fall back to derived.
  const hash = node.level > 0 ? '#'.repeat(Math.min(6, node.level)) : headingHash;

  const body = node.body.join('\n').replace(/^\n+|\n+$/g, '');
  let qmd = '';
  qmd += `${hash} ${node.title}\n\n`;
  if (body) qmd += body + '\n\n';
  qmd += '<!-- AUTO-INCLUDES-BEGIN -->\n<!-- AUTO-INCLUDES-END -->\n';

  fs.writeFileSync(path.join(dir, fileSlug + '.qmd'), qmd);

  // Children — each becomes its own folder
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childSlug = slugify(child.title, i);
    writeNode(child, path.join(dir, childSlug), childSlug, depth + 1);
  }
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------
const content = fs.readFileSync(srcPath, 'utf8');
const root = parse(content);

// We expect exactly one H1 = chapter
const h1s = root.children.filter(c => c.level === 1);
if (h1s.length === 0) {
  console.error('No H1 heading found in source .md');
  process.exit(1);
}
const chapter = h1s[0];
// If there's content in root.body before the H1, prepend it to chapter body.
if (root.body.length) chapter.body = root.body.concat([''], chapter.body);
// Any extra H1s become extra H2 children of the chapter.
for (const extra of h1s.slice(1)) {
  extra.level = 2;
  chapter.children.push(extra);
}

if (fs.existsSync(chapterRoot)) {
  console.error(`Target already exists: ${chapterRoot}`);
  console.error('Refuse to overwrite. Move/rename it first.');
  process.exit(1);
}

console.log(`Importing "${chapter.title}"`);
console.log(`  Sections: ${chapter.children.length}`);
console.log(`  Target:   qmd/${chapterSlug}/`);

writeNode(chapter, chapterRoot, chapterSlug, 0);

// Copy images sibling-folder of the source .md
if (fs.existsSync(srcImagesDir)) {
  fs.mkdirSync(chapterImages, { recursive: true });
  const files = fs.readdirSync(srcImagesDir);
  for (const f of files) {
    fs.copyFileSync(path.join(srcImagesDir, f), path.join(chapterImages, f));
  }
  console.log(`  Copied ${files.length} images to qmd/${chapterSlug}/images/`);
} else {
  console.log('  (no images/ folder next to source .md, skipped)');
}

console.log(`
Done.

Next step — add this line to _quarto.yml under book.chapters:
  - qmd/${chapterSlug}/${chapterSlug}.qmd

Then save (watcher will auto-rebuild). The auto-includes will populate themselves.
`);

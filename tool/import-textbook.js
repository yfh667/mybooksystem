// import-textbook.js 鈥?convert a MinerU-style .md of a Chinese textbook
// into our Quarto book's folder-first chapter layout.
//
// Unlike import-paper.js, MinerU emits every heading in a textbook as H1.
// The real hierarchy is encoded in the heading TEXT's numbering prefix:
//   "绗?N 绔?鏍囬"      鈫?level 2 (a chapter inside the book)
//   "N.M 鏍囬"          鈫?level 3 (a section)
//   "N.M.K 鏍囬"        鈫?level 4 (a subsection)
//   "N.M.K.L 鏍囬"      鈫?level 5 (a sub-subsection)
//   "a. 鏍囬"           鈫?level 6 (deepest)
//   "鍐呭绠€浠? / "鍓嶈█" / "鐩綍" / etc.  鈫?level 2 (front-matter, sibling of chapters)
//
// Also, the source MD begins with a large TOC where every entry is an H1
// like "# 1.2 閬椾紶绠楁硶搴旂敤浜庣粍鍚堜紭鍖栭棶棰樼殑瀹炰緥鈥︹€?7". Those page-numbered
// entries are skipped 鈥?they're not content, just a table of contents.
//
// Usage:
//   node tool/import-textbook.js <source.md> <chapter-slug>

const fs   = require('fs');
const path = require('path');
const { classifyHeadingText } = require('./heading-normalizer');

const [, , srcPath, chapterSlug] = process.argv;
if (!srcPath || !chapterSlug) {
  console.error('Usage: node import-textbook.js <source.md> <chapter-slug>');
  process.exit(1);
}
if (!fs.existsSync(srcPath)) {
  console.error('Source not found: ' + srcPath);
  process.exit(1);
}

const PROJECT_ROOT  = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
      ? process.cwd()
      : path.join(__dirname, '..'));
const srcDir        = path.dirname(srcPath);
const srcImagesDir  = path.join(srcDir, 'images');
const chapterRoot   = path.join(PROJECT_ROOT, 'qmd', chapterSlug);
const chapterImages = path.join(chapterRoot, 'images');

// ----------------------------------------------------------------------
// Normalize MinerU-isms (same as import-paper.js)
// ----------------------------------------------------------------------
let content = fs.readFileSync(srcPath, 'utf8');
// MinerU OCR can leak invisible control characters (e.g. U+0003/U+000C).
// HTML mostly ignores them, but XeLaTeX fails with "invalid character".
content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
// Pandoc only recognizes inline math when the opening $ is not followed by
// whitespace and the closing $ is not preceded by whitespace.
content = content
  .replace(/\$\s+(?=[\\{A-Za-z0-9])/g, '$')
  .replace(/([\\}\]\)A-Za-z0-9])\s+\$/g, '$1$');

const looksLikeCitation = s => {
  const t = s.trim();
  if (/^\[?\d+\]?(\s*[,;\-\u2013\u2014]\s*\[?\d+\]?)*$/.test(t)) return true;
  if (/^\[\d{1,3}\]\(#ref-\d{1,3}\)$/.test(t)) return true;
  return false;
};
content = content.replace(/\\\(([\s\S]+?)\\\)/g, (full, m) => looksLikeCitation(m) ? m : `$${m}$`);
content = content.replace(/\\\[([\s\S]+?)\\\]/g, (full, m) => looksLikeCitation(m) ? full : `\n$$\n${m.trim()}\n$$\n`);

content = content.replace(/<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/g, '$1');
content = content.replace(/<\/?details>/g, '');
content = content.replace(/<summary>[^<]*<\/summary>/g, '');
content = content.replace(/<table[\s\S]*?<\/table>/gi, htmlTableToPipe);
content = content.replace(/```mermaid[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n');
content = content.replace(/\n\$\$\s*\\begin\{array\}c(?:\s+c){20,}\s*\$\$\n/g, '\n\n');

// (Citations in textbooks are usually less structured than papers; keep [N]鈫抣ink
// handling but tolerate the references section being missing.)
content = (function processCitations(s) {
  const m = s.match(/\n(#{1,6})\s+(?:references|bibliography|\u53c2\u8003\u6587\u732e)\b[^\n]*\n/i);
  if (!m) return s.replace(/\[(\d{1,3})\](?!\(#ref-|\{#ref-)/g, (_, n) => `\\[[${n}](#ref-${n})\\]`);
  const cut = m.index + m[0].length;
  const before  = s.slice(0, cut);
  const refsBody = s.slice(cut);
  const anchored = refsBody.replace(/(^|\n)\[(\d{1,3})\]/g, (_, p, n) => `${p}[${n}]{#ref-${n}}`);
  return before.replace(/\[(\d{1,3})\](?!\(#ref-|\{#ref-)/g, (_, n) => `\\[[${n}](#ref-${n})\\]`) + anchored;
})(content);
content = content.replace(/\s*\$\^\{([^$]*#ref-[^$]*)\}\$/g, (_, refs) => ` ${refs}`);

// ----------------------------------------------------------------------
// Parse heading text by number, not by the number of # characters.
// ----------------------------------------------------------------------
function classifyHeading(text) {
  return classifyHeadingText(text);
}

// ----------------------------------------------------------------------
// Parse the whole MD: collect heading segments and build a tree
// ----------------------------------------------------------------------
function parseTextbook(md) {
  const lines = md.split(/\r?\n/);

  // Collect every markdown heading. MinerU's # count is only a heading marker;
  // the real hierarchy is recovered from the numbering in the heading text.
  const segs = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\uFEFF?#{1,6}\s+(.+?)\s*$/);
    if (m) {
      if (cur) segs.push(cur);
      cur = { idx: i, title: m[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(lines[i]);
    }
  }
  if (cur) segs.push(cur);

  for (const s of segs) s.cls = classifyHeading(s.title);

  // Filter: drop TOC entries. Also drop the literal "鐩綍" front-matter (it's a TOC marker, not content).
  // Dedupe bare repeats (book title typically appears twice on title/spine page).
  const seenBare = new Set();
  const filtered = [];
  for (const s of segs) {
    if (s.cls.kind === 'toc') continue;
    if (s.cls.kind === 'front-matter' && s.cls.title === '鐩綍') continue;
    if (s.cls.kind === 'bare') {
      if (seenBare.has(s.title)) continue;
      seenBare.add(s.title);
    }
    filtered.push(s);
  }

  // Merge a chapter-without-title + following bare heading.
  // MinerU often splits "绗?绔燶n閬椾紶绠楁硶" into two H1s; rejoin them.
  for (let i = 0; i < filtered.length - 1; i++) {
    const a = filtered[i], b = filtered[i + 1];
    if (a.cls.kind === 'section' && a.cls.depth === 1 && !a.cls.title && b.cls.kind === 'bare') {
      a.cls.title = b.cls.text;
      a.title = a.title + ' ' + b.cls.text;
      a.body = a.body.concat(b.body);
      filtered.splice(i + 1, 1);
      i--;
    }
  }

  // Build tree. Map depths:
  //   bare = book title prelude 鈫?level 1 (the root chapter file paper.qmd)
  //   front-matter             鈫?level 2
  //   section depth N          鈫?level (N+1)
  //   capped at 6
  const root = { level: 0, title: '', body: [], children: [] };
  const stack = [root];
  for (const s of filtered) {
    let level;
    if (s.cls.kind === 'bare') {
      const parent = stack[stack.length - 1];
      level = parent && parent.level >= 2 ? Math.min(6, parent.level + 1) : 1;
    }
    else if (s.cls.kind === 'front-matter') level = 2;
    else if (s.cls.kind === 'preface') level = 2;
    else if (s.cls.kind === 'section') level = Math.min(6, s.cls.depth + 1);
    else continue;

    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node = { level, title: s.title, body: s.body, children: [], cls: s.cls };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

// ----------------------------------------------------------------------
// Slugify, htmlTableToPipe, writeNode, updateMarkers (copied from import-paper.js)
// ----------------------------------------------------------------------
function slugify(title, idx) {
  let s = title.toLowerCase();
  s = s.replace(/^(?:[ivxlcdm]+|[a-z]|[0-9]+)[\.\)]\s+/i, '');
  s = s.replace(/[^\p{L}\p{N}]+/gu, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (s.length > 25) s = s.slice(0, 25).replace(/-[^-]*$/, '') || s.slice(0, 25);
  if (!s) s = 'section';
  return `${String(idx + 1).padStart(2, '0')}-${s}`;
}

function htmlTableToPipe(table) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(table)) !== null) {
    const cells = [];
    const cellRe = /<(t[dh])[^>]*>([\s\S]*?)<\/\1>/gi;
    let c;
    while ((c = cellRe.exec(m[1])) !== null) {
      cells.push(c[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return table;
  const maxCols = Math.max(...rows.map(r => r.length));
  for (const r of rows) while (r.length < maxCols) r.push('');
  const sep = Array(maxCols).fill('---');
  const out = ['| ' + rows[0].join(' | ') + ' |', '| ' + sep.join(' | ') + ' |'];
  for (let i = 1; i < rows.length; i++) out.push('| ' + rows[i].join(' | ') + ' |');
  return '\n' + out.join('\n') + '\n';
}

function writeNode(node, dir, fileSlug, depth) {
  fs.mkdirSync(dir, { recursive: true });
  const hash = '#'.repeat(Math.min(6, Math.max(1, node.level || (depth + 1))));
  const body = node.body.join('\n').replace(/^\n+|\n+$/g, '');
  let qmd = `${hash} ${node.title}\n\n`;
  if (body) qmd += body + '\n\n';
  qmd += '<!-- AUTO-INCLUDES-BEGIN -->\n<!-- AUTO-INCLUDES-END -->\n';
  fs.writeFileSync(path.join(dir, fileSlug + '.qmd'), qmd);
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childSlug = slugify(child.title, i);
    writeNode(child, path.join(dir, childSlug), childSlug, depth + 1);
  }
}

function cloneWithLevelShift(node, shift) {
  return {
    ...node,
    level: Math.min(6, Math.max(1, node.level + shift)),
    children: node.children.map(child => cloneWithLevelShift(child, shift)),
  };
}

function adjustChapterImagePaths(node) {
  return {
    ...node,
    body: node.body.map(line => line
      .replace(/(!\[[^\]]*\]\()images\//g, '$1../images/')
      .replace(/(<img\b[^>]*\bsrc=["'])images\//gi, '$1../images/')),
    children: node.children.map(adjustChapterImagePaths),
  };
}

function writeIndex(bookNode, frontMatterNodes) {
  const indexPath = path.join(PROJECT_ROOT, 'index.qmd');
  const parts = [`# ${bookNode.title}`];
  const coverBody = bookNode.body.join('\n').replace(/^\n+|\n+$/g, '');
  if (coverBody) parts.push(coverBody);

  for (const node of frontMatterNodes) {
    const body = node.body.join('\n').replace(/^\n+|\n+$/g, '');
    parts.push(`## ${node.title}${body ? `\n\n${body}` : ''}`);
  }

  fs.writeFileSync(indexPath, parts.join('\n\n') + '\n');
}

function collectBookChapters(bookNode) {
  const frontMatterNodes = [];
  const chapterNodes = [];

  const visit = node => {
    if (node.cls && node.cls.kind === 'front-matter') {
      frontMatterNodes.push(node);
      return;
    }
    if (node.cls && node.cls.kind === 'preface') {
      chapterNodes.push(node);
      return;
    }
    if (node.cls && node.cls.kind === 'section' && node.cls.depth === 1) {
      chapterNodes.push(node);
      return;
    }
    for (const child of node.children || []) visit(child);
  };

  for (const child of bookNode.children || []) visit(child);

  return { frontMatterNodes, chapterNodes: mergeRepeatedBackMatter(chapterNodes) };
}

function collectBookChaptersFrom(nodes) {
  return collectBookChapters({ children: nodes });
}

function mergeRepeatedBackMatter(chapterNodes) {
  const out = [];
  const seen = new Map();
  for (const node of chapterNodes) {
    const key = (node.title || '').trim().toLowerCase();
    const shouldMerge = /^(?:preface|foreword|references|bibliography|index)$/.test(key);
    if (shouldMerge && seen.has(key)) {
      const target = seen.get(key);
      target.body = target.body.concat([''], node.body || []);
      target.children = target.children.concat(node.children || []);
      continue;
    }
    out.push(node);
    if (shouldMerge) seen.set(key, node);
  }
  return out;
}

function writeBookChapters(chapterNodes) {
  fs.mkdirSync(chapterRoot, { recursive: true });
  const chapterFiles = [];
  for (let i = 0; i < chapterNodes.length; i++) {
    const chapter = chapterNodes[i];
    const slug = slugify(chapter.title, i);
    const shifted = cloneWithLevelShift(chapter, 1 - chapter.level);
    writeNode(adjustChapterImagePaths(shifted), path.join(chapterRoot, slug), slug, 0);
    chapterFiles.push(`qmd/${chapterSlug}/${slug}/${slug}.qmd`);
  }
  return chapterFiles;
}

function updateQuartoChapters(chapterFiles) {
  const ymlPath = path.join(PROJECT_ROOT, '_quarto.yml');
  if (!fs.existsSync(ymlPath)) return false;

  const lines = fs.readFileSync(ymlPath, 'utf8').split(/\r?\n/);
  const chaptersIdx = lines.findIndex(line => /^\s{2}chapters\s*:/.test(line));
  if (chaptersIdx < 0) return false;

  let endIdx = chaptersIdx + 1;
  while (endIdx < lines.length) {
    const line = lines[endIdx];
    if (line.trim() === '') {
      endIdx++;
      continue;
    }
    if (/^\s{4}-\s+/.test(line)) {
      endIdx++;
      continue;
    }
    if (/^\s{2}\S/.test(line) || /^\S/.test(line)) break;
    endIdx++;
  }

  const existing = lines
    .slice(chaptersIdx + 1, endIdx)
    .map(line => line.match(/^\s{4}-\s+(.+?)\s*$/))
    .filter(Boolean)
    .map(match => match[1])
    .filter(item => item !== 'index.qmd' && !item.startsWith(`qmd/${chapterSlug}/`));

  const replacement = [
    '    - index.qmd',
    ...existing.map(item => `    - ${item}`),
    ...chapterFiles.map(item => `    - ${item}`),
  ];

  lines.splice(chaptersIdx + 1, endIdx - chaptersIdx - 1, ...replacement);
  fs.writeFileSync(ymlPath, lines.join('\n'));
  return true;
}

function updateQuartoBookTitle(title) {
  const ymlPath = path.join(PROJECT_ROOT, '_quarto.yml');
  if (!fs.existsSync(ymlPath)) return false;

  const lines = fs.readFileSync(ymlPath, 'utf8').split(/\r?\n/);
  const titleIdx = lines.findIndex(line => /^\s{2}title\s*:/.test(line));
  if (titleIdx < 0) return false;

  const escaped = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  lines[titleIdx] = `  title: "${escaped}"`;
  fs.writeFileSync(ymlPath, lines.join('\n'));
  return true;
}

function disableQuartoNumberSections() {
  const ymlPath = path.join(PROJECT_ROOT, '_quarto.yml');
  if (!fs.existsSync(ymlPath)) return false;

  const lines = fs.readFileSync(ymlPath, 'utf8').split(/\r?\n/);
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{4}number-sections\s*:\s*true\s*$/.test(lines[i])) {
      lines[i] = lines[i].replace(/true\s*$/, 'false');
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(ymlPath, lines.join('\n'));
  return changed;
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------
const root = parseTextbook(content);

// Treat the first bare heading as the book title; fallback if missing.
let bookNode = root.children.find(c => c.level === 1 && c.cls && c.cls.kind === 'bare');
if (!bookNode) {
  // No book title detected 鈥?synthesize one from the first heading
  bookNode = {
    level: 1,
    title: path.basename(srcPath, '.md'),
    body: [],
    children: root.children,
    cls: { kind: 'bare', text: path.basename(srcPath, '.md') },
  };
}
const sourceNodes = root.children.filter(c => c !== bookNode);
const { frontMatterNodes, chapterNodes } = collectBookChaptersFrom([...bookNode.children, ...sourceNodes]);

if (fs.existsSync(chapterRoot)) {
  console.error(`Target already exists: ${chapterRoot}`);
  console.error('Refuse to overwrite. Move/rename it first.');
  process.exit(1);
}

console.log(`Importing textbook: "${bookNode.title}"`);
console.log(`  Index front-matter sections: ${frontMatterNodes.length}`);
console.log(`  Book chapters: ${chapterNodes.length}`);
console.log(`  Target: qmd/${chapterSlug}/`);

writeIndex(bookNode, frontMatterNodes);
const chapterFiles = writeBookChapters(chapterNodes);

// Copy images
if (fs.existsSync(srcImagesDir)) {
  fs.mkdirSync(chapterImages, { recursive: true });
  const files = fs.readdirSync(srcImagesDir);
  for (const f of files) {
    fs.copyFileSync(path.join(srcImagesDir, f), path.join(chapterImages, f));
  }
  console.log(`  Copied ${files.length} image(s)`);
}

// Auto-update _quarto.yml
const updatedYml = updateQuartoChapters(chapterFiles);
const updatedTitle = updateQuartoBookTitle(bookNode.title);
const disabledNumbering = disableQuartoNumberSections();

// Group paper-style subfigures such as Fig. 7(a)-(d), dropping MinerU's
// chart OCR tables from the visible reading flow.
console.log('  Grouping subfigures...');
try {
  require('child_process').execSync(`node "${path.join(__dirname, 'group-subfigures.js')}"`,
    { cwd: PROJECT_ROOT, stdio: 'inherit' });
} catch (e) { console.log(`  ! group-subfigures failed: ${e.message}`); }

// Keep every qmd self-contained: image links become images/<file>, and the
// files are copied into a sibling images/ folder beside that qmd.
console.log('  Localizing images...');
try {
  require('child_process').execSync(`node "${path.join(__dirname, 'localize-images.js')}"`,
    { cwd: PROJECT_ROOT, stdio: 'inherit' });
} catch (e) { console.log(`  ! localize-images failed: ${e.message}`); }

// Rebuild MinerU-split algorithm fragments into IEEE-like algorithm blocks.
console.log('  Formatting algorithms...');
try {
  require('child_process').execSync(`node "${path.join(__dirname, 'format-algorithms.js')}"`,
    { cwd: PROJECT_ROOT, stdio: 'inherit' });
} catch (e) { console.log(`  ! format-algorithms failed: ${e.message}`); }

// Run gen-includes to populate AUTO-INCLUDES blocks
console.log('  Populating auto-includes...');
try {
  require('child_process').execSync(`node "${path.join(__dirname, 'gen-includes.js')}"`,
    { cwd: PROJECT_ROOT, stdio: 'inherit' });
} catch (e) { console.log(`  ! gen-includes failed: ${e.message}`); }

console.log('\nDone.');
if (updatedYml) console.log('  Updated _quarto.yml book.chapters');
else {
  console.log('  ! Add these to _quarto.yml manually:');
  for (const f of chapterFiles) console.log(`      - ${f}`);
}
if (updatedTitle) console.log('  Updated _quarto.yml book.title');
if (disabledNumbering) console.log('  Disabled Quarto auto-numbering for textbook headings');
console.log('\nProject is ready. Start the watcher to render.\n');

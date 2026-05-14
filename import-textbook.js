// import-textbook.js — convert a MinerU-style .md of a Chinese textbook
// into our Quarto book's folder-first chapter layout.
//
// Unlike import-paper.js, MinerU emits every heading in a textbook as H1.
// The real hierarchy is encoded in the heading TEXT's numbering prefix:
//   "第 N 章 标题"      → level 2 (a chapter inside the book)
//   "N.M 标题"          → level 3 (a section)
//   "N.M.K 标题"        → level 4 (a subsection)
//   "N.M.K.L 标题"      → level 5 (a sub-subsection)
//   "a. 标题"           → level 6 (deepest)
//   "内容简介" / "前言" / "目录" / etc.  → level 2 (front-matter, sibling of chapters)
//
// Also, the source MD begins with a large TOC where every entry is an H1
// like "# 1.2 遗传算法应用于组合优化问题的实例……17". Those page-numbered
// entries are skipped — they're not content, just a table of contents.
//
// Usage:
//   node tool/import-textbook.js <source.md> <chapter-slug>

const fs   = require('fs');
const path = require('path');

const [, , srcPath, chapterSlug] = process.argv;
if (!srcPath || !chapterSlug) {
  console.error('Usage: node import-textbook.js <source.md> <chapter-slug>');
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

// ----------------------------------------------------------------------
// Normalize MinerU-isms (same as import-paper.js)
// ----------------------------------------------------------------------
let content = fs.readFileSync(srcPath, 'utf8');

const looksLikeCitation = s => {
  const t = s.trim();
  if (/^\[?\d+\]?(\s*[,;\-–]\s*\[?\d+\]?)*$/.test(t)) return true;
  if (/^\[\d+\]\(#ref-\d+\)$/.test(t)) return true;
  return false;
};
content = content.replace(/\\\(([\s\S]+?)\\\)/g, (full, m) => looksLikeCitation(m) ? m : `$${m}$`);
content = content.replace(/\\\[([\s\S]+?)\\\]/g, (full, m) => looksLikeCitation(m) ? full : `\n$$\n${m.trim()}\n$$\n`);

content = content.replace(/<details>\s*<summary>[^<]*<\/summary>([\s\S]*?)<\/details>/g, '$1');
content = content.replace(/<\/?details>/g, '');
content = content.replace(/<summary>[^<]*<\/summary>/g, '');
content = content.replace(/<table[\s\S]*?<\/table>/gi, htmlTableToPipe);
content = content.replace(/```mermaid[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n');

// (Citations in textbooks are usually less structured than papers; keep [N]→link
// handling but tolerate the references section being missing.)
content = (function processCitations(s) {
  const m = s.match(/\n(#{1,6})\s+(?:references|参考文献)\b[^\n]*\n/i);
  if (!m) return s.replace(/\[(\d+)\](?!\(#ref-|\{#ref-)/g, (_, n) => `\\[[${n}](#ref-${n})\\]`);
  const cut = m.index + m[0].length;
  const before  = s.slice(0, cut);
  const refsBody = s.slice(cut);
  const anchored = refsBody.replace(/(^|\n)\[(\d+)\]/g, (_, p, n) => `${p}[${n}]{#ref-${n}}`);
  return before.replace(/\[(\d+)\](?!\(#ref-|\{#ref-)/g, (_, n) => `\\[[${n}](#ref-${n})\\]`) + anchored;
})(content);

// ----------------------------------------------------------------------
// Parse heading text → classification
// ----------------------------------------------------------------------
function classifyHeading(text) {
  const t = text.trim();

  // TOC entry: trailing "…N", ".....N" or "title  N" where N is page number.
  // Matchers, in order of specificity:
  //   "…… 209"  or "……209"
  //   "...... 51"  or "....51"
  //   bare trailing digits after numbered prefix: "5.3 标题 209"
  if (/(?:\.{2,}|…{1,})\s*\d+\s*$/.test(t)) return { kind: 'toc' };
  if (/^(?:第\s*\d+\s*章|附录\s*[A-Za-z]?|\d+(?:\.\d+){0,3})\b[\s\S]*\s\d+\s*$/.test(t)) {
    return { kind: 'toc' };
  }

  // 第 N 章 标题
  const chap = t.match(/^第\s*(\d+)\s*章\s*(.*)$/);
  if (chap) {
    return { kind: 'section', depth: 1, num: chap[1], title: chap[2].trim() };
  }
  // 附录 A 标题
  const appx = t.match(/^附录\s*([A-Za-z]?)\s*(.*)$/);
  if (appx) {
    return { kind: 'section', depth: 1, num: appx[1] || '', title: appx[2].trim() };
  }
  // N.M [.K [.L]] 标题
  const num = t.match(/^(\d+(?:\.\d+){1,3})\s*(.*)$/);
  if (num) {
    const depth = num[1].split('.').length;
    return { kind: 'section', depth, num: num[1], title: num[2].trim() };
  }
  // Letter prefix: "a. 标题"  or "(a) 标题"
  if (/^\(?[a-zA-Z]\)?\.?\s+\S/.test(t)) {
    return { kind: 'section', depth: 5, num: null, title: t };
  }

  // Front-matter
  if (/^(?:内容简介|前言|序|后记|附录|图书在版编目|致谢|目录)/.test(t)) {
    return { kind: 'front-matter', title: t };
  }
  // Bare (book title repeats, chapter sub-titles in 2-line form, etc.)
  return { kind: 'bare', text: t };
}

// ----------------------------------------------------------------------
// Parse the whole MD: collect H1 segments and build a tree
// ----------------------------------------------------------------------
function parseTextbook(md) {
  const lines = md.split(/\r?\n/);

  // Collect H1 segments only (textbook MinerU emits everything as H1)
  const segs = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) {
      if (cur) segs.push(cur);
      cur = { idx: i, title: m[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(lines[i]);
    }
  }
  if (cur) segs.push(cur);

  for (const s of segs) s.cls = classifyHeading(s.title);

  // Filter: drop TOC entries. Also drop the literal "目录" front-matter (it's a TOC marker, not content).
  // Dedupe bare repeats (book title typically appears twice on title/spine page).
  const seenBare = new Set();
  const filtered = [];
  for (const s of segs) {
    if (s.cls.kind === 'toc') continue;
    if (s.cls.kind === 'front-matter' && s.cls.title === '目录') continue;
    if (s.cls.kind === 'bare') {
      if (seenBare.has(s.title)) continue;
      seenBare.add(s.title);
    }
    filtered.push(s);
  }

  // Merge a chapter-without-title + following bare heading.
  // MinerU often splits "第1章\n遗传算法" into two H1s; rejoin them.
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
  //   bare = book title prelude → level 1 (the root chapter file paper.qmd)
  //   front-matter             → level 2
  //   section depth N          → level (N+1)
  //   capped at 6
  const root = { level: 0, title: '', body: [], children: [] };
  const stack = [root];
  for (const s of filtered) {
    let level;
    if (s.cls.kind === 'bare') level = 1;
    else if (s.cls.kind === 'front-matter') level = 2;
    else if (s.cls.kind === 'section') level = Math.min(6, s.cls.depth + 1);
    else continue;

    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node = { level, title: s.title, body: s.body, children: [] };
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

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------
const root = parseTextbook(content);

// Treat the book title (first bare heading) as the root chapter; fallback if missing
let bookNode = root.children.find(c => c.level === 1);
if (!bookNode) {
  // No book title detected — synthesize one from the first heading
  bookNode = {
    level: 1,
    title: path.basename(srcPath, '.md'),
    body: [],
    children: root.children,
  };
}
// Anything else at level 1 becomes a child of the book node (chapters / front-matter)
const otherLevel1 = root.children.filter(c => c !== bookNode);
for (const o of otherLevel1) {
  o.level = 2; // demote front-matter / chapters to be children of the book
  bookNode.children.push(o);
}

if (fs.existsSync(chapterRoot)) {
  console.error(`Target already exists: ${chapterRoot}`);
  console.error('Refuse to overwrite. Move/rename it first.');
  process.exit(1);
}

console.log(`Importing textbook: "${bookNode.title}"`);
console.log(`  Top-level chapters / front-matter: ${bookNode.children.length}`);
console.log(`  Target: qmd/${chapterSlug}/`);

writeNode(bookNode, chapterRoot, chapterSlug, 0);

// Copy images
if (fs.existsSync(srcImagesDir)) {
  fs.mkdirSync(chapterImages, { recursive: true });
  const files = fs.readdirSync(srcImagesDir);
  for (const f of files) {
    fs.copyFileSync(path.join(srcImagesDir, f), path.join(chapterImages, f));
  }
  console.log(`  Copied ${files.length} image(s)`);
}

// Auto-add to _quarto.yml
const ymlPath = path.join(PROJECT_ROOT, '_quarto.yml');
const chapterLine = `    - qmd/${chapterSlug}/${chapterSlug}.qmd`;
let addedToYml = false;
if (fs.existsSync(ymlPath)) {
  const yml = fs.readFileSync(ymlPath, 'utf8');
  if (yml.includes(chapterLine.trim())) {
    addedToYml = 'already-present';
  } else {
    const lines = yml.split(/\r?\n/);
    let inChapters = false, lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*chapters\s*:/.test(lines[i])) { inChapters = true; continue; }
      if (inChapters) {
        if (/^\s{2,4}-\s+/.test(lines[i])) lastIdx = i;
        else if (lines[i].trim() !== '' && !/^\s/.test(lines[i])) break;
      }
    }
    if (lastIdx >= 0) {
      lines.splice(lastIdx + 1, 0, chapterLine);
      fs.writeFileSync(ymlPath, lines.join('\n'));
      addedToYml = true;
    }
  }
}

// Run gen-includes to populate AUTO-INCLUDES blocks
console.log('  Populating auto-includes...');
try {
  require('child_process').execSync(`node "${path.join(__dirname, 'gen-includes.js')}"`,
    { cwd: PROJECT_ROOT, stdio: 'inherit' });
} catch (e) { console.log(`  ! gen-includes failed: ${e.message}`); }

console.log('\nDone.');
if (addedToYml === true) console.log('  ✓ Added to _quarto.yml book.chapters');
else if (addedToYml === 'already-present') console.log('  • Already in _quarto.yml');
else console.log(`  ! Add to _quarto.yml manually:\n      ${chapterLine.trim()}`);
console.log('\nProject is ready. Start the watcher to render.\n');

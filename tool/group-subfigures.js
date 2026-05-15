// Group MinerU-split paper subfigures into Quarto figure layouts.
// Also drops MinerU's chart/eye-diagram OCR tables when they sit between
// a figure image and its Fig. N caption.
//
// Detects patterns like:
//   ![](image-a.jpg)
//   <chart/table OCR output>
//   ![](image-b.jpg)
//   <chart/table OCR output>
//   Fig. 8. (a) ... (b) ...
//
// Rewrites them as an HTML/PDF-friendly markdown table:
//   | ![](image-a.jpg) | ![](image-b.jpg) |
//   | --- | --- |
//   | *(a)* | *(b)* |
//
//   **Fig. 8. ...**
//
// We intentionally do NOT use ids like #fig-8. Quarto treats #fig-* as its
// own cross-reference target and renumbers it as "Figure 4.1", which is not
// what paper imports want. Papers should keep their original "Fig. 8." label.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
      ? process.cwd()
      : path.join(__dirname, '..'));

const ROOT_QMD = path.join(PROJECT_ROOT, 'qmd');

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function listQmdFiles(dir, out = []) {
  if (!isDir(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listQmdFiles(p, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.qmd')) out.push(p);
  }
  return out;
}

function imageOf(line) {
  const m = line.match(/!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?\s*$/);
  if (!m) return null;
  return { alt: m[1], src: m[2] };
}

function imageOfAnywhere(line) {
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push({ alt: m[1], src: m[2] });
  return out;
}

function isCaption(line) {
  const m = line.match(/^\s*(?:Fig\.?|Figure)\s*(\d+)\.\s+(.+)$/i);
  if (!m) return null;
  const letters = [...line.matchAll(/\(([a-z])\)/gi)]
    .map(x => x[1].toLowerCase())
    .filter((x, i, a) => a.indexOf(x) === i);
  if (letters.length < 2) return null;
  return { number: m[1], letters };
}

function isShortSubfigureLabel(line) {
  const t = line.trim();
  return t.length > 0 && t.length <= 16 && /^[（(]?[a-zA-Z](?:[).）]|锛|ï|$)/.test(t);
}

function skipBlank(lines, j) {
  while (j >= 0 && lines[j].trim() === '') j--;
  return j;
}

function skipTableUp(lines, j) {
  if (!/^\s*\|/.test(lines[j])) return j;
  while (j >= 0 && /^\s*\|/.test(lines[j])) j--;
  return j;
}

function skipDetailsUp(lines, j) {
  if (!/<\/details>/i.test(lines[j])) return j;
  j--;
  while (j >= 0 && !/<details\b/i.test(lines[j])) j--;
  return j - 1;
}

function insideFigureDiv(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    if (/^:::\s*\{#(?:fig|paper-fig)-/.test(lines[i])) return true;
    if (/^:::\s*$/.test(lines[i])) return false;
  }
  return false;
}

function collectPreviousImages(lines, captionIdx) {
  const images = [];
  let j = captionIdx - 1;
  let start = captionIdx;

  while (j >= 0) {
    j = skipBlank(lines, j);
    if (j < 0) break;

    const afterDetails = skipDetailsUp(lines, j);
    if (afterDetails !== j) {
      start = Math.min(start, afterDetails + 1);
      j = afterDetails;
      continue;
    }

    const afterTable = skipTableUp(lines, j);
    if (afterTable !== j) {
      start = Math.min(start, afterTable + 1);
      j = afterTable;
      continue;
    }

    const img = imageOf(lines[j]);
    if (img) {
      images.unshift(img);
      start = Math.min(start, j);
      j--;
      j = skipBlank(lines, j);
      if (j >= 0 && isShortSubfigureLabel(lines[j])) {
        start = Math.min(start, j);
        j--;
      }
      continue;
    }

    if (images.length > 0 && isShortSubfigureLabel(lines[j])) {
      start = Math.min(start, j);
      j--;
      continue;
    }

    break;
  }

  return { images, start };
}

function figureBlock(caption, images) {
  const cols = images.length >= 4 ? 2 : images.length;
  const out = [];
  for (let i = 0; i < images.length; i += cols) {
    const row = images.slice(i, i + cols);
    out.push('| ' + row.map(img => `![](${img.src})`).join(' | ') + ' |');
    out.push('| ' + row.map(() => '---').join(' | ') + ' |');
    out.push('| ' + row.map((_, j) => {
      const letter = caption.letters[i + j] || String.fromCharCode(97 + i + j);
      return `*(${letter})*`;
    }).join(' | ') + ' |');
    out.push('');
  }
  out.push(`**${caption.line.trim()}**`);
  return out;
}

function normalizeExistingFigureDivs(lines) {
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/^:::\s*\{#fig-/.test(lines[i])) continue;

    let end = i + 1;
    while (end < lines.length && !/^:::\s*$/.test(lines[end])) end++;
    if (end >= lines.length) continue;

    const block = lines.slice(i + 1, end);
    const captionLine = block.find(line => isFigureCaptionLine(line));
    const caption = captionLine ? isCaption(captionLine) : null;
    if (!caption) continue;

    const images = block.flatMap(imageOfAnywhere);
    if (images.length < 2) continue;

    caption.line = captionLine;
    lines.splice(i, end - i + 1, ...figureBlock(caption, images.slice(0, caption.letters.length)));
    changed = true;
  }
  return changed;
}

function isFigureCaptionLine(line) {
  return /^\s*(?:Fig\.?|Figure)\s*\d+\.\s+.+/i.test(line);
}

function tableEnd(lines, start) {
  if (!/^\s*\|/.test(lines[start])) return -1;
  let end = start;
  while (end + 1 < lines.length && /^\s*\|/.test(lines[end + 1])) end++;
  return end;
}

function stripImageOcrTables(lines) {
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!imageOf(lines[i])) continue;

    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length || !/^\s*\|/.test(lines[j])) continue;

    const end = tableEnd(lines, j);
    let k = end + 1;
    while (k < lines.length && lines[k].trim() === '') k++;

    // Only remove the table if it is clearly attached to the preceding
    // figure, not a real paper table that follows in the prose.
    if (k < lines.length && isFigureCaptionLine(lines[k])) {
      lines.splice(j, end - j + 1);
      changed = true;
      i = Math.max(0, i - 1);
    }
  }
  return changed;
}

function processMarkdown(text) {
  const lines = text.split(/\r?\n/);
  let changed = normalizeExistingFigureDivs(lines);
  if (stripImageOcrTables(lines)) changed = true;

  for (let i = 0; i < lines.length; i++) {
    const caption = isCaption(lines[i]);
    if (!caption || insideFigureDiv(lines, i)) continue;

    const { images, start } = collectPreviousImages(lines, i);
    if (images.length < 2) continue;
    if (images.length < caption.letters.length) continue;

    caption.line = lines[i];
    const block = figureBlock(caption, images.slice(-caption.letters.length));
    lines.splice(start, i - start + 1, ...block);
    i = start + block.length - 1;
    changed = true;
  }

  return changed ? lines.join('\n') : text;
}

let changedFiles = 0;
for (const file of listQmdFiles(ROOT_QMD)) {
  const before = fs.readFileSync(file, 'utf8');
  const after = processMarkdown(before);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    changedFiles++;
  }
}

console.log(`group-subfigures: updated ${changedFiles} file(s).`);

// Copy every image referenced by a .qmd into that .qmd file's sibling
// images/ folder, then rewrite the markdown link to images/<file>.
//
// This keeps each note self-contained for later manual inspection.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
      ? process.cwd()
      : path.join(__dirname, '..'));

const ROOT_QMD = path.join(PROJECT_ROOT, 'qmd');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);

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

function listImageFiles(dir, out = []) {
  if (!isDir(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) listImageFiles(p, out);
    else if (entry.isFile() && IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) out.push(p);
  }
  return out;
}

const imageByName = new Map();
for (const img of [
  ...listImageFiles(ROOT_QMD),
  ...listImageFiles(path.join(PROJECT_ROOT, 'images')),
]) {
  const name = path.basename(img);
  if (!imageByName.has(name)) imageByName.set(name, img);
}

function isExternal(src) {
  return /^(?:https?:|data:|mailto:|#)/i.test(src);
}

function resolveImage(qmdFile, src) {
  if (isExternal(src)) return null;
  const clean = decodeURIComponent(src.split(/[?#]/)[0]);
  if (!IMAGE_EXT.has(path.extname(clean).toLowerCase())) return null;

  const qmdDir = path.dirname(qmdFile);
  const candidates = [];
  candidates.push(path.resolve(qmdDir, clean));

  // Included qmd files in Quarto often resolve image paths relative to the
  // top-level chapter file, not the physical child qmd file. Try ancestors too.
  let ancestor = qmdDir;
  while (ancestor.startsWith(ROOT_QMD) && ancestor !== path.dirname(ROOT_QMD)) {
    candidates.push(path.resolve(ancestor, clean));
    ancestor = path.dirname(ancestor);
  }

  const byName = imageByName.get(path.basename(clean));
  if (byName) candidates.push(byName);

  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

function sameFileContent(a, b) {
  if (!isFile(a) || !isFile(b)) return false;
  const sa = fs.statSync(a), sb = fs.statSync(b);
  if (sa.size !== sb.size) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

function contentUnitFile(dir) {
  return path.join(dir, path.basename(dir) + '.qmd');
}

function chapterDirFor(qmdFile) {
  const qmdDir = path.dirname(qmdFile);
  let found = qmdDir;
  let dir = qmdDir;
  while (dir.startsWith(ROOT_QMD) && dir !== ROOT_QMD) {
    if (isFile(contentUnitFile(dir))) found = dir;
    dir = path.dirname(dir);
  }
  return found;
}

function copyIfNeeded(source, dest) {
  if (isFile(dest) && sameFileContent(source, dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  return true;
}

let changedFiles = 0;
let copiedImages = 0;
let missingImages = 0;

for (const qmdFile of listQmdFiles(ROOT_QMD)) {
  const qmdDir = path.dirname(qmdFile);
  const localImages = path.join(qmdDir, 'images');
  const renderImages = path.join(chapterDirFor(qmdFile), 'images');
  let content = fs.readFileSync(qmdFile, 'utf8');
  let changed = false;

  content = content.replace(/(!\[[^\]]*\]\()([^)]+)(\)(?:\{[^}]*\})?)/g, (full, prefix, src, suffix) => {
    if (isExternal(src)) return full;

    if (src.startsWith('images/')) {
      const localSource = resolveImage(qmdFile, src);
      if (!localSource) {
        missingImages++;
        return full;
      }
      const renderDest = path.join(renderImages, path.basename(src));
      if (path.resolve(localSource) !== path.resolve(renderDest) && copyIfNeeded(localSource, renderDest)) {
        copiedImages++;
      }
      return full;
    }

    const source = resolveImage(qmdFile, src);
    if (!source) {
      missingImages++;
      return full;
    }

    fs.mkdirSync(localImages, { recursive: true });
    let fileName = path.basename(source);
    let dest = path.join(localImages, fileName);

    if (isFile(dest) && !sameFileContent(source, dest)) {
      const parsed = path.parse(fileName);
      let n = 2;
      do {
        fileName = `${parsed.name}-${n}${parsed.ext}`;
        dest = path.join(localImages, fileName);
        n++;
      } while (isFile(dest) && !sameFileContent(source, dest));
    }

    if (!isFile(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
      copiedImages++;
    }

    const renderDest = path.join(renderImages, fileName);
    if (path.resolve(dest) !== path.resolve(renderDest) && copyIfNeeded(dest, renderDest)) {
      copiedImages++;
    }

    changed = true;
    return `${prefix}images/${fileName}${suffix}`;
  });

  if (changed) {
    fs.writeFileSync(qmdFile, content, 'utf8');
    changedFiles++;
  }
}

console.log(`localize-images: updated ${changedFiles} file(s), copied ${copiedImages} image(s), missing ${missingImages}.`);

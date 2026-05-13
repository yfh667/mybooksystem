const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const POSITRON_CLI = 'C:\\Program Files\\Positron\\bin\\positron.cmd';

// Project layout:
//   <project-root>/tool/serve.js      ← this file
//   <project-root>/_book/             ← Quarto HTML output
//   <project-root>/_pdf/              ← Quarto PDF output
//   <project-root>/qmd/               ← user content
//   <project-root>/tool/_pdfjs/       ← PDF.js dist (lives with the tool)
const PROJECT_ROOT = path.join(__dirname, '..');
const BOOK_DIR = path.join(PROJECT_ROOT, '_book');
const PDF_DIR = path.join(PROJECT_ROOT, '_pdf');
const QMD_DIR  = path.join(PROJECT_ROOT, 'qmd');
const PDFJS_DIR = path.join(__dirname, '_pdfjs');
const PORT = 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.pdf': 'application/pdf',
};

// Wrapper page that loads PDF.js viewer in an iframe and auto-reloads on PDF change,
// preserving scroll + zoom by calling PDFViewerApplication.open().
const PDF_WRAPPER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PDF preview</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #2a2a2e; }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
  #status { position: fixed; bottom: 6px; right: 10px; font: 11px monospace;
            color: #fff; background: rgba(0,0,0,.55); padding: 2px 7px; border-radius: 3px;
            pointer-events: none; z-index: 9999; }
</style>
</head>
<body>
<iframe id="v" src="/_pdfjs/web/viewer.html?file=/_pdf/test.pdf"></iframe>
<div id="status">loading…</div>
<script>
const iframe = document.getElementById('v');
const statusEl = document.getElementById('status');
let lastTag = null;
let lastReloadAt = 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Aggressively try to restore page+scale by polling until it sticks
async function restoreView(app, savedPage, savedScale, maxMs = 5000) {
  const start = Date.now();
  let setCount = 0;
  while (Date.now() - start < maxMs) {
    try {
      if (app.pdfDocument && app.pagesCount > 0 && app.pdfViewer && typeof app.page === 'number') {
        if (app.pagesCount >= savedPage) {
          try { app.pdfViewer.currentScaleValue = savedScale; } catch (e) {}
          try { app.page = savedPage; } catch (e) {}
          setCount++;
          await sleep(200);
          if (app.page === savedPage) {
            return { ok: true, attempts: setCount, took: Date.now() - start };
          }
        }
      }
    } catch (e) {}
    await sleep(120);
  }
  return { ok: false, attempts: setCount, took: Date.now() - start, actual: app.page };
}

async function check() {
  try {
    const r = await fetch('/_pdf/test.pdf?_=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) return;
    const tag = r.headers.get('content-length') + '|' + r.headers.get('last-modified');
    if (lastTag === null) { lastTag = tag; statusEl.textContent = 'ready'; return; }
    if (tag === lastTag) return;
    lastTag = tag;
    const now = Date.now();
    if (now - lastReloadAt < 1500) return;
    lastReloadAt = now;

    const app = iframe.contentWindow && iframe.contentWindow.PDFViewerApplication;
    if (!app || !app.initialized) {
      iframe.src = '/_pdfjs/web/viewer.html?file=/_pdf/test.pdf&_=' + Date.now();
      return;
    }

    const savedPage = app.page;
    const savedScale = app.pdfViewer.currentScaleValue;
    statusEl.textContent = 'reloading… (was p.' + savedPage + ')';

    await app.open({ url: '/_pdf/test.pdf?_=' + Date.now() });

    const result = await restoreView(app, savedPage, savedScale);
    if (result.ok) {
      statusEl.textContent = 'reloaded p.' + savedPage + ' in ' + result.took + 'ms (' + result.attempts + 'x)';
    } else {
      statusEl.textContent = 'FAILED to restore p.' + savedPage + ', ended at p.' + result.actual;
    }
  } catch (e) {
    statusEl.textContent = 'reload err: ' + (e.message || e);
  }
}
check();
setInterval(check, 1500);
</script>
</body>
</html>`;

const PDF_VIEWER_HTML_OLD = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PDF preview</title>
<style>
  html, body { margin: 0; padding: 0; background: #444; color: #ddd;
               font-family: system-ui, sans-serif; }
  #pages { padding: 12px; display: flex; flex-direction: column;
           align-items: center; gap: 12px; }
  canvas { background: white; box-shadow: 0 2px 8px rgba(0,0,0,.5); max-width: 100%; height: auto; }
  #status { position: fixed; top: 8px; right: 10px; font: 11px monospace;
            color: #fff; background: rgba(0,0,0,.55); padding: 3px 8px; border-radius: 3px; }
  #empty { padding: 30px; text-align: center; }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body>
<div id="pages"><div id="empty">Loading PDF...</div></div>
<div id="status">init</div>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const pagesEl = document.getElementById('pages');
const statusEl = document.getElementById('status');
let lastTag = null;
let rendering = false;
let renderToken = 0;

async function renderPdf() {
  if (rendering) return;
  rendering = true;
  const myToken = ++renderToken;
  const oldScroll = window.scrollY;
  try {
    const url = '/_pdf/test.pdf?_=' + Date.now();
    const loadingTask = pdfjsLib.getDocument({ url, disableStream: true, disableAutoFetch: true });
    const pdf = await loadingTask.promise;
    if (myToken !== renderToken) return;

    const frag = document.createDocumentFragment();
    const baseScale = 1.4;
    const dpr = Math.max(window.devicePixelRatio || 1, 2); // oversample for crispness
    for (let i = 1; i <= pdf.numPages; i++) {
      if (myToken !== renderToken) return;
      const page = await pdf.getPage(i);
      const cssViewport = page.getViewport({ scale: baseScale });
      const hiViewport = page.getViewport({ scale: baseScale * dpr });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = hiViewport.width;
      canvas.height = hiViewport.height;
      canvas.style.width = cssViewport.width + 'px';
      canvas.style.height = cssViewport.height + 'px';
      await page.render({ canvasContext: ctx, viewport: hiViewport }).promise;
      if (myToken !== renderToken) return;
      frag.appendChild(canvas);
    }
    pagesEl.innerHTML = '';
    pagesEl.appendChild(frag);
    window.scrollTo(0, oldScroll);
    statusEl.textContent = 'rendered ' + new Date().toLocaleTimeString() + ' (' + pdf.numPages + ' pages)';
  } catch (e) {
    statusEl.textContent = 'err: ' + e.message;
  } finally {
    rendering = false;
  }
}

async function checkForUpdate() {
  try {
    const r = await fetch('/_pdf/test.pdf?_=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
    if (!r.ok) return;
    const tag = r.headers.get('content-length') + '|' + r.headers.get('last-modified');
    if (lastTag !== tag) {
      lastTag = tag;
      renderPdf();
    }
  } catch (e) {}
}
checkForUpdate();
setInterval(checkForUpdate, 1500);
</script>
</body>
</html>`;

// Search for a text snippet across all .qmd files in qmd/. Return { file, line } on hit.
// HTML renderers collapse paragraphs that span multiple source lines into one block.
// So we cascade: try long needle (works for short paragraphs / headings),
// then shorter prefixes (catch the first source line of multi-line paragraphs).
function findSource(searchText) {
  if (!searchText) return null;
  const QMD_ROOT = QMD_DIR;
  const text = searchText.replace(/\s+/g, ' ').trim();
  if (text.length < 2) return null;

  // Cascade of candidate prefixes (longest first → most specific).
  const candidates = [];
  for (const len of [70, 30, 15, 8, 4]) {
    const c = text.slice(0, len);
    if (c.length >= 2 && !candidates.includes(c)) candidates.push(c);
  }

  // Collect all .qmd files in deterministic order (depth-first, files before subdirs).
  const allFiles = [];
  (function collect(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const dirs = [], files = [];
    for (const e of entries) {
      if (e.isDirectory()) dirs.push(e.name);
      else if (e.name.endsWith('.qmd')) files.push(e.name);
    }
    files.sort(); dirs.sort();
    for (const name of files) allFiles.push(path.join(dir, name));
    for (const sub of dirs) collect(path.join(dir, sub));
  })(QMD_ROOT);

  // Read each file once.
  const fileLines = new Map();
  for (const fp of allFiles) {
    try { fileLines.set(fp, fs.readFileSync(fp, 'utf8').split(/\r?\n/)); } catch {}
  }

  // Try each candidate prefix in cascading order; first hit anywhere wins.
  for (const cand of candidates) {
    for (const fp of allFiles) {
      const lines = fileLines.get(fp);
      if (!lines) continue;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(cand)) return { file: fp, line: i + 1, found: true };
      }
    }
  }
  return null;
}

function readWithRetry(filePath, maxAttempts, cb) {
  let attempts = 0;
  const tryRead = () => {
    fs.readFile(filePath, (err, data) => {
      if (!err) return cb(null, data);
      attempts++;
      if (attempts >= maxAttempts) return cb(err);
      setTimeout(tryRead, 200);
    });
  };
  tryRead();
}

http.createServer((req, res) => {
  let p = decodeURIComponent(url.parse(req.url).pathname);

  // GET /status → current watcher state JSON (consumed by autoreload.html)
  if (p === '/status') {
    const statusFile = path.join(PROJECT_ROOT, '.watcher-status.json');
    fs.readFile(statusFile, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      if (err) return res.end('{"state":"unknown"}');
      res.end(data);
    });
    return;
  }

  // POST /open-in-editor  { text: "..." }  → { found, file, line }
  //   Finds the .qmd source for the given text snippet and opens Positron at that line.
  if (p === '/open-in-editor' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const { text } = JSON.parse(body || '{}');
        const result = findSource(text || '');
        if (result && result.found) {
          const arg = `${result.file}:${result.line}:1`;
          const { exec } = require('child_process');
          // -r --goto FILE:LINE:COL  — reuse current window, move cursor to that line.
          const cmd = `"${POSITRON_CLI}" -r --goto "${arg}"`;
          exec(cmd, { windowsHide: true, timeout: 5000 }, (err) => {
            if (err) console.log('[open-in-editor] failed:', err.message);
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result || { found: false }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('bad request: ' + e.message);
      }
    });
    return;
  }

  // POST /find-source  { text: "..." }  → { file, line }
  // Recursively search every .qmd under qmd/ for a line containing the snippet.
  if (p === '/find-source' && req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const { text } = JSON.parse(body || '{}');
        const result = findSource(text || '');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result || { found: false }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('bad request: ' + e.message);
      }
    });
    return;
  }

  // Split view: HTML on the left, PDF on the right, draggable splitter in middle
  if (p === '/split' || p === '/both' || p === '/split.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>HTML + PDF preview</title>
<style>
  html,body { margin:0; padding:0; height:100%; background:#222; overflow:hidden; }
  #wrap { display:flex; height:100%; }
  iframe { border:0; height:100%; display:block; flex: 0 0 auto; }
  #left { background:#fff; }
  #right { background:#2a2a2e; }
  #split { flex:0 0 6px; cursor:col-resize; background:#444; }
  #split:hover { background:#5c8df6; }
</style></head><body>
<div id="wrap">
  <iframe id="left" src="/index.html"></iframe>
  <div id="split"></div>
  <iframe id="right" src="/pdf"></iframe>
</div>
<script>
const left = document.getElementById('left');
const right = document.getElementById('right');
const split = document.getElementById('split');
const wrap = document.getElementById('wrap');

// Restore stored ratio
let ratio = parseFloat(localStorage.getItem('splitRatio')) || 0.5;
function apply() {
  const w = wrap.clientWidth - 6;
  left.style.flex = '0 0 ' + (w * ratio) + 'px';
  right.style.flex = '0 0 ' + (w * (1 - ratio)) + 'px';
}
apply();
window.addEventListener('resize', apply);

let dragging = false;
split.addEventListener('mousedown', e => { dragging = true; document.body.style.userSelect = 'none'; });
window.addEventListener('mouseup',   e => { dragging = false; document.body.style.userSelect = ''; localStorage.setItem('splitRatio', ratio); });
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  ratio = Math.min(0.9, Math.max(0.1, e.clientX / wrap.clientWidth));
  apply();
});
</script>
</body></html>`);
  }

  // Inline PDF viewer wrapper (uses bundled PDF.js viewer in iframe)
  if (p === '/pdf' || p === '/pdf.html' || p === '/pdf/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(PDF_WRAPPER_HTML);
  }

  // PDF.js viewer static files
  if (p.startsWith('/_pdfjs/')) {
    const rel = p.slice('/_pdfjs/'.length);
    const filePath = path.join(PDFJS_DIR, rel);
    if (!filePath.startsWith(PDFJS_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found: ' + p); }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
      });
      res.end(data);
    });
    return;
  }

  // PDF files served from _pdf/  (with retry to survive render swap window).
  // The book's PDF is named after `book.title` in _quarto.yml, so we don't hard-code
  // the filename. For any /_pdf/*.pdf request, we look up whatever .pdf currently
  // lives in _pdf/ and serve that.
  if (p.startsWith('/_pdf/')) {
    function resolveActualPdf(cb) {
      let tries = 0;
      const tryFind = () => {
        try {
          const files = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
          if (files.length > 0) {
            // Pick the most recently modified .pdf in _pdf/
            const sorted = files
              .map(f => ({ f, m: fs.statSync(path.join(PDF_DIR, f)).mtimeMs }))
              .sort((a, b) => b.m - a.m);
            return cb(null, path.join(PDF_DIR, sorted[0].f));
          }
        } catch {}
        tries++;
        if (tries >= 90) return cb(new Error('no pdf'));
        setTimeout(tryFind, 200);
      };
      tryFind();
    }

    if (req.method === 'HEAD') {
      resolveActualPdf((err, filePath) => {
        if (err) { res.writeHead(404); return res.end(); }
        fs.stat(filePath, (e, st) => {
          if (e) { res.writeHead(404); return res.end(); }
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': st.size,
            'Last-Modified': st.mtime.toUTCString(),
            'Cache-Control': 'no-store',
          });
          res.end();
        });
      });
      return;
    }

    resolveActualPdf((err, filePath) => {
      if (err) {
        res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
        return res.end('No PDF available in _pdf/');
      }
      fs.readFile(filePath, (e, data) => {
        if (e) {
          res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
          return res.end('Error reading PDF: ' + e.message);
        }
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      });
    });
    return;
  }

  // Default: serve from _book/
  if (p.endsWith('/')) p += 'index.html';
  const filePath = path.join(BOOK_DIR, p);
  if (!filePath.startsWith(BOOK_DIR)) { res.writeHead(403); return res.end(); }
  const ext = path.extname(filePath).toLowerCase();
  const maxAttempts = ext === '.html' ? 60 : 1;

  readWithRetry(filePath, maxAttempts, (err, data) => {
    if (err) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      return res.end('Not found: ' + p);
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Serving _book/ + _pdf/ at http://localhost:${PORT}/`);
  console.log(`PDF viewer:  http://localhost:${PORT}/pdf`);
});

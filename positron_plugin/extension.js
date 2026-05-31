const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const sessions = new Map();
let output;
let statusBar;
let newProjectStatusBar;

function activate(context) {
  console.log('[QmdTool] extension activated');
  output = vscode.window.createOutputChannel('QmdTool');
  output.appendLine('[QmdTool] extension activated');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(book) QmdTool';
  statusBar.tooltip = 'Convert and preview QmdTool project';
  statusBar.command = 'qmdtool.convertAndPreview';
  statusBar.show();

  newProjectStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  newProjectStatusBar.text = '$(new-folder) 新建 Qmd 项目';
  newProjectStatusBar.tooltip = '在当前工作目录生成 Quarto book 模板';
  newProjectStatusBar.command = 'qmdtool.newProject';

  context.subscriptions.push(output, statusBar, newProjectStatusBar);
  updateNewProjectStatusBar();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(updateNewProjectStatusBar),
  );
  const quartoYmlWatcher = vscode.workspace.createFileSystemWatcher('**/_quarto.yml');
  quartoYmlWatcher.onDidCreate(updateNewProjectStatusBar);
  quartoYmlWatcher.onDidDelete(updateNewProjectStatusBar);
  context.subscriptions.push(quartoYmlWatcher);

  context.subscriptions.push(register('qmdtool.newProject', (uri) => newProject(context, uri)));
  context.subscriptions.push(register('qmdtool.convertAndPreview', (uri) => convertAndPreview(context, uri)));
  context.subscriptions.push(register('qmdtool.previewHtml', (uri) => preview(context, uri, 'html')));
  context.subscriptions.push(register('qmdtool.previewPdf', (uri) => preview(context, uri, 'pdf')));
  context.subscriptions.push(register('qmdtool.renderHtml', (uri) => renderOnly(context, uri, 'html')));
  context.subscriptions.push(register('qmdtool.renderPdf', (uri) => renderOnly(context, uri, 'pdf')));
  context.subscriptions.push(register('qmdtool.stopPreview', (uri) => stopPreview(uri)));
}

function deactivate() {
  for (const session of sessions.values()) {
    disposeSession(session);
  }
  sessions.clear();
}

function register(command, handler) {
  return vscode.commands.registerCommand(command, async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      output.appendLine(`[error] ${message}`);
      vscode.window.showErrorMessage(message);
    }
  });
}

async function convertAndPreview(context, uri) {
  const root = await resolveProjectRoot(uri);
  const mode = await pickMode();
  if (!mode) return;

  output.show(true);
  output.appendLine(`\n[project] ${root}`);
  await previewRoot(context, root, mode);
  const session = sessions.get(normalizeKey(root));
  if (session) {
    queueRender(session, async () => {
      const converted = await runConvert(context, root);
      if (converted) organizeConvertedProject(root);
      await runPreviewBuild(context, root, session);
      updatePanel(session);
    }, '[convert]');
  }
}

async function preview(context, uri, mode) {
  const root = await resolveProjectRoot(uri);
  await previewRoot(context, root, mode);
  const session = sessions.get(normalizeKey(root));
  if (session) {
    await queueRender(session, async () => {
      await runPreviewBuild(context, root, session);
      updatePanel(session);
    }, '[preview]');
  }
}

async function renderOnly(context, uri, mode) {
  const root = await resolveProjectRoot(uri);
  output.show(true);
  const session = sessions.get(normalizeKey(root));
  if (session) {
    await queueRender(session, async () => {
      await runPreRenderTools(context, root);
      if (mode === 'pdf') {
        await runPdf(context, root, session);
      } else {
        await runHtml(context, root, session);
      }
      session.mode = mode;
      updatePanel(session);
    });
  } else if (mode === 'pdf') {
    await runPreRenderTools(context, root);
    await runPdf(context, root);
  } else {
    await runPreRenderTools(context, root);
    await runHtml(context, root);
  }
}

async function stopPreview(uri) {
  const root = await resolveProjectRoot(uri);
  const key = normalizeKey(root);
  const session = sessions.get(key);
  if (!session) {
    vscode.window.showInformationMessage('QmdTool preview server is not running for this project.');
    return;
  }
  disposeSession(session);
  sessions.delete(key);
  vscode.window.showInformationMessage('QmdTool preview server stopped.');
}

async function previewRoot(context, root, mode) {
  const key = normalizeKey(root);
  let session = sessions.get(key);
  if (!session) {
    const port = await getFreePort();
    session = {
      root,
      port,
      server: undefined,
      mode,
      panel: undefined,
      watchers: [],
      rendering: false,
      renderQueue: Promise.resolve(),
      debounce: undefined,
      suppressWatchUntil: 0,
      htmlPath: '/index.html',
      htmlScroll: new Map(),
      assetCache: new Map(),
      pdfCache: null,
      status: { state: 'idle', message: '', buildId: 0 },
      disposed: false,
    };
    session.server = await startStaticServer(session, getToolDir(context));
    sessions.set(key, session);
    setupWatchers(context, session);
    output.appendLine(`[server] http://127.0.0.1:${port}/`);
  }

  session.mode = mode;
  if (!session.panel) {
    session.panel = vscode.window.createWebviewPanel(
      'qmdtoolPreview',
      `QmdTool: ${path.basename(root)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    session.panel.onDidDispose(() => {
      session.panel = undefined;
      disposeSession(session);
      sessions.delete(key);
    });
    session.panel.webview.onDidReceiveMessage(async (message) => {
      await handleWebviewMessage(context, session, message);
    });
  }
  updatePanel(session);
  session.panel.reveal(vscode.ViewColumn.Beside);
}

async function handleWebviewMessage(context, session, message) {
  if (!message || !message.command) return;
  if (message.command === 'mode') {
    session.mode = message.mode === 'pdf' ? 'pdf' : 'html';
    session.panel && session.panel.webview.postMessage({ command: 'mode', mode: session.mode });
    return;
  }
  if (message.command === 'refresh') {
    updatePanel(session);
    return;
  }
  if (message.command === 'convert') {
    await queueRender(session, async () => {
      const converted = await runConvert(context, session.root);
      if (converted) organizeConvertedProject(session.root);
      await runHtml(context, session.root, session);
      session.mode = 'html';
      updatePanel(session);
    });
    return;
  }
  if (message.command === 'renderHtml') {
    await queueRender(session, async () => {
      await runHtml(context, session.root, session);
      session.mode = 'html';
      updatePanel(session);
    });
    return;
  }
  if (message.command === 'renderPdf') {
    await queueRender(session, async () => {
      await runPdf(context, session.root, session);
      session.mode = 'pdf';
      updatePanel(session);
    });
    return;
  }
  if (message.command === 'openPdf') {
    await openPdfInEditor(session.root);
    return;
  }
  if (message.command === 'stop') {
    const key = normalizeKey(session.root);
    disposeSession(session);
    sessions.delete(key);
  }
}

function updatePanel(session) {
  if (!session.panel) return;
  const nonce = Date.now();
  const htmlPath = sanitizeHtmlPath(session.htmlPath || '/index.html');
  session.htmlPath = htmlPath;
  const htmlUrl = `http://127.0.0.1:${session.port}${withCacheBuster(htmlPath, nonce)}`;
  const pdfFile = findNewestPdf(path.join(session.root, '_pdf'));
  const pdfName = pdfFile ? path.basename(pdfFile) : '';
  const pdfUrl = pdfFile
    ? `http://127.0.0.1:${session.port}/__pdf/${encodeURIComponent(pdfName)}?t=${nonce}`
    : '';
  const pdfViewerUrl = `http://127.0.0.1:${session.port}/pdf?t=${nonce}`;

  const missingPdf = !pdfUrl;
  const htmlStage = `<iframe id="htmlFrame" class="preview" src="${htmlUrl}"></iframe>`;
  const pdfStageHtml = pdfStage(missingPdf, pdfName, pdfViewerUrl);
  const csp = [
    "default-src 'none'",
    `img-src ${session.panel.webview.cspSource} http://127.0.0.1:${session.port} data:`,
    `style-src ${session.panel.webview.cspSource} 'unsafe-inline'`,
    `script-src 'unsafe-inline'`,
    `frame-src http://127.0.0.1:${session.port}`,
    `connect-src http://127.0.0.1:${session.port}`,
  ].join('; ');

  session.panel.title = `QmdTool: ${session.mode.toUpperCase()}`;
  session.panel.webview.html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    .toolbar { height: 38px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-bottom: 1px solid var(--vscode-panel-border); box-sizing: border-box; }
    button { height: 26px; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-secondaryBackground); border-radius: 4px; padding: 0 10px; cursor: pointer; }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary { background: var(--vscode-button-background); }
    .spacer { flex: 1; }
    .path { max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .75; font-size: 12px; }
    .stage { width: 100%; height: calc(100% - 38px); position: relative; overflow: hidden; }
    .pane { position: absolute; inset: 0; width: 100%; height: 100%; visibility: hidden; opacity: 0; pointer-events: none; z-index: 0; }
    .pane.active { visibility: visible; opacity: 1; pointer-events: auto; z-index: 1; }
    .preview { width: 100%; height: 100%; border: 0; background: white; }
    .empty { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 12px; color: var(--vscode-descriptionForeground); }
    .pdfName { max-width: 70%; overflow-wrap: anywhere; color: var(--vscode-foreground); text-align: center; }
    .actions { display: flex; gap: 8px; }
    .busy { color: var(--vscode-descriptionForeground); font-size: 12px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="htmlButton" class="${session.mode === 'html' ? 'primary' : ''}" onclick="switchMode('html')">HTML</button>
    <button id="pdfButton" class="${session.mode === 'pdf' ? 'primary' : ''}" onclick="switchMode('pdf')">PDF</button>
    <button onclick="send({ command: 'renderHtml' })">Render HTML</button>
    <button onclick="send({ command: 'renderPdf' })">Render PDF</button>
    <button onclick="send({ command: 'convert' })">Convert</button>
    <button onclick="send({ command: 'refresh' })">Refresh</button>
    ${session.rendering ? '<span class="busy">Building...</span>' : ''}
    <div class="spacer"></div>
    <div class="path" title="${escapeHtml(session.root)}">${escapeHtml(session.root)}</div>
    <button onclick="send({ command: 'stop' })">Stop</button>
  </div>
  <div class="stage">
    <div id="htmlPane" class="pane ${session.mode === 'html' ? 'active' : ''}">${htmlStage}</div>
    <div id="pdfPane" class="pane ${session.mode === 'pdf' ? 'active' : ''}">${pdfStageHtml}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function send(message) { vscode.postMessage(message); }
    function applyMode(mode) {
      document.getElementById('htmlPane').classList.toggle('active', mode === 'html');
      document.getElementById('pdfPane').classList.toggle('active', mode === 'pdf');
      document.getElementById('htmlButton').classList.toggle('primary', mode === 'html');
      document.getElementById('pdfButton').classList.toggle('primary', mode === 'pdf');
    }
    function switchMode(mode) {
      applyMode(mode);
      send({ command: 'mode', mode });
    }
    window.addEventListener('message', event => {
      const message = event.data || {};
      if (message.command === 'mode') applyMode(message.mode === 'pdf' ? 'pdf' : 'html');
    });
  </script>
</body>
</html>`;
}

function pdfStage(missingPdf, pdfName, pdfViewerUrl) {
  if (missingPdf) {
    return `<div class="empty"><div>No PDF found in _pdf.</div><button class="primary" onclick="send({ command: 'renderPdf' })">Render PDF</button></div>`;
  }
  return `<div style="width:100%;height:100%;display:flex;flex-direction:column;">
    <div style="height:30px;display:flex;align-items:center;gap:8px;padding:0 8px;border-bottom:1px solid var(--vscode-panel-border);box-sizing:border-box;">
      <div class="pdfName" title="${escapeHtml(pdfName)}">${escapeHtml(pdfName)}</div>
      <div class="spacer"></div>
      <button onclick="send({ command: 'openPdf' })">Open Externally</button>
      <button onclick="send({ command: 'renderPdf' })">Render PDF</button>
    </div>
    <iframe class="preview" src="${pdfViewerUrl}" style="height:calc(100% - 30px);"></iframe>
  </div>`;
}

async function runConvert(context, root) {
  if (isConvertedProject(root)) {
    output.appendLine('[convert] project already has _quarto.yml and qmd files; skipping import');
    return false;
  }
  const toolDir = getToolDir(context);
  const script = path.join(toolDir, 'convert-mineru.js');
  assertFile(script, 'convert-mineru.js');
  output.appendLine('[convert] mineru markdown -> qmd project');
  await runProcess(getNodePath(), [script, root], root, { PROJECT_ROOT: root });
  return true;
}

function organizeConvertedProject(root) {
  const ymlPath = path.join(root, '_quarto.yml');
  if (!fs.existsSync(ymlPath)) return;
  const hiddenDir = path.join(root, '.qmdtool');
  fs.mkdirSync(hiddenDir, { recursive: true });

  let moved = 0;
  for (const name of ['references.bib', 'ieee.csl', 'autoreload.html']) {
    const source = path.join(root, name);
    const dest = path.join(hiddenDir, name);
    if (!fs.existsSync(source)) continue;
    if (fs.existsSync(dest)) continue;
    fs.renameSync(source, dest);
    moved++;
  }

  const before = fs.readFileSync(ymlPath, 'utf8');
  const after = before
    .replace(/^bibliography:\s*references\.bib\s*$/m, 'bibliography: .qmdtool/references.bib')
    .replace(/^csl:\s*ieee\.csl\s*$/m, 'csl: .qmdtool/ieee.csl')
    .replace(/^(\s*-\s*)autoreload\.html\s*$/m, '$1.qmdtool/autoreload.html');

  if (after !== before) {
    fs.writeFileSync(ymlPath, after, 'utf8');
  }
  output.appendLine(`[organize] moved ${moved} support file(s) into .qmdtool/`);
}

async function runHtml(context, root, session) {
  setStatus(session, 'rendering-html', 'HTML');
  output.appendLine('[render] html');
  await runProcess(getQuartoPath(), ['render', '--to', 'html'], root);
  bumpHtmlBuild(session);
}

async function runPdf(context, root, session) {
  setStatus(session, 'rendering-pdf', 'PDF');
  output.appendLine('[render] pdf');
  await runProcess(getQuartoPath(), ['render', '--to', 'pdf', '--output-dir', '_pdf'], root);
}

async function runPreRenderTools(context, root) {
  const toolDir = getToolDir(context);
  output.appendLine('[render] prepare');
  await runToolScript(toolDir, 'normalize-encoding.js', root);
  await runToolScript(toolDir, 'format-algorithms.js', root);
  await runToolScript(toolDir, 'gen-includes.js', root);
  await runToolScript(toolDir, 'localize-images.js', root, ['--prune-unused']);
}

async function runPreviewBuild(context, root, session) {
  const renderHtml = vscode.workspace.getConfiguration('qmdtool').get('autoRenderHtmlOnSave', true);
  const renderPdf = vscode.workspace.getConfiguration('qmdtool').get('autoRenderPdfOnSave', true);
  if (renderHtml || renderPdf) await runPreRenderTools(context, root);
  if (renderHtml) await runHtml(context, root, session);
  if (renderPdf) await runPdf(context, root, session);
}

async function runToolScript(toolDir, scriptName, root, args = []) {
  const script = path.join(toolDir, scriptName);
  assertFile(script, scriptName);
  await runProcess(getNodePath(), [script, ...args], root);
}

function runProcess(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    output.appendLine(`> ${command} ${args.map(quoteArg).join(' ')}`);
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      shell: false,
    });
    child.stdout.on('data', (chunk) => output.append(chunk.toString()));
    child.stderr.on('data', (chunk) => output.append(chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        output.appendLine(`[done] ${path.basename(command)} ${formatDuration(Date.now() - started)}`);
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command}`));
      }
    });
  });
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

async function startStaticServer(session, toolDir) {
  const root = session.root;
  const port = session.port;
  const bookDir = path.join(root, '_book');
  const pdfDir = path.join(root, '_pdf');
  const pdfjsDir = path.join(toolDir, '_pdfjs');
  const server = http.createServer((req, res) => {
    try {
      const rawUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (rawUrl.pathname === '/status') {
        sendJson(res, session.status || { state: 'idle', buildId: 0 });
        return;
      }
      if (rawUrl.pathname === '/find-source' && req.method === 'POST') {
        readJsonBody(req, (err, body) => {
          if (err) return sendText(res, 400, `bad request: ${err.message}`);
          sendJson(res, findSource(root, body.text || '') || { found: false });
        });
        return;
      }
      if (rawUrl.pathname === '/remember-html-location' && req.method === 'POST') {
        readJsonBody(req, (err, body) => {
          if (err) return sendText(res, 400, `bad request: ${err.message}`);
          const remembered = sanitizeHtmlPath(body.path || '/index.html');
          if (remembered) session.htmlPath = remembered;
          session.htmlScroll.set(remembered, {
            x: Number(body.x) || 0,
            y: Number(body.y) || 0,
          });
          sendJson(res, { ok: true, path: session.htmlPath });
        });
        return;
      }
      if (rawUrl.pathname === '/html-location') {
        const remembered = sanitizeHtmlPath(rawUrl.searchParams.get('path') || session.htmlPath || '/index.html');
        sendJson(res, {
          path: session.htmlPath || remembered,
          scroll: session.htmlScroll.get(remembered) || { x: 0, y: 0 },
        });
        return;
      }
      if (rawUrl.pathname === '/open-in-editor' && req.method === 'POST') {
        readJsonBody(req, async (err, body) => {
          if (err) return sendText(res, 400, `bad request: ${err.message}`);
          const result = findSource(root, body.text || '') || { found: false };
          if (result.found) {
            await openSource(result.file, result.line);
          }
          sendJson(res, result);
        });
        return;
      }
      if (rawUrl.pathname === '/pdf' || rawUrl.pathname === '/pdf/' || rawUrl.pathname === '/pdf.html') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(pdfWrapperHtml());
        return;
      }
      if (rawUrl.pathname.startsWith('/_pdfjs/')) {
        const rel = decodeURIComponent(rawUrl.pathname.slice('/_pdfjs/'.length));
        serveStaticFile(res, safeJoin(pdfjsDir, rel));
        return;
      }
      if (rawUrl.pathname.startsWith('/__pdf/')) {
        const name = decodeURIComponent(rawUrl.pathname.slice('/__pdf/'.length));
        const file = name === 'latest.pdf' ? findNewestPdf(pdfDir) : safeJoin(pdfDir, name);
        if (req.method === 'HEAD') {
          servePdfHead(res, file, session);
        } else {
          servePdfFile(res, file, session);
        }
        return;
      }
      let requestPath = decodeURIComponent(rawUrl.pathname);
      if (requestPath === '/') requestPath = '/index.html';
      serveFile(res, safeJoin(bookDir, requestPath), session, bookDir);
    } catch (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(err && err.message ? err.message : err));
    }
  });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

function serveFile(res, file, session, bookDir) {
  if (path.extname(file).toLowerCase() === '.html') {
    serveHtmlWithFallback(res, file, session, bookDir);
    return;
  }

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const cached = getAssetCache(session, bookDir, file);
    if (cached) {
      res.writeHead(200, {
        'content-type': cached.mime,
        'cache-control': 'no-store',
        'x-qmdtool-cache': 'stale',
      });
      res.end(cached.bytes);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  rememberAssetCache(session, bookDir, file);
  res.writeHead(200, { 'content-type': mimeType(file) });
  fs.createReadStream(file).pipe(res);
}

function serveStaticFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': mimeType(file),
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

function serveHtmlWithFallback(res, file, session, bookDir) {
  fs.readFile(file, 'utf8', (err, content) => {
    if (!err) {
      rememberAssetCache(session, bookDir, file, Buffer.from(content, 'utf8'));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(injectSourceJump(content));
      return;
    }

    const cached = getAssetCache(session, bookDir, file);
    if (cached) {
      res.writeHead(200, {
        'content-type': cached.mime,
        'cache-control': 'no-store',
        'x-qmdtool-cache': 'stale',
      });
      const text = cached.bytes.toString('utf8');
      res.end(injectSourceJump(text));
      return;
    }

    if (path.basename(file).toLowerCase() === 'index.html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(emptyPreviewHtml());
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
}

function rememberAssetCache(session, bookDir, file, bytes) {
  if (!session || !bookDir) return;
  const key = assetCacheKey(bookDir, file);
  try {
    const stat = bytes ? null : fs.statSync(file);
    if (stat && stat.size > 25 * 1024 * 1024) return;
    const data = bytes || fs.readFileSync(file);
    if (data.length > 25 * 1024 * 1024) return;
    session.assetCache.set(key, {
      bytes: Buffer.isBuffer(data) ? data : Buffer.from(String(data)),
      mime: mimeType(file),
    });
    trimAssetCache(session, 120 * 1024 * 1024);
  } catch (_) {}
}

function trimAssetCache(session, maxBytes) {
  let total = 0;
  for (const value of session.assetCache.values()) total += value.bytes.length;
  while (total > maxBytes && session.assetCache.size > 0) {
    const firstKey = session.assetCache.keys().next().value;
    const first = session.assetCache.get(firstKey);
    total -= first ? first.bytes.length : 0;
    session.assetCache.delete(firstKey);
  }
}

function getAssetCache(session, bookDir, file) {
  if (!session || !bookDir) return '';
  return session.assetCache.get(assetCacheKey(bookDir, file)) || null;
}

function assetCacheKey(bookDir, file) {
  return path.relative(bookDir, file).replace(/\\/g, '/').toLowerCase();
}

function emptyPreviewHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin:0; height:100%; display:flex; align-items:center; justify-content:center; background:#fff; color:#555; font:14px system-ui, sans-serif; }
    .box { text-align:center; line-height:1.7; }
  </style>
</head>
<body>
  <div class="box">
    <div>QmdTool is building this preview.</div>
    <div id="state">Please keep this panel open.</div>
  </div>
  <script>
    let lastBuildId = null;
    async function poll() {
      try {
        const r = await fetch('/status?_=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return;
        const s = await r.json();
        document.getElementById('state').textContent =
          (s.state || 'building') + (s.message ? ' - ' + s.message : '');
        if (typeof s.buildId === 'number') {
          if (lastBuildId === null) lastBuildId = s.buildId;
          else if (s.buildId !== lastBuildId && (s.state === 'idle' || s.state === 'rendering-pdf' || s.state === 'error')) {
            location.reload();
          }
        }
      } catch (_) {}
    }
    poll();
    setInterval(poll, 700);
  </script>
</body>
</html>`;
}

function serveHead(res, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'content-type': mimeType(file),
    'content-length': stat.size,
    'last-modified': stat.mtime.toUTCString(),
    'cache-control': 'no-store',
  });
  res.end();
}

function servePdfHead(res, file, session) {
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    rememberPdfCache(session, file);
    return serveHead(res, file);
  }
  if (session && session.pdfCache) {
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-length': session.pdfCache.bytes.length,
      'last-modified': session.pdfCache.mtime,
      'cache-control': 'no-store',
      'x-qmdtool-cache': 'stale',
    });
    res.end();
    return;
  }
  res.writeHead(404);
  res.end();
}

function servePdfFile(res, file, session) {
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    rememberPdfCache(session, file);
    return serveStaticFile(res, file);
  }
  if (session && session.pdfCache) {
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'cache-control': 'no-store',
      'x-qmdtool-cache': 'stale',
    });
    res.end(session.pdfCache.bytes);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('No PDF available');
}

function rememberPdfCache(session, file) {
  if (!session || !file) return;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 80 * 1024 * 1024) return;
    session.pdfCache = {
      bytes: fs.readFileSync(file),
      mtime: stat.mtime.toUTCString(),
    };
  } catch (_) {}
}

function pdfWrapperHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>QmdTool PDF</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #2a2a2e; }
    iframe { width: 100%; height: 100%; border: 0; display: block; }
    #status { position: fixed; bottom: 6px; right: 10px; z-index: 9999; color: #fff; background: rgba(0,0,0,.55); font: 11px monospace; padding: 2px 7px; border-radius: 3px; pointer-events: none; }
  </style>
</head>
<body>
  <iframe id="viewer" src="/_pdfjs/web/viewer.html?file=/__pdf/latest.pdf"></iframe>
  <div id="status">loading</div>
  <script>
    const iframe = document.getElementById('viewer');
    const statusEl = document.getElementById('status');
    let lastTag = null;
    let lastReloadAt = 0;
    const viewKey = '__qmdtool_pdf_view__';
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function getApp() {
      return iframe.contentWindow && iframe.contentWindow.PDFViewerApplication;
    }

    function readSavedView() {
      try {
        return JSON.parse(sessionStorage.getItem(viewKey) || 'null') || {};
      } catch (_) {
        return {};
      }
    }

    function saveView() {
      try {
        const app = getApp();
        if (!app || !app.initialized || !app.pdfViewer) return;
        const page = app.page || 1;
        const scale = app.pdfViewer.currentScaleValue || 'auto';
        sessionStorage.setItem(viewKey, JSON.stringify({ page, scale }));
      } catch (_) {}
    }

    async function restoreView(app, page, scale, maxMs = 5000) {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        try {
          if (app.pdfDocument && app.pagesCount > 0 && app.pdfViewer) {
            if (app.pagesCount >= page) {
              try { app.pdfViewer.currentScaleValue = scale; } catch (_) {}
              try { app.page = page; } catch (_) {}
              await sleep(160);
              if (app.page === page) return true;
            }
          }
        } catch (_) {}
        await sleep(120);
      }
      return false;
    }

    async function restoreSavedView(maxMs = 5000) {
      const saved = readSavedView();
      const page = saved.page || 1;
      const scale = saved.scale || 'auto';
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const app = getApp();
        if (app && app.initialized) {
          return restoreView(app, page, scale, Math.max(500, maxMs - (Date.now() - start)));
        }
        await sleep(120);
      }
      return false;
    }

    async function check() {
      try {
        const r = await fetch('/__pdf/latest.pdf?_=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
        if (!r.ok) { statusEl.textContent = 'waiting for pdf'; return; }
        const tag = r.headers.get('content-length') + '|' + r.headers.get('last-modified');
        if (lastTag === null) { lastTag = tag; statusEl.textContent = 'ready'; return; }
        if (tag === lastTag) return;
        lastTag = tag;
        const now = Date.now();
        if (now - lastReloadAt < 1500) return;
        lastReloadAt = now;

        saveView();
        const saved = readSavedView();
        const app = getApp();
        if (!app || !app.initialized) {
          iframe.src = '/_pdfjs/web/viewer.html?file=/__pdf/latest.pdf&_=' + Date.now();
          setTimeout(function(){ restoreSavedView(6000); }, 500);
          return;
        }

        const page = saved.page || app.page || 1;
        const scale = saved.scale || app.pdfViewer && app.pdfViewer.currentScaleValue || 'auto';
        statusEl.textContent = 'reloading p.' + page;
        await app.open({ url: '/__pdf/latest.pdf?_=' + Date.now() });
        const ok = await restoreView(app, page, scale);
        statusEl.textContent = ok ? 'reloaded p.' + page : 'reloaded';
      } catch (err) {
        statusEl.textContent = 'pdf err: ' + (err.message || err);
      }
    }

    check();
    setTimeout(function(){ restoreSavedView(6000); }, 800);
    setInterval(saveView, 1000);
    setInterval(check, 1500);
  </script>
</body>
</html>`;
}

function injectSourceJump(html) {
  if (html.includes('__qmdtool_source_jump__')) return html;
  const script = `<script id="__qmdtool_source_jump__">
(function(){
  if (window.__qmdtoolSourceJumpInstalled) return;
  window.__qmdtoolSourceJumpInstalled = true;
  const STATES = {
    idle: ['#2a8', 'idle'],
    scanning: ['#48a', 'preparing'],
    'rendering-html': ['#d80', 'rendering HTML'],
    'rendering-pdf': ['#86a', 'rendering PDF'],
    error: ['#c33', 'error']
  };
  let lastBuildId = null;
  function badge() {
    if (document.getElementById('__kb_status__')) return null;
    let b = document.getElementById('__qmdtool_status__');
    if (b) return b;
    b = document.createElement('div');
    b.id = '__qmdtool_status__';
    b.style.cssText = 'position:fixed;top:10px;right:12px;z-index:999999;font:12px/1.4 system-ui,sans-serif;padding:5px 10px;border-radius:14px;background:#666;color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);opacity:.8;pointer-events:none;user-select:none;';
    document.body.appendChild(b);
    return b;
  }
  async function pollStatus() {
    try {
      const r = await fetch('/status?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      const spec = STATES[s.state] || ['#666', s.state || 'unknown'];
      const b = badge();
      if (!b) return;
      b.style.background = spec[0];
      b.style.opacity = s.state === 'idle' ? '0.55' : '1';
      b.textContent = spec[1] + (s.message ? ' - ' + s.message : '');
      if (typeof s.buildId === 'number') {
        if (lastBuildId === null) lastBuildId = s.buildId;
        else if (s.buildId !== lastBuildId && (s.state === 'idle' || s.state === 'rendering-pdf' || s.state === 'error')) {
          lastBuildId = s.buildId;
          location.reload();
        }
      }
    } catch (_) {}
  }
  pollStatus();
  setInterval(pollStatus, 700);

  function stableHtmlPath() {
    const params = new URLSearchParams(location.search);
    params.delete('t');
    const qs = params.toString();
    return location.pathname + (qs ? '?' + qs : '') + (location.hash || '');
  }
  function scrollPos() {
    const el = document.scrollingElement || document.documentElement || document.body;
    return { x: window.scrollX || el.scrollLeft || 0, y: window.scrollY || el.scrollTop || 0 };
  }
  const scrollKey = '__qmdtool_scroll__:' + stableHtmlPath();
  function rememberLocation() {
    try {
      const pos = scrollPos();
      sessionStorage.setItem(scrollKey, JSON.stringify(pos));
      fetch('/remember-html-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: stableHtmlPath(), x: pos.x, y: pos.y }),
        keepalive: true
      }).catch(function(){});
    } catch (_) {}
  }
  function applyScroll(saved) {
    if (!saved || typeof saved.y !== 'number') return;
    const x = saved.x || 0;
    const y = saved.y || 0;
    [50, 250, 700, 1400].forEach(function(ms) {
      setTimeout(function(){ window.scrollTo(x, y); }, ms);
    });
  }
  async function restoreLocation() {
    try {
      let saved = JSON.parse(sessionStorage.getItem(scrollKey) || 'null');
      if (!saved || typeof saved.y !== 'number') {
        const r = await fetch('/html-location?path=' + encodeURIComponent(stableHtmlPath()), { cache: 'no-store' });
        if (r.ok) {
          const data = await r.json();
          saved = data && data.scroll;
        }
      }
      applyScroll(saved);
      rememberLocation();
    } catch (_) {}
  }
  let rememberTimer = null;
  window.addEventListener('scroll', function() {
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(rememberLocation, 120);
  }, { passive: true });
  setInterval(rememberLocation, 1000);
  document.addEventListener('click', function() {
    setTimeout(rememberLocation, 150);
  }, true);
  document.addEventListener('keyup', function(ev) {
    if (['PageDown','PageUp','Home','End','ArrowDown','ArrowUp','Space'].includes(ev.code || ev.key)) {
      setTimeout(rememberLocation, 120);
    }
  }, true);
  document.addEventListener('visibilitychange', rememberLocation);
  window.addEventListener('beforeunload', rememberLocation);
  window.addEventListener('pagehide', rememberLocation);
  window.addEventListener('hashchange', function() {
    setTimeout(rememberLocation, 80);
  });
  restoreLocation();

  let zoomBox = null;
  let zoomImg = null;
  let zoomScale = 1;
  function ensureZoomBox() {
    if (zoomBox) return zoomBox;
    zoomBox = document.createElement('div');
    zoomBox.id = '__qmdtool_image_zoom__';
    zoomBox.style.cssText = 'position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,.86);display:none;align-items:center;justify-content:center;overflow:hidden;cursor:zoom-out;';
    zoomImg = document.createElement('img');
    zoomImg.style.cssText = 'max-width:none;max-height:none;transform-origin:center center;transition:transform .08s ease-out;box-shadow:0 8px 28px rgba(0,0,0,.45);background:white;';
    const hint = document.createElement('div');
    hint.textContent = 'Wheel to zoom, double-click to reset, Esc to close';
    hint.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,.55);font:12px system-ui,sans-serif;padding:4px 10px;border-radius:4px;pointer-events:none;';
    zoomBox.appendChild(zoomImg);
    zoomBox.appendChild(hint);
    zoomBox.addEventListener('click', function(ev) {
      if (ev.target === zoomBox) closeZoom();
    });
    zoomBox.addEventListener('wheel', function(ev) {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.12 : 0.89;
      zoomScale = Math.min(8, Math.max(0.4, zoomScale * factor));
      zoomImg.style.transform = 'scale(' + zoomScale + ')';
    }, { passive: false });
    zoomBox.addEventListener('dblclick', function(ev) {
      ev.preventDefault();
      zoomScale = 1;
      zoomImg.style.transform = 'scale(1)';
    });
    document.body.appendChild(zoomBox);
    return zoomBox;
  }
  function openZoom(src) {
    ensureZoomBox();
    zoomScale = 1;
    zoomImg.src = src;
    zoomImg.style.transform = 'scale(1)';
    zoomBox.style.display = 'flex';
  }
  function closeZoom() {
    if (zoomBox) zoomBox.style.display = 'none';
  }
  document.addEventListener('click', function(ev) {
    const img = ev.target && ev.target.closest && ev.target.closest('img');
    if (!img || !img.src) return;
    ev.preventDefault();
    ev.stopPropagation();
    openZoom(img.src);
  }, true);
  document.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape') closeZoom();
  }, true);

  const BLOCKS = new Set(['P','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','PRE','TD','TH','DT','DD','FIGCAPTION']);
  function block(node) {
    let el = node;
    while (el && el !== document.body) {
      if (BLOCKS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function toast(msg) {
    let t = document.getElementById('__qmdtool_source_toast__');
    if (!t) {
      t = document.createElement('div');
      t.id = '__qmdtool_source_toast__';
      t.style.cssText = 'position:fixed;bottom:8px;left:8px;background:rgba(0,0,0,.75);color:#fff;font:12px monospace;padding:4px 10px;border-radius:4px;z-index:999999;pointer-events:none;transition:opacity .25s;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._hide);
    t._hide = setTimeout(function(){ t.style.opacity = '0'; }, 1600);
  }
  async function jump(ev) {
    if (ev.type === 'click' && !(ev.ctrlKey || ev.metaKey)) return;
    if (ev.target && ev.target.closest && ev.target.closest('img')) return;
    const b = block(ev.target);
    if (!b) return;
    const text = (b.textContent || '').trim();
    if (text.length < 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    toast('opening source...');
    try {
      const r = await fetch('/open-in-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await r.json();
      if (data && data.found) toast('opened ' + data.file.split(/[\\\\/]/).pop() + ':' + data.line);
      else toast('source not found');
    } catch (e) {
      toast('source jump failed: ' + (e.message || e));
    }
  }
  document.addEventListener('click', jump, true);
  document.addEventListener('dblclick', jump, true);
})();
</script>`;
  if (html.includes('</body>')) return html.replace('</body>', `${script}</body>`);
  return `${html}\n${script}`;
}

function readJsonBody(req, callback) {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      callback(null, JSON.parse(text || '{}'));
    } catch (err) {
      callback(err);
    }
  });
  req.on('error', callback);
}

function sendJson(res, data) {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function findSource(root, searchText) {
  const text = String(searchText || '').replace(/\s+/g, ' ').trim();
  if (text.length < 2) return null;

  const candidates = [];
  for (const len of [100, 70, 40, 20, 10, 5]) {
    const candidate = text.slice(0, len);
    if (candidate.length >= 2 && !candidates.includes(candidate)) candidates.push(candidate);
  }

  const files = collectQmdFiles(path.join(root, 'qmd'));
  for (const candidate of candidates) {
    for (const file of files) {
      let lines;
      try {
        lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      } catch (_) {
        continue;
      }
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].replace(/\s+/g, ' ').includes(candidate)) {
          return { found: true, file, line: i + 1 };
        }
      }
    }
  }
  return null;
}

function collectQmdFiles(dir, out = []) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const name of files) {
    if (name.toLowerCase().endsWith('.qmd')) out.push(path.join(dir, name));
  }
  for (const name of dirs) collectQmdFiles(path.join(dir, name), out);
  return out;
}

async function openSource(file, line) {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
  const pos = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

function setupWatchers(context, session) {
  const renderHtml = vscode.workspace.getConfiguration('qmdtool').get('autoRenderHtmlOnSave', true);
  const renderPdf = vscode.workspace.getConfiguration('qmdtool').get('autoRenderPdfOnSave', true);
  if (!renderHtml && !renderPdf) return;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(session.root));
  const baseUri = workspaceFolder ? workspaceFolder.uri : vscode.Uri.file(session.root);
  const patterns = ['**/*.qmd', '**/_quarto.yml', '**/*.bib', '**/*.csl'];
  for (const pattern of patterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(baseUri, pattern));
    const trigger = () => scheduleAutoRender(context, session);
    watcher.onDidCreate(trigger);
    watcher.onDidChange(trigger);
    watcher.onDidDelete(trigger);
    session.watchers.push(watcher);
    context.subscriptions.push(watcher);
  }
}

function scheduleAutoRender(context, session) {
  if (session.rendering || Date.now() < session.suppressWatchUntil) return;
  if (session.debounce) clearTimeout(session.debounce);
  session.debounce = setTimeout(async () => {
    if (session.rendering || Date.now() < session.suppressWatchUntil) return;
    await queueRender(session, async () => {
      const hadHtml = fs.existsSync(path.join(session.root, '_book', 'index.html'));
      const hadPdf = Boolean(findNewestPdf(path.join(session.root, '_pdf')));
      await runPreviewBuild(context, session.root, session);
      if (session.mode === 'html' && !hadHtml) updatePanel(session);
      if (session.mode === 'pdf' && !hadPdf) {
        updatePanel(session);
      }
    }, '[watch]');
  }, 1200);
}

function queueRender(session, task, label = '[render]') {
  const run = async () => {
    if (session.disposed) return;
    session.rendering = true;
    session.suppressWatchUntil = Date.now() + 3000;
    snapshotBookCache(session);
    setStatus(session, 'scanning', 'preparing');
    try {
      await withProjectRenderLock(session.root, task);
      setStatus(session, 'idle', '');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setStatus(session, 'error', message);
      output.appendLine(`${label} ${message}`);
      vscode.window.showErrorMessage(message);
    } finally {
      session.suppressWatchUntil = Date.now() + 3000;
      session.rendering = false;
    }
  };
  session.renderQueue = session.renderQueue.then(run, run);
  return session.renderQueue;
}

async function withProjectRenderLock(root, task) {
  const lockDir = path.join(root, '.qmdtool', 'render.lock');
  await acquireProjectRenderLock(lockDir);
  try {
    await task();
  } finally {
    releaseProjectRenderLock(lockDir);
  }
}

async function acquireProjectRenderLock(lockDir) {
  const parent = path.dirname(lockDir);
  fs.mkdirSync(parent, { recursive: true });

  const started = Date.now();
  let lastNotice = 0;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'owner.txt'), [
        `pid=${process.pid}`,
        `started=${new Date().toISOString()}`,
      ].join('\n'), 'utf8');
      return;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
    }

    if (isStaleRenderLock(lockDir)) {
      releaseProjectRenderLock(lockDir);
      continue;
    }

    if (Date.now() - lastNotice > 10000) {
      output.appendLine('[render] another render is running for this project; waiting...');
      lastNotice = Date.now();
    }
    if (Date.now() - started > 15 * 60 * 1000) {
      throw new Error(`Timed out waiting for render lock: ${lockDir}`);
    }
    await sleep(1000);
  }
}

function isStaleRenderLock(lockDir) {
  try {
    const ownerPath = path.join(lockDir, 'owner.txt');
    if (fs.existsSync(ownerPath)) {
      const owner = fs.readFileSync(ownerPath, 'utf8');
      const match = owner.match(/^pid=(\d+)/m);
      if (match) {
        const ownerPid = Number(match[1]);
        if (Number.isInteger(ownerPid) && ownerPid > 0 && !isProcessAlive(ownerPid)) {
          return true;
        }
      }
    }

    const stat = fs.statSync(lockDir);
    return Date.now() - stat.mtimeMs > 30 * 60 * 1000;
  } catch (_) {
    return false;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function releaseProjectRenderLock(lockDir) {
  try {
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch (_) {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function snapshotBookCache(session) {
  if (!session) return;
  const bookDir = path.join(session.root, '_book');
  if (fs.existsSync(bookDir) && fs.statSync(bookDir).isDirectory()) {
    for (const file of collectBookFiles(bookDir)) {
      try {
        rememberAssetCache(session, bookDir, file);
      } catch (_) {}
    }
  }
  rememberPdfCache(session, findNewestPdf(path.join(session.root, '_pdf')));
}

function collectBookFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) collectBookFiles(file, out);
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

function setStatus(session, state, message = '') {
  if (!session) return;
  const current = session.status || { buildId: 0 };
  session.status = {
    state,
    message,
    buildId: current.buildId || 0,
  };
}

function bumpHtmlBuild(session) {
  if (!session) return;
  const current = session.status || { state: 'rendering-html', message: 'HTML', buildId: 0 };
  session.status = {
    ...current,
    buildId: (current.buildId || 0) + 1,
  };
}

async function resolveProjectRoot(uri) {
  if (uri && uri.fsPath) {
    const stat = fs.existsSync(uri.fsPath) ? fs.statSync(uri.fsPath) : undefined;
    const candidate = stat && stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
    const existingProject = findUp(candidate, '_quarto.yml');
    if (existingProject) return existingProject;
    if (directoryHasMarkdown(candidate)) return candidate;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(candidate));
    return folder ? folder.uri.fsPath : candidate;
  }
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: 'Select a Markdown/image folder or QmdTool project',
  });
  if (!picked || picked.length === 0) throw new Error('No project folder selected.');
  return picked[0].fsPath;
}

async function pickMode() {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'HTML', description: 'Fast preview inside Positron', mode: 'html' },
      { label: 'PDF', description: 'Render LaTeX PDF and preview it', mode: 'pdf' },
    ],
    { placeHolder: 'Choose preview format' },
  );
  return picked && picked.mode;
}

function getToolDir(context) {
  const configured = vscode.workspace.getConfiguration('qmdtool').get('toolDir', '');
  const candidates = [
    configured,
    path.join(context.extensionPath, 'tool'),
    path.resolve(context.extensionPath, '..', 'tool'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  throw new Error('QmdTool tool directory not found. Set qmdtool.toolDir.');
}

function getQuartoPath() {
  const configured = vscode.workspace.getConfiguration('qmdtool').get('quartoPath', '');
  if (configured) return configured;
  const detected = detectQuartoPath();
  if (detected) return detected;
  return 'quarto';
}

function detectQuartoPath() {
  const candidates = [
    'C:\\Program Files\\Quarto\\bin\\quarto.exe',
    'C:\\Program Files (x86)\\Quarto\\bin\\quarto.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Quarto', 'bin', 'quarto.exe') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'Quarto', 'bin', 'quarto.exe') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const where = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(where, ['quarto'], { encoding: 'utf8', windowsHide: true });
  if (result.status === 0 && result.stdout) {
    const first = result.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (first) return first;
  }
  return '';
}

function getNodePath() {
  const configured = vscode.workspace.getConfiguration('qmdtool').get('nodePath', '');
  return configured || 'node';
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function safeJoin(root, requestPath) {
  const clean = requestPath.replace(/^[/\\]+/, '');
  const target = path.resolve(root, clean);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Invalid path');
  }
  return target;
}

function sanitizeHtmlPath(value) {
  let raw = String(value || '/index.html').trim();
  if (!raw.startsWith('/')) raw = `/${raw}`;
  try {
    const parsed = new URL(raw, 'http://127.0.0.1');
    if (parsed.pathname.startsWith('/_pdfjs/') || parsed.pathname === '/pdf' || parsed.pathname === '/pdf/' || parsed.pathname === '/pdf.html') {
      return '/index.html';
    }
    if (!parsed.pathname.toLowerCase().endsWith('.html') && parsed.pathname !== '/') {
      return '/index.html';
    }
    const pathname = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
    const search = parsed.search
      .replace(/[?&]t=\d+/g, '')
      .replace(/^\?&/, '?')
      .replace(/^\?$/, '');
    return `${pathname}${search}${parsed.hash || ''}`;
  } catch (_) {
    return '/index.html';
  }
}

function withCacheBuster(pathWithHash, nonce) {
  const parsed = new URL(pathWithHash || '/index.html', 'http://127.0.0.1');
  parsed.searchParams.set('t', String(nonce));
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function disposeSession(session) {
  if (session.disposed) return;
  session.disposed = true;
  if (session.debounce) clearTimeout(session.debounce);
  for (const watcher of session.watchers) {
    try { watcher.dispose(); } catch (_) {}
  }
  session.watchers = [];
  if (session.panel) {
    try { session.panel.dispose(); } catch (_) {}
    session.panel = undefined;
  }
  if (session.server) {
    try { session.server.close(); } catch (_) {}
  }
}

function findNewestPdf(dir) {
  if (!fs.existsSync(dir)) return '';
  const files = fs.readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || '';
}

async function openPdfInEditor(root) {
  const pdf = findNewestPdf(path.join(root, '_pdf'));
  if (!pdf) {
    vscode.window.showInformationMessage('No PDF found yet. Click Render PDF first.');
    return;
  }
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pdf), {
    preview: false,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

function findUp(start, fileName) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, fileName))) return current;
    const parent = path.dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

function directoryHasMarkdown(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  return fs.readdirSync(dir).some((name) => name.toLowerCase().endsWith('.md'));
}

function isConvertedProject(root) {
  return fs.existsSync(path.join(root, '_quarto.yml')) && hasQmdFile(path.join(root, 'qmd'));
}

function hasQmdFile(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.qmd')) return true;
    if (entry.isDirectory() && hasQmdFile(file)) return true;
  }
  return false;
}

function assertFile(file, label) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`${label} not found: ${file}`);
  }
}

function quoteArg(arg) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function normalizeKey(file) {
  return path.resolve(file).toLowerCase();
}

async function newProject(context, uri) {
  let targetDir;
  if (uri && uri.fsPath) {
    const stat = fs.existsSync(uri.fsPath) ? fs.statSync(uri.fsPath) : undefined;
    targetDir = stat && stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath);
  } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    targetDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
  } else {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: '选择要创建 Quarto 项目的文件夹',
      openLabel: '在此创建',
    });
    if (!picked || picked.length === 0) return;
    targetDir = picked[0].fsPath;
  }

  if (fs.existsSync(path.join(targetDir, '_quarto.yml'))) {
    vscode.window.showWarningMessage(
      `目录已经是 Quarto 项目（存在 _quarto.yml）：${targetDir}`,
    );
    return;
  }

  const visibleEntries = fs.existsSync(targetDir)
    ? fs.readdirSync(targetDir).filter((n) => !n.startsWith('.'))
    : [];
  if (visibleEntries.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `目录非空（${visibleEntries.length} 个可见项）。仍然在此创建模板吗？已有的同名文件不会被覆盖。`,
      { modal: true },
      '继续',
    );
    if (choice !== '继续') return;
  }

  const templateDir = path.join(context.extensionPath, 'templates', 'book');
  if (!fs.existsSync(templateDir)) {
    throw new Error(`模板目录不存在：${templateDir}`);
  }

  output.show(true);
  output.appendLine(`\n[new-project] target = ${targetDir}`);

  const created = copyTemplate(templateDir, targetDir);
  const quartoPath = detectQuartoPath();
  const settingsChanged = ensureWorkspaceSettings(targetDir, quartoPath);
  if (settingsChanged.length) created.push(...settingsChanged);

  const qmdDir = path.join(targetDir, 'qmd');
  if (!fs.existsSync(qmdDir)) {
    fs.mkdirSync(qmdDir, { recursive: true });
    created.push('qmd/');
  }

  for (const item of created) {
    output.appendLine(`[new-project] + ${item}`);
  }
  if (created.length === 0) {
    output.appendLine('[new-project] nothing copied (all files already existed)');
  }

  updateNewProjectStatusBar();

  const indexQmd = path.join(targetDir, 'index.qmd');
  if (fs.existsSync(indexQmd)) {
    try {
      const doc = await vscode.workspace.openTextDocument(indexQmd);
      await vscode.window.showTextDocument(doc);
    } catch (e) {
      output.appendLine(`[new-project] open index.qmd failed: ${e.message}`);
    }
  }

  vscode.window.showInformationMessage(
    `Quarto 项目模板已创建（${created.length} 项）。直接编辑 index.qmd 和 _quarto.yml 即可。`,
  );
}

function copyTemplate(srcDir, dstDir) {
  const created = [];
  if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstName = templateNameToReal(entry.name);
    const dstPath = path.join(dstDir, dstName);
    if (entry.isDirectory()) {
      const subCreated = copyTemplate(srcPath, dstPath);
      created.push(...subCreated.map((p) => path.join(dstName, p)));
    } else if (entry.isFile()) {
      if (fs.existsSync(dstPath)) continue;
      fs.copyFileSync(srcPath, dstPath);
      created.push(dstName);
    }
  }
  return created;
}

function templateNameToReal(name) {
  if (name === 'gitignore') return '.gitignore';
  if (name === 'dot-vscode') return '.vscode';
  return name;
}

function ensureWorkspaceSettings(targetDir, quartoPath) {
  const settingsPath = path.join(targetDir, '.vscode', 'settings.json');
  const changed = [];
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (_) {
      return changed;
    }
  }

  let dirty = false;
  if (settings['files.encoding'] !== 'utf8') {
    settings['files.encoding'] = 'utf8';
    dirty = true;
  }
  if (settings['files.autoGuessEncoding'] !== false) {
    settings['files.autoGuessEncoding'] = false;
    dirty = true;
  }
  if (quartoPath && !settings['qmdtool.quartoPath']) {
    settings['qmdtool.quartoPath'] = quartoPath;
    dirty = true;
  }

  if (dirty) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    changed.push('.vscode\\settings.json');
  }
  return changed;
}

function updateNewProjectStatusBar() {
  if (!newProjectStatusBar) return;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    newProjectStatusBar.hide();
    return;
  }
  const root = folders[0].uri.fsPath;
  if (fs.existsSync(path.join(root, '_quarto.yml'))) {
    newProjectStatusBar.hide();
  } else {
    newProjectStatusBar.show();
  }
}

module.exports = {
  activate,
  deactivate,
};

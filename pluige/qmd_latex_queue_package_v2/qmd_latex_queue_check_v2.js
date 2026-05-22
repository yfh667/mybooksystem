#!/usr/bin/env node
/*
 qmd_latex_queue_check.js

 Purpose:
   Validate MinerU/QmdTool Markdown snippets by the same final criterion that matters:
   can Markdown math/table snippets pass Pandoc -> XeLaTeX compilation?

 Typical usage on Windows:
   node qmd_latex_queue_check.js "D:\\book\\pdf040_qmdtool_fixed.md" --compile --workers 4 --report "D:\\book\\latex_queue_report.json"

 The script does not modify the source Markdown. It extracts all math snippets and tables into
 a queue, compiles each snippet independently, writes a JSON report, and writes Codex repair
 prompt files for failed snippets.
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '0.2.0';

function usage() {
  console.log(`qmd_latex_queue_check.js v${VERSION}

Usage:
  node qmd_latex_queue_check.js <markdown-file> [options]

Options:
  --compile                 Compile every extracted item via Pandoc -> XeLaTeX.
  --workers <n>             Parallel compile workers. Default: 2.
  --timeout <ms>            Per-item timeout. Default: 60000.
  --report <path>           JSON report path. Default: <file>.latex_queue_report.json.
  --workdir <path>          Temp/work directory. Default: <file>.latex_check_work.
  --failed-md <path>        Failed items Markdown report. Default: <file>.latex_failures.md.
  --types <list>            Comma list: math,table,heading,raw. Default: math,table,heading,raw.
  --limit <n>               Only process first n extracted items.
  --from-line <n>           Only process items starting from this source line.
  --to-line <n>             Only process items ending before/at this source line.
  --include-details         Also scan content inside <details>...</details>. Default: ignored.
  --no-codex-prompts        Do not generate per-failure Codex prompt files.
  --cjk-font <name>         Preferred CJK font for XeLaTeX. Default: auto fallback.
  --pandoc <path>           Pandoc executable. Default: pandoc.
  --pdf-engine <name>       LaTeX/PDF engine. Default: xelatex.
  --math-check <mode>       direct or pandoc. Default: direct.
  --help                    Show this help.

Exit code:
  0 = no compile failures or extraction only
  2 = at least one compile failure
  3 = environment/usage error
`);
}

function parseArgs(argv) {
  const args = {
    file: '',
    compile: false,
    workers: 2,
    timeout: 60000,
    report: '',
    workdir: '',
    failedMd: '',
    types: new Set(['math', 'table', 'heading', 'raw']),
    limit: 0,
    fromLine: 0,
    toLine: 0,
    includeDetails: false,
    codexPrompts: true,
    cjkFont: '',
    pandoc: 'pandoc',
    pdfEngine: 'xelatex',
    mathCheck: 'direct',
  };
  const a = [...argv];
  while (a.length) {
    const x = a.shift();
    if (x === '--help' || x === '-h') { args.help = true; return args; }
    if (!args.file && !x.startsWith('--')) { args.file = x; continue; }
    switch (x) {
      case '--compile': args.compile = true; break;
      case '--include-details': args.includeDetails = true; break;
      case '--no-codex-prompts': args.codexPrompts = false; break;
      case '--workers': args.workers = positiveInt(a.shift(), '--workers'); break;
      case '--timeout': args.timeout = positiveInt(a.shift(), '--timeout'); break;
      case '--report': args.report = requiredValue(a.shift(), '--report'); break;
      case '--workdir': args.workdir = requiredValue(a.shift(), '--workdir'); break;
      case '--failed-md': args.failedMd = requiredValue(a.shift(), '--failed-md'); break;
      case '--types': args.types = new Set(requiredValue(a.shift(), '--types').split(',').map(s => s.trim()).filter(Boolean)); break;
      case '--limit': args.limit = positiveInt(a.shift(), '--limit'); break;
      case '--from-line': args.fromLine = positiveInt(a.shift(), '--from-line'); break;
      case '--to-line': args.toLine = positiveInt(a.shift(), '--to-line'); break;
      case '--cjk-font': args.cjkFont = requiredValue(a.shift(), '--cjk-font'); break;
      case '--pandoc': args.pandoc = requiredValue(a.shift(), '--pandoc'); break;
      case '--pdf-engine': args.pdfEngine = requiredValue(a.shift(), '--pdf-engine'); break;
      case '--math-check': args.mathCheck = requiredValue(a.shift(), '--math-check'); break;
      default: throw new Error(`Unknown argument: ${x}`);
    }
  }
  return args;
}

function requiredValue(v, name) {
  if (!v) throw new Error(`${name} requires a value`);
  return v;
}

function positiveInt(v, name) {
  if (!v || !/^\d+$/.test(v) || Number(v) <= 0) throw new Error(`${name} requires a positive integer`);
  return Number(v);
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function makeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineOf(offset, lineStarts) {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function maskRangeChars(chars, start, end) {
  for (let i = start; i < end; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  }
}

function maskFencedCode(text) {
  const chars = [...text];
  let offset = 0;
  let inFence = false;
  let fenceRe = null;
  const lines = text.split(/(\r?\n)/);
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i];
    const nl = lines[i + 1] || '';
    const fullLen = line.length + nl.length;
    const m = line.match(/^\s*(```+|~~~+)/);
    if (!inFence && m) {
      inFence = true;
      fenceRe = new RegExp('^\\s*' + escapeRe(m[1][0].repeat(m[1].length)));
      maskRangeChars(chars, offset, offset + fullLen);
    } else if (inFence) {
      maskRangeChars(chars, offset, offset + fullLen);
      if (fenceRe && fenceRe.test(line)) {
        inFence = false;
        fenceRe = null;
      }
    }
    offset += fullLen;
  }
  return chars.join('');
}

function maskDetails(text) {
  return text.replace(/<details\b[\s\S]*?<\/details>/gi, (m) => m.replace(/[^\r\n]/g, ' '));
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function isEscaped(text, i) {
  let n = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) n++;
  return (n % 2) === 1;
}

function overlapsAny(start, end, spans) {
  return spans.some(s => start < s.end && end > s.start);
}

function addItem(items, usedSpans, source, type, subtype, start, end, lineStarts) {
  const text = source.slice(start, end);
  if (!text.trim()) return;
  if (overlapsAny(start, end, usedSpans)) return;
  const id = `${type}_${String(items.length + 1).padStart(5, '0')}_${sha1(text)}`;
  const startLine = lineOf(start, lineStarts);
  const endLine = lineOf(Math.max(start, end - 1), lineStarts);
  items.push({
    id, type, subtype, start, end, startLine, endLine,
    hash: sha1(text),
    text,
    preview: text.replace(/\s+/g, ' ').trim().slice(0, 220),
  });
  usedSpans.push({ start, end });
}

function extractMarkdownItems(source, options = {}) {
  const lineStarts = makeLineStarts(source);
  let scan = source;
  if (!options.includeDetails) scan = maskDetails(scan);
  scan = maskFencedCode(scan);

  const items = [];
  const usedSpans = [];

  // 1. display math $$...$$
  for (let i = 0; i < scan.length;) {
    const start = scan.indexOf('$$', i);
    if (start < 0) break;
    if (isEscaped(scan, start)) { i = start + 2; continue; }
    const end = findUnescaped(scan, '$$', start + 2);
    if (end < 0) break;
    addItem(items, usedSpans, source, 'math', 'display_dollars', start, end + 2, lineStarts);
    i = end + 2;
  }

  // 2. display math \[...\]
  for (let i = 0; i < scan.length;) {
    const start = scan.indexOf('\\[', i);
    if (start < 0) break;
    if (isEscaped(scan, start)) { i = start + 2; continue; }
    const end = findUnescaped(scan, '\\]', start + 2);
    if (end < 0) break;
    addItem(items, usedSpans, source, 'math', 'display_bracket', start, end + 2, lineStarts);
    i = end + 2;
  }

  // 3. inline math $...$ outside display math.
  for (let i = 0; i < scan.length;) {
    const start = scan.indexOf('$', i);
    if (start < 0) break;
    if (scan[start + 1] === '$' || isEscaped(scan, start) || overlapsAny(start, start + 1, usedSpans)) { i = start + 1; continue; }
    const prev = start > 0 ? scan[start - 1] : '';
    const next = scan[start + 1] || '';
    // Avoid common currency/non-math cases. Pandoc also dislikes spaces immediately inside inline math.
    if (/\s/.test(next) || /\d/.test(next) && /\w/.test(prev)) { i = start + 1; continue; }
    let end = -1;
    for (let j = start + 1; j < scan.length; j++) {
      if (scan[j] === '\n' || scan[j] === '\r') break;
      if (scan[j] === '$' && scan[j + 1] !== '$' && !isEscaped(scan, j)) { end = j; break; }
    }
    if (end < 0) { i = start + 1; continue; }
    const beforeEnd = scan[end - 1] || '';
    if (/\s/.test(beforeEnd)) { i = end + 1; continue; }
    addItem(items, usedSpans, source, 'math', 'inline_dollars', start, end + 1, lineStarts);
    i = end + 1;
  }

  // 4. raw LaTeX environments outside already captured math.
  const envRe = /\\begin\s*\{([A-Za-z*]+)\}[\s\S]*?\\end\s*\{\1\}/g;
  let m;
  while ((m = envRe.exec(scan)) !== null) {
    addItem(items, usedSpans, source, 'raw', `env:${m[1]}`, m.index, m.index + m[0].length, lineStarts);
  }

  // 5. HTML tables.
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  while ((m = tableRe.exec(scan)) !== null) {
    addItem(items, usedSpans, source, 'table', 'html_table', m.index, m.index + m[0].length, lineStarts);
  }

  // 6. Markdown pipe tables.
  const lineMatches = [];
  let offset = 0;
  const parts = scan.split(/(\r?\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    const nl = parts[i + 1] || '';
    lineMatches.push({ line, nl, start: offset, end: offset + line.length + nl.length });
    offset += line.length + nl.length;
  }
  for (let i = 0; i < lineMatches.length - 1; i++) {
    const a = lineMatches[i].line;
    const b = lineMatches[i + 1].line;
    if (!looksLikePipeRow(a) || !looksLikePipeSeparator(b)) continue;
    let j = i + 2;
    while (j < lineMatches.length && looksLikePipeRow(lineMatches[j].line)) j++;
    const start = lineMatches[i].start;
    const end = lineMatches[j - 1].end;
    addItem(items, usedSpans, source, 'table', 'markdown_pipe_table', start, end, lineStarts);
    i = j - 1;
  }

  // 7. Headings containing TeX/math. These can break PDF through converted headings/bookmarks.
  for (let i = 0; i < lineMatches.length; i++) {
    const line = lineMatches[i].line;
    if (/^\s*#{1,6}\s+/.test(line) && /(?:\\[A-Za-z]+|\$[^$]+\$)/.test(line)) {
      addItem(items, usedSpans, source, 'heading', 'heading_tex', lineMatches[i].start, lineMatches[i].end, lineStarts);
    }
  }

  items.sort((a, b) => a.start - b.start);
  // Re-number after sorting.
  items.forEach((it, idx) => { it.id = `${it.type}_${String(idx + 1).padStart(5, '0')}_${it.hash}`; });
  return items;
}

function findUnescaped(text, needle, from) {
  let i = from;
  while (true) {
    const at = text.indexOf(needle, i);
    if (at < 0) return -1;
    if (!isEscaped(text, at)) return at;
    i = at + needle.length;
  }
}

function looksLikePipeRow(line) {
  const t = line.trim();
  if (!t.includes('|')) return false;
  // At least two pipe separators, or one leading/trailing plus a separator.
  const pipes = (t.match(/\|/g) || []).length;
  return pipes >= 2;
}

function looksLikePipeSeparator(line) {
  const t = line.trim();
  if (!t.includes('|')) return false;
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(t);
}

function itemToMarkdown(item) {
  const marker = `<!-- qmd-latex-check: ${item.id} source-lines ${item.startLine}-${item.endLine} -->`;
  if (item.type === 'math') {
    if (item.subtype.startsWith('inline')) return `${marker}\n\n测试公式：${item.text}\n`;
    return `${marker}\n\n${item.text}\n`;
  }
  if (item.type === 'raw') return `${marker}\n\n${item.text}\n`;
  if (item.type === 'table') return `${marker}\n\n${item.text}\n`;
  if (item.type === 'heading') return `${marker}\n\n${item.text}\n\n正文。\n`;
  return `${marker}\n\n${item.text}\n`;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function pandocHeader(cjkFont) {
  const preferred = cjkFont || '';
  const prefLine = preferred ? `\\IfFontExistsTF{${texEscape(preferred)}}{\\setCJKmainfont{${texEscape(preferred)}}}{%` : '% no preferred CJK font\n%';
  const prefClose = preferred ? `}` : '';
  return `
\\usepackage{fontspec}
\\usepackage{xeCJK}
${prefLine}
  \\IfFontExistsTF{Noto Serif CJK SC}{\\setCJKmainfont{Noto Serif CJK SC}}{%
    \\IfFontExistsTF{Microsoft YaHei}{\\setCJKmainfont{Microsoft YaHei}}{%
      \\IfFontExistsTF{SimSun}{\\setCJKmainfont{SimSun}}{%
        \\IfFontExistsTF{AR PL UMing CN}{\\setCJKmainfont{AR PL UMing CN}}{}
      }
    }
  }
${prefClose}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{mathtools}
\\usepackage{bm}
\\usepackage{booktabs}
\\usepackage{longtable}
\\usepackage{array}
\\usepackage{graphicx}
\\usepackage{xcolor}
`;
}

function texEscape(s) { return String(s).replace(/[{}]/g, ''); }

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = options.timeout ? setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, options.timeout) : null;
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + '\n' + err.message, killed });
    });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, killed });
    });
  });
}


function latexNeedsCjk(text) {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text);
}

function directLatexHeader(text) {
  const cjk = latexNeedsCjk(text) ? `
\\usepackage{fontspec}
\\usepackage{xeCJK}
\\IfFontExistsTF{Noto Serif CJK SC}{\\setCJKmainfont{Noto Serif CJK SC}}{%
  \\IfFontExistsTF{Microsoft YaHei}{\\setCJKmainfont{Microsoft YaHei}}{%
    \\IfFontExistsTF{SimSun}{\\setCJKmainfont{SimSun}}{}
  }
}
` : '';
  return `\\documentclass{article}
${cjk}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{mathtools}
\\usepackage{bm}
\\usepackage{mathrsfs}
\\pagestyle{empty}
\\begin{document}
`;
}

function directLatexBody(item) {
  const marker = `% qmd-latex-check: ${item.id} source-lines ${item.startLine}-${item.endLine}\n`;
  const t = item.text.trim();
  if (item.type === 'math') {
    if (item.subtype === 'inline_dollars') return `${marker}测试公式： ${t}\n`;
    if (item.subtype === 'display_dollars') {
      const inner = t.replace(/^\$\$\s*/, '').replace(/\s*\$\$$/, '');
      return `${marker}\\[\n${inner}\n\\]\n`;
    }
    return `${marker}${t}\n`;
  }
  // Raw environments are tested as-is. If an OCR array appears outside math mode, this should fail.
  return `${marker}${t}\n`;
}

async function compileMathDirect(item, args) {
  const itemDir = path.join(args.workdir, item.id);
  ensureDir(itemDir);
  const texPath = path.join(itemDir, 'snippet.tex');
  const mdPath = path.join(itemDir, 'snippet.md');
  fs.writeFileSync(mdPath, itemToMarkdown(item), 'utf8');
  const tex = directLatexHeader(item.text) + directLatexBody(item) + '\\end{document}\n';
  fs.writeFileSync(texPath, tex, 'utf8');
  const engineArgs = ['-interaction=nonstopmode', '-halt-on-error', 'snippet.tex'];
  const result = await runCommand(args.pdfEngine, engineArgs, { cwd: itemDir, timeout: args.timeout });
  const ok = result.code === 0;
  const log = `${result.stdout}\n${result.stderr}`.trim();
  return {
    ...item,
    text: undefined,
    ok,
    exitCode: result.code,
    killed: result.killed,
    workdir: itemDir,
    errorClass: ok ? '' : classifyLatexError(log),
    logExcerpt: ok ? '' : excerptLog(log),
  };
}

async function compileItem(item, args, headerPath) {
  if ((item.type === 'math' || item.type === 'raw') && args.mathCheck !== 'pandoc') {
    return compileMathDirect(item, args);
  }
  const itemDir = path.join(args.workdir, item.id);
  ensureDir(itemDir);
  const md = itemToMarkdown(item);
  const mdPath = path.join(itemDir, 'snippet.md');
  fs.writeFileSync(mdPath, md, 'utf8');

  const pandocArgs = [
    mdPath,
    '-o', path.join(itemDir, 'snippet.pdf'),
    '--pdf-engine', args.pdfEngine,
    '--from', 'markdown+tex_math_dollars+raw_tex+raw_html+pipe_tables+table_captions',
    '--standalone',
    '--metadata', 'title=QmdLatexSnippet',
    '--include-in-header', headerPath,
    '--pdf-engine-opt=-interaction=nonstopmode',
    '--pdf-engine-opt=-halt-on-error',
  ];

  const result = await runCommand(args.pandoc, pandocArgs, { cwd: itemDir, timeout: args.timeout });
  const ok = result.code === 0;
  const log = `${result.stdout}\n${result.stderr}`.trim();
  return {
    ...item,
    text: undefined, // keep JSON report readable; full snippet is in snippet.md and failed-md.
    ok,
    exitCode: result.code,
    killed: result.killed,
    workdir: itemDir,
    errorClass: ok ? '' : classifyLatexError(log),
    logExcerpt: ok ? '' : excerptLog(log),
  };
}

function classifyLatexError(log) {
  if (/Undefined control sequence/i.test(log)) return 'Undefined control sequence';
  if (/Extra alignment tab/i.test(log)) return 'Extra alignment tab';
  if (/Missing \{ inserted/i.test(log)) return 'Missing { inserted';
  if (/Missing \} inserted/i.test(log)) return 'Missing } inserted';
  if (/Runaway argument/i.test(log)) return 'Runaway argument';
  if (/Argument of \\qopname\s+has an extra \}/i.test(log)) return 'Argument of \\qopname has an extra }';
  if (/Unicode character .* not set up/i.test(log)) return 'Unicode character not set up';
  if (/Package .* Error/i.test(log)) return 'LaTeX package error';
  if (/LaTeX Error/i.test(log)) return 'LaTeX Error';
  if (/Error producing PDF/i.test(log)) return 'Pandoc PDF error';
  if (/not found|is not recognized|No such file/i.test(log)) return 'Tool not found or missing file';
  return 'Compile error';
}

function excerptLog(log) {
  const lines = log.split(/\r?\n/);
  const important = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^! |Undefined control sequence|Extra alignment|Missing \{|Missing \}|Runaway argument|LaTeX Error|Error producing PDF|l\.\d+/.test(lines[i])) {
      important.push(...lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 6)));
      if (important.length > 80) break;
    }
  }
  const text = (important.length ? important : lines.slice(-80)).join('\n');
  return text.slice(0, 6000);
}

async function runPool(items, workerCount, worker) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function loop(workerId) {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      const item = items[idx];
      process.stderr.write(`[${done + 1}/${items.length}] worker ${workerId}: ${item.id} lines ${item.startLine}-${item.endLine}\n`);
      results[idx] = await worker(item);
      done++;
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(workerCount, items.length); i++) workers.push(loop(i + 1));
  await Promise.all(workers);
  return results;
}

function writeFailuresMd(file, failed, sourceFile, args) {
  let out = `# QMD LaTeX Queue Failures\n\nSource: \`${sourceFile}\`\n\n`;
  out += `Total failures: ${failed.length}\n\n`;
  for (const f of failed) {
    const snippetPath = path.join(f.workdir || '', 'snippet.md');
    out += `## ${f.id}\n\n`;
    out += `- type: ${f.type}/${f.subtype}\n`;
    out += `- source lines: ${f.startLine}-${f.endLine}\n`;
    out += `- error: ${f.errorClass}\n`;
    out += `- snippet file: ${snippetPath}\n\n`;
    out += `### Original snippet\n\n`;
    const raw = fs.existsSync(snippetPath) ? fs.readFileSync(snippetPath, 'utf8') : '';
    out += '```markdown\n' + raw.slice(0, 4000).replace(/```/g, '`\u200b``') + '\n```\n\n';
    out += `### Compile log excerpt\n\n`;
    out += '```text\n' + (f.logExcerpt || '').replace(/```/g, '`\u200b``') + '\n```\n\n';
    out += `### Codex instruction\n\n`;
    out += `Fix only the Markdown around source lines ${f.startLine}-${f.endLine}. Do not rewrite unrelated text. After the fix, rerun the queue checker for this range.\n\n`;
  }
  fs.writeFileSync(file, out, 'utf8');
}

function writeCodexPrompts(dir, failed, sourceFile) {
  ensureDir(dir);
  for (const f of failed) {
    const snippetPath = path.join(f.workdir || '', 'snippet.md');
    const snippet = fs.existsSync(snippetPath) ? fs.readFileSync(snippetPath, 'utf8') : '';
    const prompt = `你是一个 MinerU/QmdTool Markdown 修复 agent。\n\n` +
`目标：修复源文件中的一个 LaTeX/Markdown 片段，使它能通过 Pandoc -> XeLaTeX 编译。\n\n` +
`源文件：${sourceFile}\n` +
`片段 ID：${f.id}\n` +
`源文件行号：${f.startLine}-${f.endLine}\n` +
`类型：${f.type}/${f.subtype}\n` +
`错误类型：${f.errorClass}\n\n` +
`严格规则：\n` +
`1. 不要重写全书。只修复源文件第 ${f.startLine}-${f.endLine} 行附近的最小必要内容。\n` +
`2. 不要凭空改写正文含义。\n` +
`3. 如果是 OCR 乱码公式且无法从上下文恢复，替换为 [Removed OCR-damaged formula block.] 并保留上下文。\n` +
`4. 优先把 OCR 生成的一行 array 改成普通 $...$ 或 $$...$$。\n` +
`5. 修改后运行：node qmd_latex_queue_check.js "${sourceFile}" --compile --from-line ${f.startLine} --to-line ${f.endLine}\n\n` +
`待修复片段：\n\n\`\`\`markdown\n${snippet.slice(0, 6000).replace(/```/g, '`\u200b``')}\n\`\`\`\n\n` +
`编译错误摘录：\n\n\`\`\`text\n${(f.logExcerpt || '').slice(0, 6000).replace(/```/g, '`\u200b``')}\n\`\`\`\n`;
    fs.writeFileSync(path.join(dir, `${f.id}.prompt.md`), prompt, 'utf8');
  }
}

function summarize(items, results) {
  const byType = {};
  for (const it of items) byType[it.type] = (byType[it.type] || 0) + 1;
  const failures = results ? results.filter(r => !r.ok) : [];
  const byError = {};
  for (const f of failures) byError[f.errorClass] = (byError[f.errorClass] || 0) + 1;
  return { total: items.length, byType, failures: failures.length, byError };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return 0; }
  if (!args.file) { usage(); return 3; }
  args.file = path.resolve(args.file);
  if (!fs.existsSync(args.file)) throw new Error(`Markdown file not found: ${args.file}`);

  const base = args.file.replace(/\.md$/i, '');
  args.report = path.resolve(args.report || `${base}.latex_queue_report.json`);
  args.workdir = path.resolve(args.workdir || `${base}.latex_check_work`);
  args.failedMd = path.resolve(args.failedMd || `${base}.latex_failures.md`);

  const source = fs.readFileSync(args.file, 'utf8');
  let items = extractMarkdownItems(source, { includeDetails: args.includeDetails });
  items = items.filter(it => {
    if (!args.types.has(it.type)) return false;
    if (args.fromLine && it.endLine < args.fromLine) return false;
    if (args.toLine && it.startLine > args.toLine) return false;
    return true;
  });
  if (args.limit) items = items.slice(0, args.limit);

  ensureDir(path.dirname(args.report));
  ensureDir(args.workdir);

  let results = null;
  if (args.compile) {
    const headerPath = path.join(args.workdir, '_qmd_latex_check_header.tex');
    fs.writeFileSync(headerPath, pandocHeader(args.cjkFont), 'utf8');
    results = await runPool(items, args.workers, item => compileItem(item, args, headerPath));
  }

  const report = {
    version: VERSION,
    createdAt: new Date().toISOString(),
    sourceFile: args.file,
    options: {
      compile: args.compile,
      workers: args.workers,
      mathCheck: args.mathCheck,
      includeDetails: args.includeDetails,
      types: [...args.types],
      fromLine: args.fromLine || null,
      toLine: args.toLine || null,
    },
    summary: summarize(items, results),
    items: results || items.map(it => ({ ...it, text: undefined })),
  };
  fs.writeFileSync(args.report, JSON.stringify(report, null, 2), 'utf8');

  if (results) {
    const failed = results.filter(r => !r.ok);
    writeFailuresMd(args.failedMd, failed, args.file, args);
    if (args.codexPrompts && failed.length) {
      writeCodexPrompts(path.join(args.workdir, 'codex_prompts'), failed, args.file);
    }
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(`Report: ${args.report}`);
    console.log(`Failures: ${args.failedMd}`);
    if (failed.length) console.log(`Codex prompts: ${path.join(args.workdir, 'codex_prompts')}`);
    return failed.length ? 2 : 0;
  }

  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${args.report}`);
  return 0;
}

main().then(code => process.exit(code)).catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(3);
});

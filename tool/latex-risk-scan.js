#!/usr/bin/env node
/*
 * Scan MinerU/QmdTool Markdown for LaTeX fragments that are likely to break
 * XeLaTeX, optionally repair deterministic OCR damage, and optionally compile
 * extracted math fragments in batches to isolate failing source locations.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const args = process.argv.slice(2);
if (args.length < 1 || args.includes("--help")) {
  console.log(`Usage: node latex-risk-scan.js <md-file-or-dir> [--fix] [--compile] [--report report.json]

Options:
  --fix       Apply deterministic OCR/LaTeX repairs in-place.
  --compile   Compile extracted risky math snippets with XeLaTeX batch+bisection.
  --report    Write JSON report path.
`);
  process.exit(args.length < 1 ? 1 : 0);
}

const target = path.resolve(args[0]);
const fix = args.includes("--fix");
const compile = args.includes("--compile");
const reportArg = args.indexOf("--report");
const reportPath = reportArg >= 0 ? path.resolve(args[reportArg + 1]) : null;
const xelatex = process.env.XELATEX || "xelatex";

function walk(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return /\.(qmd|md)$/i.test(p) ? [p] : [];
  const out = [];
  for (const name of fs.readdirSync(p)) {
    if ([".git", ".quarto", "_book", "_pdf", "node_modules"].includes(name)) continue;
    out.push(...walk(path.join(p, name)));
  }
  return out;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function count(re, s) {
  const m = s.match(re);
  return m ? m.length : 0;
}

function classifyMath(raw) {
  const inner = raw
    .replace(/^\$\$?|\$\$?$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "");

  if (/\\operatorname\s*\\operatorname/.test(inner) || count(/\\operatorname\s*\{\s*~\s*\}/g, inner) >= 6) {
    return { severity: "error", kind: "operatorname-garbage", message: "Repeated \\operatorname OCR garbage." };
  }
  if (/\\uparrows/.test(inner)) {
    return { severity: "error", kind: "undefined-uparrows", message: "Undefined \\uparrows command." };
  }
  if (/\\begin\s*\{\s*array\s*\}/.test(inner) && count(/&/g, inner) >= 3 && /r\s*c\s*l/.test(inner)) {
    return { severity: "error", kind: "array-extra-alignment", message: "Likely OCR array with too many alignment tabs." };
  }
  if (inner.length > 350) {
    const noisy =
      count(/\\mathbb|\\sqcup|\\ddag|\\underbracket|\\jmath|\\varTheta|\\breve|\\prod\s*_/g, inner) +
      count(/\\operatorname/g, inner);
    if (noisy >= 10) return { severity: "warning", kind: "long-ocr-math", message: "Very long noisy OCR math block." };
  }
  return null;
}

function extractMath(text, file) {
  const out = [];
  const patterns = [
    /\$\$[\s\S]*?\$\$/g,
    /\\\[[\s\S]*?\\\]/g,
    /\\\([\s\S]*?\\\)/g,
    /\$(?!\$)(?:\\.|[^$\n]){1,900}?\$/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const raw = m[0];
      const risk = classifyMath(raw);
      out.push({ file, line: lineOf(text, m.index), raw, risk });
    }
  }
  return out;
}

function escapeTexText(s) {
  return s.replace(/[\\{}#$%&_]/g, (ch) => `\\${ch}`);
}

function texFor(snippets) {
  const body = snippets.map((s, i) => {
    return `\\par\\noindent\\textbf{Snippet ${i + 1}: ${escapeTexText(path.basename(s.file))}:${s.line}}\\par\n${s.raw}\n\\par`;
  }).join("\n");
  return String.raw`\documentclass{article}
\usepackage{amsmath,amssymb,mathtools}
\usepackage{fontspec}
\usepackage{xeCJK}
\setmainfont{Times New Roman}
\begin{document}
` + body + "\n\\end{document}\n";
}

function runXeLatex(snippets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qmdtool-latex-risk-"));
  const tex = path.join(dir, "risk.tex");
  fs.writeFileSync(tex, texFor(snippets), "utf8");
  const r = cp.spawnSync(xelatex, ["-interaction=nonstopmode", "-halt-on-error", "risk.tex"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
  });
  const logPath = path.join(dir, "risk.log");
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : `${r.stdout || ""}\n${r.stderr || ""}`;
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: r.status === 0, status: r.status, log };
}

function firstLatexError(log) {
  const lines = log.split(/\r?\n/);
  const i = lines.findIndex((l) => /^! /.test(l));
  if (i < 0) return "";
  return lines.slice(i, i + 8).join("\n");
}

function bisectFailures(snippets, failures) {
  if (snippets.length === 0) return;
  const r = runXeLatex(snippets);
  if (r.ok) return;
  if (snippets.length === 1) {
    failures.push({ ...snippets[0], compileError: firstLatexError(r.log) });
    return;
  }
  const mid = Math.floor(snippets.length / 2);
  bisectFailures(snippets.slice(0, mid), failures);
  bisectFailures(snippets.slice(mid), failures);
}

function repairText(text) {
  const fixes = [];
  let s = text;

  function replaceAll(name, re, replacement) {
    const before = s;
    s = s.replace(re, replacement);
    if (s !== before) fixes.push({ name, count: (before.match(re) || []).length });
  }

  replaceAll(
    "bidirectional-search-array",
    /\$\\begin\{array\}\s*\{\s*r\s*c\s*l\s*\}\s*\{\s*f\s*_\s*\{\s*B\s*\}\s*\(\s*n\s*\)\s*\}\s*&\s*\{\s*=\s*\}\s*&\s*\{\s*g\s*_\s*\{\s*B\s*\}\s*\(\s*n\s*\)\s*\}\s*&\s*\{\s*\+\s*\}\s*\\end\{array\}\$\s*\$h\s*_\s*\{\s*B\s*\}\s*\(\s*n\s*\)\$/g,
    "$f _ { B } ( n ) = g _ { B } ( n ) + h _ { B } ( n )$"
  );

  replaceAll(
    "ocr-uparrows-utility",
    /\$\\mathrm\s*\{\s*U\s*\}\s*\\uparrows[\s\S]{1,260}?\\updownarrow[\s\S]{1,160}?\$/g,
    "$\\mathrm{UTILITY}(loss,p) \\leq EVAL(s,p) \\leq \\mathrm{UTILITY}(win,p)$"
  );

  replaceAll(
    "erf-operatorname-garbage",
    /\$\\operatorname\s*\{\s*\\Pi\s*\}[\s\S]{80,1500}?\\operatorname\s*\\operatorname\s*\{\s*~\s*\}[\s\S]{0,160}?\\operatorname\s*~\s*\}/g,
    "$\\operatorname{erf}$"
  );

  replaceAll(
    "long-future-ocr-garbage",
    /\$\\mathbb\s*\{\s*E\s*\}\s*\\backslash\s*\\uparrow[\s\S]{120,1600}?\\prod\s*_\s*\{\s*i\s*=\s*1\s*\}\s*\^\s*\{\s*\\infty\s*\}[\s\S]{0,600}?\$/g,
    "[Removed OCR-damaged formula block.]"
  );

  s = s.replace(/\$([^$\n]{0,800}?\\operatorname\s*\\operatorname[^$\n]{0,800}?)\$/g, (m) => {
    fixes.push({ name: "inline-operatorname-garbage", count: 1 });
    return "[Removed OCR-damaged formula block.]";
  });

  s = s.replace(/\$([^$\n]{0,800}?\\uparrows[^$\n]{0,800}?)\$/g, (m) => {
    fixes.push({ name: "inline-uparrows-garbage", count: 1 });
    return "[Removed OCR-damaged formula block.]";
  });

  return { text: s, fixes };
}

function scanTables(text, file) {
  const lines = text.split(/\r?\n/);
  const issues = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i])) continue;
    if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) continue;
    const cols = lines[i].split("|").length;
    for (let j = i + 2; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]); j++) {
      if (lines[j].split("|").length !== cols) {
        issues.push({ file, line: j + 1, kind: "table-column-mismatch", text: lines[j] });
      }
    }
  }
  return issues;
}

const files = walk(target);
const report = { target, fix, compile, files: [], risky: [], tableIssues: [], compileFailures: [] };
let changedFiles = 0;

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  let text = before;
  let fixes = [];
  if (fix) {
    const repaired = repairText(text);
    text = repaired.text;
    fixes = repaired.fixes;
    if (text !== before) {
      fs.writeFileSync(file, text, "utf8");
      changedFiles++;
    }
  }
  const snippets = extractMath(text, file);
  const risky = snippets.filter((s) => s.risk);
  report.files.push({ file, snippets: snippets.length, risky: risky.length, fixes });
  report.risky.push(...risky);
  report.tableIssues.push(...scanTables(text, file));
}

if (compile) {
  const candidates = report.risky.length
    ? report.risky.map(({ file, line, raw, risk }) => ({ file, line, raw, risk }))
    : files.flatMap((file) => extractMath(fs.readFileSync(file, "utf8"), file)).filter((s) => s.raw.length > 120);
  const batchSize = 64;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const r = runXeLatex(batch);
    if (!r.ok) bisectFailures(batch, report.compileFailures);
  }
}

if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log(`latex-risk-scan: files=${files.length}, changed=${changedFiles}, risky=${report.risky.length}, tableIssues=${report.tableIssues.length}, compileFailures=${report.compileFailures.length}`);
if (report.risky.length) {
  for (const item of report.risky.slice(0, 20)) {
    console.log(`  [${item.risk.kind}] ${item.file}:${item.line} ${item.risk.message}`);
  }
  if (report.risky.length > 20) console.log(`  ... ${report.risky.length - 20} more`);
}
if (report.compileFailures.length) {
  for (const item of report.compileFailures.slice(0, 20)) {
    console.log(`  [compile] ${item.file}:${item.line}\n${item.compileError}`);
  }
  process.exitCode = 2;
}

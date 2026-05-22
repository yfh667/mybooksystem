#!/usr/bin/env node
/*
 * Scan MinerU/QmdTool Markdown for TeX math fragments, optionally repair
 * deterministic OCR damage, and optionally validate every extracted formula
 * with XeLaTeX. QmdTool keeps math bodies as TeX; it only normalizes Markdown
 * delimiters such as \(...\), \[...\], and whitespace around $...$.
 * Compilation is the source of truth; static checks are only advisory.
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
  --compile   Compile every extracted math snippet with XeLaTeX batch+bisection.
  --report    Write JSON report path.
`);
  process.exit(args.length < 1 ? 1 : 0);
}

const target = path.resolve(args[0]);
const fix = args.includes("--fix");
const compile = args.includes("--compile");
const reportArg = args.indexOf("--report");
const reportPath = reportArg >= 0 ? path.resolve(args[reportArg + 1]) : null;
const tinytexXeLaTeX = path.join(os.homedir(), "AppData", "Roaming", "TinyTeX", "bin", "windows", "xelatex.exe");
const xelatex = process.env.XELATEX || (fs.existsSync(tinytexXeLaTeX) ? tinytexXeLaTeX : "xelatex");

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
  if (count(/\\mathbf\s*\{\s*\}/g, inner) >= 6 || /\\mathbf\s*\\/.test(inner)) {
    return { severity: "error", kind: "empty-mathbf-garbage", message: "Repeated empty \\mathbf OCR garbage." };
  }
  if (/\\uparrows/.test(inner)) {
    return { severity: "error", kind: "undefined-uparrows", message: "Undefined \\uparrows command." };
  }
  if (/\\warrow/.test(inner)) {
    return { severity: "error", kind: "undefined-warrow", message: "Undefined OCR command \\warrow." };
  }
  if (/\\varleftrightarrows/.test(inner)) {
    return { severity: "error", kind: "undefined-varleftrightarrows", message: "Undefined OCR command \\varleftrightarrows." };
  }
  if (/\\mathrm\s*$/.test(inner) || /\\mathrm\s*(?=[\\)\]\}])/.test(inner)) {
    return { severity: "error", kind: "broken-mathrm", message: "Broken \\mathrm without a braced argument." };
  }
  if (inner.includes("&") && !/\\begin\s*\{\s*(array|aligned|matrix|cases|tabular)\s*\}/.test(inner)) {
    return { severity: "error", kind: "bare-alignment-tab", message: "Bare & inside math outside an alignment environment." };
  }
  if (count(/\\begin\s*\{\s*array\s*\}/g, inner) === 1) {
    const spec = inner.match(/\\begin\s*\{\s*array\s*\}\s*\{\s*([^}]+?)\s*\}/);
    const cols = spec ? (spec[1].match(/[lcr]/g) || []).length : 0;
    const rows = inner
      .replace(/\\begin\s*\{\s*array\s*\}\s*\{[^}]+?\}/g, "")
      .replace(/\\end\s*\{\s*array\s*\}/g, "")
      .split(/\\\\/);
    if (cols > 0 && rows.some((row) => count(/&/g, row) >= cols)) {
      return { severity: "error", kind: "array-extra-alignment", message: "Likely OCR array with too many alignment tabs." };
    }
  }
  if (inner.length > 350) {
    const noisy =
      count(/\\mathbb|\\sqcup|\\ddag|\\underbracket|\\jmath|\\varTheta|\\breve|\\prod\s*_/g, inner) +
      count(/\\operatorname/g, inner);
    if (noisy >= 10 && !/MINIMAX|UTILITY|RESULT|IS-TERMINAL/.test(inner)) {
      return { severity: "warning", kind: "long-ocr-math", message: "Very long noisy OCR math block." };
    }
  }
  return null;
}

function extractMath(text, file) {
  const out = [];
  const ignored = [];
  for (const m of text.matchAll(/```[\s\S]*?```/g)) ignored.push([m.index, m.index + m[0].length]);
  for (const m of text.matchAll(/<table\b[\s\S]*?<\/table>/gi)) ignored.push([m.index, m.index + m[0].length]);
  const ranges = [...ignored];

  function inRange(i, rs = ranges) {
    return rs.some(([a, b]) => i >= a && i < b);
  }
  function push(raw, index) {
    const risk = classifyMath(raw);
    out.push({ file, line: lineOf(text, index), raw, risk });
  }

  for (const m of text.matchAll(/\$\$[\s\S]*?\$\$/g)) {
    if (inRange(m.index, ignored)) continue;
    push(m[0], m.index);
    ranges.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/\\\[[\s\S]*?\\\]/g)) {
    if (inRange(m.index)) continue;
    push(m[0], m.index);
    ranges.push([m.index, m.index + m[0].length]);
  }
  for (const m of text.matchAll(/\\\(([\s\S]{1,1200}?)\\\)/g)) {
    if (inRange(m.index)) continue;
    push(m[0], m.index);
    ranges.push([m.index, m.index + m[0].length]);
  }

  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf("$", pos);
    if (start < 0) break;
    if (inRange(start) || (start > 0 && text[start - 1] === "\\") || text[start + 1] === "$") {
      pos = start + 1;
      continue;
    }
    let end = start + 1;
    while (end < text.length) {
      end = text.indexOf("$", end);
      if (end < 0) break;
      if (!inRange(end) && text[end - 1] !== "\\") break;
      end++;
    }
    if (end < 0) break;
    const raw = text.slice(start, end + 1);
    if (!/\n\s*\n/.test(raw) && raw.length > 1) push(raw, start);
    pos = end + 1;
  }
  return out;
}

function extractTables(text, file) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const start = i;
      let j = i + 2;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) j++;
      out.push({ file, line: start + 1, kind: "table", raw: lines.slice(start, j).join("\n"), risk: null });
      i = j - 1;
      continue;
    }

    if (/<table\b/i.test(line)) {
      const start = i;
      let j = i + 1;
      while (j < lines.length && !/<\/table>/i.test(lines[j])) j++;
      if (j < lines.length) j++;
      out.push({ file, line: start + 1, kind: "html-table", raw: lines.slice(start, j).join("\n"), risk: null });
      i = j - 1;
    }
  }
  return out;
}

function escapeTexText(s) {
  return s.replace(/[\\{}#$%&_]/g, (ch) => `\\${ch}`);
}

function mathBody(raw) {
  const t = raw.trim();
  if (t.startsWith("$$") && t.endsWith("$$")) return t.slice(2, -2).trim();
  if (t.startsWith("$") && t.endsWith("$")) return t.slice(1, -1).trim();
  if (t.startsWith("\\(") && t.endsWith("\\)")) return t.slice(2, -2).trim();
  if (t.startsWith("\\[") && t.endsWith("\\]")) return t.slice(2, -2).trim();
  return t;
}

function texFor(snippets) {
  const body = snippets.map((s, i) => {
    const math = mathBody(s.raw);
    return `\\par\\noindent\\textbf{Snippet ${i + 1}: ${escapeTexText(path.basename(s.file))}:${s.line}}\\par\n\\[\n${math}\n\\]\n\\par`;
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
    timeout: 30000,
  });
  const logPath = path.join(dir, "risk.log");
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : `${r.error ? r.error.message : ""}\n${r.stdout || ""}\n${r.stderr || ""}`;
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

function compileAllSnippets(snippets, report) {
  const batchSize = 128;
  report.compiledSnippets = snippets.length;
  report.compileBatches = Math.ceil(snippets.length / batchSize);
  for (let i = 0; i < snippets.length; i += batchSize) {
    const batch = snippets.slice(i, i + batchSize);
    const r = runXeLatex(batch);
    if (!r.ok) bisectFailures(batch, report.compileFailures);
  }
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
    "drop-mineru-text-image-details",
    /<details>\s*<summary>\s*text_image\s*<\/summary>[\s\S]*?<\/details>/gi,
    ""
  );

  replaceAll(
    "bidirectional-search-array",
    /\$\\begin\{array\}\s*\{\s*r\s*c\s*l\s*\}\s*\{\s*f\s*_\s*\{\s*B\s*\}\s*\(\s*n\s*\)\s*\}\s*&\s*\{\s*=\s*\}\s*&\s*\{\s*g\s*_\s*\{\s*B\s*\}\s*\(\s*n\s*\)\s*\}\s*&\s*\{\s*\+\s*\}\s*\\end\{array\}\$\s*\$h\s*_\s*\{\s*B\s*\}\s*\(\s*n\s*\)\$/g,
    "$f _ { B } ( n ) = g _ { B } ( n ) + h _ { B } ( n )$"
  );

  replaceAll("undefined-dprime", /\\dprime/g, "\\prime");
  replaceAll("undefined-rrangle", /\\rrangle/g, "\\rangle");
  replaceAll("undefined-overrightharpoon-p", /\\overrightharpoon\s*\{\s*p\s*\}/g, "p");
  replaceAll("undefined-mathbfcal", /\\mathbfcal/g, "\\mathcal");
  replaceAll("unsupported-mathscr-vector", /\\pmb\s*\{\s*\\mathscr\s*\{\s*([A-Za-z0])\s*\}\s*\}/g, "\\pmb { $1 }");
  replaceAll("unsupported-mathscr-bold", /\\mathbf\s*\{\s*\\mathscr\s*\{\s*([A-Za-z0])\s*\}\s*\}/g, "\\pmb { $1 }");
  replaceAll("unsupported-bf-mathscr-e", /\{\s*\\bf\s+\\mathscr\s*\{\s*e\s*\}\s*\}\s*_\s*\{\s*1\s*:\s*t\s*\}/g, "\\boldsymbol { e } _ { 1 : t }");
  replaceAll("theta2-mathscr-noise", /\\theta\s*_\s*\{\s*2\s*\}\s*\\mathscr\s*\{\s*f\s*\}/g, "\\theta _ { 2 }");
  replaceAll("operator-hat-rho", /\\operatorname\s*\{\s*\\hat\s*\{\s*\\rho\s*\}\s*\}\s*\(\s*x\s*\)/g, "\\hat { \\rho } ( x )");
  replaceAll("bold-accented-symbol-noise", /\\mathbf\s*\{\s*\\(?:dot|hat)\s*\{\s*\\?([A-Za-z]+)\s*\}\s*\}\s*_\s*\{\s*([^}]+?)\s*\}/g, "\\$1 _ { $2 }");
  replaceAll("nested-bold-accented-symbol-noise", /\\mathbf\s*\{\s*\{\s*\\(?:dot|hat)\s*\{\s*\\?([A-Za-z]+)\s*\}\s*\}\s*\}\s*_\s*\{\s*([^}]+?)\s*\}/g, "\\$1 _ { $2 }");
  replaceAll("policy-loss-symbol-noise", /\\mathbf\s*\{\s*\\dot\s*\{\s*\\tau\s*\}\s*\}\s*_\s*\{\s*\\pi\s*_\s*\{\s*i\s*\}\s*\}/g, "\\pi _ { i }");
  replaceAll("partial-event-garbage", /\\mathbf\s*\{\s*\{\s*\\dot\s*\{\s*x\s*\}\s*\}\s*\}\s*_\s*\{\s*1\s*\}\s*,\s*\\mathbf\s*\{\s*\{\s*\\dot\s*\{\s*\\theta\s*\}\s*\}\s*\}\s*_\s*\{\s*\\dots\s*\}\s*,\s*\\mathbf\s*\{\s*\{\s*\\dot\s*\{\s*x\s*\}\s*\}\s*\}\s*_\s*\{\s*m\s*\}\s*\)/g, "x _ { 1 } , \\dots , x _ { m }");
  replaceAll("partial-event-after-accent-repair", /\\x\s*_\s*\{\s*1\s*\}\s*,\s*\\theta\s*_\s*\{\s*\\dots\s*\}\s*,\s*\\x\s*_\s*\{\s*m\s*\}\s*\)/g, "x _ { 1 } , \\dots , x _ { m }");
  replaceAll("join-nodes-ocr-command", /\\J\s*_\s*\{\s*\\mathrm\s*\{\s*O\s*I\s*N\s*-\s*N\s*_\s*\{\s*o\s*D\s*E\s*S\s*\}\s*\}\s*\}/g, "\\mathrm { JOIN\\text{-}NODES }");
  replaceAll("message-m-ocr-command", /\\m\s*_\s*\{\s*1\s*:\s*t\s*\}/g, "\\boldsymbol { m } _ { 1 : t }");
  replaceAll("hypothesis-h-ocr-command", /\\h\s*_\s*\{\s*1\s*\}/g, "h _ { 1 }");
  replaceAll("td-utility-garbage", /\\operatorname\s*\{\s*\\dot\s*\{\s*\\cal\s+U\s*\}\s*\}\s*\^\s*\{\s*\\pi\s*\}\s*\(\s*\\dot\s*\{\s*1\s*\}\s*,\s*3\s*\)\s*=\s*0\s*\.\s*8\s*8\s*\\mathcal\s*\{\s*F\s*\}\s*\\ddot\s*\{\s*\\mathbb\s*\{\s*H\s*\}\s*\}/g, "U ^ { \\pi } ( 1 , 3 ) = 0 . 8 8");
  replaceAll("bad-reward-shaping-tail", /-\s*\\phi\s*\(\s*s\s*\)\s*_\s*\{\s*\\sharp\s*\}\s*\\mathscr\s*\{\s*A\s*\}\s*_\s*\{\s*\\sharp\s*\}\s*\\sharp\s*_\s*\{\s*\\cal\s+R\s*\}\s*\(\s*s\s*,\s*a\s*,\s*s\s*\^\s*\{\s*\\prime\s*\}\s*\)/g, "- \\phi ( s )");

  const lines = s.split(/\r?\n/);
  let lineFixCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("|") && line.includes("$")) {
      const cells = line.split("|");
      let changed = false;
      for (let c = 0; c < cells.length; c++) {
        const trimmed = cells[c].trim();
        if (trimmed === "$") {
          cells[c] = cells[c].replace("$", "\\$");
          changed = true;
        } else if (/^\$(?:\\\$)+\$$/.test(trimmed)) {
          const dollars = (trimmed.match(/\\\$/g) || []).length;
          cells[c] = cells[c].replace(trimmed, "\\$".repeat(Math.max(1, dollars)));
          changed = true;
        } else if (/^\$#/.test(trimmed)) {
          cells[c] = cells[c].replace("$#", "$\\#");
          changed = true;
        }
      }
      if (changed) {
        lines[i] = cells.join("|");
        lineFixCount++;
        continue;
      }
    }

    if (/<\/?(table|tr|td|th)\b/i.test(line) && line.includes("$")) {
      lines[i] = line
        .replace(/<td>\s*\$\s*<\/td>/g, "<td>\\$</td>")
        .replace(/(PRP|WP)\$/g, "$1\\$")
        .replace(/\$#/g, "$\\#")
        .replace(/\$((?:\\\$)+)\$/g, (m, body) => "\\$".repeat(Math.max(1, (body.match(/\\\$/g) || []).length)));
      if (lines[i] !== line) {
        lineFixCount++;
        continue;
      }
    }

    if (/\$\{\s*\\hat/.test(line) || /\$\{\s*\\bf\s+N/.test(line)) {
      lines[i] = line
        .replace(/\$\{\s*\\hat\s*\{\s*P\s*\}\s*\}\s*\(\s*X\s*=\s*x\s*\|\s*e\s*\)\$\s*0/g, "$\\hat{P}(X=x \\mid e)$。")
        .replace(/\$\{\s*\\hat\s*\{\s*\\pmb\s*\{\s*P\s*\}\s*\}\s*\}\s*\}\s*\(\s*X\s*\\mid\s*\{\s*\\pmb\s*\{\s*e\s*\}\s*\}\s*\)\$/g, "$\\hat{\\boldsymbol{P}}(X \\mid \\boldsymbol{e})$")
        .replace(/\$\{\s*\\bf\s+N\s*\}\s*_\s*\{\s*P\s*S\s*\}\s*\(\s*X\s*,\s*\$e\)/g, "$N_{PS}(X,e)$");
      if (lines[i] !== line) {
        lineFixCount++;
        continue;
      }
    }

    if (/后向消息/.test(line) && /\$\s*1\s*新的后向消息/.test(line)) {
      lines[i] = line.replace(/\$\\mathbf\s*\{\s*\\Delta\s*\}\s*_\s*\{\s*\[\s*-\s*d\s*\+\s*1\s*:\s*t\s*\]\s*\}\s*\$\s*1\s*新的后向消息/g, "$\\boldsymbol{b}_{t-d+1:t}$ 与新的后向消息");
      if (lines[i] !== line) {
        lineFixCount++;
        continue;
      }
    }

    if (/R\s*_\s*\{\s*m\s*a\s*x\s*\}/.test(line) && /\\begin\{array\}/.test(line)) {
      lines[i] = line.replace(/\$?\\begin\{array\}\s*\{\s*r\s*l\s*\}\s*\{\s*R\s*_\s*\{\s*m\s*a\s*x\s*\}\s*\}\s*&\s*\{\s*\{\s*\}\s*=\s*\}\s*\\end\{array\}\$?\s*1/g, "$R_{max}=1$");
      if (lines[i] !== line) {
        lineFixCount++;
        continue;
      }
    }

    if (/高斯核/.test(line) && /K\s*\(\s*x\s*_\s*\{\s*j\s*\}/.test(line) && /\$\s*0/.test(line)) {
      lines[i] = line.replace(/\$K\s*\(\s*x\s*_\s*\{\s*j\s*\}\s*,\s*x\s*_\s*\{\s*k\s*\}\s*\)\s*=\s*\\mathrm\s*\{\s*e\s*\}\s*\^\s*\{\s*-\s*\\gamma\s*\|\s*x\s*_\s*\{\s*j\s*\}\s*-\s*x\s*_\s*\{\s*k\s*\}\s*\|\s*\^\s*\{\s*2\s*\}\s*\}\s*,\$\s*0/g, "$K(x_j,x_k)=\\mathrm{e}^{-\\gamma |x_j-x_k|^2}$。");
      if (lines[i] !== line) {
        lineFixCount++;
        continue;
      }
    }

    if (/\\text\s*\{\s*``to''\s+and\s+c_\{i\s*-\s*1\}\s*=\s*VB\s*\}/.test(line)) {
      lines[i] = line.replace(/\\text\s*\{\s*``to''\s+and\s+c_\{i\s*-\s*1\}\s*=\s*VB\s*\}/g, "\\text {``to'' and } c _ {i - 1} = \\mathrm{VB}");
      if (lines[i] !== line) {
        lineFixCount++;
        continue;
      }
    }

    if (/\\\\\s*\[/.test(line)) {
      lines[i] = line.replace(/\\\\\s*(?=\[)/g, "\\\\{} ");
      if (lines[i] !== line) {
        lineFixCount++;
        continue;
      }
    }

    if (!line.includes("$")) continue;

    if (/\\operatorname\s*\\operatorname/.test(line) && /误差函数/.test(line)) {
      lines[i] = line.replace(/\$[^$\n]*\\operatorname\s*\\operatorname[^$\n]*\$/g, "$\\operatorname{erf}$");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (count(/\\mathbf\s*\{\s*\}/g, line) >= 6 || /\\mathbf\s*\\/.test(line)) {
      lines[i] = line.replace(/\$[^$\n]*(?:\\mathbf\s*\{\s*\}|\\mathbf\s*\\)[^$\n]*\$/g, "$\\boldsymbol{b}_{k+1:t}$");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/\\operatorname\s*\\operatorname/.test(line) || count(/\\operatorname\s*\{\s*~\s*\}/g, line) >= 6) {
      lines[i] = line.replace(/\$[^$\n]*(?:\\operatorname\s*\\operatorname|\\operatorname\s*\{\s*~\s*\})[^$\n]*\$/g, "[Removed OCR-damaged formula block.]");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/\\uparrows/.test(line)) {
      if (/loss\s*,\s*p/.test(line) && /win\s*,\s*p/.test(line)) {
        lines[i] = line.replace(/\$[^$\n]*\\uparrows[^$\n]*\$/g, "$\\mathrm{UTILITY}(loss,p) \\leq EVAL(s,p) \\leq \\mathrm{UTILITY}(win,p)$");
      } else {
        lines[i] = line.replace(/\$[^$\n]*\\uparrows[^$\n]*\$/g, "[Removed OCR-damaged formula block.]");
      }
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/\\warrow/.test(line)) {
      lines[i] = line
        .replace(/\$[^$\n]*\\warrow[^$\n]*\$/g, "$Color(Table,c) \\wedge Color(can,c)$")
        .replace(/\$\\\{\s*c\s*a\s*n\s*\/\s*C\s*a\s*n\s*_\s*\{\s*2\s*\}\s*\$/g, "$\\{can/Can_2\\}$");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/\\varleftrightarrows/.test(line)) {
      lines[i] = line.replace(/\\varleftrightarrows/g, "\\leftrightarrow");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }


    if (/\\mathbb\s*\{\s*E\s*\}\s*\\backslash\s*\\uparrow/.test(line) || /\\prod\s*_\s*\{\s*i\s*=\s*1\s*\}\s*\^\s*\{\s*\\infty\s*\}/.test(line)) {
      lines[i] = line.replace(/\$[^$\n]*(?:\\mathbb\s*\{\s*E\s*\}\s*\\backslash\s*\\uparrow|\\prod\s*_\s*\{\s*i\s*=\s*1\s*\}\s*\^\s*\{\s*\\infty\s*\})[^$\n]*\$/g, "[Removed OCR-damaged formula block.]");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/b\s*i\s*c\s*o\s*n\s*d\s*i\s*t\s*i\s*o\s*n\s*a\s*l/.test(line) || (/\\mathscr/.test(line) && /\\sqcup/.test(line))) {
      lines[i] = line.replace(/\$[^$\n]*(?:b\s*i\s*c\s*o\s*n\s*d\s*i\s*t\s*i\s*o\s*n\s*a\s*l|\\mathscr|\\sqcup)[^$\n]*\$/g, "[Removed OCR-damaged formula block.]");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/\\sharp\s+\\sharp/.test(line) && /\\mathbb\s*\{\s*E\s*\}/.test(line) && /\\jmath/.test(line)) {
      lines[i] = line.replace(/\$[^$\n]*\\sharp\s+\\sharp[^$\n]*\\jmath[^$\n]*\$/g, "[Removed OCR-damaged formula block.]");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/\\begin\{array\}/.test(line) && /v\s*_\s*\{\s*x\s*\}/.test(line) && /D\s*_\s*\{\s*t\s*\}/.test(line)) {
      lines[i] = line
        .replace(/\$\\begin\{array\}\s*\{\s*r\s*l\s*\}\s*\{\s*\(\s*D\s*_\s*\{\s*x\s*\}\s*,\s*\}\s*&\s*\{\s*\{\s*\}\s*D\s*_\s*\{\s*y\s*\}\s*\)\s*\}\s*\\end\{array\}\$/g, "$(D _ { x }, D _ { y })$")
        .replace(/\$\\begin\{array\}\s*\{\s*c\s*c\s*c\s*\}[\s\S]*?\\end\{array\}\$\s*\$D\s*_\s*\{\s*v\s*\}\s*\/\s*D\s*_\s*\{\s*t\s*\}\s*\)\$/g, "$(v _ { x }, v _ { y }) = (D _ { x } / D _ { t }, D _ { y } / D _ { t })$");
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/\\mathrm\s*\$/.test(line)) {
      lines[i] = line.replace(/\$([^$\n]*?)\\mathrm\s*\$/g, (m, body) => {
        if (/k\s*\\\s*=\s*\\?\s*3/.test(body) || /k\s*=\s*3/.test(body)) return "$k=3$";
        return `$${body.trim()}$`;
      });
      if (lines[i] !== line) lineFixCount++;
      continue;
    }

    if (/E\s*m\s*p\s*l\s*o\s*y\s*s\s*\(\s*I\s*B\s*M\s*,\s*R\s*i\s*c\s*h\s*a\s*r\s*d\s*\)/.test(line) && /\\vec\s*\{\s*\\tau\s*\}/.test(line)) {
      lines[i] = line.replace(/\$[^$\n]*E\s*m\s*p\s*l\s*o\s*y\s*s\s*\(\s*I\s*B\s*M\s*,\s*R\s*i\s*c\s*h\s*a\s*r\s*d\s*\)[^$\n]*\$\s*/, "Employs(IBM, Richard)\n\n");
      if (lines[i] !== line) lineFixCount++;
    }
  }
  if (lineFixCount) fixes.push({ name: "line-bounded-ocr-math", count: lineFixCount });
  s = lines.join("\n");

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
const report = { target, fix, compile, files: [], risky: [], tableIssues: [], compileFailures: [], compiledSnippets: 0, compileBatches: 0 };
let changedFiles = 0;
const allSnippets = [];

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
  allSnippets.push(...snippets);
  const risky = snippets.filter((s) => s.risk);
  report.files.push({ file, snippets: snippets.length, risky: risky.length, fixes });
  report.risky.push(...risky);
  report.tableIssues.push(...scanTables(text, file));
}

if (compile) compileAllSnippets(allSnippets, report);

if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log(`latex-risk-scan: files=${files.length}, changed=${changedFiles}, formulas=${allSnippets.length}, compiled=${report.compiledSnippets}, risky=${report.risky.length}, tableIssues=${report.tableIssues.length}, compileFailures=${report.compileFailures.length}`);
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

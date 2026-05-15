// Rebuild MinerU-split algorithms into one IEEE-like algorithm block.
//
// MinerU often turns an algorithm into a folder tree:
//   Algorithm 1...
//     Inputs:
//       Output:
//         BEGIN
//         END
//
// This script gathers those pieces into the algorithm parent qmd and marks it
// so gen-includes does not re-include the fragments.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : (fs.existsSync(path.join(process.cwd(), '_quarto.yml'))
      ? process.cwd()
      : path.join(__dirname, '..'));

const ROOT_QMD = path.join(PROJECT_ROOT, 'qmd');
const BEGIN = '<!-- AUTO-INCLUDES-BEGIN -->';
const END = '<!-- AUTO-INCLUDES-END -->';
const NO_AUTO_INCLUDES = '<!-- QmdTool: no-auto-includes -->';

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

function stripAutoIncludes(text) {
  const esc = s => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  return text.replace(new RegExp(esc(BEGIN) + '[\\s\\S]*?' + esc(END), 'g'), '').trim();
}

function headingInfo(text) {
  const m = text.match(/^(\#{1,6})\s+(.+?)\s*$/m);
  if (!m) return null;
  return { level: m[1].length, title: m[2].trim() };
}

function bodyWithoutFirstHeading(file) {
  let text = stripAutoIncludes(fs.readFileSync(file, 'utf8'));
  text = text.replace(/^#{1,6}\s+.+?\s*\r?\n/, '');
  return text.trim();
}

function findByHeading(root, re) {
  for (const file of listQmdFiles(root)) {
    const info = headingInfo(fs.readFileSync(file, 'utf8'));
    if (info && re.test(info.title)) return file;
  }
  return null;
}

function normalizeBulletLine(line) {
  return line
    .replace(/^\s*(?:鈥\?|•|-|\*)\s*/, '')
    .replace(/\s+$/g, '')
    .trim();
}

function extractBullets(text) {
  return text
    .split(/\r?\n/)
    .map(normalizeBulletLine)
    .filter(Boolean);
}

function extractSteps(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const m = line.match(/^(\d+)\s*:\s*(.+)$/);
      if (m) return { number: m[1], text: m[2].trim() };
      return { number: '', text: line };
    });
}

function escapeCell(s) {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function algorithmNumber(title) {
  const m = title.match(/Algorithm\s+(\d+)/i);
  return m ? m[1] : '';
}

function algorithmBlock(title, inputs, outputs, steps) {
  const out = [];
  out.push('::: {.ieee-algorithm}');
  out.push('');
  out.push('---');
  out.push('');
  out.push(`**${title}**`);
  out.push('');
  out.push('---');
  out.push('');
  if (inputs.length) {
    out.push('**Inputs:**');
    out.push('');
    for (const item of inputs) out.push(`- ${item}`);
    out.push('');
  }
  if (outputs.length) {
    out.push('**Output:**');
    out.push('');
    for (const item of outputs) out.push(`- ${item}`);
    out.push('');
  }
  out.push('**BEGIN**');
  out.push('');
  out.push('|  |  |');
  out.push('| ---: | --- |');
  for (const step of steps) {
    const n = step.number ? `${step.number}:` : '';
    out.push(`| ${n} | ${escapeCell(step.text)} |`);
  }
  out.push('');
  out.push('**END**');
  out.push('');
  out.push('---');
  out.push('');
  out.push(':::');
  return out.join('\n');
}

function processAlgorithmFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  const info = headingInfo(original);
  if (!info || !/^Algorithm\s+\d+\s*:/i.test(info.title)) return false;

  const dir = path.dirname(file);
  const inputsFile = findByHeading(dir, /^Inputs:?$/i);
  const outputFile = findByHeading(dir, /^Output:?$/i);
  const beginFile = findByHeading(dir, /^BEGIN$/i);
  const endFile = findByHeading(dir, /^END$/i);
  if (!inputsFile || !outputFile || !beginFile) return false;

  const inputs = extractBullets(bodyWithoutFirstHeading(inputsFile));
  const outputs = extractBullets(bodyWithoutFirstHeading(outputFile));
  const steps = extractSteps(bodyWithoutFirstHeading(beginFile));

  let tail = '';
  if (endFile) {
    tail = bodyWithoutFirstHeading(endFile);
  }

  const hash = '#'.repeat(info.level);
  const next = [
    `${hash} ${info.title}`,
    '',
    NO_AUTO_INCLUDES,
    '',
    algorithmBlock(info.title, inputs, outputs, steps),
    tail ? `\n${tail}` : '',
    '',
    BEGIN,
    END,
    '',
  ].join('\n');

  if (next !== original) {
    fs.writeFileSync(file, next, 'utf8');
    return true;
  }
  return false;
}

let changed = 0;
for (const file of listQmdFiles(ROOT_QMD)) {
  if (processAlgorithmFile(file)) changed++;
}

console.log(`format-algorithms: updated ${changed} file(s).`);

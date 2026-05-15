const ROMAN = new Set([
  'I','II','III','IV','V','VI','VII','VIII','IX','X',
  'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX',
]);

function stripTrailingHashes(text) {
  return text.replace(/\s+#+\s*$/, '').trim();
}

function isTocLike(text) {
  const t = text.trim();
  if (!t) return true;
  if (/^contents(?:\s+[ivxlcdm]+)?$/i.test(t)) return true;
  if (/^(?:table\s+of\s+contents|目录)\s*$/i.test(t)) return true;
  if (/^[ivxlcdm]+$/i.test(t)) return true;
  if (/^part\s+(?:[a-z]+|[ivxlcdm]+)(?:\s+.*?)(?:\s+\d+)?$/i.test(t)) return true;
  if (/^(?:\.{2,}|\u2026+)\s*\d+\s*$/.test(t)) return true;
  if (/^(?:\d+(?:\.\d+){0,5}|[IVXLCDM]+)\.?\s+\S[\s\S]*\s\d{1,4}$/i.test(t)) return true;
  return false;
}

function classifyHeadingText(text) {
  const t = stripTrailingHashes(text);
  if (isTocLike(t)) return { kind: 'toc', title: t };

  const chineseChapter = t.match(/^第\s*([一二三四五六七八九十百千万\d]+)\s*[章节篇]\s*(.*)$/);
  if (chineseChapter) {
    return { kind: 'section', depth: 1, num: chineseChapter[1], title: chineseChapter[2].trim() };
  }

  const appendix = t.match(/^(?:appendix|附录)\s*([A-Za-z]?)\.?\s*(.*)$/i);
  if (appendix) {
    return { kind: 'section', depth: 1, num: appendix[1] || '', title: appendix[2].trim() || t };
  }

  const bareChapter = t.match(/^(\d{1,2})$/);
  if (bareChapter) {
    const n = Number(bareChapter[1]);
    if (n >= 1 && n <= 50) {
      return { kind: 'section', depth: 1, num: bareChapter[1], title: '' };
    }
  }

  const numeric = t.match(/^(\d+(?:\.\d+){0,5})\.?\s+(.+)$/);
  if (numeric) {
    return {
      kind: 'section',
      depth: numeric[1].split('.').length,
      num: numeric[1],
      title: numeric[2].trim(),
    };
  }

  const roman = t.match(/^([IVXLCDM]+)\.\s+(.+)$/i);
  if (roman && ROMAN.has(roman[1].toUpperCase())) {
    return { kind: 'section', depth: 1, num: roman[1].toUpperCase(), title: roman[2].trim() };
  }

  const letter = t.match(/^([A-Z])\.\s+(.+)$/);
  if (letter) {
    return { kind: 'section', depth: 2, num: letter[1], title: letter[2].trim() };
  }

  if (/^(?:references|bibliography|参考文献|index|appendix|acknowledg(?:e?)ments?)\s*$/i.test(t)) {
    return { kind: 'section', depth: 1, num: '', title: t };
  }
  if (/^(?:abstract|conclusion)\s*$/i.test(t)) {
    return { kind: 'section', depth: 1, num: '', title: t };
  }
  if (/^(?:preface|foreword|前言|序言|后记|致谢)\s*$/i.test(t)) {
    return { kind: 'preface', depth: 1, num: '', title: t };
  }

  const lowerLetter = t.match(/^\(?([a-z])\)?\.?\s+(.+)$/);
  if (lowerLetter) {
    return { kind: 'section', depth: 5, num: lowerLetter[1], title: t };
  }

  return { kind: 'bare', title: t, text: t };
}

function parseHeadingLine(line) {
  const m = /^\uFEFF?(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  const text = stripTrailingHashes(m[2]);
  return {
    rawLevel: m[1].length,
    rawText: text,
    cls: classifyHeadingText(text),
  };
}

function collectHeadingSegments(markdown) {
  const lines = markdown.split(/\r?\n/);
  const segments = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const heading = parseHeadingLine(lines[i]);
    if (heading) {
      if (cur) segments.push(cur);
      cur = {
        idx: i,
        rawLevel: heading.rawLevel,
        title: heading.rawText,
        body: [],
        cls: heading.cls,
      };
    } else if (cur) {
      cur.body.push(lines[i]);
    }
  }
  if (cur) segments.push(cur);
  return segments;
}

function hasDocumentTitle(segments) {
  const first = segments.find(s => s.cls.kind !== 'toc');
  if (!first) return false;
  if (first.cls.kind !== 'bare') return false;
  return first.rawLevel === 1;
}

function segmentLevel(segment, options = {}) {
  const hasTitle = options.hasTitle ?? hasDocumentTitle(options.segments || []);
  const cls = segment.cls;
  if (cls.kind === 'section' || cls.kind === 'preface' || cls.kind === 'front-matter') {
    return Math.min(6, Math.max(1, cls.depth + (hasTitle ? 1 : 0)));
  }
  if (cls.kind === 'bare') return Math.min(6, Math.max(1, segment.rawLevel || 1));
  return null;
}

function buildHeadingTree(markdown, options = {}) {
  const segments = collectHeadingSegments(markdown);
  const hasTitle = options.hasTitle ?? hasDocumentTitle(segments);
  const lines = markdown.split(/\r?\n/);
  const firstHeadingIdx = lines.findIndex(line => parseHeadingLine(line));
  const rootBody = firstHeadingIdx > 0 ? lines.slice(0, firstHeadingIdx) : [];
  const root = { level: 0, title: '(root)', body: rootBody, children: [] };
  const stack = [root];

  for (const segment of segments) {
    if (segment.cls.kind === 'toc') continue;
    const level = segmentLevel(segment, { ...options, hasTitle, segments });
    if (!level) continue;
    const node = {
      level,
      title: segment.title,
      body: segment.body,
      children: [],
      cls: segment.cls,
      rawLevel: segment.rawLevel,
    };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

module.exports = {
  classifyHeadingText,
  parseHeadingLine,
  collectHeadingSegments,
  buildHeadingTree,
};

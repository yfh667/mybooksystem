# Agent Handoff — quarto-knowledge-tool

This document is the complete brief for a new agent (Codex, Claude, or
similar) continuing development on this toolkit. Read it end to end before
making changes. Everything described here is implemented and pushed to
`https://github.com/yfh667/mybooksystem` — but the WHY behind each piece
matters for choosing the right approach to extend it.

---

## 1. What this project is

A self-contained local toolkit that turns a **Quarto Book** project into a
live writing environment, plus an importer that converts MinerU's PDF→MD
output into the same project layout. The aim: take any PDF (paper or
textbook), get a folder-organized Quarto book with live HTML + PDF
preview, source-jump from preview back to .qmd, and clean separation
between user notes and tool code.

The user is non-technical-ish: they write Markdown in Positron, save, and
expect HTML + PDF to update with no manual commands. Everything in this
toolkit exists to make that workflow happen reliably on Windows.

---

## 2. Repository topology

### 2.1 GitHub repo IS a project template

- GitHub: `https://github.com/yfh667/mybooksystem`
- License: MIT
- Owner: yfh (`12224067@zju.edu.cn`)

**Cloning the repo gives a complete Quarto Book project**, not just the
tool scripts. Top-level layout:

```
mybooksystem/                              ← repo root == clone target
├── _quarto.yml                            ← book config (template)
├── index.qmd                              ← cover page (template)
├── references.bib                         ← empty BibTeX
├── ieee.csl                               ← IEEE citation style
├── .vscode/settings.json                  ← paste-image config
├── .gitignore                             ← ignores _book/ _pdf/ logs etc.
├── README.md                              ← top-level "how to clone & use"
└── tool/                                  ← all scripts + PDF.js
    ├── README.md                          ← internals doc
    ├── AGENT_HANDOFF.md                   ← this document
    ├── LICENSE
    ├── start.cmd / stop.cmd
    ├── watch-render.ps1
    ├── serve.js
    ├── gen-includes.js
    ├── autoreload.html
    ├── import-paper.js
    ├── import-textbook.js
    ├── fix-md-syntax.js
    ├── init-project.js                    ← still useful for older flows
    └── _pdfjs/
```

New-project workflow:

```powershell
git clone https://github.com/yfh667/mybooksystem.git my-new-project
cd my-new-project
node tool\import-paper.js path\to\test.md paper      # or import-textbook
tool\start.cmd
```

That's it — `init-project.js` is not needed; templates are in the clone.

### 2.2 Local source-of-truth for pushing

- `C:\Users\Administrator\mybooksystem\` — local clone you push from
  (the only working copy that has `.git/`)
- Older user projects (my-knowledge, Performance_Analysis_..., hybrid_auto,
  test2) each have a `tool/` folder which is a plain **copy** (no `.git/`).
  To sync new scripts into them:
  `Copy-Item -Recurse -Force <repo>\tool\* <old-project>\tool\`

### 2.3 Known user projects

| Path | Role |
|------|------|
| `C:\Users\Administrator\mybooksystem` | **Repo source-of-truth — edit + push from here** |
| `C:\Users\Administrator\my-knowledge` | Original dev / personal notes; `tool/` is a script copy |
| `C:\Users\Administrator\Desktop\Performance_Analysis_...IsOWC_45000_km` | English IEEE paper, MinerU-imported |
| `C:\Users\Administrator\Desktop\book1\hybrid_auto` | Chinese textbook |
| `C:\user\test2` | Chinese textbook (Codex's working project for the textbook-as-real-book refactor) |

---

## 3. Tool module inventory

Everything in this list lives in `tool/` and is shipped via the GitHub
repo. Paths are relative to `tool/`.

### 3.1 `start.cmd` / `stop.cmd`

User-facing entry points. Double-click `start.cmd` in any project's
`tool/` folder to launch live preview; double-click `stop.cmd` to shut
down.

`start.cmd`:
- Derives `ROOT` from `%~dp0..` (parent of `tool/`)
- Spawns a hidden background PowerShell running `watch-render.ps1`
- Redirects stdout/stderr to `<ROOT>\watcher.log` / `watcher.err.log`
- Prints next steps and waits 4 seconds before closing the console

`stop.cmd`:
- Reads `<ROOT>\.watcher.lock` → kills that PID
- Also greps `Win32_Process` for any `node.exe` whose CommandLine matches
  `serve.js` — kills those (`Stop-Process -Force` doesn't let
  watch-render's `finally` block run, so the Node server orphans otherwise)
- Removes the lock file

### 3.2 `watch-render.ps1`

The orchestrator. Long-running PowerShell process that:

1. Resolves project root from `$PSScriptRoot/..`
2. Lock-file enforcement (`.watcher.lock` at project root)
3. Kills stale `quarto`, `deno`, and `node serve.js` processes
4. Performs an initial `quarto render --to html`
5. Starts `node serve.js` from `$toolDir` (so `__dirname` points into `tool/`)
6. Sets up a `System.IO.FileSystemWatcher` on `<root>` recursively for `*.qmd`
7. Loops: on event OR on `_quarto.yml` mtime change:
   - Drains rapid-fire events (atomic save fires several events)
   - Waits for file quiescence (no writes in last 600ms)
   - Runs `node $toolDir\gen-includes.js`
   - Runs `quarto render --to html` (8 sec for a small book, longer for big)
   - On HTML success, runs `quarto render --to pdf --output-dir _pdf`
     (separate output dir so PDF render doesn't wipe `_book/`)
   - Updates `<root>/.watcher-status.json` at each phase (used by the
     browser badge)
8. `finally` block stops `serve.js` and removes lock file (but only fires
   on graceful exit, not `Stop-Process -Force`)

Key constants:
- `$port = 4321` — hardcoded, single project at a time
- `$quartoExe = "C:\Program Files\Quarto\bin\quarto.exe"` — hardcoded path

`Update-Status` writes JSON to `.watcher-status.json` **without BOM** —
Windows PowerShell 5's `Set-Content -Encoding UTF8` emits BOM by default
and broke `JSON.parse` in the browser. Use
`[System.IO.File]::WriteAllText(..., [System.Text.UTF8Encoding]::new($false))`.

State transitions:
- `starting` → `rendering-html` (initial) → `idle`
- on save: `idle` → `scanning` → `rendering-html` → (HTML OK: BuildId++)
  → `rendering-pdf` → `idle` | `error`

### 3.3 `serve.js`

Node HTTP server on port 4321. Routes:

| Route | Behavior |
|-------|----------|
| `/` `/qmd/*` `/site_libs/*` etc. | Static serve from `<root>/_book/`, with read-retry up to 60×200ms for `.html` to survive Quarto's delete-then-rename swap during render |
| `/_pdf/*.pdf` (any filename!) | Returns the **most recently modified** `.pdf` in `<root>/_pdf/`. The filename is ignored because Quarto names the PDF after `book.title`; ignoring the name lets users rename the title without breaking the URL |
| `/_pdfjs/*` | Static serve from `<tool>/_pdfjs/` (Mozilla PDF.js v3.11.174 dist) |
| `/pdf` `/pdf.html` `/pdf/` | Wrapper HTML that loads `viewer.html?file=/_pdf/test.pdf` in an iframe and auto-reloads on PDF change via `PDFViewerApplication.open()` + cached page+scale |
| `/split` | Two-panel layout: left iframe loads `/index.html`, right loads `/pdf`, draggable splitter (saves ratio in `localStorage`) |
| `/status` | Returns `<root>/.watcher-status.json` as application/json |
| `POST /find-source` | Body: `{text}`. Cascading search through every `.qmd` under `qmd/` for the first prefix of the input that matches a line. Returns `{file, line, found}` |
| `POST /open-in-editor` | Same lookup as `/find-source` PLUS shells out to `positron -r --goto <file>:<line>:1` |

Constants:
- `PROJECT_ROOT = path.join(__dirname, '..')`
- `BOOK_DIR = path.join(PROJECT_ROOT, '_book')`
- `PDF_DIR  = path.join(PROJECT_ROOT, '_pdf')`
- `PDFJS_DIR = path.join(__dirname, '_pdfjs')`  ← stays inside tool/
- `POSITRON_CLI = 'C:\\Program Files\\Positron\\bin\\positron.cmd'`

POST bodies are accumulated as `Buffer.concat(chunks).toString('utf8')`,
NOT `body += chunk` — the latter mangles multi-byte UTF-8 (CJK).

`findSource` cascading: try the search text as 70, 30, 15, 8, 4 char
prefixes. First file/line match anywhere wins. The 2-char floor lets
short Chinese words match (`驱动` is 2 chars in JS string length).

### 3.4 `gen-includes.js`

Scans `<root>/qmd/` and writes `{{< include >}}` lines between
`<!-- AUTO-INCLUDES-BEGIN -->` and `<!-- AUTO-INCLUDES-END -->` markers
inside each chapter / section file.

Folder-first convention:
- A content unit `X` is `X/X.qmd`
- Subsections live in sibling folders inside `X/`: each `Y/` contains `Y/Y.qmd`
- The script recursively walks; for each `X/X.qmd` it scans sibling
  directories of `X.qmd` inside `dirname(X.qmd)`, looks for `Y/Y.qmd` in
  each, and emits an include line

**Quarto quirk**: nested include paths must be relative to the
**top-level chapter file's directory**, not the directly-including file.
So when `qmd/example/example.qmd` includes `01-section/01-section.qmd`,
and `01-section.qmd` includes its own sub, the sub-include path must be
`01-section/02-nested/02-nested.qmd` (rooted at `qmd/example/`), not
`02-nested/02-nested.qmd`. The script tracks `chapterDir` through
recursion and emits all paths relative to it.

### 3.5 `autoreload.html`

Injected into every rendered HTML page via
`format.html.include-in-header: tool/autoreload.html` in `_quarto.yml`.
Runs only if `location.hostname` is `localhost` or `127.0.0.1`.

Two responsibilities:

1. **Status badge + auto-reload**: polls `/status` every 700ms, paints a
   pill in the top-right corner colored by state
   (`idle/scanning/rendering-html/rendering-pdf/error/stopped/unknown`).
   When `buildId` changes (incremented by watcher on each HTML render
   OK) AND state is "settled" (idle / rendering-pdf / error), triggers
   `location.reload()`.
2. **Ctrl/Cmd+Click → source jump**: capture-phase click listener.
   When Ctrl is held and the click target is inside a block element
   (P, H1-H6, LI, BLOCKQUOTE, PRE, TD, TH, DT, DD, FIGCAPTION), POST
   the block's `textContent` to `/open-in-editor`. Server runs
   Positron CLI to jump. Shows a small bottom-left toast indicating
   `→ <file>:<line>` or `source not found`.

### 3.6 `import-paper.js`

Converts an English IEEE-style paper from MinerU's MD output into a
folder-first Quarto chapter.

Inputs:
- `<source.md>` — the MinerU-emitted markdown
- `<chapter-slug>` — the folder name to create under `qmd/`

Output:
- `qmd/<slug>/<slug>.qmd` (chapter file with title + abstract + auto-includes)
- `qmd/<slug>/01-introduction/01-introduction.qmd` etc.
- `qmd/<slug>/02-system-model/01-foo/01-foo.qmd` (nested where source has H3 inside H2)
- `qmd/<slug>/images/` (copied wholesale from source's sibling `images/`)

The flow:
1. Read the file as UTF-8 text
2. Run all MinerU normalizations (see §4)
3. Parse the markdown into a heading tree using markdown-native heading
   levels (`#`, `##`, `###`)
4. Top-level H1 is the chapter; H2s become folders; H3s nested folders
5. Slugify each title (Unicode-aware, max 25 chars)
6. Recursively write each node, indexed with `01-`, `02-` prefixes
7. Append `- qmd/<slug>/<slug>.qmd` to `_quarto.yml`'s `book.chapters`
8. Run `gen-includes.js` so AUTO-INCLUDES blocks are populated
   immediately (no need to wait for the watcher)

### 3.7 `import-textbook.js`

Same purpose as `import-paper.js` but for Chinese textbooks where MinerU
emits **every heading as H1** and the real hierarchy is in the heading
text's numbering prefix.

The classification heuristic on each H1:

```
Trailing "……N" or "....N" or numbered-prefix + trailing digits → TOC entry, drop
"第 N 章 标题"                       → section level 1 (chapter)
"附录 A 标题"                         → section level 1
"N.M 标题"                            → section level 2
"N.M.K 标题"                          → section level 3
"N.M.K.L 标题"                        → section level 4
"a. 标题" / "(a) 标题"                → section level 5
"内容简介" / "前言" / "目录" / "CIP数据" → front-matter
Everything else                       → bare (book-title repeat or chapter sub-title)
```

Plus two post-processing steps:
- `第N章`-without-title heading + immediately following bare heading get
  **merged** (MinerU often splits `# 第1章\n# 遗传算法` across two lines)
- Bare headings that match an earlier bare title are dropped (book title
  prints twice on the cover/spine page)

Final level mapping (so writeNode emits the right `#` count):
- bare (book title)     → level 1 (top of chapter file)
- front-matter          → level 2
- section depth N       → level N + 1 (capped at 6)

### 3.8 `fix-md-syntax.js`

Idempotent retroactive fixer for projects imported before
`import-paper.js` / `import-textbook.js` learned new normalizations.

Walks every `.qmd` under `<root>/qmd/` and applies the same pipeline as
the importers' normalization phase. Includes repair regexes that undo
mistakes from older versions of the script (e.g. `$\[[N](#ref-N)\]$`
patterns left by an earlier bug).

Idempotent — running it twice produces the same result.

### 3.9 `init-project.js`

Bootstraps a new Quarto Book project at any target directory.

Steps:
1. `mkdir -p <target>`
2. Copy `tool/` from `__dirname` to `<target>/tool/` (or `git clone` if
   `--git` flag given; the `--git` path also removes the nested `.git/`)
3. Write `<target>/_quarto.yml` with sensible defaults (project type
   `book`, output-dir `_book`, format html+pdf, `include-in-header:
   tool/autoreload.html`, IEEE CSL, BibTeX, suppress-bibliography)
4. Write `<target>/index.qmd` (Preface placeholder)
5. Create `<target>/qmd/`
6. Write `<target>/.vscode/settings.json` (paste-image config:
   `markdown.copyFiles.destination` maps `**/*.qmd` to `images/${fileName}`)
7. Write empty `<target>/references.bib`
8. Copy `<source-project>/ieee.csl` if present
9. Write `<target>/.gitignore`

### 3.10 `_pdfjs/`

Mozilla PDF.js viewer v3.11.174 distribution. About 5 MB. Shipped
with the tool (offline-capable). `serve.js` mounts it at `/_pdfjs/`.

---

## 4. MinerU normalizations (the gauntlet)

Both `import-paper.js` and `import-textbook.js` apply the same pipeline
of fixes to raw MinerU output. Order matters in some places; replicate
exactly when extending.

### 4.1 Math delimiters

MinerU emits LaTeX math as `\(...\)` (inline) and `\[...\]` (display).
Pandoc passes those through HTML (MathJax handles them), but the
Pandoc→LaTeX path treats them as literal brackets, breaking PDF render.

Replace `\(...\)` → `$...$` and `\[...\]` → `$$...$$`.

**Catch**: MinerU also wraps **inline citations** like `[9]` in `\(...\)`
(mis-classifying them as math). If the wrapper's content is pure
citation pattern, **strip the wrapper, do not convert to dollar**. The
later citation-linking step turns the bare `[9]` into a link.

Also: `\[...\]` containing an already-linked citation
`[N](#ref-N)` is **escaped IEEE brackets**, not display math —
preserve the wrapper exactly.

The detection helper:

```js
const looksLikeCitation = s => {
  const t = s.trim();
  if (/^\[?\d+\]?(\s*[,;\-–]\s*\[?\d+\]?)*$/.test(t)) return true;
  if (/^\[\d+\]\(#ref-\d+\)$/.test(t)) return true;
  return false;
};
```

### 4.2 `<details><summary>…</summary>…</details>`

MinerU wraps tables and Mermaid blocks in HTML disclosure elements.
HTML hides them by default; LaTeX doesn't understand them. Strip the
wrapper and `<summary>` label; keep the inner content.

### 4.3 `<table>…</table>` → markdown pipe-table

Raw HTML tables pass through to HTML output (unstyled), but are silently
dropped by Pandoc→LaTeX. Convert each `<table>` to a markdown pipe-table
by parsing `<tr>` and `<td>/<th>` (no colspan/rowspan support).

### 4.4 Mermaid blocks

MinerU sometimes recreates a figure as a `\`\`\`mermaid\`\`\`` block
*alongside* inserting the real image. The Mermaid version is usually
broken nonsense. Drop all `\`\`\`mermaid` … `\`\`\`` blocks.

### 4.5 IEEE-style `[N]` citations

Detect the References section by heading match
`/(##+)\s+(?:references|参考文献)/i`.

In that section: each `[N]` at line start gets an inline anchor
`{#ref-N}` so `<span id="ref-N">N</span>` is emitted.

Everywhere else: replace `[N]` (not already followed by `(#ref-` or
`{#ref-`) with `\[[N](#ref-N)\]`. The escaped outer brackets keep the
IEEE-style visible "[N]" in the rendered output; the inner `[N](#ref-N)`
is a markdown link Pandoc converts to a clickable hyperlink in both HTML
and PDF.

### 4.6 Pipeline order

In the importers:

1. Math `\(...\)` and `\[...\]` conversion (with `looksLikeCitation`
   guard)
2. Strip `<details>` / `<summary>`
3. Convert `<table>` to pipe-table
4. Strip Mermaid blocks
5. Process citations (anchor refs, link body)

In `fix-md-syntax.js` (per-file, for already-imported projects):
- All of the above
- PLUS repair regexes for old corruption patterns
  (`$\[[N](#ref-N)\]$` → `\[[N](#ref-N)\]`, `$[N]$` → `[N]`, etc.)
- PLUS re-wrap bare `[N](#ref-N)` (no surrounding `\[...\]`) as
  `\[[N](#ref-N)\]`, using a negative lookbehind/lookahead

---

## 5. The folder-first convention (full spec)

The single rule, applied at every depth:

> **Any content unit `X` is `X/X.qmd`. To add a subsection `Y` to `X`,
> create `X/Y/Y.qmd`.**

Worked example for a paper:

```
qmd/<chapter-slug>/
├── <chapter-slug>.qmd                      ← H1 (chapter title + intro/abstract)
├── images/                                  ← chapter-wide images
├── 01-introduction/
│   └── 01-introduction.qmd                  ← H2 (one section)
├── 02-system-model/
│   ├── 02-system-model.qmd                  ← H2
│   ├── 01-foo/
│   │   ├── 01-foo.qmd                       ← H3 (subsection of system-model)
│   │   └── 01-nested/
│   │       └── 01-nested.qmd                ← H4 (sub-subsection)
│   └── 02-bar/
│       └── 02-bar.qmd
└── 03-conclusion/
    └── 03-conclusion.qmd
```

Constraints / quirks:

- `index.qmd` **must** live at the project root. Quarto book enforces
  this hard with the error "Book contents must include a home page".
- For Chinese textbooks, **do not** import the entire source as one
  wrapper chapter like `qmd/paper/paper.qmd`. The user's desired shape is
  a real Quarto book:
  - `index.qmd` is the book landing page / cover matter. Put the book
    title, author/translator blurb, `内容简介`, and
    `图书在版编目(CIP)数据` here. These are not standalone top-level
    chapters in the left sidebar.
  - `前言`, `序`, `后记`, `致谢`, and each real `第 N 章 ...` should be
    individual top-level files in `_quarto.yml`'s `book.chapters`.
  - Because the textbook headings already contain their own numbering
    (`第1章`, `1.1`, `1.1.1`), set Quarto `number-sections: false` for
    both HTML and PDF when importing a textbook. Otherwise rendered
    headings become double-numbered (`3 第1章 ...`, `3.1 1.1 ...`).
- Current textbook layout is:
  `qmd/<book-slug>/<chapter-slug>/<chapter-slug>.qmd`, with shared
  images at `qmd/<book-slug>/images/`. This differs from the older paper
  layout where `qmd/<slug>/<slug>.qmd` is the only top-level chapter.
- Folder names get an `NN-` numeric prefix (`01-foo`, `02-bar`) so they
  sort alphabetically AS authored. Without prefixes the sort might be
  alphabetical and break the intended order.
- Slugs are Unicode-aware (CJK chars survive). Max 25 chars at a hyphen
  boundary.
- `images/` directory is created at the chapter root (next to the
  chapter `.qmd`). Section files reference images as
  `images/<name>` (relative to chapter dir, NOT relative to the section
  file — Quarto include resolution semantics).
- In the newer textbook layout, images are one level above each chapter
  directory (`qmd/<book-slug>/images/`), so importer output inside
  chapters must rewrite MinerU image links from `images/<name>` to
  `../images/<name>`. If this is missed, HTML may appear to work in some
  cases but PDF will fail with a misleading "image format" or
  "file not found" error from LaTeX.

---

## 6. AUTO-INCLUDES mechanism

Each `X/X.qmd` file contains a block:

```markdown
<!-- AUTO-INCLUDES-BEGIN -->
{{< include 01-foo/01-foo.qmd >}}
{{< include 02-bar/02-bar.qmd >}}
<!-- AUTO-INCLUDES-END -->
```

`gen-includes.js` regenerates the lines between the markers from the
folder structure. The markers stay; everything between them is the
script's domain. User-edited content outside the markers is preserved.

The watcher runs gen-includes before every render, so this stays in
sync automatically.

`gen-includes.js` must detect folder-first units recursively, not only
immediate `qmd/X/X.qmd` chapters. This matters because textbook imports
now create top-level book chapters under `qmd/<book-slug>/<chapter>/`.
When walking recursively, process only content units that do not already
have a content-unit ancestor; otherwise nested sections get treated as
independent book chapters and include paths are generated from the wrong
root.

Quarto's include paths must be **relative to the chapter root**, not
the immediately-including file. So in a 3-level structure, the level-3
file's include line says `path-from-chapter-root/level-3-sub.qmd`. The
gen script tracks `chapterDir` through recursion.

---

## 7. Live preview architecture

```
┌──────────────────────┐   _quarto.yml edits             ┌────────────────────┐
│  Positron / editor   │ ─────────────────────────────── │                    │
│                      │                                 │   watch-render.ps1 │
│  (any .qmd save)     │ ────atomic-write event─────────▶│   (PowerShell)     │
└──────────────────────┘                                 │                    │
                                                         │  1. gen-includes   │
                                                         │  2. quarto render  │
                                                         │     --to html      │
                                                         │  3. quarto render  │
                                                         │     --to pdf       │
                                                         │     --output-dir   │
                                                         │     _pdf           │
                                                         │                    │
                                                         │  writes _book/     │
                                                         │  writes _pdf/      │
                                                         │  writes .watcher-  │
                                                         │     status.json    │
                                                         └─────────┬──────────┘
                                                                   │ spawns
                                                                   ▼
                                                         ┌────────────────────┐
┌──────────────────────────┐  HTTP                       │  node serve.js     │
│   Simple Browser /       │ ◀───────────────────────────│  (port 4321)       │
│   external browser       │                             │                    │
│                          │  /pdf / /split / /qmd/* /   │  • static serve    │
│   /split panel:          │  /index.html / /_pdf/*.pdf  │    _book/          │
│     left iframe          │                             │  • static serve    │
│       = /index.html      │                             │    _pdf/           │
│       (autoreload.html   │                             │  • PDF.js viewer   │
│        injected)         │                             │    from _pdfjs/    │
│     right iframe         │                             │  • POST /find-     │
│       = /pdf             │                             │    source          │
│       (PDF.js wrapper)   │                             │  • POST /open-in-  │
│                          │  /open-in-editor            │    editor →        │
│  Ctrl+Click on text ─────┼─────────────────────────────│    positron -r     │
│                          │                             │      --goto …      │
└──────────────────────────┘                             └────────────────────┘
```

Key invariants:

- All file paths in `serve.js` are anchored on `__dirname` and
  `path.join(__dirname, '..')`. The tool is movable to any project as
  long as `tool/` lives one level under the project root.
- Port 4321 is hardcoded in `serve.js`, `start.cmd`, `watch-render.ps1`,
  and the AGENT_HANDOFF instructions to the user. **Only one project's
  watcher can run at a time** until this is parameterized (see §11).

---

## 8. Cross-reference Ctrl+Click → source

User flow: read HTML in browser, see a paragraph they want to fix,
Ctrl+Click it, Positron jumps to that line in the matching `.qmd`.

Implementation:

1. `autoreload.html` registers a capture-phase click listener
2. On Ctrl/Cmd+Click, walks up the DOM to find the nearest block
   element (`<p>`, `<h1>`-`<h6>`, `<li>`, `<blockquote>`, `<pre>`,
   `<td>`, `<th>`, `<dt>`, `<dd>`, `<figcaption>`)
3. POSTs the block's `textContent` to `/open-in-editor`
4. Server's `findSource` cascades through prefix lengths
   `[70, 30, 15, 8, 4]` to handle text content that wraps across source
   lines (HTML collapses whitespace, source preserves it)
5. On match, server `exec`s
   `"C:\Program Files\Positron\bin\positron.cmd" -r --goto FILE:LINE:1`
6. Browser shows a bottom-left toast like `→ intro.qmd:5`

Why CLI instead of `positron://` URL scheme?
**Simple Browser (the Positron/VS Code webview) intercepts non-HTTP
URL schemes**. The `positron://` link from inside the iframe never
reaches the OS. Going through the Node server bypasses this entirely.

Why `-r` (`--reuse-window`)? Without it, Positron sometimes opens a
new instance instead of focusing the current one.

Edge cases the prefix cascade handles:
- Short standalone block ("Section A" — 9 chars) — caught by 8-char prefix
- Long paragraph with line wrapping — caught by 15 or 8 char prefix
- CJK text (each char is 1 JS string char) — caught down to 4 chars
- Math-rendered content (MathJax DOM) — usually has surrounding text
  that matches

---

## 9. Status badge JSON shape

`<root>/.watcher-status.json`:

```json
{
  "state": "idle" | "starting" | "scanning" | "rendering-html" |
            "rendering-pdf" | "error" | "stopped" | "unknown",
  "message": "<short detail, e.g. file being rendered, error excerpt>",
  "buildId": <int, increments on each successful HTML render>,
  "ts": <unix-millis>
}
```

The browser uses `buildId` (not state or content hash) to decide when
to reload. `buildId` increments only on HTML render OK, never on PDF.

The status file is updated by `Update-Status` in `watch-render.ps1`,
and read on each `/status` GET request. No caching layer; the file
itself is the cache.

UTF-8 encoding **without BOM** is mandatory — PowerShell 5's default
emits BOM, which broke `JSON.parse` in some browsers.

---

## 10. Day-to-day workflow (user view)

1. Open project folder in Positron (`File → Open Folder`)
2. Double-click `tool\start.cmd`
3. In Positron: `Ctrl+Shift+P` → `Simple Browser: Show` → enter
   `http://localhost:4321/split`
4. Edit any `.qmd` in `qmd/`. Save.
5. ~8 seconds later HTML auto-reloads in the left pane; ~20 seconds
   later PDF auto-reloads in the right pane (with page+zoom preserved).
6. Ctrl+Click any rendered text to jump to source.
7. To stop: double-click `tool\stop.cmd`.

Importing a new MinerU PDF:

```powershell
# Make the paper folder its own Positron project:
node C:\Users\Administrator\mybooksystem\tool\init-project.js "<paper-folder>"
cd "<paper-folder>"

# Pick the right importer:
node tool\import-paper.js   "<source.md>" paper          # English paper
node tool\import-textbook.js "<source.md>" paper          # Chinese textbook

# Open in Positron, double-click tool\start.cmd, you're done.
```

---

## 11. Known limitations / future work

These are unblocked, low-risk improvements that an agent can pick up.

### 11.1 Single-project port (4321 hardcoded)

The user has multiple projects but can only run one watcher at a time.
Plumb the port from `_quarto.yml`'s `project.preview.port` through
`watch-render.ps1`, `serve.js`, `start.cmd`, and the autoreload script
URL substitutions.

Concrete change:
- In `watch-render.ps1`, parse `_quarto.yml` and extract
  `project.preview.port` (default 4321 if missing)
- Pass it as an env var or CLI arg when spawning `node serve.js`
- In `serve.js`, read `process.env.PORT` or argv

### 11.2 MinerU page-index provenance

MinerU emits `*_content_list.json` next to the `.md`. Each content block
has `"page_idx": N`. Currently the importers ignore this metadata.

Adding it would unlock:
- "Which PDF page does this section come from?" inline (HTML comment
  marker like `<!-- mineru-page: 42 -->` at the top of each section's
  `.qmd`)
- A future `audit-chapter.js` could resolve each section to its source
  page and ship that page's image to a vision LLM for OCR review

Implementation:
- Read `<source-basename>_content_list.json` alongside the `.md`
- For each generated section file, find the content blocks that fall
  within its heading boundaries and record the page-index range
- Emit one HTML comment line per section

### 11.3 AI audit pipeline (the user's stated next goal)

Concept: after import, run an audit pass that lets an LLM compare each
section's `.qmd` content against the corresponding original PDF page(s),
flag OCR errors (broken math, garbled characters, missing rows in
tables, etc.), and optionally write fixes.

Stages:

**Stage A — page provenance (prereq)**: see §11.2.

**Stage B — `audit-chapter.js`**: a CLI tool that takes a chapter slug,
walks each `.qmd`, extracts the page-idx range, renders those pages of
the source PDF to PNG (using e.g. `pdftoppm`), sends `{chapter text, page
images}` to a vision LLM with a system prompt like "find OCR errors,
report file:line + suggested fix; do not modify anything that looks
correct". Writes `audit-report.md` next to the chapter. Does NOT auto-
edit files. Human reviews and applies.

**Stage C — auto-fix loop**: optional, risky. Let the LLM apply fixes
into a side branch of the .qmd files; show a diff; user accepts/rejects.

Cost notes (rough):
- Vision API: ~$0.01-0.05 per page (varies by model and resolution)
- 500-page textbook: $5-25 in vision calls if every page is checked
- Mitigation: have the LLM first scan the text alone (no image), only
  request the page image when it sees something suspicious

Implementation hints:
- Use `pdftoppm` (from poppler-utils) to convert PDF pages to PNG, or
  use the `pdf2pic` npm package, or just send a base64-encoded crop of
  `*_layout.pdf` which MinerU already provides
- For the vision API, both OpenAI's `gpt-4o` and Anthropic's
  `claude-3-5-sonnet` accept image inputs in the same Messages-style
  API
- Don't bake the API key into source — read from
  `~/.knowledge-tool-config.json` or env var

### 11.4 Cross-platform

Currently Windows-only (`.cmd`, `.ps1`, hardcoded Windows paths).
Mac/Linux port would need:
- `.sh` equivalents of `start.cmd` / `stop.cmd`
- `watch-render.ps1` → Node script (or shell + inotifywait)
- Positron CLI path: `code --goto` / `positron --goto` (different per OS)
- Forward-slash path normalization everywhere (Node's `path` mostly
  handles this, but a few raw strings in `serve.js` use backslash)

### 11.5 Visual editor compatibility with shortcodes

Quarto Visual editor strips `{{< include >}}` shortcodes on round-trip
in some cases. Safer to encourage users to **edit leaf files in Visual
mode** (no includes) and edit chapter files only in Source mode.

This is documented in `tool/README.md` already; consider adding a
runtime warning in autoreload.html when the user opens a chapter file
in Visual mode.

### 11.6 Mermaid: keep figures, drop redundant diagrams

Current rule: drop all `\`\`\`mermaid` blocks. This is correct for
MinerU output (which always emits Mermaid alongside the real image,
where the Mermaid is broken nonsense). But if a user authors a
legitimate Mermaid diagram, the importer would drop it. Consider
detecting "MinerU-generated Mermaid" specifically (e.g. blocks that
follow an `<details>` wrapper) and only drop those.

---

## 12. Bug-fix history (so you don't re-introduce these)

In rough chronological order:

1. **`_pdf/test.pdf` 404 during render** — Quarto deletes then renames
   the file. Solution: `readWithRetry` in `serve.js` with up to 60×200ms
   wait for `.html` requests. Same for PDF (different code path, same
   idea).

2. **Quarto preview's file watcher missing Positron saves on Windows** —
   Positron does atomic save (write temp + rename). Quarto preview's
   internal watcher only listens for `MODIFY` events. Replaced with
   PowerShell `FileSystemWatcher` (catches `RENAMED` events).

3. **`quarto preview` overwriting fresh HTML with cached output** —
   Even with `--no-watch-inputs`, the preview server's HTTP handler
   serves from a cache that lags behind disk. Replaced with a plain
   Node static server.

4. **PDF render wiped `_book/`** — `quarto render --to pdf` cleans the
   project's `output-dir` before writing. Use `--output-dir _pdf` to
   isolate.

5. **Concurrent renders racing for `index.tex` rename** — Each render
   writes a temp `.tex` in the project root and renames into `_book/`.
   Two parallel watchers (a common state after stop/start glitches)
   collide. Solution: lock-file based single-instance enforcement and
   queue all renders sequentially within one watcher.

6. **`Stop-Process -Force` doesn't run `finally`** — the watcher's
   cleanup block (kill node serve, remove lock) is skipped. `stop.cmd`
   has to redundantly kill `node.exe` matching `serve.js`.

7. **CJK characters mangled in POST bodies** — `body += chunk` (where
   chunk is a Buffer) calls `.toString()` with default encoding which
   sometimes splits multi-byte UTF-8. Use
   `Buffer.concat(chunks).toString('utf8')`.

8. **`Set-Content -Encoding UTF8` writes a BOM** in PowerShell 5.
   `JSON.parse(text)` in some browsers fails on leading BOM. Use
   `[System.IO.File]::WriteAllText(path, json,
   [System.Text.UTF8Encoding]::new($false))`.

9. **PDF.js iframe black in Simple Browser** — Simple Browser's webview
   doesn't ship the native Chromium PDF plugin. Bundled the full PDF.js
   viewer in `_pdfjs/` and wrap it manually.

10. **`positron://` URL scheme blocked in Simple Browser webview** —
    custom URL schemes are intercepted. Switched to server-side
    `positron --goto` invocation.

11. **`positron --goto` opened file but didn't move cursor** — was
    actually working; user had a stale tab. Added `-r` (reuse-window)
    for reliability.

12. **`\(\[N\]\)` math wrapper around citations broke PDF** — MinerU's
    inline citations sometimes use math-paren syntax. Added
    `looksLikeCitation` guard so the math regex strips the wrapper
    instead of converting to `$...$`.

13. **`\[...\]` math regex destroyed citation outer brackets** — after
    earlier fixes, the math regex still matched `\[[N](#ref-N)\]` and
    stripped the `\[` and `\]` (the IEEE bracket markers). Fixed by
    detecting the linked-citation pattern in `looksLikeCitation` and
    preserving the full match when matched.

14. **PDF rename failure when book title has spaces** — Quarto names the
    output PDF after `book.title` (e.g. "Personal Learning System.pdf").
    `serve.js` was hardcoded to `_pdf/test.pdf`. Changed to "serve the
    most recently modified `.pdf` in `_pdf/` regardless of filename".

15. **`_quarto.yml` changes didn't trigger renders** — FileSystemWatcher
    `Filter` accepts one pattern only. Added a manual mtime poll for
    `_quarto.yml` in the watcher's main loop.

16. **All Chinese-titled sections slugified to "section"** — old slug
    regex was `[^a-z0-9]+` which stripped CJK. Changed to
    `[^\p{L}\p{N}]+` with `u` flag.

17. **Textbooks' all-H1 layout collapsed into one flat list** — created
    `import-textbook.js` with text-prefix-based hierarchy inference.
    Skips TOC entries with trailing page numbers.

18. **Chinese textbook import looked like a chapter, not a book** —
    `import-textbook.js` originally wrote one `qmd/paper/paper.qmd`
    wrapper whose children were `内容简介`, `图书在版编目(CIP)数据`,
    `前言`, and `第1章...`. The user rejected this because it did not
    feel like a real book in Positron/Quarto. Fix: write cover matter
    into root `index.qmd`; keep `内容简介` and CIP as level-2 sections
    inside `index.qmd`; write `前言` and each real `第 N 章` as separate
    top-level book chapter files in `_quarto.yml`; disable Quarto
    auto-numbering for textbook imports so original book numbering is
    preserved.

19. **`gen-includes.js` missed nested textbook chapters** — it only
    scanned immediate `qmd/X/X.qmd` units, so the new layout
    `qmd/<book-slug>/<chapter>/<chapter>.qmd` produced zero processed
    chapters and empty AUTO-INCLUDES blocks. Fix: recursively find
    folder-first units and process only those without a content-unit
    ancestor.

20. **Textbook chapter images broke PDF after nesting chapters** —
    MinerU image links are emitted as `images/<name>`, but in the new
    textbook layout chapter files live under `qmd/<book-slug>/<chapter>/`
    while images live at `qmd/<book-slug>/images/`. Fix:
    `import-textbook.js` rewrites chapter-body image refs to
    `../images/<name>`. Missing this can show up as a misleading LaTeX
    "image format" error because the resolved path is wrong.

21. **Project source of truth must be explicit before importing**. When the
    user says "everything should follow `test.md`" or points at a single
    MinerU markdown file, treat existing `qmd/` content as stale unless the
    user says otherwise. Move old `qmd/` into `_import-backup/` with a
    timestamp, create a fresh `qmd/`, then import from the requested source.
    This prevents old chapters from silently staying in `_quarto.yml`.

22. **Some MinerU textbook covers have several bare H1 headings before real
    chapters**. Do not choose the first bare heading with children as the
    book root; use the first bare H1 as the book title and collect real
    front matter / preface / chapter nodes recursively from the remaining
    headings. Also classify `译者的话` as preface-like front matter and drop
    TOC-only headings such as `前言 VI`.

23. **Do not link every bracketed number as a citation**. Bracketed vectors
    or bit strings such as `[1000000]` and `[000100]` can appear inside math
    and must not become `#ref-*` links. Limit automatic citation linking to
    plausible reference numbers, currently 1-3 digits, and repair already
    linked long/all-zero-ish bracket groups back to plain bracket text.

24. **PDF render catches normalization bugs that HTML tolerates**. In this
    run, LaTeX failed on `$^{\[[N](#ref-N)\]}$` citation superscripts and
    on MinerU pseudo-formula blocks like `$$ \begin{array}c c c c ... $$`.
    Normalize math superscript citation links back to plain markdown links,
    and drop huge `\begin{array}c c c...` blocks because they are usually
    OCR junk for diagrams, not usable math.

25. **Port 4321 can be occupied by another project's watcher**. If
    `http://localhost:4321/` opens the wrong book or cannot be reached,
    inspect the listener and process command lines before changing content:
    `netstat -ano | Select-String ':4321'`, then check `node.exe` /
    `powershell.exe` command lines for `serve.js` or `watch-render.ps1`.
    Stop stale watchers from other projects, clear the current project's
    `.watcher.lock`, start this project's watcher, and verify the rendered
    page title matches `_quarto.yml`.

26. **`start.cmd` / `Start-Process` can fail in agent shells with duplicate
    `Path`/`PATH` environment keys**. This is usually a tool-session quirk,
    not a project bug. Prefer starting the watcher through normal Windows
    process creation from the user environment, or ask the user to double
    click `tool\start.cmd`. If launching manually for verification, make
    sure the process persists after the shell command returns.

27. **The repo was restructured so a single `git clone` yields a complete
    Quarto Book project**, not just the tool scripts. Before this change the
    repo's content lived at the root (start.cmd, serve.js, _pdfjs/, …); the
    user had to either run `init-project.js` from an existing tool/ folder
    (chicken-and-egg) or hand-copy template files from a working project.
    After: root has `_quarto.yml`, `index.qmd`, `references.bib`, `ieee.csl`,
    `.vscode/settings.json`, `.gitignore`, `README.md`; scripts moved to
    `tool/` subfolder. **The local source-of-truth clone moved** from
    `C:\Users\Administrator\my-knowledge\tool\` to
    `C:\Users\Administrator\mybooksystem\`. Existing user projects keep
    their `tool/` script copies (no `.git/`) and continue to function; to
    propagate new scripts into them, `Copy-Item -Recurse -Force
    <repo>\tool\* <old-project>\tool\`.

---

## 13. Environment requirements

- **Windows 10/11** (scripts use PowerShell + `.cmd`)
- **Quarto** ≥ 1.4 — installed at `C:\Program Files\Quarto\bin\quarto.exe`
  (hardcoded path; change if installed elsewhere)
- **Node.js** ≥ 16 (for `serve.js`, `gen-includes.js`, importers)
- **Positron** (the IDE, latest stable). VS Code also works but Ctrl+Click
  source-jump won't (uses `positron.cmd`)
- **TeX Live or MiKTeX** with `xelatex` and `xeCJK` — only needed if
  generating PDF
- **Git** for syncing the tool repo

---

## 14. How to test changes you make

For tool-script changes:

1. Edit in `C:\Users\Administrator\mybooksystem\tool\<file>.js`
2. Copy the changed file into a target project's `tool/`:
   ```bash
   cp tool/<file>.js <target-project>/tool/
   ```
   (Or use the `git pull` flow if the target was set up via `--git` in
   `init-project.js`.)
3. Restart that project's watcher (`tool\stop.cmd` → `tool\start.cmd`)
4. Save any `.qmd` to trigger a render
5. Check `watcher.log` for `Render OK` and the `/status` endpoint for
   `state: "idle"` afterward
6. Open `http://localhost:4321/split` and verify HTML + PDF both render

For pure normalization changes (no infrastructure impact):

1. Take a fresh MinerU output folder (or one already converted)
2. Run `node tool/fix-md-syntax.js` against it
3. Diff the before/after of `qmd/**/*.qmd`
4. Render once and verify the rendered output matches expectations

For a full re-import from a named source markdown:

1. Confirm the source of truth with the user. If they say to ignore the old
   `qmd/`, move it to `_import-backup/qmd-before-<slug>-<timestamp>/`.
2. Import with the appropriate entry point, e.g.
   `node tool/import-textbook.js test.md paper`.
3. Run `node tool/gen-includes.js`.
4. Render HTML first: `quarto render --to html`.
5. Render PDF next: `quarto render --to pdf --output-dir _pdf`.
6. If PDF fails, fix the smallest normalization issue in `.qmd` and add the
   general rule to the importer before retrying.
7. Verify `http://localhost:4321/` returns the current book title, not a
   stale title from another project.

Always test on at least two projects (one paper, one textbook) before
pushing — they exercise different code paths.

---

## 15. Pushing changes to the tool repo

```powershell
cd C:\Users\Administrator\mybooksystem\tool
git add -A
git status                         # always sanity-check before committing
git commit -m "Short subject

Why-not-what body. The current code shows what changed; the commit
message should say why and explain non-obvious tradeoffs."
git push
```

Identity:
- `user.name = yfh`
- `user.email = 12224067@zju.edu.cn`

Don't `git push --force` to main except for the very first push
(which already happened — initial commit was a `--force` because the
GitHub repo auto-init had a stub README).

---

## 16. What you (the agent) should do next

The user's near-term priority is the **AI audit pipeline** (§11.3).
Suggested approach if asked to build it:

1. **First**, implement §11.2 (page-idx provenance). This is a prereq
   and self-contained — read `*_content_list.json`, embed
   `<!-- mineru-page: N -->` markers, add it to both `import-paper.js`
   and `import-textbook.js`, and add an equivalent retroactive fix
   that takes the source MinerU folder path as input
2. **Then**, write a standalone `audit-chapter.js` that, for one
   chapter slug:
   - Walks all `.qmd` under `qmd/<slug>/`
   - For each, extracts the `mineru-page` markers
   - Optional: render those PDF pages to PNG via `pdftoppm` (offer the
     fallback of just using the `*_layout.pdf` page directly)
   - Sends `{section text, page images}` to a vision LLM
   - Writes a Markdown audit report (file:line + suggested fix per
     issue) — NOT auto-edits
3. **Only after** the user has used the audit report manually for a
   while, build the auto-apply loop (Stage C in §11.3). Even then,
   gate it behind a `--yes-fix` flag and write all changes to a side
   branch under `qmd/<slug>/.audit-fixes/` first.

For any work: keep `import-paper.js` and `import-textbook.js` as
**separate code paths**. The user has been explicit about not wanting
textbook handling to overwrite paper handling. Refactor shared
helpers (math conversion, table conversion, etc.) into a small shared
module if duplication gets painful — but don't merge the entry points.

---

## 17. Files I would NOT change without explicit user permission

- `serve.js` core routing — many tweaks here over multiple debugging
  rounds, regressions easy to introduce
- `watch-render.ps1` lock-file and process-cleanup logic — already
  handles three known race conditions
- Anything in `autoreload.html` — careful balance of polling
  frequencies and reload conditions
- `_pdfjs/*` — vendored Mozilla code, do not patch

Safe to change without asking:
- `import-paper.js` / `import-textbook.js` / `fix-md-syntax.js`
  normalization rules (they are heuristic anyway)
- `init-project.js` templates (`_quarto.yml`, `.gitignore`,
  `.vscode/settings.json`)
- `README.md`, this file

---

## 18. Quick reference card

```
Boot a new project from a paper:
  node C:\Users\Administrator\mybooksystem\tool\init-project.js "<dest>"
  cd "<dest>"
  node tool\import-paper.js "<source.md>" paper
  tool\start.cmd
  → http://localhost:4321/split

Boot a new project from a textbook:
  (same, but import-textbook.js)

Fix a project's .qmd's retroactively:
  cd <project>
  node tool\fix-md-syntax.js

Restart watcher:
  tool\stop.cmd
  tool\start.cmd

Push tool changes to GitHub:
  cd C:\Users\Administrator\mybooksystem\tool
  git add -A && git commit -m "..." && git push
```

That's the full picture. Read this top to bottom once; refer back as needed.

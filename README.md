# mybooksystem — Quarto knowledge project template

Clone this repo and you have a **complete, working Quarto Book project**
with live HTML + PDF preview, source-jump from preview back to `.qmd`,
and a MinerU-to-Quarto importer.

This single repo serves two purposes:
1. **Template** for new knowledge / paper / textbook projects — clone to
   start.
2. **Source of truth** for the `tool/` scripts. Updates to `tool/` are
   pushed here; downstream projects can `cp -r` to sync.

## Quick start (new project)

```powershell
# Clone as a fresh project
git clone https://github.com/yfh667/mybooksystem.git my-new-project
cd my-new-project

# (Optional) drop MinerU output into the folder and import:
node tool\import-paper.js   path\to\test.md paper   # English IEEE paper
node tool\import-textbook.js path\to\test.md paper  # Chinese textbook

# Start live preview (HTML + PDF in browser)
tool\start.cmd
# → http://localhost:4321/split
```

The cloned folder already contains everything:

```
my-new-project/
├── _quarto.yml             # Quarto book config (edit title/author/chapters)
├── index.qmd               # cover page
├── references.bib          # empty BibTeX (add entries if you cite)
├── ieee.csl                # IEEE citation style
├── .gitignore              # ignores _book/ _pdf/ logs etc.
├── .vscode/settings.json   # paste-image config for Positron/VS Code
├── tool/                   # all scripts + PDF.js viewer
└── (your content goes into qmd/<chapter>/<chapter>.qmd)
```

Open the folder in **Positron** (or VS Code), double-click
`tool\start.cmd`, then `Ctrl+Shift+P` → `Simple Browser: Show` →
`http://localhost:4321/split`. Save any `.qmd`, preview auto-updates.

## What's in `tool/`

See [tool/README.md](tool/README.md) for the full reference.

| Script | Purpose |
|--------|---------|
| `start.cmd` / `stop.cmd` | Double-click to start / stop live preview |
| `watch-render.ps1` | File watcher + render pipeline orchestrator |
| `serve.js` | HTTP server (HTML + PDF preview + Ctrl+Click → source) |
| `gen-includes.js` | Generates `{{< include >}}` blocks from folder structure |
| `autoreload.html` | Injected into HTML for auto-reload + Ctrl+Click |
| `import-paper.js` | Convert MinerU paper output to Quarto chapter |
| `import-textbook.js` | Convert MinerU textbook output to Quarto book |
| `fix-md-syntax.js` | Retroactively fix old imports |
| `init-project.js` | Bootstrap a Quarto project elsewhere (older flow) |
| `_pdfjs/` | Mozilla PDF.js viewer (bundled, offline) |

## Requirements

- Windows 10 / 11
- [Quarto](https://quarto.org) ≥ 1.4 at `C:\Program Files\Quarto\bin\quarto.exe`
- [Node.js](https://nodejs.org) ≥ 16
- [Positron](https://positron.posit.co) (recommended) or VS Code
- TeX Live or MiKTeX with `xelatex` + `xeCJK` (only if generating PDF)

## Updating tool/ in existing projects

If you already have older projects with a `tool/` folder (cloned before
this restructure), sync new tool scripts by:

```powershell
git pull                                       # in this repo
Copy-Item -Recurse -Force tool\* <old-project>\tool\
```

Or just clone fresh and migrate content over.

## License

MIT — see [tool/LICENSE](tool/LICENSE).

## Agent / contributor docs

For AI agents (Codex, Claude, etc.) extending this toolkit, read
[tool/AGENT_HANDOFF.md](tool/AGENT_HANDOFF.md) end to end before editing.
It documents every script, every quirk, every bug-fix history entry.

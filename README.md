# mybooksystem — Quarto knowledge project toolkit

Clone this repo once into a central location (e.g. `C:\mukuai\`). From
there you can either:

- **Bootstrap any folder as a project** that uses the central scripts
  (no `tool/` copy per project — recommended for many projects).
- **Use this clone itself as a project**, or copy `tool/` into a project
  for a fully self-contained setup (legacy embedded mode).

## Central mode (recommended for many projects)

One central tool, many projects. Each project gets only its per-project
config files (`_quarto.yml`, `index.qmd`, `ieee.csl`, etc.). Scripts are
shared, so editing the toolkit applies to all projects.

```powershell
# Setup once:
git clone https://github.com/yfh667/mybooksystem.git C:\mukuai

# For every new project:
C:\mukuai\tool\new-project.cmd C:\paper-X
cd C:\paper-X
# (drop a MinerU output md anywhere accessible)
node C:\mukuai\tool\import-paper.js path\to\test.md paper        # IEEE paper
node C:\mukuai\tool\import-textbook.js path\to\test.md paper     # Chinese textbook
C:\mukuai\tool\start.cmd C:\paper-X

# Stop:
C:\mukuai\tool\stop.cmd C:\paper-X
```

After `new-project.cmd`, the project folder contains:

```
C:\paper-X\
├── _quarto.yml             # editable per project
├── index.qmd               # editable
├── references.bib          # add citations as needed
├── ieee.csl
├── autoreload.html         # referenced from _quarto.yml
├── .gitignore
├── .vscode\settings.json
└── (NO tool/ folder — scripts run from C:\mukuai\tool\)
```

**Editing scripts**: change files inside `C:\mukuai\tool\`. All projects
running off this central tool pick up the change on their next watcher
restart. Push to GitHub from `C:\mukuai\`.

## Embedded mode (single self-contained project)

If you want a project that carries its own `tool/` copy:

```powershell
git clone https://github.com/yfh667/mybooksystem.git my-project
cd my-project
node tool\import-paper.js path\to\test.md paper
tool\start.cmd
```

The cloned folder works as-is. Edits inside `my-project\tool\` only
affect that project. To update later, `git pull` or replace `tool/`.

## Folder layout of this repo

```
mybooksystem/                  ← clone target (works as a project too)
├── _quarto.yml                ← template (also valid in this clone)
├── index.qmd                  ← template
├── references.bib             ← empty
├── ieee.csl                   ← IEEE citation style
├── .vscode\settings.json      ← paste-image config
├── .gitignore                 ← project-level gitignore
├── README.md                  ← (this file)
└── tool\
    ├── README.md              ← internals doc
    ├── AGENT_HANDOFF.md       ← briefing for AI agents extending this
    ├── LICENSE                ← MIT
    ├── start.cmd / stop.cmd   ← accepts optional project-path arg
    ├── new-project.cmd        ← bootstrap a project (central mode)
    ├── watch-render.ps1       ← reads PROJECT_ROOT env var
    ├── serve.js               ← reads PROJECT_ROOT env var
    ├── gen-includes.js
    ├── autoreload.html        ← copied into each project by new-project.cmd
    ├── import-paper.js
    ├── import-textbook.js
    ├── fix-md-syntax.js
    ├── init-project.js        ← older entry point, still works
    └── _pdfjs\                ← Mozilla PDF.js viewer (bundled, ~5 MB)
```

## Requirements

- Windows 10 / 11
- [Quarto](https://quarto.org) ≥ 1.4 at `C:\Program Files\Quarto\bin\quarto.exe`
- [Node.js](https://nodejs.org) ≥ 16
- [Positron](https://positron.posit.co) (recommended) or VS Code
- TeX Live or MiKTeX with `xelatex` + `xeCJK` (only if generating PDF)

## Updating tool scripts in old projects

Old projects with their own `tool/` folder can be synced to the latest
central scripts:

```powershell
Copy-Item -Recurse -Force C:\mukuai\tool\* <old-project>\tool\
```

Or migrate the old project to central mode by deleting its `tool/`
folder and editing `_quarto.yml`'s `include-in-header` from
`tool/autoreload.html` to `autoreload.html` (and copy `autoreload.html`
from `C:\mukuai\tool\` to the project root).

## License

MIT — see [tool/LICENSE](tool/LICENSE).

## Agent / contributor docs

For AI agents (Codex, Claude, etc.) extending this toolkit, read
[tool/AGENT_HANDOFF.md](tool/AGENT_HANDOFF.md) end to end before editing.

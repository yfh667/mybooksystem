# QmdTool for Positron

This is a local Positron / VS Code compatible extension for QmdTool.

## Install as a normal extension

From this folder:

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pluige
npm install
npm run package
npm run install:positron
```

Then reload Positron. After that, use QmdTool commands in the normal Positron window. You do not need to press `F5` or open an Extension Development Host window.

The packaged VSIX only includes the extension entrypoint and the runtime files it actually uses:

```text
extension.js
README.md
package.json
tool\convert-mineru.js
tool\format-algorithms.js
tool\gen-includes.js
tool\localize-images.js
tool\_pdfjs
```

Main command:

```text
QmdTool: Convert & Preview
```

It converts a folder containing a completed Markdown file and images into the current QmdTool Quarto structure, then opens a single preview panel. You choose either HTML or PDF, not both.

The preview panel opens immediately after the command starts. If rendering is still running, it shows a blank/building page first and refreshes when output is ready.

Each Positron window gets its own local preview server on a random free port. When Positron closes or the extension deactivates, the server is closed automatically.

## Commands

- `QmdTool: Convert & Preview`: convert the current folder, then choose HTML or PDF preview.
- `QmdTool: Preview HTML`: open the current project's rendered HTML.
- `QmdTool: Preview PDF`: open the current project's newest PDF from `_pdf`.
- `QmdTool: Render HTML`: run the QmdTool include/image pipeline and `quarto render --to html`.
- `QmdTool: Render PDF`: run the QmdTool include/image pipeline and `quarto render --to pdf --output-dir _pdf`.
- `QmdTool: Stop Preview Server`: stop the server for the current project.

## Settings

- `qmdtool.toolDir`: optional absolute path to the existing `tool` directory.
- `qmdtool.quartoPath`: optional absolute path to `quarto.exe`.
- `qmdtool.nodePath`: optional absolute path to `node.exe`.
- `qmdtool.autoRenderHtmlOnSave`: when enabled, saving qmd/yml/bib/csl files triggers HTML render for the active preview project.
- `qmdtool.autoRenderPdfOnSave`: when enabled, saving qmd/yml/bib/csl files also triggers PDF render after HTML.

## Notes

The preview panel has one display area only. Use the `HTML` and `PDF` buttons in the toolbar to switch formats. On save, the extension renders HTML first and PDF second by default. Initial conversion/preview also builds both formats by default. The extension does not reserve port `4321`; it chooses a free local port per project, so two Positron windows can preview different books at the same time.
HTML and PDF panes stay mounted at the same time; switching formats only hides one pane and shows the other, so scroll/page position is preserved.

PDF preview uses the bundled local PDF.js viewer from `tool/_pdfjs`, matching the old server workflow more closely than a raw PDF iframe.
The PDF viewer stores the current page and zoom in session storage and restores them after automatic PDF rebuilds.

In HTML preview, `Ctrl+Click` or double-click a rendered paragraph/heading/list item to jump back to the matching `.qmd` source line.

During automatic rendering, the HTML preview shows a status badge such as `preparing`, `rendering HTML`, `rendering PDF`, or `error`.

When save-triggered rendering is running, the existing HTML page stays visible and usable. It reloads only after the new HTML build is ready.
During that window, the extension serves cached copies of the previous HTML files, so sidebar navigation should continue to work instead of blocking on Quarto's temporary `_book` rewrite.
HTML refresh is independent from PDF rendering: as soon as HTML finishes, the HTML pane can reload while PDF continues building in the background.

Click an image in HTML preview to open a zoom overlay. Use the mouse wheel to zoom, double-click to reset, and `Esc` to close.

---
name: qmdtool-latex-repair
description: Use this when converting a MinerU Markdown textbook or paper into a QmdTool/Quarto project and PDF compilation fails because of OCR-damaged LaTeX formulas, Markdown math delimiters, image OCR detail blocks, or table syntax.
---

# QmdTool LaTeX Repair Skill

## Goal

Repair one MinerU-produced Markdown file so QmdTool can import it and Quarto/XeLaTeX can compile the PDF.

The standard input folder looks like this:

```text
BOOK_FOLDER/
├── pdf040.md
└── images/
```

The target output should include:

```text
BOOK_FOLDER/
├── pdf040.md                    # original, never modify
├── pdf040_qmdtool_fixed.md      # repaired copy
├── latex_scan.json              # formula compile report
├── _quarto.yml
├── qmd/
└── _pdf/
    └── 人工智能.pdf             # or the book title PDF
```

## Non-Negotiable Rules

- Never edit the original source Markdown.
- Always create and repair a sibling `*_qmdtool_fixed.md` copy.
- Do not rely on visual judgment or model guessing for formulas.
- The acceptance criterion for formulas is real XeLaTeX compilation.
- The final acceptance criterion is full `quarto render --to pdf --output-dir _pdf` success.
- Use UTF-8 file APIs. Do not judge Chinese text corruption from PowerShell display alone.

## Important QmdTool Math Rule

QmdTool keeps formula bodies as TeX. The importer mainly normalizes wrappers:

- `\(...\)` becomes `$...$`
- `\[...\]` becomes `$$...$$`
- spaces around `$ ... $` are tightened so Pandoc recognizes inline math
- HTML tables are converted to Markdown pipe tables

Therefore, the repair workflow is:

1. Extract every formula body from `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`.
2. Compile those formula bodies with XeLaTeX.
3. Fix only the source Markdown copy.
4. Repeat until `compileFailures=0`.

## Standard Workflow

Open PowerShell in the target folder:

```powershell
cd "C:\path\to\BOOK_FOLDER"
```

Create or refresh the fixed copy:

```powershell
Copy-Item ".\pdf040.md" ".\pdf040_qmdtool_fixed.md" -Force
```

Run the formula repair/check queue:

```powershell
node "C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\latex-risk-scan.js" ".\pdf040_qmdtool_fixed.md" --fix --compile --report ".\latex_scan.json"
```

Success looks like this:

```text
compileFailures=0
```

If `compileFailures` is not zero:

1. Read `latex_scan.json`.
2. Inspect each failing `line`, `raw`, and `compileError`.
3. Repair the corresponding line in `pdf040_qmdtool_fixed.md`.
4. Run the same scanner command again.
5. Continue until `compileFailures=0`.

## Initialize QmdTool Project

If `_quarto.yml` does not exist:

```powershell
& "C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\new-project.cmd" "C:\path\to\BOOK_FOLDER"
```

Import the repaired Markdown:

```powershell
node "C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\import-textbook.js" ".\pdf040_qmdtool_fixed.md" __root__
```

If import refuses because `qmd/` is not empty, only remove or rename `qmd/` if it was generated from this same source and is safe to replace:

```powershell
$root = Resolve-Path -LiteralPath "."
$qmd = Resolve-Path -LiteralPath ".\qmd"
if ($qmd.Path.StartsWith($root.Path)) {
  Remove-Item -LiteralPath $qmd.Path -Recurse -Force
} else {
  throw "qmd path safety check failed"
}
```

Then run the import command again.

## Validate Qmd Output

Run a fast structural scan on generated `qmd/`:

```powershell
node "C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\latex-risk-scan.js" ".\qmd" --report ".\qmd_latex_scan.json"
```

This fast scan should show:

```text
risky=0
compileFailures=0
```

It may still show `tableIssues>0` for imperfect OCR tables. If the full PDF compiles, those are non-blocking cleanup items. If PDF fails on a table, simplify that table into a standard Markdown pipe table or plain text.

## Render PDF

Run:

```powershell
& "C:\Program Files\Quarto\bin\quarto.exe" render --to pdf --output-dir _pdf
```

Success looks like:

```text
Output created: _pdf\人工智能.pdf
```

Verify the PDF exists:

```powershell
Get-ChildItem ".\_pdf" -Filter "*.pdf" | Select-Object FullName,Length,LastWriteTime
```

## Common Formula Repairs

Undefined OCR commands:

```markdown
Bad:
$Q ^ { \dprime }$
$| p \rrangle$
$\mathbfcal { P }$
$\overrightharpoon { p }$
$\J _ { \mathrm { O I N - N _ { o D E S } } }$
$\m _ { 1 : t }$
$\h _ { 1 }$

Good:
$Q'$
$|p\rangle$
$\mathcal { P }$
$p$
$\mathrm { JOIN\text{-}NODES }$
$\boldsymbol { m } _ { 1 : t }$
$h _ { 1 }$
```

Unsupported font/script noise:

```markdown
Bad:
${ \bf \mathscr { e } } _ { 1 : t }$
$\hat { y } = X \pmb { \mathscr { w } }$
$\theta _ { 2 } \mathscr { f }$
$\mathbf { \mathscr { W } } ^ { ( i - 1 ) } = \pmb { \mathscr { 0 } }$

Good:
$\boldsymbol { e } _ { 1 : t }$
$\hat { y } = X \pmb { w }$
$\theta _ { 2 }$
$\pmb { W } ^ { ( i - 1 ) } = \pmb { 0 }$
```

Broken math delimiters:

```markdown
Bad:
其中 $\operatorname{erf}$$ 即所谓的误差函数。

Good:
其中 $\operatorname{erf}$ 即所谓的误差函数。
```

Array optional-argument trap:

```markdown
Bad:
\begin{array}{r}[ 0.80 ]\\[ 0.20 ]\end{array}

Good:
\begin{array}{r} [ 0.80 ]\\{} [ 0.20 ]\end{array}
```

OCR garbage formula:

```markdown
Bad:
$R'(s,a,s') = R(s,a,s') + \gamma\phi(s') - \phi(s)_{\sharp}\mathscr{A}_{\sharp}\sharp_{\cal R}(s,a,s')$

Good:
$R'(s,a,s') = R(s,a,s') + \gamma\phi(s') - \phi(s)$
```

## Common Markdown Repairs

MinerU image OCR detail blocks often look like this:

```markdown
<details>
<summary>text_image</summary>

X_{t+1}
\tilde{f}(X_t, a_t) = f(\mu_t, a_t) + F_t(X_t - \mu_t)
</details>
```

These are not readable textbook content. They are OCR text extracted from an image, and they can break PDF because TeX syntax appears outside math delimiters. Remove the whole `text_image` details block.

Tables:

- Prefer standard Markdown pipe tables.
- Every table row must have the same number of cells.
- Escape literal pipe characters inside cells as `\|`.
- If a table is OCR garbage from a figure/chart, delete it or turn it into plain text.

## Troubleshooting Loop

If `latex-risk-scan.js` reports failures:

1. Use the reported line number.
2. Open the fixed copy.
3. Read the local sentence around that formula.
4. Decide whether the formula has recoverable meaning.
5. If recoverable, rewrite it into simple legal TeX.
6. If not recoverable, remove the formula or replace it with `[Removed OCR-damaged formula block.]`.
7. Re-run:

```powershell
node "C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\latex-risk-scan.js" ".\pdf040_qmdtool_fixed.md" --fix --compile --report ".\latex_scan.json"
```

If full Quarto PDF fails after formula scan passes:

1. Read the Quarto error line and `index.log`.
2. Search the fixed Markdown and generated `qmd/` for the failing text.
3. Common cause: TeX-like text outside `$...$` because it came from a MinerU `text_image` block.
4. Fix the fixed Markdown copy.
5. Re-import by replacing generated `qmd/`.
6. Render PDF again.

## Final Acceptance Checklist

- `pdf040.md` is unchanged.
- `pdf040_qmdtool_fixed.md` exists.
- `latex_scan.json` has `compileFailures: []`.
- `localize-images` during import reports `missing 0`.
- `_quarto.yml` exists.
- `qmd/` exists.
- `quarto render --to pdf --output-dir _pdf` exits with code `0`.
- `_pdf/*.pdf` exists and has a current timestamp.

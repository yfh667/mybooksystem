# QmdTool Markdown Input Format

This file describes the Markdown format expected by QmdTool's Positron plugin.

The input folder should contain:

```text
your-folder/
  textbook.md
  image/
    fig-01.png
    fig-02.jpg
```

`images/` is also accepted, but `image/` is preferred.

## Basic Rule

Write one complete document in one `.md` file.

The plugin converts that `.md` file into a QmdTool/Quarto book structure. Do not write Quarto project files yourself. Do not create `_quarto.yml`, `qmd/`, `_book/`, or `_pdf/` manually in the input folder.

When cleaning or rewriting OCR/MinerU output, never overwrite the original Markdown file. Create a sibling fixed copy such as:

```text
paper_qmdtool_fixed.md
```

Read Markdown as UTF-8. On Windows, plain PowerShell output can display valid UTF-8 files as mojibake; use Node.js `fs.readFileSync(file, "utf8")` or PowerShell `Get-Content -Encoding utf8` when checking content.

## Required Structure

Use headings to express the document structure.

Recommended structure:

```markdown
# Book Title

## 1 Chapter Title

### 1.1 Section Title

#### 1.1.1 Subsection Title

## 2 Chapter Title

### 2.1 Section Title
```

The numeric labels are important. The plugin can correct heading levels more reliably when headings contain numbers such as:

```text
1
1.1
1.1.1
2
2.1
```

Good:

```markdown
## 2 Genetic Algorithm Operators

### 2.1 Selection

### 2.2 Crossover
```

Avoid:

```markdown
## Operators

### Selection
```

## Heading Rules

Use exactly one top-level title:

```markdown
# From Zero to Genetic Algorithms
```

Use `##` for chapters.

Use `###` for sections.

Use `####` for subsections.

Do not skip randomly between heading levels.

Do not use headings only for visual emphasis. If a line is not a real section title, use bold text instead:

```markdown
**Important note.**
```

For OCR/MinerU textbooks, recover heading hierarchy from the heading text rather than from MinerU's `#` count. MinerU may mark every heading as `#`, but the numbering is usually enough:

```markdown
# Book Title

## 第1章 绪论

### 1.1 什么是人工智能

#### 1.1.1 类人行为：图灵测试方法
```

If the source says `1.1什么是人工智能`, normalize it to `1.1 什么是人工智能`.

Remove generated table-of-contents blocks before conversion. OCR TOCs often repeat real chapter headings, for example a fake early `# 第1章 绪论` followed later by the real `# 第1章 绪论`. Keep the real body section and discard the TOC copy.

## Paragraphs

Use normal Markdown paragraphs.

Keep paragraphs separated by one blank line.

Good:

```markdown
Genetic algorithms search by maintaining a population of candidate solutions.

Each generation applies selection, crossover, and mutation.
```

Avoid putting many unrelated sentences into one extremely long paragraph.

## Images

Put all images in the input folder's `image/` directory.

Reference images with relative paths:

```markdown
![Fitness curve](image/fitness-curve.png)
```

Preferred image filenames:

```text
fig-01.png
fig-02-selection.png
chapter-02-flowchart.jpg
```

Avoid spaces in image filenames.

Avoid absolute paths:

```markdown
![Bad](C:\Users\...\image.png)
```

Avoid remote images:

```markdown
![Bad](https://example.com/image.png)
```

Avoid empty alt text from OCR:

```markdown
![](images/abc123.jpg)
```

Use at least a stable placeholder:

```markdown
![Image: abc123.jpg](images/abc123.jpg)
```

## Figure Captions

Write figure captions in the image alt text:

```markdown
![Figure 2.1: Fitness decreases over generations.](image/fitness.png)
```

For grouped subfigures, write the images consecutively and then write one figure caption below them:

```markdown
![(a) Initial population](image/fig-03a.png)
![(b) After selection](image/fig-03b.png)
![(c) After mutation](image/fig-03c.png)

Figure 3: Evolution of the population during one generation.
```

## Tables

Use standard Markdown tables.

Good:

```markdown
| City | x | y |
|------|---|---|
| A    | 0 | 0 |
| B    | 1 | 5 |
| C    | 2 | 2 |
```

Keep every row with the same number of columns.

Do not use OCR-style broken tables, such as many separate lines that only visually look like a table.

## Math

Use `$...$` for inline math:

```markdown
The mutation rate is $p_m = 0.1$.
```

Use `$$...$$` for display math:

```markdown
$$
f(x) = \frac{1}{d(x) + 10^{-9}}
$$
```

Keep display formulas on their own lines.

Avoid mixing Chinese punctuation inside LaTeX commands.

Good:

```markdown
$$
P(i) = \frac{f_i}{\sum_j f_j}
$$
```

Avoid:

```markdown
$$ P（i）= \frac{f_i}{\sum_j f_j} $$
```

### OCR-Damaged Array Formulas

Do not use `array` just to write a simple one-line equation.

Bad:

```markdown
$\begin{array} { r c l } { f _ { B } ( n ) } & { = } & { g _ { B } ( n ) } & { + } \end{array}$ $h _ { B } ( n )$
```

Why this is bad: `{r c l}` declares three aligned columns, but the formula contains four alignment cells:

```text
f_B(n) & = & g_B(n) & +
```

XeLaTeX will fail with:

```text
Extra alignment tab has been changed to \cr.
```

Good:

```markdown
$f _ { B } ( n ) = g _ { B } ( n ) + h _ { B } ( n )$
```

For multi-line aligned equations, use a valid display equation and keep the number of `&` markers consistent on every line:

```markdown
$$
\begin{aligned}
f_B(n) &= g_B(n) + h_B(n) \\
f_F(n) &= g_F(n) + h_F(n)
\end{aligned}
$$
```

When cleaning MinerU/OCR output, search for suspicious inline patterns such as:

```text
\begin{array} { r c l }
\begin{array}{rcl}
```

If they are only representing one ordinary equation, replace them with a normal `$...$` inline formula.

### OCR-Damaged Math Commands

OCR may invent LaTeX commands that do not exist. These often render in HTML loosely but fail in PDF.

Bad:

```markdown
$\mathrm { U } \uparrows \mathrm { u } \mathsf { i } \mathsf { i } \mathsf { \gamma } ( l o s s , p ) \leqslant \mathrm { E } \mathsf { v } \mathsf { A } ( s , p ) \leqslant \mathrm { U } \uparrows \mathsf { l } \updownarrow \mathsf { T } ( w i n , p )$
```

Why this is bad: `\uparrows` is not a standard LaTeX command. XeLaTeX will fail with:

```text
Undefined control sequence.
```

Good:

```markdown
$\mathrm{UTILITY}(loss,p) \leqslant \mathrm{EVAL}(s,p) \leqslant \mathrm{UTILITY}(win,p)$
```

When cleaning OCR output, search for suspicious commands and fragments such as:

```text
\uparrows
\mathrm { U } \uparrow
\updownarrow
```

If the original intent is obvious, rewrite the formula into simple valid LaTeX. If the intent is not obvious, replace the damaged math with plain text or mark it for human review rather than keeping invalid commands.

### OCR-Garbage Math Blocks

Sometimes OCR creates a whole line of meaningless LaTeX from a diagram, cover texture, or decorative symbols. Do not keep these blocks just because they are syntactically wrapped in `$...$`.

Bad:

```markdown
$\begin{array} { r l } & { \mathbb { E } \backslash \uparrow ] \stackrel { \prod } { \sim } \mathbb { H } _ { \sf E } ^ { \sf E } \not \equiv \mathbb { E } \backslash \mathbb { H } _ { \sf H } ^ { \sf E } \not \mathbb { H } _ { \sf X } ^ { \sf E } ... } \end{array}$
```

Why this is bad: it is not meaningful math, and it can break XeLaTeX with errors such as:

```text
Missing { inserted.
Undefined control sequence.
```

Good:

```markdown
[Removed OCR-damaged formula block.]
```

or delete the line entirely if it clearly came from OCR noise and carries no readable content.

## MinerU/OCR Cleanup Checklist

Use this checklist before giving Markdown to QmdTool:

1. Keep the original `.md` untouched; write a fixed copy.
2. Confirm the file is read as UTF-8.
3. Remove OCR-generated TOC pages or TOC sections.
4. Normalize heading levels from numeric text such as `第1章`, `1.1`, and `1.1.1`.
5. Normalize headings without spaces, such as `1.1什么是人工智能`, to `1.1 什么是人工智能`.
6. Strip OCR annotation blocks such as `<details><summary>...</summary>...</details>`.
7. Replace empty image alt text with a placeholder.
8. Verify every referenced `image/...` or `images/...` file exists.
9. Search for suspicious inline `array` formulas and replace one-line equations with normal inline math.
10. Search for OCR-invented LaTeX commands such as `\uparrows`; replace them with valid formulas or plain text.
11. Remove or mark whole-line OCR-garbage math blocks that are not meaningful formulas.

## Algorithms

Use a simple Markdown algorithm block. The plugin will later format algorithms into a more IEEE-like style.

Recommended:

```markdown
Algorithm 1: Genetic Algorithm

Input:
- Population size N
- Maximum generations T
- Mutation probability p_m

Output:
- Best solution x*

Steps:
1. Initialize a population P.
2. Evaluate every individual in P.
3. Select parents according to fitness.
4. Apply crossover and mutation.
5. Replace the old population.
6. Repeat until T generations are reached.
7. Return the best solution.
```

Avoid putting algorithms into screenshots unless the original source only provides an image.

## References

If references are needed, put them at the end under a clear heading:

```markdown
## References

[1] Author, "Title," Journal, Year.
[2] Author, "Title," Conference, Year.
```

For simple textbooks, references can be omitted.

## Things To Avoid

Do not include HTML layout code.

Do not include Quarto front matter.

Do not include `_quarto.yml`.

Do not manually create `qmd/`.

Do not use absolute image paths.

Do not use broken OCR table fragments.

Do not use random heading levels just for font size.

Do not put multiple books or papers into one `.md` file.

## Batch LaTeX Simulation Check

Before giving a Markdown file to QmdTool, later AI agents must validate formulas with real XeLaTeX compilation. Do not keep a suspicious OCR formula because it "looks close enough".

QmdTool's importer treats source Markdown math as TeX math bodies wrapped by Markdown delimiters. It normalizes only the wrapper:

- `\(...\)` becomes `$...$`
- `\[...\]` becomes `$$...$$`
- `$ ... $` whitespace is tightened so Pandoc recognizes inline math
- HTML tables are converted to Markdown pipe tables

Therefore, formula validation must extract the math body and compile it as TeX. Do not judge formulas by plain Markdown display, and do not rely on model intuition alone.

Use this workflow:

1. Keep the original file unchanged.
2. Create a sibling copy named `*_qmdtool_fixed.md`.
3. Extract all formula blocks from the copy:
   - inline math: `$...$`
   - display math: `$$...$$`, `\[...\]`
   - raw LaTeX environments inside math: `\begin{...}...\end{...}`
4. Compile every extracted formula body in a minimal XeLaTeX document.
5. If a batch fails, split the batch until the exact source line is found.
6. Fix the source line, then compile the snippet again.
7. Check Markdown tables separately for column consistency and raw HTML table leftovers.
8. Only after all formulas pass, run the full QmdTool/Quarto PDF render.

The QmdTool helper command is:

```powershell
node "C:\Users\Administrator\Desktop\qmdtool\mybooksystem\tool\latex-risk-scan.js" "PATH\TO\file_or_qmd_dir" --fix --compile --report "PATH\TO\latex-risk-report.json"
```

Common XeLaTeX errors and required fixes:

| Error | Common MinerU/OCR cause | Required fix |
|---|---|---|
| `Undefined control sequence` | Fake commands such as `\uparrows`, or unsupported OCR noise such as random `\mathscr` blocks | Replace with the intended legal formula if obvious; otherwise replace the whole math block with `[Removed OCR-damaged formula block.]` |
| `Extra alignment tab has been changed to \cr` | OCR converted one-line formulas into `array` with too many `&` cells | Rewrite as normal math, e.g. `$f_B(n)=g_B(n)+h_B(n)$`; do not leave broken `array` |
| `Argument of \qopname has an extra }` | Garbage like `\operatorname \operatorname { ~ }` or many repeated `\operatorname { ~ }` | Replace with the intended symbol if context is clear, e.g. `$\operatorname{erf}$`; otherwise remove the math block |
| `Missing { inserted` or `Missing } inserted` | Unbalanced OCR braces inside math | Rebuild the formula manually or remove it if the meaning is unrecoverable |
| `Missing $ inserted` | Broken Markdown delimiter, such as `$\operatorname{erf}$$`, or text accidentally captured inside display math | Fix the `$...$` / `$$...$$` boundaries before changing formula content |
| blank error / XeLaTeX timeout | Bad accent or font command nesting, e.g. `\mathbf{\dot{\omega}}`, `\operatorname{\hat{\rho}}` | Rewrite as simple valid TeX such as `\omega_i`, `\hat{\rho}(x)`, `\dot{\alpha}_1` |
| PDF compiles but formula is meaningless OCR noise | Long blocks full of `\sharp`, `\sqcup`, `\mathbb`, `\jmath`, `\operatorname { ~ }` | Remove or replace with a short plain-text note |

Known repair examples:

```markdown
Bad:
$\begin{array} { r c l } { f _ { B } ( n ) } & { = } & { g _ { B } ( n ) } & { + } \end{array}$ $h _ { B } ( n )$

Good:
$f_B(n)=g_B(n)+h_B(n)$
```

```markdown
Bad:
$\mathrm { U } \uparrows ... \updownarrow ...$

Good:
$\mathrm{UTILITY}(loss,p) \le EVAL(s,p) \le \mathrm{UTILITY}(win,p)$
```

```markdown
Bad:
$\operatorname { \Pi } ... \operatorname \operatorname { ~ } ...$

Good if context says this is the error function:
$\operatorname{erf}$

Otherwise:
[Removed OCR-damaged formula block.]
```

More OCR command repairs seen in real MinerU textbook input:

```markdown
Bad:
$Q ^ { \dprime }$
$| p \rrangle$
$\mathbfcal { P }$
$\overrightharpoon { p }$
$\mathbf { \mathscr { W } } ^ { ( i - 1 ) } = \pmb { \mathscr { 0 } }$

Good:
$Q'$
$|p\rangle$
$\mathcal { P }$
$p$
$\pmb { W } ^ { ( i - 1 ) } = \pmb { 0 }$
```

Markdown delimiter repairs:

```markdown
Bad:
其中 $\operatorname{erf}$$ 即所谓的误差函数。

Good:
其中 $\operatorname{erf}$ 即所谓的误差函数。
```

Tables are not formula-compiled. For tables, the source Markdown must use pipe tables with the same number of cells in every row. Raw `<table>...</table>` should be converted by the importer; if a table still breaks PDF, simplify it to a standard pipe table or plain text.

PowerShell/encoding note:

Windows PowerShell output may display UTF-8 Markdown as garbled text. Do not conclude the file is corrupted from terminal display alone. Read and write with Node.js UTF-8 APIs, or use `Get-Content -Encoding UTF8`.

## Minimal Example

```markdown
# From Zero to Genetic Algorithms

## 1 Intuition

### 1.1 What Is Optimization?

Optimization means searching for the best solution under a given objective.

$$
x^* = \arg\min_x f(x)
$$

![Figure 1.1: A simple optimization landscape.](image/landscape.png)

### 1.2 Why Evolution?

Genetic algorithms imitate selection, crossover, and mutation.

## 2 Basic Genetic Algorithm

### 2.1 Population

A population is a set of candidate solutions.

| Individual | Fitness |
|------------|---------|
| A          | 0.81    |
| B          | 0.74    |

Algorithm 1: Basic Genetic Algorithm

Input:
- Population size N
- Maximum generations T

Output:
- Best individual

Steps:
1. Initialize population.
2. Evaluate fitness.
3. Select parents.
4. Apply crossover and mutation.
5. Repeat until termination.

## References

[1] J. Holland, Adaptation in Natural and Artificial Systems, 1975.
```

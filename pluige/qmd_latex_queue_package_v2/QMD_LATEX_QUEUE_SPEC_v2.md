# QmdTool / MinerU Markdown LaTeX Queue Checking Specification

## Goal

Validate and repair MinerU-generated Markdown before it enters QmdTool/Quarto PDF rendering.

The acceptance criterion is not whether an AI thinks a formula looks correct. The acceptance criterion is whether the extracted Markdown formula/table can pass a real LaTeX compilation path.

## Rendering path inferred from the uploaded QmdTool plugin

The plugin does not render math itself. Its path is:

1. `convert-mineru.js` converts the input Markdown folder into a QmdTool/Quarto project.
2. Pre-render tools run: `format-algorithms.js`, `gen-includes.js`, and `localize-images.js`.
3. HTML is rendered by `quarto render --to html`.
4. PDF is rendered by `quarto render --to pdf --output-dir _pdf`.

Therefore, the checker should not modify the plugin. It should clean and validate the source Markdown before the plugin conversion/render phase.

## Input format to enforce

- Keep the original Markdown unchanged.
- Create a sibling fixed copy, such as `pdf040_qmdtool_fixed.md`.
- Use `$...$` for inline math.
- Use `$$...$$` for display math.
- Use standard Markdown tables with consistent columns.
- Avoid raw broken OCR table fragments.
- Remove or mark OCR-garbage formulas that are not meaningful.

## Queue strategy

Extract all items that can break the final PDF:

- inline math: `$...$`
- display math: `$$...$$`, `\[...\]`
- raw LaTeX environments: `\begin{...}...\end{...}` when not already inside a math item
- Markdown pipe tables
- HTML tables
- headings containing TeX commands

Then process them as a queue:

1. Pop an item from the queue.
2. Compile it.
3. If it passes, mark it as `ok`.
4. If it fails, write a failure report and a Codex repair prompt.
5. Codex repairs only the original source lines related to that item.
6. Re-run the checker on that line range.
7. Repeat until all items pass or the item is marked for manual review.

## Recommended commands

Extract only:

```powershell
node qmd_latex_queue_check.js "D:\book\pdf040.md" `
  --report "D:\book\pdf040.extract_report.json"
```

Compile all extracted formulas/tables:

```powershell
node qmd_latex_queue_check.js "D:\book\pdf040_qmdtool_fixed.md" `
  --compile `
  --workers 4 `
  --timeout 30000 `
  --report "D:\book\pdf040.latex_queue_report.json" `
  --failed-md "D:\book\pdf040.latex_failures.md"
```

Check a specific failure range after Codex repair:

```powershell
node qmd_latex_queue_check.js "D:\book\pdf040_qmdtool_fixed.md" `
  --compile `
  --workers 4 `
  --from-line 7326 `
  --to-line 7326 `
  --report "D:\book\range_7326_report.json"
```

## Codex repair prompt template

```text
你是一个 MinerU/QmdTool Markdown 修复 agent。

目标：修复源文件中的一个 LaTeX/Markdown 片段，使它能通过 Pandoc -> XeLaTeX 编译。

严格规则：
1. 不要重写全书，只修复报告中给出的源文件行号附近内容。
2. 不要凭空改写正文含义。
3. 如果是 OCR 乱码公式且无法从上下文恢复，替换为 [Removed OCR-damaged formula block.] 并保留上下文。
4. 优先把 OCR 生成的一行 array 改成普通 $...$ 或 $$...$$。
5. 修改后重新运行 qmd_latex_queue_check.js 的相同行号范围。
```

## Known failure patterns in pdf040.md

Examples found by the checker:

1. Line 7326: inline `array` has too many alignment cells and fails with `Extra alignment tab`.
2. Line 9324: OCR invented `\uparrows`, which fails with `Undefined control sequence`.
3. Line 33188: long OCR garbage formula containing repeated `\operatorname` fails with `Argument of \qopname has an extra }`.

## Recommended full workflow

1. Copy `pdf040.md` to `pdf040_qmdtool_fixed.md`.
2. Run the queue checker.
3. Use the generated failure prompts in `.latex_check_work/codex_prompts/` to drive Codex repairs.
4. Re-run the checker on failed line ranges.
5. When the queue is clean, run QmdTool Convert & Preview.
6. Finally run full Quarto PDF rendering.


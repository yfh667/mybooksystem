# PDF Mineru Batch

Code lives in `mybooksystem`. PDF data and MinerU outputs live outside the project.

## Paths

Code folder:

```powershell
C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
```

Default data folder:

```powershell
C:\Users\Administrator\Desktop\mineru_pdf_data
```

MinerU Python:

```powershell
C:\ProgramData\miniconda3\envs\mineru\python.exe
```

## Recommended Flow

Step 1: collect PDFs and rename them to `pdf001.pdf`, `pdf002.pdf`, ...

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\collect_pdfs.py --source "C:\Users\Administrator\Desktop\日常文献" --output "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs"
```

Step 2: run MinerU. Output folders are also named `pdf001`, `pdf002`, ...

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\batch_mineru.py --input "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs" --output "C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_output" --api-url "http://192.168.31.251:8000"
```

The mapping from original paper names to `pdf001.pdf` is saved here:

```powershell
C:\Users\Administrator\Desktop\mineru_pdf_data\manifest.csv
```

The MinerU batch report is saved here:

```powershell
C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_batch_report.csv
```

## run_pipeline_direct.py

Purpose: one-click workflow. It first copies and renames PDFs to `pdf001.pdf`, `pdf002.pdf`, ..., then runs MinerU and writes outputs to `pdf001`, `pdf002`, ...

This version uses the remote MinerU API configured in the file.

Open this file in VSCode and click Run:

```powershell
C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch\run_pipeline_direct.py
```

Default example:

```python
SOURCE_PDF_DIR = Path(r"C:\Users\Administrator\Desktop\c3")
RENAMED_PDF_DIR = Path(r"C:\Users\Administrator\Desktop\c3\renamed_pdfs")
MINERU_OUTPUT_DIR = Path(r"C:\Users\Administrator\Desktop\c3\output")
NAME_PREFIX = "pdf"
```

Direct Python command example:

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\run_pipeline_direct.py
```

## run_pipeline_local_direct.py

Purpose: one-click local workflow. It directly reads PDFs from the input folder and runs local MinerU without `--api-url`.

It does not sort PDFs. It uses the filesystem traversal order. It does not copy or rename PDFs.

Open this file in VSCode and click Run:

```powershell
C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch\run_pipeline_local_direct.py
```

Default example:

```python
INPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mainpaper\renamed_pdfs")
OUTPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mainpaper\output")
```

Generated files under `OUTPUT_FOLDER`:

```text
pdf0035
pdf0036
mineru_batch_report.csv
```

Direct Python command example:

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\run_pipeline_local_direct.py
```

## run_pipeline_local_auto_split.py

Purpose: local workflow with automatic splitting for large PDFs.

It checks page count before running MinerU:

```text
page_count <= MAX_LENGTH
  run MinerU once

page_count > MAX_LENGTH
  run MinerU by page ranges
  merge split Markdown and images with bigfile.merge_parts()
```

Open this file in VSCode and edit:

```python
INPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mainpaper\renamed_pdfs")
OUTPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mainpaper\output")
MAX_LENGTH = 100
```

Direct Python command example:

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\run_pipeline_local_auto_split.py
```

Split part outputs are stored under:

```text
OUTPUT_FOLDER\_parts\<pdf-name>\<pdf-name>_p001
OUTPUT_FOLDER\_parts\<pdf-name>\<pdf-name>_p002
```

Merged final output is stored under:

```text
OUTPUT_FOLDER\<pdf-name>
```

## collect_pdfs.py

Purpose: recursively scan a folder, copy every PDF into one external data folder, rename copied PDFs to `pdf001.pdf`, `pdf002.pdf`, ..., and write a CSV manifest.

Direct Python command example:

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\collect_pdfs.py --source "C:\Users\Administrator\Desktop\日常文献" --output "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs"
```

Keep original names example:

```powershell
C:\ProgramData\miniconda3\envs\mineru\python.exe .\collect_pdfs.py --keep-original-names
```

## batch_mineru.py

Purpose: process every PDF in a folder with the remote MinerU API.

The command format for each PDF is:

```powershell
mineru -p <pdf-path> -o <output-folder> --api-url http://192.168.31.251:8000
```

By default, output folders are named `pdf001`, `pdf002`, ... instead of using the original paper titles.

Direct Python command example:

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\batch_mineru.py --input "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs" --output "C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_output" --api-url "http://192.168.31.251:8000"
```

Dry-run example:

```powershell
C:\ProgramData\miniconda3\envs\mineru\python.exe .\batch_mineru.py --input "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs" --dry-run
```

If the output folder is inside the input folder, for example `C:\Users\Administrator\Desktop\c3\output`, the script automatically excludes that output folder during recursive PDF scanning.

## run_mineru_direct.py

Purpose: open this Python file in Anaconda or VSCode, edit the CONFIG section at the top, then click Run.

Open this file:

```powershell
C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch\run_mineru_direct.py
```

Default configuration:

```python
PDF_INPUT_DIR = Path("C:\\Users\\Administrator\\Desktop\\日常文献")
MINERU_OUTPUT_DIR = Path(r"C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_output")
API_URL = "http://192.168.31.251:8000"
DRY_RUN = False
KEEP_ORIGINAL_OUTPUT_NAMES = False
NAME_PREFIX = "pdf"
```

Direct Python command example:

```powershell
cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
C:\ProgramData\miniconda3\envs\mineru\python.exe .\run_mineru_direct.py
```

r"""Direct-run script for batch MinerU PDF recognition.

Usage:
  1. Open Anaconda Prompt or an IDE that uses Anaconda Python.
  2. Open this file:
     C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch\run_mineru_direct.py
  3. Edit the CONFIG section below if needed.
  4. Click Run, or run:
     C:\ProgramData\miniconda3\python.exe .\run_mineru_direct.py
"""

from __future__ import annotations

import sys
from pathlib import Path


# =========================
# CONFIG: edit these values
# =========================

# Folder that contains PDFs. The script scans it recursively by default.
PDF_INPUT_DIR = Path("C:\\Users\\Administrator\\Desktop\\\u65e5\u5e38\u6587\u732e")

# MinerU output root folder. Keep it outside mybooksystem.
MINERU_OUTPUT_DIR = Path(r"C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_output")

# CSV report path. It records every PDF, output folder, command, and status.
REPORT_PATH = Path(r"C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_batch_report.csv")

# Remote MinerU API.
API_URL = "http://192.168.31.251:8000"

# If True, scan subfolders under PDF_INPUT_DIR.
RECURSIVE = True

# If True, skip a PDF when its output folder already contains files.
SKIP_EXISTING = True

# If True, only print commands and write a report; MinerU will not run.
DRY_RUN = False

# If False, long PDF names are shortened for output folders to avoid Windows path issues.
KEEP_ORIGINAL_OUTPUT_NAMES = False

# Output folders are named pdf001, pdf002, ... by default.
NAME_PREFIX = "pdf"

# MinerU command:
# - "auto": use mineru.exe from the current Anaconda environment when available.
# - "mineru": use the active environment's mineru command directly
# - full command string is also supported
MINERU_COMMAND = "auto"


THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from batch_mineru import find_pdfs, resolve_mineru_bin, run_one_pdf, write_report  # noqa: E402


def main() -> None:
    input_dir = PDF_INPUT_DIR.resolve()
    output_root = MINERU_OUTPUT_DIR.resolve()
    report_path = REPORT_PATH.resolve()
    mineru_command = resolve_mineru_bin() if MINERU_COMMAND == "auto" else MINERU_COMMAND

    if not input_dir.exists():
        raise FileNotFoundError(f"PDF_INPUT_DIR does not exist: {input_dir}")
    if not input_dir.is_dir():
        raise NotADirectoryError(f"PDF_INPUT_DIR is not a folder: {input_dir}")

    pdf_paths = find_pdfs(input_dir, RECURSIVE, exclude_dir=output_root)
    print("=" * 80)
    print("MinerU batch recognition")
    print("=" * 80)
    print(f"Input folder : {input_dir}")
    print(f"Output folder: {output_root}")
    print(f"Report       : {report_path}")
    print(f"API URL      : {API_URL}")
    print(f"MinerU cmd   : {mineru_command}")
    print(f"PDF count    : {len(pdf_paths)}")
    print(f"Dry run      : {DRY_RUN}")
    print("=" * 80)

    results = []
    for index, pdf_path in enumerate(pdf_paths, start=1):
        print(f"[{index}/{len(pdf_paths)}] {pdf_path}")
        result = run_one_pdf(
            index=index,
            input_dir=input_dir,
            output_root=output_root,
            pdf_path=pdf_path,
            mineru_bin=mineru_command,
            api_url=API_URL,
            skip_existing=SKIP_EXISTING,
            dry_run=DRY_RUN,
            keep_original_output_names=KEEP_ORIGINAL_OUTPUT_NAMES,
            total_count=len(pdf_paths),
            name_prefix=NAME_PREFIX,
        )
        print(f"  status : {result.status}")
        print(f"  output : {result.output_dir}")
        if result.error:
            print(f"  error  : {result.error[:500]}")
        results.append(result)

    write_report(report_path, results)

    status_counts: dict[str, int] = {}
    for result in results:
        status_counts[result.status] = status_counts.get(result.status, 0) + 1

    print("=" * 80)
    print(f"Done. Summary: {status_counts}")
    print(f"Report: {report_path}")
    print("=" * 80)


if __name__ == "__main__":
    main()

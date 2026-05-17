r"""One-click pipeline: rename PDFs to pdf001.pdf, then run MinerU.

Usage:
  1. Open this file in VSCode or Anaconda.
  2. Edit the CONFIG section below.
  3. Click Run, or run:
     C:\ProgramData\miniconda3\envs\mineru\python.exe .\run_pipeline_direct.py
"""

from __future__ import annotations

import sys
from pathlib import Path


# =========================
# CONFIG: edit these values
# =========================

# Original PDF folder. It will not be modified.
SOURCE_PDF_DIR = Path(r"C:\Users\Administrator\Desktop\mainpaper")

# Renamed PDF working folder. PDFs are copied here as pdf001.pdf, pdf002.pdf, ...
RENAMED_PDF_DIR = Path(r"C:\Users\Administrator\Desktop\mainpaper\renamed_pdfs")

# MinerU output root. Output folders are pdf001, pdf002, ...
MINERU_OUTPUT_DIR = Path(r"C:\Users\Administrator\Desktop\mainpaper\output")

# CSV files for traceability.
MANIFEST_PATH = Path(r"C:\Users\Administrator\Desktop\c4\manifest.csv")
REPORT_PATH = Path(r"C:\Users\Administrator\Desktop\c4\mineru_batch_report.csv")

# Remote MinerU API.
API_URL = "http://192.168.31.251:8000"

# If True, skip files whose output folder already contains files.
SKIP_EXISTING = True

# If True, only print MinerU commands and write reports; MinerU will not run.
DRY_RUN = False

# Prefix for renamed PDFs and output folders.
NAME_PREFIX = "pdf"


THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from batch_mineru import find_pdfs, resolve_mineru_bin, run_one_pdf, write_report  # noqa: E402
from collect_pdfs import collect_pdfs  # noqa: E402


def main() -> None:
    print("=" * 80)
    print("Step 1: collect and rename PDFs")
    print("=" * 80)
    count = collect_pdfs(
        source_dir=SOURCE_PDF_DIR,
        output_dir=RENAMED_PDF_DIR,
        manifest_path=MANIFEST_PATH,
        name_prefix=NAME_PREFIX,
        keep_original_names=False,
        exclude_dirs=[RENAMED_PDF_DIR, MINERU_OUTPUT_DIR],
    )
    print(f"Renamed PDF count: {count}")
    print(f"Renamed PDF folder: {RENAMED_PDF_DIR.resolve()}")
    print(f"Manifest: {MANIFEST_PATH.resolve()}")

    input_dir = RENAMED_PDF_DIR.resolve()
    output_root = MINERU_OUTPUT_DIR.resolve()
    report_path = REPORT_PATH.resolve()
    mineru_bin = resolve_mineru_bin()
    pdf_paths = find_pdfs(input_dir, recursive=False, exclude_dir=output_root)

    print("=" * 80)
    print("Step 2: run MinerU")
    print("=" * 80)
    print(f"Input folder : {input_dir}")
    print(f"Output folder: {output_root}")
    print(f"Report       : {report_path}")
    print(f"MinerU cmd   : {mineru_bin}")
    print(f"PDF count    : {len(pdf_paths)}")

    results = []
    for index, pdf_path in enumerate(pdf_paths, start=1):
        print(f"[{index}/{len(pdf_paths)}] {pdf_path.name}")
        result = run_one_pdf(
            index=index,
            input_dir=input_dir,
            output_root=output_root,
            pdf_path=pdf_path,
            mineru_bin=mineru_bin,
            api_url=API_URL,
            skip_existing=SKIP_EXISTING,
            dry_run=DRY_RUN,
            keep_original_output_names=False,
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

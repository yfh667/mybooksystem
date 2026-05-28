r"""Local MinerU batch conversion with automatic page-range splitting.

Usage:
  1. Open this file in VSCode or Anaconda.
  2. Edit INPUT_FOLDER, OUTPUT_FOLDER, and MAX_LENGTH in the CONFIG section.
  3. Click Run, or run:
     C:\ProgramData\miniconda3\envs\mineru\python.exe .\run_pipeline_local_auto_split.py

Behavior:
  - Recursively reads PDFs from INPUT_FOLDER.
  - Checks each PDF page count before running MinerU.
  - If page_count <= MAX_LENGTH, runs local MinerU normally.
  - If page_count > MAX_LENGTH, runs local MinerU by page ranges and then
    calls bigfile.merge_parts() to merge Markdown and images into one folder.
"""

from __future__ import annotations

import csv
import contextlib
import io
import logging
import subprocess
import sys
import warnings
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


logging.getLogger("pypdf").setLevel(logging.ERROR)
logging.getLogger("pypdf._reader").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", module="pypdf")


# =========================
# CONFIG: edit these values
# =========================

INPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mineru_test")
OUTPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mineru_test\chuanoutput")

# Maximum pages for one MinerU run. Larger PDFs are processed in parts.
MAX_LENGTH = 300


# Internal defaults. Usually no need to edit.
RECURSIVE = True
SKIP_EXISTING = True
DRY_RUN = False


THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from batch_mineru import build_command, command_to_text, is_inside, resolve_mineru_bin  # noqa: E402
from bigfile import merge_parts  # noqa: E402


@dataclass(frozen=True)
class ConvertResult:
    index: int
    pdf_path: Path
    output_dir: Path
    page_count: int
    status: str
    detail: str


def get_pdf_page_count(pdf_path: Path) -> int:
    with contextlib.redirect_stderr(io.StringIO()):
        reader = PdfReader(str(pdf_path), strict=False)
    return len(reader.pages)


def iter_pdfs_no_sort(input_folder: Path, output_folder: Path) -> list[Path]:
    pattern = "**/*" if RECURSIVE else "*"
    pdf_paths: list[Path] = []
    for path in input_folder.glob(pattern):
        if not path.is_file() or path.suffix.lower() != ".pdf":
            continue
        if is_inside(path, output_folder):
            continue
        pdf_paths.append(path)
    return pdf_paths


def has_existing_output(output_dir: Path) -> bool:
    return output_dir.exists() and any(output_dir.iterdir())


def run_command(command: list[str], dry_run: bool) -> tuple[str, int | None, str]:
    command_text = command_to_text(command)
    if dry_run:
        return "dry_run", None, command_text

    try:
        completed = subprocess.run(command, capture_output=True, text=True)
    except FileNotFoundError as exc:
        return "failed", None, f"{command_text}\n{exc}"

    if completed.returncode == 0:
        return "success", completed.returncode, command_text

    error = (completed.stderr or completed.stdout or "").strip()
    return "failed", completed.returncode, f"{command_text}\n{error}"


def page_ranges(page_count: int, max_length: int) -> list[tuple[int, int]]:
    if max_length <= 0:
        raise ValueError("MAX_LENGTH must be greater than 0")

    ranges = []
    for start in range(0, page_count, max_length):
        end = min(start + max_length - 1, page_count - 1)
        ranges.append((start, end))
    return ranges


def convert_small_pdf(pdf_path: Path, output_folder: Path, mineru_bin: str) -> tuple[str, str]:
    output_dir = output_folder / pdf_path.stem
    if SKIP_EXISTING and has_existing_output(output_dir):
        return "skipped_existing", f"Existing output: {output_dir}"

    output_dir.mkdir(parents=True, exist_ok=True)
    command = build_command(mineru_bin, pdf_path, output_dir, api_url="")
    status, _return_code, detail = run_command(command, DRY_RUN)
    return status, detail


def convert_large_pdf(pdf_path: Path, output_folder: Path, mineru_bin: str, page_count: int) -> tuple[str, str]:
    final_output_dir = output_folder / pdf_path.stem
    if SKIP_EXISTING and has_existing_output(final_output_dir):
        return "skipped_existing", f"Existing output: {final_output_dir}"

    ranges = page_ranges(page_count, MAX_LENGTH)
    parts_root = output_folder / "_parts" / pdf_path.stem
    parts_root.mkdir(parents=True, exist_ok=True)

    part_dirs: list[Path] = []
    details: list[str] = []

    for part_index, (start, end) in enumerate(ranges, start=1):
        part_dir = parts_root / f"{pdf_path.stem}_p{part_index:03d}"
        part_dirs.append(part_dir)

        if SKIP_EXISTING and has_existing_output(part_dir):
            details.append(f"part {part_index}: skipped_existing {part_dir}")
            continue

        part_dir.mkdir(parents=True, exist_ok=True)
        command = build_command(
            mineru_bin,
            pdf_path,
            part_dir,
            api_url="",
            extra_args=["--start", str(start), "--end", str(end)],
        )
        status, _return_code, detail = run_command(command, DRY_RUN)
        details.append(f"part {part_index} pages {start}-{end}: {status}\n{detail}")
        if status == "failed":
            return "failed_split_part", "\n\n".join(details)

    if DRY_RUN:
        return "dry_run_split", "\n\n".join(details)

    merge_parts(part_dirs, output_folder, pdf_path.stem, clean=True)
    details.append(f"merged: {final_output_dir}")
    return "success_split_merged", "\n\n".join(details)


def convert_one_pdf(
    pdf_path: Path,
    output_folder: Path,
    index: int = 1,
    mineru_bin: str | None = None,
) -> ConvertResult:
    """Convert one PDF, auto-splitting and merging when it exceeds MAX_LENGTH."""
    if mineru_bin is None:
        mineru_bin = resolve_mineru_bin()

    page_count = get_pdf_page_count(pdf_path)
    output_dir = output_folder / pdf_path.stem

    if page_count <= MAX_LENGTH:
        status, detail = convert_small_pdf(pdf_path, output_folder, mineru_bin)
    else:
        print("the page is lage ,we need split it ")
        status, detail = convert_large_pdf(pdf_path, output_folder, mineru_bin, page_count)

    return ConvertResult(
        index=index,
        pdf_path=pdf_path,
        output_dir=output_dir,
        page_count=page_count,
        status=status,
        detail=detail,
    )


def write_report(report_path: Path, results: list[ConvertResult]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", newline="", encoding="utf-8-sig") as report_file:
        writer = csv.DictWriter(
            report_file,
            fieldnames=["index", "pdf_path", "output_dir", "page_count", "status", "detail"],
        )
        writer.writeheader()
        for result in results:
            writer.writerow(
                {
                    "index": result.index,
                    "pdf_path": str(result.pdf_path),
                    "output_dir": str(result.output_dir),
                    "page_count": result.page_count,
                    "status": result.status,
                    "detail": result.detail,
                }
            )


def main() -> None:
    input_folder = INPUT_FOLDER.resolve()
    output_folder = OUTPUT_FOLDER.resolve()
    report_path = output_folder / "mineru_auto_split_report.csv"

    if not input_folder.exists():
        raise FileNotFoundError(f"INPUT_FOLDER does not exist: {input_folder}")
    if not input_folder.is_dir():
        raise NotADirectoryError(f"INPUT_FOLDER is not a folder: {input_folder}")

    pdf_paths = iter_pdfs_no_sort(input_folder, output_folder)
    mineru_bin = resolve_mineru_bin()

    print("=" * 80)
    print("Local MinerU batch conversion with auto split")
    print("=" * 80)
    print(f"Input folder : {input_folder}")
    print(f"Output folder: {output_folder}")
    print(f"Report       : {report_path}")
    print(f"MinerU cmd   : {mineru_bin}")
    print(f"Max length   : {MAX_LENGTH} pages")
    print(f"PDF count    : {len(pdf_paths)}")

    results: list[ConvertResult] = []
    for index, pdf_path in enumerate(pdf_paths, start=1):
        print(f"[{index}/{len(pdf_paths)}] {pdf_path.name}")
        result = convert_one_pdf(pdf_path, output_folder, index=index, mineru_bin=mineru_bin)
        print(f"  pages : {result.page_count}")
        print(f"  status: {result.status}")
        print(f"  output: {result.output_dir}")
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

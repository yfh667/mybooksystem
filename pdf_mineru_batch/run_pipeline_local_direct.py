r"""One-click local MinerU batch conversion.

Usage:
  1. Open this file in VSCode or Anaconda.
  2. Edit INPUT_FOLDER and OUTPUT_FOLDER in the CONFIG section.
  3. Click Run, or run:
     C:\ProgramData\miniconda3\envs\mineru\python.exe .\run_pipeline_local_direct.py

Behavior:
  - Recursively reads PDFs from INPUT_FOLDER.
  - Does not sort PDFs; it uses the filesystem traversal order.
  - Does not rename or copy PDFs.
  - Runs local MinerU without --api-url.
  - Writes each PDF output to OUTPUT_FOLDER\<pdf-file-name-without-extension>.
"""

from __future__ import annotations

import csv
import sys
from dataclasses import dataclass
from pathlib import Path


# =========================
# CONFIG: edit these values
# =========================

# Folder containing PDFs, for example pdf0035.pdf, pdf0036.pdf, ...
INPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mainpaper\failed")

# Folder for MinerU outputs and reports.
OUTPUT_FOLDER = Path(r"C:\Users\Administrator\Desktop\mainpaper\output")


# Internal defaults. Usually no need to edit.
RECURSIVE = True
SKIP_EXISTING = True
DRY_RUN = False


THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from batch_mineru import build_command, command_to_text, is_inside, resolve_mineru_bin  # noqa: E402


@dataclass(frozen=True)
class LocalMineruResult:
    index: int
    pdf_path: Path
    output_dir: Path
    status: str
    return_code: int | None
    command: str
    error: str


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


def output_dir_for_pdf(output_folder: Path, pdf_path: Path) -> Path:
    return output_folder / pdf_path.stem


def run_local_mineru_one(
    index: int,
    pdf_path: Path,
    output_folder: Path,
    mineru_bin: str,
) -> LocalMineruResult:
    output_dir = output_dir_for_pdf(output_folder, pdf_path)
    command = build_command(mineru_bin, pdf_path, output_dir, api_url="")
    command_text = command_to_text(command)

    if SKIP_EXISTING and has_existing_output(output_dir):
        return LocalMineruResult(index, pdf_path, output_dir, "skipped_existing", None, command_text, "")

    if DRY_RUN:
        return LocalMineruResult(index, pdf_path, output_dir, "dry_run", None, command_text, "")

    output_dir.mkdir(parents=True, exist_ok=True)

    import subprocess

    try:
        completed = subprocess.run(command, capture_output=True, text=True)
    except FileNotFoundError as exc:
        return LocalMineruResult(index, pdf_path, output_dir, "failed", None, command_text, str(exc))

    if completed.returncode == 0:
        return LocalMineruResult(index, pdf_path, output_dir, "success", 0, command_text, "")

    error = (completed.stderr or completed.stdout or "").strip()
    return LocalMineruResult(index, pdf_path, output_dir, "failed", completed.returncode, command_text, error)


def write_local_report(report_path: Path, results: list[LocalMineruResult]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", newline="", encoding="utf-8-sig") as report_file:
        writer = csv.DictWriter(
            report_file,
            fieldnames=[
                "index",
                "pdf_path",
                "output_dir",
                "status",
                "return_code",
                "command",
                "error",
            ],
        )
        writer.writeheader()
        for result in results:
            writer.writerow(
                {
                    "index": result.index,
                    "pdf_path": str(result.pdf_path),
                    "output_dir": str(result.output_dir),
                    "status": result.status,
                    "return_code": result.return_code if result.return_code is not None else "",
                    "command": result.command,
                    "error": result.error,
                }
            )


def main() -> None:
    input_folder = INPUT_FOLDER.resolve()
    output_folder = OUTPUT_FOLDER.resolve()
    report_path = output_folder / "mineru_batch_report.csv"

    if not input_folder.exists():
        raise FileNotFoundError(f"INPUT_FOLDER does not exist: {input_folder}")
    if not input_folder.is_dir():
        raise NotADirectoryError(f"INPUT_FOLDER is not a folder: {input_folder}")

    pdf_paths = iter_pdfs_no_sort(input_folder, output_folder)
    mineru_bin = resolve_mineru_bin()

    print("=" * 80)
    print("Local MinerU batch conversion")
    print("=" * 80)
    print(f"Input folder : {input_folder}")
    print(f"Output folder: {output_folder}")
    print(f"Report       : {report_path}")
    print(f"MinerU cmd   : {mineru_bin}")
    print(f"PDF count    : {len(pdf_paths)}")
    print("API URL      : local mode, no --api-url")

    results = []
    for index, pdf_path in enumerate(pdf_paths, start=1):
        print(f"[{index}/{len(pdf_paths)}] {pdf_path.name}")
        result = run_local_mineru_one(index, pdf_path, output_folder, mineru_bin)
        print(f"  status : {result.status}")
        print(f"  output : {result.output_dir}")
        if result.error:
            print(f"  error  : {result.error[:500]}")
        results.append(result)

    write_local_report(report_path, results)

    status_counts: dict[str, int] = {}
    for result in results:
        status_counts[result.status] = status_counts.get(result.status, 0) + 1

    print("=" * 80)
    print(f"Done. Summary: {status_counts}")
    print(f"Report: {report_path}")
    print("=" * 80)


if __name__ == "__main__":
    main()

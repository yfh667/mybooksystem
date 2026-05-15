r"""Collect PDFs into one external data folder.

Usage:
  cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
  C:\ProgramData\miniconda3\python.exe .\collect_pdfs.py --source "C:\Users\Administrator\Desktop\日常文献" --output "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs"
"""

from __future__ import annotations

import argparse
import csv
import shutil
from pathlib import Path


DEFAULT_SOURCE_DIR = Path("C:\\Users\\Administrator\\Desktop\\\u65e5\u5e38\u6587\u732e")
DEFAULT_DATA_DIR = Path(r"C:\Users\Administrator\Desktop\mineru_pdf_data")
DEFAULT_OUTPUT_DIR = DEFAULT_DATA_DIR / "collected_pdfs"
DEFAULT_MANIFEST = DEFAULT_DATA_DIR / "manifest.csv"

EXAMPLE_COMMAND = (
    r"C:\ProgramData\miniconda3\python.exe collect_pdfs.py "
    "--source \"C:\\Users\\Administrator\\Desktop\\\u65e5\u5e38\u6587\u732e\" "
    r'--output "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs"'
)


def unique_target_path(output_dir: Path, file_name: str) -> Path:
    """Return a collision-free path inside output_dir."""
    target = output_dir / file_name
    if not target.exists():
        return target

    stem = target.stem
    suffix = target.suffix
    index = 2
    while True:
        candidate = output_dir / f"{stem}__{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def collect_pdfs(source_dir: Path, output_dir: Path, manifest_path: Path) -> int:
    source_dir = source_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")
    if not source_dir.is_dir():
        raise NotADirectoryError(f"Source path is not a directory: {source_dir}")

    pdf_paths = sorted(
        path for path in source_dir.rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"
    )

    with manifest_path.open("w", newline="", encoding="utf-8-sig") as manifest_file:
        writer = csv.DictWriter(
            manifest_file,
            fieldnames=["index", "source_path", "copied_path", "file_name"],
        )
        writer.writeheader()

        for index, source_pdf in enumerate(pdf_paths, start=1):
            target_pdf = unique_target_path(output_dir, source_pdf.name)
            shutil.copy2(source_pdf, target_pdf)
            writer.writerow(
                {
                    "index": index,
                    "source_path": str(source_pdf),
                    "copied_path": str(target_pdf),
                    "file_name": source_pdf.name,
                }
            )

    return len(pdf_paths)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recursively collect PDF files into one data folder for later mineru processing.",
        epilog=f"Example:\n  {EXAMPLE_COMMAND}",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE_DIR,
        help=f"Folder to scan recursively. Default: {DEFAULT_SOURCE_DIR}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Folder where copied PDFs are stored. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help=f"CSV file recording source-to-copy mapping. Default: {DEFAULT_MANIFEST}",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    count = collect_pdfs(args.source, args.output, args.manifest)
    print(f"Collected {count} PDF file(s).")
    print(f"Output folder: {args.output.resolve()}")
    print(f"Manifest: {args.manifest.resolve()}")
    print("Example command:")
    print(f"  {EXAMPLE_COMMAND}")


if __name__ == "__main__":
    main()

r"""Run remote mineru recognition for every PDF in a folder.

Usage:
  cd C:\Users\Administrator\Desktop\qmdtool\mybooksystem\pdf_mineru_batch
  C:\ProgramData\miniconda3\python.exe .\batch_mineru.py --input "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs" --output "C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_output" --api-url "http://192.168.31.251:8000"

Dry-run example:
  C:\ProgramData\miniconda3\python.exe .\batch_mineru.py --input "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs" --dry-run
"""

from __future__ import annotations

import argparse
import csv
import os
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


# C:\Users\Administrator\Desktop\c2


DEFAULT_INPUT_DIR = Path(r"C:\Users\Administrator\Desktop\c3")
DEFAULT_OUTPUT_DIR = Path(r"C:\Users\Administrator\Desktop\c3\output")
DEFAULT_REPORT = Path(r"C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_batch_report.csv")
DEFAULT_API_URL = "http://192.168.31.251:8000"
DEFAULT_MINERU_ENV_EXE = Path(r"C:\ProgramData\miniconda3\envs\mineru\Scripts\mineru.exe")
DEFAULT_NAME_PREFIX = "pdf"

EXAMPLE_COMMAND = (
    r"C:\ProgramData\miniconda3\python.exe batch_mineru.py "
    r'--input "C:\Users\Administrator\Desktop\mineru_pdf_data\collected_pdfs" '
    r'--output "C:\Users\Administrator\Desktop\mineru_pdf_data\mineru_output" '
    r'--api-url "http://192.168.31.251:8000"'
)


@dataclass(frozen=True)
class MineruResult:
    index: int
    pdf_path: Path
    output_dir: Path
    status: str
    return_code: int | None
    command: str
    error: str


def is_inside(path: Path, folder: Path) -> bool:
    try:
        path.resolve().relative_to(folder.resolve())
        return True
    except ValueError:
        return False


def find_pdfs(input_dir: Path, recursive: bool, exclude_dir: Path | None = None) -> list[Path]:
    pattern = "**/*" if recursive else "*"
    return sorted(
        path
        for path in input_dir.glob(pattern)
        if path.is_file() and path.suffix.lower() == ".pdf"
        and (exclude_dir is None or not is_inside(path, exclude_dir))
    )


def sequential_output_name(index: int, total_count: int, prefix: str) -> str:
    width = max(3, len(str(total_count)))
    return f"{prefix}{index:0{width}d}"


def output_dir_for_pdf(
    input_dir: Path,
    output_root: Path,
    pdf_path: Path,
    index: int,
    total_count: int,
    name_prefix: str,
    keep_original_output_names: bool = False,
) -> Path:
    relative_pdf = pdf_path.relative_to(input_dir)
    if keep_original_output_names:
        return output_root / relative_pdf.with_suffix("")
    return output_root / sequential_output_name(index, total_count, name_prefix)


def has_existing_output(output_dir: Path) -> bool:
    return output_dir.exists() and any(output_dir.iterdir())


def build_command(
    mineru_bin: str,
    pdf_path: Path,
    output_dir: Path,
    api_url: str,
    extra_args: list[str] | None = None,
) -> list[str]:
    if mineru_bin == "auto":
        mineru_bin = resolve_mineru_bin()
    command_prefix = shlex.split(mineru_bin, posix=os.name != "nt")
    command = [
        *command_prefix,
        "-p",
        str(pdf_path),
        "-o",
        str(output_dir),
    ]
    if api_url:
        command.extend(["--api-url", api_url])
    if extra_args:
        command.extend(extra_args)
    return command


def command_to_text(command: list[str]) -> str:
    return " ".join(f'"{part}"' if " " in part else part for part in command)


def resolve_mineru_bin() -> str:
    current_env_mineru = Path(sys.executable).resolve().parent / "Scripts" / "mineru.exe"
    if current_env_mineru.exists():
        return str(current_env_mineru)

    path_mineru = shutil.which("mineru")
    if path_mineru:
        return path_mineru

    if DEFAULT_MINERU_ENV_EXE.exists():
        return str(DEFAULT_MINERU_ENV_EXE)

    return "mineru"


def run_one_pdf(
    index: int,
    input_dir: Path,
    output_root: Path,
    pdf_path: Path,
    mineru_bin: str,
    api_url: str,
    skip_existing: bool,
    dry_run: bool,
    keep_original_output_names: bool,
    total_count: int,
    name_prefix: str,
) -> MineruResult:
    output_dir = output_dir_for_pdf(
        input_dir,
        output_root,
        pdf_path,
        index,
        total_count,
        name_prefix,
        keep_original_output_names,
    )
    command = build_command(mineru_bin, pdf_path, output_dir, api_url)
    command_text = command_to_text(command)

    if skip_existing and has_existing_output(output_dir):
        return MineruResult(index, pdf_path, output_dir, "skipped_existing", None, command_text, "")

    if dry_run:
        return MineruResult(index, pdf_path, output_dir, "dry_run", None, command_text, "")

    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        completed = subprocess.run(command, capture_output=True, text=True)
    except FileNotFoundError as exc:
        return MineruResult(index, pdf_path, output_dir, "failed", None, command_text, str(exc))

    if completed.returncode == 0:
        return MineruResult(index, pdf_path, output_dir, "success", 0, command_text, "")

    error = (completed.stderr or completed.stdout or "").strip()
    return MineruResult(index, pdf_path, output_dir, "failed", completed.returncode, command_text, error)


def write_report(report_path: Path, results: list[MineruResult]) -> None:
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Batch-run remote mineru recognition for PDFs in one folder.",
        epilog=f"Example:\n  {EXAMPLE_COMMAND}",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT_DIR,
        help=f"PDF folder to process. Default: {DEFAULT_INPUT_DIR}",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Root folder for mineru outputs. Default: {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--api-url",
        default=DEFAULT_API_URL,
        help=f"Remote mineru API URL. Default: {DEFAULT_API_URL}",
    )
    parser.add_argument(
        "--mineru-bin",
        default="auto",
        help='mineru executable or command prefix. Use "auto" to find mineru.exe automatically. Default: auto',
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help=f"CSV report path. Default: {DEFAULT_REPORT}",
    )
    parser.add_argument(
        "--no-recursive",
        action="store_true",
        help="Only process PDFs directly inside --input.",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip PDFs whose output folder already contains files.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned mineru commands and write a report without running mineru.",
    )
    parser.add_argument(
        "--keep-original-output-names",
        action="store_true",
        help="Use full PDF names as output folder names. Default uses pdf001, pdf002, ...",
    )
    parser.add_argument(
        "--name-prefix",
        default=DEFAULT_NAME_PREFIX,
        help=f"Prefix for generated output folders. Default: {DEFAULT_NAME_PREFIX}",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_dir = args.input.resolve()
    output_root = args.output.resolve()
    report_path = args.report.resolve()
    recursive = not args.no_recursive

    if not input_dir.exists():
        raise FileNotFoundError(f"Input folder does not exist: {input_dir}")
    if not input_dir.is_dir():
        raise NotADirectoryError(f"Input path is not a folder: {input_dir}")

    pdf_paths = find_pdfs(input_dir, recursive, exclude_dir=output_root)
    print(f"Found {len(pdf_paths)} PDF file(s).")
    print(f"Input folder: {input_dir}")
    print(f"Output root: {output_root}")
    print(f"Report: {report_path}")
    print(f"MinerU command: {resolve_mineru_bin() if args.mineru_bin == 'auto' else args.mineru_bin}")

    results: list[MineruResult] = []
    for index, pdf_path in enumerate(pdf_paths, start=1):
        print(f"[{index}/{len(pdf_paths)}] {pdf_path}")
        result = run_one_pdf(
            index=index,
            input_dir=input_dir,
            output_root=output_root,
            pdf_path=pdf_path,
            mineru_bin=args.mineru_bin,
            api_url=args.api_url,
            skip_existing=args.skip_existing,
            dry_run=args.dry_run,
            keep_original_output_names=args.keep_original_output_names,
            total_count=len(pdf_paths),
            name_prefix=args.name_prefix,
        )
        print(f"  {result.status}: {result.command}")
        if result.error:
            print(f"  error: {result.error[:500]}")
        results.append(result)

    write_report(report_path, results)

    status_counts: dict[str, int] = {}
    for result in results:
        status_counts[result.status] = status_counts.get(result.status, 0) + 1

    print(f"Finished at {datetime.now().isoformat(timespec='seconds')}.")
    print(f"Summary: {status_counts}")
    print("Example command:")
    print(f"  {EXAMPLE_COMMAND}")


if __name__ == "__main__":
    main()

r"""Merge split MinerU Markdown and images into one output folder.

Usage:
  C:\ProgramData\miniconda3\envs\mineru\python.exe .\bigfile.py

Default task:
  Input root : C:\Users\Administrator\Desktop\mainpaper
  Parts      : out_040_p1, out_040_p2, out_040_p3, out_040_p4, out_040_p5
  Output     : C:\Users\Administrator\Desktop\mainpaper\output\pdf040

Custom example:
  C:\ProgramData\miniconda3\envs\mineru\python.exe .\bigfile.py --input-root "C:\Users\Administrator\Desktop\mainpaper" --output-root "C:\Users\Administrator\Desktop\mainpaper\output" --name pdf040
"""

from __future__ import annotations

import argparse
import filecmp
import re
import shutil
from dataclasses import dataclass
from pathlib import Path


DEFAULT_INPUT_ROOT = Path(r"C:\Users\Administrator\Desktop\mainpaper")
DEFAULT_OUTPUT_ROOT = Path(r"C:\Users\Administrator\Desktop\mainpaper\output")
DEFAULT_NAME = "pdf040"
DEFAULT_PART_GLOB = "out_040_p*"


@dataclass(frozen=True)
class PartResult:
    part_dir: Path
    md_file: Path
    images_dir: Path | None
    image_count: int


def part_order_key(path: Path) -> tuple[int, str]:
    match = re.search(r"_p(\d+)$", path.name, re.IGNORECASE)
    if match:
        return int(match.group(1)), path.name.lower()
    return 10**9, path.name.lower()


def discover_parts(input_root: Path, part_glob: str) -> list[Path]:
    parts = [path for path in input_root.glob(part_glob) if path.is_dir()]
    return sorted(parts, key=part_order_key)


def find_part_base(part_dir: Path, name: str) -> Path | None:
    candidates = [
        part_dir / name / "hybrid_auto",
        part_dir / name,
        part_dir / "hybrid_auto",
        part_dir,
    ]
    for candidate in candidates:
        if (candidate / f"{name}.md").exists():
            return candidate
    return None


def rewrite_image_refs(md_text: str, old_name: str, new_name: str) -> str:
    if old_name == new_name:
        return md_text
    md_text = md_text.replace(f"images/{old_name}", f"images/{new_name}")
    md_text = md_text.replace(f"images\\{old_name}", f"images\\{new_name}")
    return md_text


def copy_images_and_update_md(
    md_text: str,
    images_dir: Path | None,
    output_images_dir: Path,
    part_label: str,
) -> tuple[str, int]:
    if images_dir is None or not images_dir.exists():
        return md_text, 0

    count = 0
    for image_path in images_dir.iterdir():
        if not image_path.is_file():
            continue

        target_name = image_path.name
        target_path = output_images_dir / target_name
        if target_path.exists() and not filecmp.cmp(image_path, target_path, shallow=False):
            target_name = f"{part_label}_{image_path.name}"
            target_path = output_images_dir / target_name

        shutil.copy2(image_path, target_path)
        md_text = rewrite_image_refs(md_text, image_path.name, target_name)
        count += 1

    return md_text, count


def clean_output(output_path: Path) -> None:
    if output_path.exists():
        shutil.rmtree(output_path)
    (output_path / "images").mkdir(parents=True, exist_ok=True)


def merge_parts(parts: list[Path], output_root: Path, name: str, clean: bool) -> list[PartResult]:
    output_path = output_root / name
    output_images_dir = output_path / "images"
    if clean:
        clean_output(output_path)
    else:
        output_images_dir.mkdir(parents=True, exist_ok=True)

    merged_sections: list[str] = []
    results: list[PartResult] = []

    for index, part_dir in enumerate(parts, start=1):
        base = find_part_base(part_dir, name)
        if base is None:
            print(f"[WARN] Markdown not found, skipped: {part_dir}")
            continue

        md_file = base / f"{name}.md"
        images_dir = base / "images"
        md_text = md_file.read_text(encoding="utf-8-sig")
        md_text, image_count = copy_images_and_update_md(
            md_text=md_text,
            images_dir=images_dir if images_dir.exists() else None,
            output_images_dir=output_images_dir,
            part_label=f"p{index:02d}",
        )

        if md_text.strip():
            merged_sections.append(md_text.strip())

        results.append(
            PartResult(
                part_dir=part_dir,
                md_file=md_file,
                images_dir=images_dir if images_dir.exists() else None,
                image_count=image_count,
            )
        )
        print(f"[OK] {part_dir.name}: md={md_file.name}, images={image_count}")

    merged_md = output_path / f"{name}.md"
    merged_md.write_text("\n\n".join(merged_sections) + "\n", encoding="utf-8")
    return results


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge split MinerU outputs into one folder.")
    parser.add_argument("--input-root", type=Path, default=DEFAULT_INPUT_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--part-glob", default=DEFAULT_PART_GLOB)
    parser.add_argument(
        "--parts",
        type=Path,
        nargs="*",
        help="Optional explicit part folders. If omitted, --input-root/--part-glob is used.",
    )
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Do not remove the existing output/name folder before merging.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_root = args.input_root.resolve()
    output_root = args.output_root.resolve()

    parts = [part.resolve() for part in args.parts] if args.parts else discover_parts(input_root, args.part_glob)
    parts = sorted(parts, key=part_order_key)

    if not parts:
        raise FileNotFoundError(f"No part folders found under {input_root} with pattern {args.part_glob}")

    print("Merge MinerU split outputs")
    print(f"Input root : {input_root}")
    print(f"Output root: {output_root}")
    print(f"Name       : {args.name}")
    print("Parts:")
    for part in parts:
        print(f"  - {part}")

    results = merge_parts(parts, output_root, args.name, clean=not args.no_clean)

    total_images = sum(result.image_count for result in results)
    output_path = output_root / args.name
    print("=" * 80)
    print("Done")
    print(f"Merged markdown: {output_path / (args.name + '.md')}")
    print(f"Merged images  : {output_path / 'images'}")
    print(f"Parts merged   : {len(results)}")
    print(f"Images copied  : {total_images}")
    print("=" * 80)


if __name__ == "__main__":
    main()

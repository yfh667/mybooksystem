#!/usr/bin/env python3
"""
Flatten MinerU batch output folders.

MinerU batch output may look like this:

    output/pdf001/pdf001/hybrid_auto/<mineru files>

This script moves the contents of hybrid_auto directly into the outer folder:

    output/pdf001/<mineru files>

It is conservative by default:
  - dry-run unless --apply is passed
  - only handles repeated-name folders: <root>/<name>/<name>/hybrid_auto
  - refuses to overwrite existing destination files unless --replace is passed
  - removes hybrid_auto and the inner repeated folder only if they are empty
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


# ---------------------------------------------------------------------------
# Default configuration
# ---------------------------------------------------------------------------
# You can edit these defaults and run this script without command-line args.
DEFAULT_ROOT = r"C:\Users\Administrator\Desktop\c4\output"
DEFAULT_APPLY = True
DEFAULT_REPLACE = False


def find_candidates(root: Path) -> list[tuple[Path, Path, Path]]:
    """Return (outer_dir, inner_dir, hybrid_auto_dir)."""
    candidates: list[tuple[Path, Path, Path]] = []
    for outer in sorted(p for p in root.iterdir() if p.is_dir()):
        inner = outer / outer.name
        hybrid = inner / "hybrid_auto"
        if inner.is_dir() and hybrid.is_dir():
            candidates.append((outer, inner, hybrid))
    return candidates


def remove_empty_dir(path: Path, *, dry_run: bool) -> bool:
    if not path.exists():
        return False
    try:
        next(path.iterdir())
        return False
    except StopIteration:
        if dry_run:
            print(f"  would remove empty dir: {path}")
        else:
            path.rmdir()
            print(f"  removed empty dir: {path}")
        return True


def list_conflicts(hybrid: Path, outer: Path) -> list[Path]:
    conflicts: list[Path] = []
    for item in hybrid.iterdir():
        dst = outer / item.name
        if dst.exists():
            conflicts.append(dst)
    return conflicts


def move_contents(outer: Path, inner: Path, hybrid: Path, *, dry_run: bool, replace: bool) -> str:
    print(f"\n{outer.name}")
    print(f"  from: {hybrid}\\*")
    print(f"  to:   {outer}\\")

    conflicts = list_conflicts(hybrid, outer)
    if conflicts and not replace:
        print("  skip: destination item(s) already exist (use --replace to overwrite):")
        for path in conflicts[:10]:
            print(f"    {path.name}")
        if len(conflicts) > 10:
            print(f"    ... {len(conflicts) - 10} more")
        return "skipped"

    items = sorted(hybrid.iterdir(), key=lambda p: p.name.lower())
    if not items:
        print("  skip: hybrid_auto is empty")
        return "empty"

    for item in items:
        dst = outer / item.name
        if dry_run:
            if dst.exists() and replace:
                print(f"  would replace: {dst.name}")
            print(f"  would move: {item.name}")
            continue

        if dst.exists():
            if dst.is_dir():
                shutil.rmtree(dst)
            else:
                dst.unlink()
            print(f"  replaced: {dst.name}")
        shutil.move(str(item), str(dst))
        print(f"  moved: {item.name}")

    remove_empty_dir(hybrid, dry_run=dry_run)
    remove_empty_dir(inner, dry_run=dry_run)
    return "planned" if dry_run else "moved"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flatten <root>/<name>/<name>/hybrid_auto/* into <root>/<name>/*"
    )
    parser.add_argument(
        "root",
        nargs="?",
        default=DEFAULT_ROOT,
        help=f"MinerU batch output root. Default: {DEFAULT_ROOT}",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=DEFAULT_APPLY,
        help=f"actually move files. Default from config: {DEFAULT_APPLY}",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="preview only, overriding DEFAULT_APPLY",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        default=DEFAULT_REPLACE,
        help=f"replace existing destination files/folders. Default from config: {DEFAULT_REPLACE}",
    )
    parser.add_argument(
        "--no-replace",
        action="store_true",
        help="do not replace existing files/folders, overriding DEFAULT_REPLACE",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        raise SystemExit(f"Root folder not found: {root}")

    apply_changes = bool(args.apply)
    if args.dry_run:
        apply_changes = False
    replace = bool(args.replace)
    if args.no_replace:
        replace = False
    dry_run = not apply_changes
    print(f"Root: {root}")
    print(f"Mode: {'APPLY' if apply_changes else 'DRY-RUN'}")
    print(f"Replace existing items: {'yes' if replace else 'no'}")

    candidates = find_candidates(root)
    if not candidates:
        print("No candidates found.")
        return 0

    counts: dict[str, int] = {}
    for outer, inner, hybrid in candidates:
        status = move_contents(outer, inner, hybrid, dry_run=dry_run, replace=replace)
        counts[status] = counts.get(status, 0) + 1

    print("\nSummary:")
    for key in sorted(counts):
        print(f"  {key}: {counts[key]}")
    if dry_run:
        print("\nNothing changed. Re-run with --apply to move files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

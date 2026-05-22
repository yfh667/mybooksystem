from __future__ import annotations

import shutil
from collections import Counter
from pathlib import Path


SOURCE_DIR = Path(r"C:\Users\Administrator\Desktop\mainpaper\output")
TARGET_DIR = SOURCE_DIR / "all"


def is_inside(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
        return True
    except ValueError:
        return False


def unique_target_name(source: Path, source_dir: Path) -> str:
    relative = source.relative_to(source_dir)
    return "__".join(relative.with_suffix("").parts) + source.suffix


def main() -> None:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    markdown_files = sorted(
        path
        for path in SOURCE_DIR.rglob("*.md")
        if path.is_file() and not is_inside(path, TARGET_DIR)
    )

    name_counts = Counter(path.name for path in markdown_files)
    copied = 0

    for source in markdown_files:
        if name_counts[source.name] == 1:
            target = TARGET_DIR / source.name
        else:
            target = TARGET_DIR / unique_target_name(source, SOURCE_DIR)

        shutil.copy2(source, target)
        copied += 1

    print(f"Found {len(markdown_files)} markdown files.")
    print(f"Copied {copied} files to {TARGET_DIR}")


if __name__ == "__main__":
    main()

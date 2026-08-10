from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.tonearms import import_tonearm_workbook_gaps


def main() -> None:
    parser = argparse.ArgumentParser(description="Import missing tonearm workbook rows as research targets.")
    parser.add_argument("workbook", help="Path to the workbook to compare against the tonearm database")
    parser.add_argument(
        "--base-dir",
        default="data/tonearms",
        help="Tonearm database base directory",
    )
    args = parser.parse_args()

    outputs = import_tonearm_workbook_gaps(Path(args.base_dir), Path(args.workbook))
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

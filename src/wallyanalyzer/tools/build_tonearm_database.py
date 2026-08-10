from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.tonearms import build_tonearm_database


def main() -> None:
    parser = argparse.ArgumentParser(description="Build local tonearm SQLite database and CSV exports.")
    parser.add_argument(
        "--output-dir",
        default="data/tonearms",
        help="Directory for SQLite database, source snapshots, and CSV exports",
    )
    args = parser.parse_args()

    outputs = build_tonearm_database(Path(args.output_dir))
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.turntables import build_turntable_database


def main() -> None:
    parser = argparse.ArgumentParser(description="Build local turntable SQLite database and CSV exports.")
    parser.add_argument(
        "--output-dir",
        default="data/turntables",
        help="Directory for SQLite database, source snapshots, staged enrichments, and CSV exports",
    )
    args = parser.parse_args()

    outputs = build_turntable_database(Path(args.output_dir))
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.turntables import enrich_turntable_database


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich local turntable SQLite database from a staged CSV file.")
    parser.add_argument("enrichment_csv", help="CSV file containing feature-level enrichment rows")
    parser.add_argument(
        "--base-dir",
        default="data/turntables",
        help="Turntable database base directory",
    )
    args = parser.parse_args()

    outputs = enrich_turntable_database(Path(args.base_dir), Path(args.enrichment_csv))
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

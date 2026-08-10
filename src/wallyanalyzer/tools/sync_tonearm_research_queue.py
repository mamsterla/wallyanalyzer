from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.tonearms import sync_tonearm_research_queue


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync manufacturer-first tonearm research queue and exports.")
    parser.add_argument(
        "--base-dir",
        default="data/tonearms",
        help="Tonearm database base directory",
    )
    args = parser.parse_args()

    outputs = sync_tonearm_research_queue(Path(args.base_dir))
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.turntables import sync_turntable_research_queue


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync manufacturer-first turntable research queue and exports.")
    parser.add_argument(
        "--base-dir",
        default="data/turntables",
        help="Turntable database base directory",
    )
    args = parser.parse_args()

    outputs = sync_turntable_research_queue(Path(args.base_dir))
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.tonearms import normalize_tonearm_manufacturers


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge legacy tonearm manufacturers into canonical manufacturers and refresh exports.")
    parser.add_argument(
        "--base-dir",
        default="data/tonearms",
        help="Tonearm database base directory",
    )
    args = parser.parse_args()

    outputs = normalize_tonearm_manufacturers(Path(args.base_dir))
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

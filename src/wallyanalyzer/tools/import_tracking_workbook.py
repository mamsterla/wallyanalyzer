from __future__ import annotations

import argparse

from wallyanalyzer.metadata import export_tracking_workbook_to_json_fixtures


def main() -> None:
    parser = argparse.ArgumentParser(description="Export tracking workbook sheets to JSON fixtures.")
    parser.add_argument("workbook_path", help="Path to tracking workbook .xlsx")
    parser.add_argument("--output-dir", default="data/fixtures", help="Target fixture directory")
    parser.add_argument("--file-stem", action="append", default=None, help="Limit export to one or more file stems")
    args = parser.parse_args()

    outputs = export_tracking_workbook_to_json_fixtures(
        args.workbook_path,
        args.output_dir,
        file_stems=args.file_stem,
    )
    for key, value in outputs.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()

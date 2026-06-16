from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.output import render_svg_batch_to_png


def main() -> None:
    parser = argparse.ArgumentParser(description="Render SVG plot files to PNG with Inkscape.")
    parser.add_argument("svg_path", nargs="+", help="SVG file(s) or directories")
    parser.add_argument("--output-dir", default="data/outputs/plots/rendered", help="Directory for PNG outputs")
    parser.add_argument("--width", type=int, default=1600, help="PNG width in pixels")
    args = parser.parse_args()

    svg_files: list[Path] = []
    for raw_path in args.svg_path:
        path = Path(raw_path)
        if path.is_dir():
            svg_files.extend(sorted(path.glob("*.svg")))
        else:
            svg_files.append(path)

    rendered = render_svg_batch_to_png(svg_files, args.output_dir, width=args.width)
    for png in rendered:
        print(png)


if __name__ == "__main__":
    main()

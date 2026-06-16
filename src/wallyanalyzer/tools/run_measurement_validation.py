from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.metadata import load_metadata_provider_from_json_dir
from wallyanalyzer.output import render_measurement_validation_svg, render_svg_to_png, save_measurement_result
from wallyanalyzer.pipelines import measure_sine_file


def main() -> None:
    parser = argparse.ArgumentParser(description="Run measurement pipeline and save validation outputs.")
    parser.add_argument("audio_path", help="Path to WAV file")
    parser.add_argument(
        "--fixtures-dir",
        default="data/fixtures",
        help="Directory containing acquisitions.json and test_tracks.json",
    )
    parser.add_argument(
        "--measurement-output-dir",
        default="data/outputs/measurement",
        help="Directory for saved measurement artifacts",
    )
    parser.add_argument(
        "--plot-output-dir",
        default="data/outputs/plots",
        help="Directory for generated validation SVG plots",
    )
    parser.add_argument(
        "--png-width",
        type=int,
        default=1600,
        help="Rendered PNG width when Inkscape is available",
    )
    parser.add_argument(
        "--skip-png",
        action="store_true",
        help="Skip SVG to PNG rendering",
    )
    args = parser.parse_args()

    provider = load_metadata_provider_from_json_dir(args.fixtures_dir)
    result = measure_sine_file(args.audio_path, provider)

    saved = save_measurement_result(result, args.measurement_output_dir)
    plot_path = Path(args.plot_output_dir) / f"{result.file_stem}_measurement_validation.svg"
    render_measurement_validation_svg(result, plot_path)

    png_path = None
    if not args.skip_png:
        png_path = render_svg_to_png(
            plot_path,
            Path(args.plot_output_dir) / "rendered" / f"{plot_path.name}.png",
            width=args.png_width,
        )

    print(f"Measurement complete for {result.file_stem}")
    for key, value in saved.items():
        print(f"{key}: {value}")
    print(f"plot_svg: {plot_path}")
    if png_path is not None:
        print(f"plot_png: {png_path}")


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
from pathlib import Path

from wallyanalyzer.metadata import load_metadata_provider_from_json_dir
from wallyanalyzer.output import (
    render_compile_sweep_svg,
    render_compile_validation_svg,
    render_svg_to_png,
    save_compile_result,
    save_compile_sweep_summary,
)
from wallyanalyzer.pipelines import compile_sine_results, measure_sine_file
from wallyanalyzer.schemas import CompileConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Run measurement + compile pipeline and save validation outputs.")
    parser.add_argument("audio_path", nargs="+", help="Path(s) to WAV file")
    parser.add_argument("--fixtures-dir", default="data/fixtures", help="Directory containing metadata JSON fixtures")
    parser.add_argument("--output-dir", default="data/outputs/compile", help="Directory for compile artifacts")
    parser.add_argument("--plot-output-dir", default="data/outputs/plots", help="Directory for compile SVG plots")
    parser.add_argument("--png-width", type=int, default=1600, help="Rendered PNG width when Inkscape is available")
    parser.add_argument("--skip-png", action="store_true", help="Skip SVG to PNG rendering")
    args = parser.parse_args()

    provider = load_metadata_provider_from_json_dir(args.fixtures_dir)
    measurements = [measure_sine_file(path, provider) for path in args.audio_path]
    compile_bundle = compile_sine_results(measurements, provider, CompileConfig())

    for single_result in compile_bundle.single_results:
        saved = save_compile_result(single_result, args.output_dir)
        plot_path = Path(args.plot_output_dir) / f"{single_result.measurement.file_stem}_compile_validation.svg"
        render_compile_validation_svg(single_result, plot_path)
        png_path = None
        if not args.skip_png:
            png_path = render_svg_to_png(
                plot_path,
                Path(args.plot_output_dir) / "rendered" / f"{plot_path.name}.png",
                width=args.png_width,
            )
        print(f"Compile validation complete for {single_result.measurement.file_stem}")
        for key, value in saved.items():
            print(f"{key}: {value}")
        print(f"plot_svg: {plot_path}")
        if png_path is not None:
            print(f"plot_png: {png_path}")

    if compile_bundle.aggregate_summary:
        stems = [result.measurement.file_stem for result in compile_bundle.single_results]
        bundle_name = "_".join(stems)
        sweep_json = Path(args.output_dir) / f"{bundle_name}_compile_sweep_summary.json"
        sweep_svg = Path(args.plot_output_dir) / f"{bundle_name}_compile_sweep.svg"
        save_compile_sweep_summary(compile_bundle, sweep_json)
        render_compile_sweep_svg(compile_bundle, sweep_svg)
        sweep_png = None
        if not args.skip_png:
            sweep_png = render_svg_to_png(
                sweep_svg,
                Path(args.plot_output_dir) / "rendered" / f"{sweep_svg.name}.png",
                width=args.png_width,
            )
        print(f"sweep_summary_json: {sweep_json}")
        print(f"sweep_plot_svg: {sweep_svg}")
        if sweep_png is not None:
            print(f"sweep_plot_png: {sweep_png}")


if __name__ == "__main__":
    main()

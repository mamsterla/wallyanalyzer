from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from wallyanalyzer.metadata import load_metadata_provider_from_json_dir
from wallyanalyzer.output import (
    render_compile_validation_svg,
    render_measurement_validation_svg,
    render_svg_to_png,
)
from wallyanalyzer.pipelines import compile_one_measurement, measure_sine_file
from wallyanalyzer.schemas import CompileConfig, MeasureSineConfig


def main() -> None:
    parser = argparse.ArgumentParser(description="Profile measurement and compile timings for one or more WAV files.")
    parser.add_argument("audio_paths", nargs="+", help="WAV files to profile")
    parser.add_argument("--fixtures-dir", default="data/fixtures", help="Metadata fixture directory")
    parser.add_argument("--output-csv", default="data/outputs/profile/timings.csv", help="CSV timing report path")
    parser.add_argument("--history-csv", default="data/outputs/profile/iteration_history.csv", help="Append-only iteration history CSV")
    parser.add_argument("--history-md", default="data/outputs/profile/iteration_history.md", help="Markdown summary table path")
    parser.add_argument("--iteration", default="baseline-001", help="Iteration label for tracking")
    parser.add_argument("--notes", default="", help="Short notes about this profiling run")
    parser.add_argument("--plot-output-dir", default="data/outputs/plots", help="Directory for generated SVG plots")
    parser.add_argument("--png-width", type=int, default=1600, help="Rendered PNG width when Inkscape is available")
    parser.add_argument("--skip-png", action="store_true", help="Skip SVG to PNG rendering")
    parser.add_argument("--skip-plots", action="store_true", help="Skip generating validation plots during profiling")
    args = parser.parse_args()

    provider = load_metadata_provider_from_json_dir(args.fixtures_dir)
    rows = []
    generated_svgs: list[Path] = []
    generated_pngs: list[Path] = []
    for audio_path in args.audio_paths:
        measurement = measure_sine_file(audio_path, provider, MeasureSineConfig())
        compile_result = compile_one_measurement(measurement, provider, CompileConfig())
        if not args.skip_plots:
            plot_dir = Path(args.plot_output_dir)
            measurement_svg = plot_dir / f"{measurement.file_stem}_measurement_validation.svg"
            compile_svg = plot_dir / f"{measurement.file_stem}_compile_validation.svg"
            render_measurement_validation_svg(measurement, measurement_svg)
            render_compile_validation_svg(compile_result, compile_svg)
            generated_svgs.extend([measurement_svg, compile_svg])
            if not args.skip_png:
                generated_pngs.extend(
                    [
                        render_svg_to_png(
                            measurement_svg,
                            plot_dir / "rendered" / f"{measurement_svg.name}.png",
                            width=args.png_width,
                        ),
                        render_svg_to_png(
                            compile_svg,
                            plot_dir / "rendered" / f"{compile_svg.name}.png",
                            width=args.png_width,
                        ),
                    ]
                )
        m = measurement.diagnostics.get("timings_s", {})
        c = compile_result.diagnostics.get("timings_s", {})
        rows.append(
            {
                "iteration": args.iteration,
                "notes": args.notes,
                "file_stem": measurement.file_stem,
                "measurement_audio_load_s": m.get("audio_load"),
                "measurement_envelope_s": m.get("envelope"),
                "measurement_setup_s": m.get("setup"),
                "measurement_segment_loop_s": m.get("segment_loop"),
                "measurement_segment_extract_s": m.get("segment_extract"),
                "measurement_segment_validity_s": m.get("segment_validity"),
                "measurement_segment_detrend_window_s": m.get("segment_detrend_window"),
                "measurement_segment_fft_s": m.get("segment_fft"),
                "measurement_segment_lr_metric_s": m.get("segment_lr_metric"),
                "measurement_segment_loop_overhead_s": m.get("segment_loop_overhead"),
                "measurement_segment_loop_per_valid_ms": m.get("segment_loop_per_valid_ms"),
                "measurement_segment_fft_per_valid_ms": m.get("segment_fft_per_valid_ms"),
                "measurement_valid_segments": measurement.diagnostics.get("n_valid_segments"),
                "compile_metadata_join_s": c.get("metadata_join"),
                "compile_preprocess_s": c.get("preprocess"),
                "compile_stylus_fit_s": c.get("stylus_fit"),
                "compile_distortion_fit_s": c.get("distortion_fit"),
                "compile_total_s": c.get("total"),
                "compile_fit_rms_deg": compile_result.summary.apparent_tracking_fit_rms_deg,
            }
        )

    output_path = Path(args.output_csv)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    history_path = Path(args.history_csv)
    _append_history_csv(history_path, rows)
    history_md_path = Path(args.history_md)
    _write_history_markdown(history_path, history_md_path)

    print(f"timing_csv: {output_path}")
    print(f"history_csv: {history_path}")
    print(f"history_md: {history_md_path}")
    for svg_path in generated_svgs:
        print(f"plot_svg: {svg_path}")
    for png_path in generated_pngs:
        print(f"plot_png: {png_path}")
    print(json.dumps(rows, indent=2))


def _append_history_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        if write_header:
            writer.writeheader()
        writer.writerows(rows)


def _write_history_markdown(history_csv_path: Path, history_md_path: Path) -> None:
    with history_csv_path.open("r", newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        history_md_path.write_text("# Iteration History\n\nNo rows.\n", encoding="utf-8")
        return

    summary_rows = []
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["iteration"], []).append(row)

    for iteration, items in grouped.items():
        def avg(field: str) -> float:
            vals = [float(item[field]) for item in items if item[field] not in ("", "None", None)]
            return sum(vals) / len(vals) if vals else float("nan")

        summary_rows.append(
            {
                "iteration": iteration,
                "notes": items[-1].get("notes", ""),
                "files": len(items),
                "meas_total_avg_s": avg("measurement_audio_load_s") + avg("measurement_envelope_s") + avg("measurement_setup_s") + avg("measurement_segment_loop_s"),
                "meas_loop_avg_s": avg("measurement_segment_loop_s"),
                "meas_fft_avg_s": avg("measurement_segment_fft_s"),
                "meas_detrend_avg_s": avg("measurement_segment_detrend_window_s"),
                "meas_validity_avg_s": avg("measurement_segment_validity_s"),
                "meas_per_valid_ms": avg("measurement_segment_loop_per_valid_ms"),
                "compile_total_avg_s": avg("compile_total_s"),
                "compile_fit_rms_avg_deg": avg("compile_fit_rms_deg"),
            }
        )

    summary_rows.sort(key=lambda r: r["iteration"])
    lines = [
        "# Iteration History",
        "",
        "| iteration | notes | files | meas total avg s | meas loop avg s | meas fft avg s | meas detrend avg s | meas validity avg s | meas per valid ms | compile total avg s | compile fit rms avg deg |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in summary_rows:
        lines.append(
            f"| {row['iteration']} | {row['notes']} | {row['files']} | {row['meas_total_avg_s']:.3f} | {row['meas_loop_avg_s']:.3f} | {row['meas_fft_avg_s']:.3f} | {row['meas_detrend_avg_s']:.3f} | {row['meas_validity_avg_s']:.3f} | {row['meas_per_valid_ms']:.3f} | {row['compile_total_avg_s']:.4f} | {row['compile_fit_rms_avg_deg']:.4f} |"
        )
    history_md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

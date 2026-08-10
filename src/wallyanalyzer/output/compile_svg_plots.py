from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np

from wallyanalyzer.schemas import CompileResult, SingleCompileResult

SVG_WIDTH = 1200
SVG_HEIGHT = 900
MARGIN_LEFT = 80
MARGIN_RIGHT = 30
MARGIN_TOP = 175
MARGIN_BOTTOM = 40
PANEL_GAP = 150


def render_compile_validation_svg(
    result: SingleCompileResult,
    output_path: str | Path,
    title: str | None = None,
) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    panel_height = (SVG_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - PANEL_GAP) / 2
    panel_width = SVG_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
    radius_valid = result.radius_valid_mm
    radius_smooth = result.radius_smooth_mm

    harm2_pct = 100.0 * result.harmonic_smooth[:, 1] / result.harmonic_smooth[:, 0]
    harm3_pct = 100.0 * result.harmonic_smooth[:, 2] / result.harmonic_smooth[:, 0]
    dist_model_pct = 100.0 * np.abs(result.distortion_model)
    dist_fit_pct = 100.0 * np.abs(result.distortion_fit)
    lr_diff_over_sum_rms_pct = 100.0 * result.lr_diff_over_sum_rms_ratio_smooth
    show_dist_fit = not np.allclose(dist_model_pct, dist_fit_pct, equal_nan=True)

    summary = result.summary
    acquisition = result.measurement.acquisition
    system_parts = []
    if result.system is not None:
        if result.system.turntable:
            system_parts.append(result.system.turntable)
        if result.cartridge is not None and result.cartridge.cartridge_name:
            system_parts.append(result.cartridge.cartridge_name)
        if result.system.tonearm:
            system_parts.append(result.system.tonearm)
    elif result.cartridge is not None and result.cartridge.cartridge_name:
        system_parts.append(result.cartridge.cartridge_name)
    system_line = ", ".join(system_parts) if system_parts else result.measurement.file_stem
    peak_idx = int(np.argmax(np.abs(result.ate_fitted_deg)))
    avg_rotations = max(1, int(round(result.diagnostics.get("smoothing_window", 1) / max(1, round(360.0 / result.measurement.skip_deg)))))
    piv_spin_adj = 0.0 if acquisition.pivot_spindle_adjustment_mm is None else float(acquisition.pivot_spindle_adjustment_mm)
    title_line_1 = title or f"Wally Analysis, {Path(result.measurement.source_file).name}"
    title_line_2 = system_line
    source_algorithm = str(result.diagnostics.get("source_algorithm", "Python port"))
    side_stamp = datetime.now().strftime("%d-%b-%Y %H:%M") + f"   {source_algorithm}"

    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}">',
        '<style>text{font-family:Arial,sans-serif;fill:#000} .title{font-size:22px;font-weight:bold} .subtitle{font-size:20px;font-weight:bold} .label{font-size:14px} .small{font-size:12px;fill:#000} .mid{font-size:13px} .axis{stroke:#444;stroke-width:1} .grid{stroke:#ddd;stroke-width:1} .raw{fill:none;stroke:#e6a400;stroke-width:1.1;opacity:0.95;stroke-dasharray:2 2} .fit1{fill:none;stroke:#0057ff;stroke-width:2} .fit2{fill:none;stroke:#111;stroke-width:2;stroke-dasharray:10 6} .fit3{fill:none;stroke:#d95f02;stroke-width:2} .fit4{fill:none;stroke:#1b9e77;stroke-width:2;stroke-dasharray:8 5} .fit5{fill:none;stroke:#7f3fbf;stroke-width:2;stroke-dasharray:5 4} .legend-bg{fill:#fff;fill-opacity:1;stroke:#555;stroke-width:1} .marker-blue{fill:white;stroke:#0057ff;stroke-width:2} .marker-black{fill:#111;stroke:#111} .marker-red{fill:#d62728;stroke:#d62728} .marker-green{fill:#2ca02c;stroke:#2ca02c} .marker-open{fill:white;stroke-width:2}</style>',
        f'<rect x="0" y="0" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" fill="#fff"/>',
        f'<text x="{SVG_WIDTH/2:.1f}" y="34" text-anchor="middle" class="title">{_escape(title_line_1)}</text>',
        f'<text x="{SVG_WIDTH/2:.1f}" y="62" text-anchor="middle" class="subtitle">{_escape(title_line_2)}</text>',
    ]

    ate_xmin, ate_xmax = _x_bounds([radius_valid, radius_smooth])
    ate_ymin, ate_ymax = _series_bounds(
        [result.ate_raw_deg, result.ate_measured_deg, result.ate_fitted_deg],
        None,
        None,
    )
    svg.extend(
        _panel_svg(
            x_series=[radius_valid, radius_smooth, radius_smooth],
            y_series=[result.ate_raw_deg, result.ate_measured_deg, result.ate_fitted_deg],
            classes=["raw", "fit1", "fit4"],
            label="Apparent Tracking Error (°)",
            xlabel="Radius (mm)",
            left=MARGIN_LEFT,
            top=MARGIN_TOP,
            width=panel_width,
            height=panel_height,
            ymin=ate_ymin,
            ymax=ate_ymax,
        )
    )
    svg.extend(
        _marker_svg(
            left=MARGIN_LEFT,
            top=MARGIN_TOP,
            width=panel_width,
            height=panel_height,
            xmin=ate_xmin,
            xmax=ate_xmax,
            ymin=ate_ymin,
            ymax=ate_ymax,
            x=float(radius_smooth[peak_idx]),
            y=float(result.ate_fitted_deg[peak_idx]),
            klass="marker-blue",
            kind="circle",
        )
    )
    raw_noise_deg = result.diagnostics.get("play_yaw_noise_deg")
    if raw_noise_deg is None or not np.isfinite(raw_noise_deg):
        raw_noise_deg = float(np.nanstd(result.ate_raw_deg[np.isfinite(result.ate_raw_deg)] - np.nanmean(result.ate_raw_deg[np.isfinite(result.ate_raw_deg)])))
    svg.extend(
        _legend_svg(
            left=MARGIN_LEFT + 28,
            top=MARGIN_TOP + 12,
            entries=[
                ("raw", f"ATEraw±{float(raw_noise_deg):.3g}"),
                ("fit1", f"{avg_rotations}rot avg"),
                ("fit4", f"ATEfit±{3.0 * summary.apparent_tracking_fit_rms_deg:.3g}°"),
            ],
        )
    )

    middle_y = MARGIN_TOP + panel_height + 54
    svg.extend([
        f'<text x="{SVG_WIDTH/2:.1f}" y="{middle_y:.1f}" text-anchor="middle" class="mid">{_escape(f"Mount: Z={summary.effective_mount_yaw_deg:.3g}°, L={float(acquisition.effective_length_mm):.3f}mm, ATEfit: SY={summary.effective_stylus_yaw_deg:.3g}°, LR={summary.effective_lr_um:.3g}µm")}</text>',
        f'<text x="{SVG_WIDTH/2:.1f}" y="{middle_y + 28:.1f}" text-anchor="middle" class="mid">{_escape(f"OH={summary.effective_overhang_mm:.3f}mm, max| |= {summary.apparent_tracking_error_peak_abs_deg:.3g}°, |ATE|={summary.apparent_tracking_error_mean_deg:.3g}°, APivSpin={piv_spin_adj:.3f}mm")}</text>',
        f'<text x="{SVG_WIDTH/2:.1f}" y="{middle_y + 56:.1f}" text-anchor="middle" class="mid">{_escape(f"RMSfit={summary.apparent_tracking_fit_rms_deg:.4f}°, {result.measurement.periods_per_segment}cycles of 1kHz every {result.measurement.skip_deg:.0f}°")}</text>',
        f'<text x="{SVG_WIDTH - 12:.1f}" y="{SVG_HEIGHT/2:.1f}" transform="rotate(-90 {SVG_WIDTH - 12:.1f},{SVG_HEIGHT/2:.1f})" text-anchor="middle" class="small">{_escape(side_stamp)}</text>',
    ])

    lower_top = MARGIN_TOP + panel_height + PANEL_GAP
    lower_series = [harm2_pct, harm3_pct, dist_model_pct, lr_diff_over_sum_rms_pct]
    lower_classes = ["fit1", "fit5", "fit2", "fit3"]
    lower_x_series = [radius_smooth, radius_smooth, radius_smooth, radius_smooth]
    legend_entries = [
        ("fit1", f"<2nd>={float(np.nanmean(harm2_pct)):.4g}%"),
        ("fit5", f"<3rd>={float(np.nanmean(harm3_pct)):.4g}%"),
        ("fit2", f"Dist.Param({result.measurement.cut_velocity_m_per_s * 100.0:.3g}cm/s)"),
    ]
    if show_dist_fit:
        lower_series.append(dist_fit_pct)
        lower_classes.append("fit4")
        lower_x_series.append(radius_smooth)
        legend_entries.append(("fit4", "Dist.Fit"))
    lower_ymax = max(
        3.0,
        float(np.nanmax(np.concatenate(lower_series))) * 1.08,
    )
    svg.extend(
        _panel_svg(
            x_series=lower_x_series,
            y_series=lower_series,
            classes=lower_classes,
            label="% Harmonic distortion",
            xlabel="Radius (mm)",
            left=MARGIN_LEFT,
            top=lower_top,
            width=panel_width,
            height=panel_height,
            ymin=0.0,
            ymax=lower_ymax,
        )
    )
    svg.extend(
        _legend_svg(
            left=SVG_WIDTH - 250,
            top=lower_top + 10,
            width=220,
            entries=legend_entries,
        )
    )

    svg.append("</svg>")
    output.write_text("\n".join(svg), encoding="utf-8")
    return output


def render_compile_sweep_svg(
    compile_result: CompileResult | dict,
    output_path: str | Path,
    title: str | None = None,
) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    aggregate = compile_result.aggregate_summary if isinstance(compile_result, CompileResult) else compile_result
    if not aggregate or not aggregate.get("records"):
        raise ValueError("compile sweep plot requires aggregate_summary with records")

    records = aggregate["records"]
    cy = np.asarray([row["mount_yaw_deg"] for row in records], dtype=float)
    atepk = np.asarray([row["ate_peak_abs_deg"] for row in records], dtype=float)
    d2pk = np.asarray([row["d2_peak_pct"] for row in records], dtype=float)
    file_stems = [row["file_stem"] for row in records]
    joined_stems = ", ".join(file_stems)
    lr_mean = float(np.mean([row["effective_lr_um"] for row in records]))
    lr_std = float(np.std([row["effective_lr_um"] for row in records]))

    panel_height = (SVG_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - PANEL_GAP) / 2
    panel_width = SVG_WIDTH - MARGIN_LEFT - MARGIN_RIGHT

    sweep_title = title or (compile_result.single_results[-1].measurement.source_file if isinstance(compile_result, CompileResult) and compile_result.single_results else "Compile sweep summary")
    side_stamp = datetime.now().strftime("%d-%b-%Y %H:%M") + "   CompileSine24 template / Python port"
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}">',
        '<style>text{font-family:Arial,sans-serif;fill:#000} .title{font-size:22px;font-weight:bold} .subtitle{font-size:18px} .label{font-size:14px} .small{font-size:12px;fill:#000} .mid{font-size:13px} .axis{stroke:#444;stroke-width:1} .grid{stroke:#ddd;stroke-width:1} .fit1{fill:none;stroke:#0057ff;stroke-width:2} .fit2{fill:none;stroke:#111;stroke-width:1.8;stroke-dasharray:10 6} .fit3{fill:none;stroke:#d62728;stroke-width:1.8;stroke-dasharray:10 4} .fit4{fill:none;stroke:#2ca02c;stroke-width:2;stroke-dasharray:8 5} .fit5{fill:none;stroke:#111;stroke-width:1.8} .legend-bg{fill:#fff;fill-opacity:1;stroke:#555;stroke-width:1} .marker-blue{fill:white;stroke:#0057ff;stroke-width:1.5} .marker-black{fill:#111;stroke:#111}</style>',
        f'<rect x="0" y="0" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" fill="#fff"/>',
        f'<text x="{SVG_WIDTH/2:.1f}" y="36" text-anchor="middle" class="title">{_escape(sweep_title)}</text>',
        f'<text x="{SVG_WIDTH/2:.1f}" y="64" text-anchor="middle" class="subtitle">{_escape(joined_stems)}</text>',
        f'<text x="{SVG_WIDTH - 12:.1f}" y="{SVG_HEIGHT/2:.1f}" transform="rotate(-90 {SVG_WIDTH - 12:.1f},{SVG_HEIGHT/2:.1f})" text-anchor="middle" class="small">{_escape(side_stamp)}</text>',
    ]

    top_top = MARGIN_TOP
    ate_sweep_ymin, ate_sweep_ymax = _series_bounds([atepk], None, None)
    svg.extend(
        _panel_svg(
            x_series=[cy],
            y_series=[atepk],
            classes=["fit1"],
            label="max₍radius₎ |ATE| (°)",
            xlabel="Mount yaw (°)",
            left=MARGIN_LEFT,
            top=top_top,
            width=panel_width,
            height=panel_height,
            ymin=ate_sweep_ymin,
            ymax=ate_sweep_ymax,
        )
    )
    svg.extend(_scatter_svg(cy, atepk, MARGIN_LEFT, top_top, panel_width, panel_height, klass="marker-blue", ymin=ate_sweep_ymin, ymax=ate_sweep_ymax))
    _extend_branch_fits(svg, aggregate.get("ate_peak_branches", {}), cy, MARGIN_LEFT, top_top, panel_width, panel_height, atepk)
    svg.extend(
        _legend_svg(
            left=MARGIN_LEFT + 85,
            top=top_top + 16,
            entries=[
                ("marker-blue", "Data"),
                ("fit2", _branch_slope_label(aggregate.get("ate_peak_branches", {}).get("negative_branch"), prefix="Slope: ")),
                ("fit3", _branch_slope_label(aggregate.get("ate_peak_branches", {}).get("positive_branch"), prefix="Slope: ")),
                ("marker-black", _cross_label(aggregate.get("ate_peak_branches", {}).get("crossing"), "ate_peak_deg")),
            ],
        )
    )

    lower_top = MARGIN_TOP + panel_height + PANEL_GAP
    d2_ymax = max(3.0, float(np.max(d2pk)) * 1.15)
    svg.extend(
        _panel_svg(
            x_series=[cy],
            y_series=[d2pk],
            classes=["fit1"],
            label="max₍radius₎ 2nd Harmonic Distortion (%)",
            xlabel="Mount yaw (°)",
            left=MARGIN_LEFT,
            top=lower_top,
            width=panel_width,
            height=panel_height,
            ymin=0.0,
            ymax=d2_ymax,
        )
    )
    svg.extend(_scatter_svg(cy, d2pk, MARGIN_LEFT, lower_top, panel_width, panel_height, klass="marker-blue", ymin=0.0, ymax=d2_ymax))
    if "d2_peak_quadratic" in aggregate:
        quad = aggregate["d2_peak_quadratic"]
        coef = np.asarray(quad["coefficients"], dtype=float)
        xs = np.linspace(np.min(cy), np.max(cy), 200)
        ys = np.polyval(coef, xs)
        svg.extend(_polyline_svg(xs, ys, MARGIN_LEFT, lower_top, panel_width, panel_height, cy, d2pk, klass="fit2", ymin=0.0, ymax=d2_ymax))
        if "minimum_mount_yaw_deg" in quad and "minimum_d2_peak_pct" in quad:
            svg.extend(
                _marker_svg(
                    MARGIN_LEFT,
                    lower_top,
                    panel_width,
                    panel_height,
                    float(np.min(cy)),
                    float(np.max(cy)),
                    0.0,
                    d2_ymax,
                    float(quad["minimum_mount_yaw_deg"]),
                    float(quad["minimum_d2_peak_pct"]),
                    "marker-black",
                    kind="star",
                )
            )
    _extend_d2_branch_fits(svg, aggregate.get("d2_peak_linear_branches", {}), cy, d2pk, MARGIN_LEFT, lower_top, panel_width, panel_height)

    svg.extend([
        f'<text x="{SVG_WIDTH/2:.1f}" y="{top_top + panel_height + 52:.1f}" text-anchor="middle" class="mid">{_escape(f"Cartridge Mount Yaw (°), <LR>={lr_mean:.2f}µm, σLR={lr_std:.3f}µm")}</text>',
        f'<text x="{SVG_WIDTH/2:.1f}" y="{lower_top - 18:.1f}" text-anchor="middle" class="subtitle">{_escape(joined_stems)}</text>',
    ])
    quad = aggregate.get("d2_peak_quadratic", {})
    svg.extend(
        _legend_svg(
            left=SVG_WIDTH - 250,
            top=lower_top + 10,
            width=220,
            entries=[
                ("marker-blue", "Data"),
                ("fit1", _branch_slope_label(aggregate.get("d2_peak_linear_branches", {}).get("low_branch"), prefix="Slope=")),
                ("fit5", _branch_slope_label(aggregate.get("d2_peak_linear_branches", {}).get("high_branch"), prefix="Slope=")),
                ("marker-black", _min_label(quad)),
            ],
        )
    )

    svg.append("</svg>")
    output.write_text("\n".join(svg), encoding="utf-8")
    return output


def save_compile_sweep_summary(compile_result: CompileResult | dict, output_path: str | Path) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    aggregate = compile_result.aggregate_summary if isinstance(compile_result, CompileResult) else compile_result
    output.write_text(json.dumps(aggregate, indent=2), encoding="utf-8")
    return output


def _extend_branch_fits(svg, branches, cy, left, top, width, height, atepk):
    xmin = float(np.min(cy))
    xmax = float(np.max(cy))
    ymin, ymax = _series_bounds([atepk], None, None)
    neg = branches.get("negative_branch")
    pos = branches.get("positive_branch")
    if neg:
        coef = np.asarray(neg["coefficients"], dtype=float)
        x0 = float(np.min(cy[np.asarray(neg["good_indices"], dtype=int)])) if neg.get("good_indices") else xmin
        x1 = float(branches.get("crossing", {}).get("mount_yaw_deg", xmax))
        xs = np.linspace(x0, x1, 80)
        ys = np.polyval(coef, xs)
        svg.extend(_polyline_svg(xs, ys, left, top, width, height, cy, atepk, klass="fit2", ymin=ymin, ymax=ymax))
    if pos:
        coef = np.asarray(pos["coefficients"], dtype=float)
        x0 = float(branches.get("crossing", {}).get("mount_yaw_deg", xmin))
        x1 = float(np.max(cy[np.asarray(pos["good_indices"], dtype=int)])) if pos.get("good_indices") else xmax
        xs = np.linspace(x0, x1, 80)
        ys = np.polyval(coef, xs)
        svg.extend(_polyline_svg(xs, ys, left, top, width, height, cy, atepk, klass="fit3", ymin=ymin, ymax=ymax))
    crossing = branches.get("crossing")
    if crossing:
        svg.extend(_marker_svg(left, top, width, height, xmin, xmax, ymin, ymax, float(crossing["mount_yaw_deg"]), float(crossing["ate_peak_deg"]), "marker-black", kind="star"))


def _extend_d2_branch_fits(svg, branches, cy, d2pk, left, top, width, height):
    xmin = float(np.min(cy))
    xmax = float(np.max(cy))
    ymin = 0.0
    ymax = max(3.0, float(np.max(d2pk)) * 1.15)
    low = branches.get("low_branch")
    high = branches.get("high_branch")
    if low:
        coef = np.asarray(low["coefficients"], dtype=float)
        x0 = float(np.min(cy[np.asarray(low["good_indices"], dtype=int)])) if low.get("good_indices") else xmin
        x1 = float(branches.get("crossing", {}).get("mount_yaw_deg", xmax))
        xs = np.linspace(x0, x1, 80)
        ys = np.polyval(coef, xs)
        svg.extend(_polyline_svg(xs, ys, left, top, width, height, cy, d2pk, klass="fit1", ymin=ymin, ymax=ymax))
    if high:
        coef = np.asarray(high["coefficients"], dtype=float)
        x0 = float(branches.get("crossing", {}).get("mount_yaw_deg", xmin))
        x1 = float(np.max(cy[np.asarray(high["good_indices"], dtype=int)])) if high.get("good_indices") else xmax
        xs = np.linspace(x0, x1, 80)
        ys = np.polyval(coef, xs)
        svg.extend(_polyline_svg(xs, ys, left, top, width, height, cy, d2pk, klass="fit5", ymin=ymin, ymax=ymax))
    crossing = branches.get("crossing")
    if crossing:
        svg.extend(_marker_svg(left, top, width, height, xmin, xmax, ymin, ymax, float(crossing["mount_yaw_deg"]), float(crossing["d2_peak_pct"]), "marker-black", kind="star"))


def _panel_svg(x_series, y_series, classes, label, xlabel, left, top, width, height, ymin=None, ymax=None):
    all_x = np.concatenate([np.asarray(x, dtype=float) for x in x_series if len(x)])
    xmin = float(np.min(all_x))
    xmax = float(np.max(all_x))
    if xmin == xmax:
        xmax = xmin + 1.0
    ymin_auto, ymax_auto = _series_bounds(y_series, ymin, ymax)
    bottom = top + height

    svg = [
        f'<text x="{left}" y="{top - 12:.1f}" class="label">{_escape(label)}</text>',
        f'<line x1="{left}" y1="{bottom:.1f}" x2="{left + width}" y2="{bottom:.1f}" class="axis"/>',
        f'<line x1="{left}" y1="{top:.1f}" x2="{left}" y2="{bottom:.1f}" class="axis"/>',
    ]

    for i in range(5):
        frac = i / 4
        gy = top + height * frac
        yv = ymax_auto - (ymax_auto - ymin_auto) * frac
        svg.append(f'<line x1="{left}" y1="{gy:.1f}" x2="{left + width}" y2="{gy:.1f}" class="grid"/>')
        svg.append(f'<text x="{left - 8}" y="{gy + 4:.1f}" text-anchor="end" class="small">{yv:.3g}</text>')
    for i in range(5):
        frac = i / 4
        gx = left + width * frac
        xv = xmin + (xmax - xmin) * frac
        svg.append(f'<line x1="{gx:.1f}" y1="{top}" x2="{gx:.1f}" y2="{bottom}" class="grid"/>')
        svg.append(f'<text x="{gx:.1f}" y="{bottom + 18:.1f}" text-anchor="middle" class="small">{xv:.3g}</text>')
    svg.append(f'<text x="{left + width / 2:.1f}" y="{bottom + 34:.1f}" text-anchor="middle" class="small">{_escape(xlabel)}</text>')

    for x, y, klass in zip(x_series, y_series, classes):
        svg.extend(_polyline_svg(x, y, left, top, width, height, all_x, np.array([ymin_auto, ymax_auto]), klass=klass, ymin=ymin_auto, ymax=ymax_auto))
    return svg


def _polyline_svg(x, y, left, top, width, height, x_ref, y_ref, klass, ymin=None, ymax=None):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    xmin = float(np.min(np.asarray(x_ref, dtype=float)))
    xmax = float(np.max(np.asarray(x_ref, dtype=float)))
    if xmin == xmax:
        xmax = xmin + 1.0
    ymin_auto, ymax_auto = _series_bounds([np.asarray(y_ref, dtype=float)], ymin, ymax)
    points = []
    lines = []
    for xv, yv in zip(x, y):
        if not np.isfinite(xv) or not np.isfinite(yv):
            if len(points) >= 2:
                lines.append(f'<polyline points="{" ".join(points)}" class="{klass}"/>')
            points = []
            continue
        px = left + (float(xv) - xmin) / (xmax - xmin) * width
        py = top + (ymax_auto - float(yv)) / (ymax_auto - ymin_auto) * height
        points.append(f"{px:.2f},{py:.2f}")
    if len(points) >= 2:
        lines.append(f'<polyline points="{" ".join(points)}" class="{klass}"/>')
    return lines


def _scatter_svg(x, y, left, top, width, height, klass, ymin=None, ymax=None):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    xmin = float(np.min(x))
    xmax = float(np.max(x))
    ymin, ymax = _series_bounds([y], ymin, ymax)
    svg = []
    for xv, yv in zip(x, y):
        if not np.isfinite(xv) or not np.isfinite(yv):
            continue
        px = left + (float(xv) - xmin) / (xmax - xmin if xmax != xmin else 1.0) * width
        py = top + (ymax - float(yv)) / (ymax - ymin if ymax != ymin else 1.0) * height
        svg.append(f'<circle cx="{px:.2f}" cy="{py:.2f}" r="4.5" class="{klass}"/>')
    return svg


def _marker_svg(left, top, width, height, xmin, xmax, ymin, ymax, x, y, klass, kind="circle"):
    if xmin == xmax:
        xmax = xmin + 1.0
    if ymin == ymax:
        ymax = ymin + 1.0
    px = left + (x - xmin) / (xmax - xmin) * width
    py = top + (ymax - y) / (ymax - ymin) * height
    if kind == "star":
        size = 7.0
        pts = [
            (px, py - size),
            (px + size * 0.35, py - size * 0.35),
            (px + size, py),
            (px + size * 0.35, py + size * 0.35),
            (px, py + size),
            (px - size * 0.35, py + size * 0.35),
            (px - size, py),
            (px - size * 0.35, py - size * 0.35),
        ]
        return [f'<polygon points="{" ".join(f"{x0:.2f},{y0:.2f}" for x0, y0 in pts)}" class="{klass}"/>']
    return [f'<circle cx="{px:.2f}" cy="{py:.2f}" r="5" class="{klass}"/>']


def _legend_svg(left: float, top: float, entries: list[tuple[str, str]], width: float = 280) -> list[str]:
    row_h = 20
    height = 14 + row_h * len(entries)
    lines = [f'<rect x="{left:.1f}" y="{top:.1f}" width="{width}" height="{height}" rx="6" ry="6" class="legend-bg"/>']
    for idx, (klass, label) in enumerate(entries):
        y = top + 18 + idx * row_h
        if klass.startswith("marker"):
            lines.append(f'<circle cx="{left + 32:.1f}" cy="{y:.1f}" r="4.5" class="{klass}"/>')
        else:
            lines.append(f'<line x1="{left + 12:.1f}" y1="{y:.1f}" x2="{left + 52:.1f}" y2="{y:.1f}" class="{klass}"/>')
        lines.append(f'<text x="{left + 60:.1f}" y="{y + 4:.1f}" class="small">{_escape(label)}</text>')
    return lines


def _series_bounds(y_series, ymin, ymax):
    if ymin is None or ymax is None:
        all_y = np.concatenate([np.asarray(y, dtype=float)[np.isfinite(y)] for y in y_series if np.any(np.isfinite(y))])
        if ymin is None:
            ymin = float(np.min(all_y))
        if ymax is None:
            ymax = float(np.max(all_y))
    if ymin == ymax:
        pad = 1.0 if ymin == 0 else abs(ymin) * 0.1
        return float(ymin - pad), float(ymax + pad)
    if ymin == 0.0:
        return float(ymin), float(ymax)
    pad = 0.05 * (ymax - ymin)
    return float(ymin - pad), float(ymax + pad)


def _x_bounds(x_series):
    all_x = np.concatenate([np.asarray(x, dtype=float) for x in x_series if len(x)])
    xmin = float(np.min(all_x))
    xmax = float(np.max(all_x))
    if xmin == xmax:
        xmax = xmin + 1.0
    return xmin, xmax


def _branch_slope_label(branch: dict | None, prefix: str) -> str:
    if not branch or "coefficients" not in branch:
        return prefix.strip() + "n/a"
    slope = float(branch["coefficients"][0])
    return f"{prefix}{slope:.3g}"


def _cross_label(crossing: dict | None, y_key: str) -> str:
    if not crossing:
        return "n/a"
    return f"[{float(crossing['mount_yaw_deg']):.3g}, {float(crossing[y_key]):.3g}]°"


def _min_label(quad: dict | None) -> str:
    if not quad or "minimum_mount_yaw_deg" not in quad or "minimum_d2_peak_pct" not in quad:
        return "Min: n/a"
    return f"Min: [{float(quad['minimum_mount_yaw_deg']):.3g}, {float(quad['minimum_d2_peak_pct']):.3g}]"


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )

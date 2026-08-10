from __future__ import annotations

from pathlib import Path

import numpy as np

from wallyanalyzer.schemas import MeasurementResult

SVG_WIDTH = 1200
SVG_HEIGHT = 1280
MARGIN_LEFT = 80
MARGIN_RIGHT = 30
MARGIN_TOP = 50
MARGIN_BOTTOM = 40
PANEL_GAP = 30


def render_measurement_validation_svg(
    result: MeasurementResult,
    output_path: str | Path,
    title: str | None = None,
) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    n_panels = 6
    panel_height = (SVG_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - PANEL_GAP * (n_panels - 1)) / n_panels
    panel_width = SVG_WIDTH - MARGIN_LEFT - MARGIN_RIGHT

    radius_mm = np.linspace(result.outer_radius_mm, result.inner_radius_mm, len(result.segment_start_samples))
    lag_us = result.lag_s * 1e6
    freq_left = result.fundamental_freq_hz[:, 0]
    freq_right = result.fundamental_freq_hz[:, 1]
    harm2_pct = 100.0 * result.harmonic_amplitude[:, 1] / result.harmonic_amplitude[:, 0]
    harm3_pct = 100.0 * result.harmonic_amplitude[:, 2] / result.harmonic_amplitude[:, 0]
    lag_diff_raw_db = result.lag_difference_db[:, 0] if result.lag_difference_db.size else np.full_like(lag_us, np.nan)
    lag_diff_delagged_db = result.lag_difference_db[:, 1] if result.lag_difference_db.size else np.full_like(lag_us, np.nan)
    harmonic_lr_diff_pct = 100.0 * result.harmonic_lr_difference_ratio if result.harmonic_lr_difference_ratio.size else np.full_like(lag_us, np.nan)
    noise_left_ratio_pct_raw = 100.0 * result.power_noise[:, 2] / result.power_noise[:, 0] if result.power_noise.size else np.full_like(lag_us, np.nan)
    noise_right_ratio_pct_raw = 100.0 * result.power_noise[:, 3] / result.power_noise[:, 1] if result.power_noise.size else np.full_like(lag_us, np.nan)
    noise_left_excess_ratio_pct = _noise_excess_ratio_pct(result.power_noise[:, 2], result.power_noise[:, 0]) if result.power_noise.size else np.full_like(lag_us, np.nan)
    noise_right_excess_ratio_pct = _noise_excess_ratio_pct(result.power_noise[:, 3], result.power_noise[:, 1]) if result.power_noise.size else np.full_like(lag_us, np.nan)
    valid = result.valid_mask.astype(bool)

    content: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" viewBox="0 0 {SVG_WIDTH} {SVG_HEIGHT}">',
        '<style>text{font-family:Arial,sans-serif;fill:#000} .title{font-size:22px;font-weight:bold} .label{font-size:14px} .small{font-size:12px;fill:#000} .axis{stroke:#444;stroke-width:1} .grid{stroke:#ddd;stroke-width:1} .invalid{fill:#999;opacity:0.35} .line1{fill:none;stroke:#1f77b4;stroke-width:1.5} .line2{fill:none;stroke:#d62728;stroke-width:1.5} .line3{fill:none;stroke:#2ca02c;stroke-width:1.5} .line4{fill:none;stroke:#9467bd;stroke-width:1.5}</style>',
        f'<rect x="0" y="0" width="{SVG_WIDTH}" height="{SVG_HEIGHT}" fill="#fff"/>',
        f'<text x="{MARGIN_LEFT}" y="28" class="title">{_escape(title or f"Measurement validation: {result.file_stem}")}</text>',
        f'<text x="{MARGIN_LEFT}" y="46" class="small">valid segments: {int(np.count_nonzero(valid))} / {len(valid)} | Fs={result.sample_rate_hz_effective:.0f} Hz | pitch={_fmt_optional(result.pitch_estimate)}</text>',
        f'<text x="{MARGIN_LEFT}" y="64" class="small">DdB raw/deLagged={_fmt_optional(_safe_nanmean(lag_diff_raw_db))} / {_fmt_optional(_safe_nanmean(lag_diff_delagged_db))} dB | ΔLR={_fmt_optional(_safe_nanmean(harmonic_lr_diff_pct))}% | PNx L/R={_fmt_optional(_safe_nanmean(noise_left_excess_ratio_pct))}% / {_fmt_optional(_safe_nanmean(noise_right_excess_ratio_pct))}%</text>',
    ]

    panels = [
        ("Lag (µs)", [(lag_us, valid, "line1")], None),
        ("Frequency (Hz)", [(freq_left, valid, "line1"), (freq_right, valid, "line2")], [("line1", "Left"), ("line2", "Right")]),
        ("2nd harmonic (%)", [(harm2_pct, valid, "line3")], None),
        ("3rd harmonic (%)", [(harm3_pct, valid, "line4")], None),
        ("dB((L-R)/(L+R))", [(lag_diff_raw_db, valid, "line2"), (lag_diff_delagged_db, valid, "line1")], [("line2", "Raw"), ("line1", "deLagged")]),
        ("ΔLR / Fundamental (%) and PNx excess (%)", [(harmonic_lr_diff_pct, valid, "line4"), (noise_left_excess_ratio_pct, valid, "line3"), (noise_right_excess_ratio_pct, valid, "line2")], [("line4", "ΔLR"), ("line3", "PNx Left"), ("line2", "PNx Right")]),
    ]

    for panel_index, (label, series_list, legend_entries) in enumerate(panels):
        top = MARGIN_TOP + panel_index * (panel_height + PANEL_GAP)
        content.extend(
            _panel_svg(
                x=radius_mm,
                y_series=series_list,
                label=label,
                left=MARGIN_LEFT,
                top=top,
                width=panel_width,
                height=panel_height,
                legend_entries=legend_entries,
            )
        )

    content.append("</svg>")
    output.write_text("\n".join(content), encoding="utf-8")
    return output


def _panel_svg(
    x: np.ndarray,
    y_series: list[tuple[np.ndarray, np.ndarray, str]],
    label: str,
    left: float,
    top: float,
    width: float,
    height: float,
    legend_entries: list[tuple[str, str]] | None = None,
) -> list[str]:
    valid_y_values = []
    for y, mask, _klass in y_series:
        keep = mask & np.isfinite(y)
        if np.any(keep):
            valid_y_values.append(y[keep])
    if not valid_y_values:
        ymin, ymax = -1.0, 1.0
    else:
        all_y = np.concatenate(valid_y_values)
        ymin = float(np.min(all_y))
        ymax = float(np.max(all_y))
        if ymin == ymax:
            pad = 1.0 if ymin == 0 else abs(ymin) * 0.1
            ymin -= pad
            ymax += pad
        else:
            pad = 0.05 * (ymax - ymin)
            ymin -= pad
            ymax += pad

    xmin = float(np.nanmin(x))
    xmax = float(np.nanmax(x))
    if xmin == xmax:
        xmax = xmin + 1.0

    bottom = top + height
    svg = [
        f'<text x="{left}" y="{top - 10:.1f}" class="label">{_escape(label)}</text>',
        f'<line x1="{left}" y1="{bottom:.1f}" x2="{left + width}" y2="{bottom:.1f}" class="axis"/>',
        f'<line x1="{left}" y1="{top:.1f}" x2="{left}" y2="{bottom:.1f}" class="axis"/>',
    ]

    for i in range(5):
        frac = i / 4 if 4 else 0
        gy = top + height * frac
        yv = ymax - (ymax - ymin) * frac
        svg.append(f'<line x1="{left}" y1="{gy:.1f}" x2="{left + width}" y2="{gy:.1f}" class="grid"/>')
        svg.append(f'<text x="{left - 8}" y="{gy + 4:.1f}" text-anchor="end" class="small">{yv:.3g}</text>')

    for i in range(5):
        frac = i / 4 if 4 else 0
        gx = left + width * frac
        xv = xmin + (xmax - xmin) * frac
        svg.append(f'<line x1="{gx:.1f}" y1="{top}" x2="{gx:.1f}" y2="{bottom}" class="grid"/>')
        svg.append(f'<text x="{gx:.1f}" y="{bottom + 18:.1f}" text-anchor="middle" class="small">{xv:.3g}</text>')

    svg.append(f'<text x="{left + width / 2:.1f}" y="{bottom + 34:.1f}" text-anchor="middle" class="small">Radius (mm)</text>')

    invalid_mask = None
    for _y, mask, _klass in y_series:
        invalid_mask = ~mask if invalid_mask is None else (invalid_mask | ~mask)
    if invalid_mask is not None and np.any(invalid_mask):
        for idx in np.flatnonzero(invalid_mask):
            x0 = _map_x(x[idx], xmin, xmax, left, width)
            svg.append(f'<circle cx="{x0:.2f}" cy="{bottom - 4:.2f}" r="2" class="invalid"/>')

    for y, mask, klass in y_series:
        points = []
        keep = mask & np.isfinite(y)
        for xv, yv, ok in zip(x, y, keep):
            if not ok:
                if len(points) >= 2:
                    svg.append(f'<polyline points="{" ".join(points)}" class="{klass}"/>')
                points = []
                continue
            px = _map_x(float(xv), xmin, xmax, left, width)
            py = _map_y(float(yv), ymin, ymax, top, height)
            points.append(f"{px:.2f},{py:.2f}")
        if len(points) >= 2:
            svg.append(f'<polyline points="{" ".join(points)}" class="{klass}"/>')

    if legend_entries:
        svg.extend(_legend_svg(left + width - 170, top + 10, legend_entries))

    return svg


def _legend_svg(left: float, top: float, entries: list[tuple[str, str]]) -> list[str]:
    width = 150
    line_height = 18
    height = 14 + line_height * len(entries)
    svg = [
        f'<rect x="{left:.1f}" y="{top:.1f}" width="{width}" height="{height}" fill="#fff" stroke="#555" stroke-width="1"/>',
    ]
    for index, (klass, label) in enumerate(entries):
        y = top + 14 + index * line_height
        svg.append(f'<line x1="{left + 10:.1f}" y1="{y - 4:.1f}" x2="{left + 34:.1f}" y2="{y - 4:.1f}" class="{klass}"/>')
        svg.append(f'<text x="{left + 42:.1f}" y="{y:.1f}" class="small">{_escape(label)}</text>')
    return svg


def _map_x(value: float, xmin: float, xmax: float, left: float, width: float) -> float:
    return left + (value - xmin) / (xmax - xmin) * width


def _map_y(value: float, ymin: float, ymax: float, top: float, height: float) -> float:
    return top + (ymax - value) / (ymax - ymin) * height


def _fmt_optional(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.6g}"


def _safe_nanmean(values: np.ndarray) -> float | None:
    array = np.asarray(values, dtype=float)
    valid = array[np.isfinite(array)]
    if valid.size == 0:
        return None
    return float(np.mean(valid))


def _noise_excess_ratio_pct(noise_power: np.ndarray, total_power: np.ndarray) -> np.ndarray:
    noise_power = np.asarray(noise_power, dtype=float)
    total_power = np.asarray(total_power, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = 100.0 * np.maximum(0.0, 2.0 * noise_power / total_power - 1.0)
    return ratio


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )

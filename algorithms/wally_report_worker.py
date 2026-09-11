"""Tracking Error artifact builder used by the private analysis worker image.

The cloud adapter supplies an isolated temporary directory and uploads only returned files.
No credentials are read here; AWS access belongs to the adapter role.
"""
from __future__ import annotations
import hashlib
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any
from wallyanalyzer.metadata.provider import InMemoryMetadataProvider
from wallyanalyzer.pipelines.compile_sine import compile_sine_results
from wallyanalyzer.pipelines.measure_sine import measure_sine_file
from wallyanalyzer.output.compile_svg_plots import render_compile_validation_svg, render_compile_sweep_svg
from wallyanalyzer.schemas.metadata import AcquisitionRecord, CartridgeRecord, SystemRecord, TestTrackRecord

PRESET = {
    "name": "RTI Test 1 Track 1 Side A", "outer_radius_mm": 144.5, "inner_radius_mm": 58.5,
    "digitizer": "Cosmos", "effective_length_mm": 245.0, "offset_angle_deg": 22.42,
    "overhang_mm": 16.9, "cantilever_yaw_deg": 0.0, "stylus_yaw_deg": -0.2,
    "actual_pivot_to_spindle_mm": 228.1,
    "system_id": 1,
    "cartridge_name": "Tracking Error reference cartridge",
    "cartridge_lr_um": 10.0,
}

def build_tracking_error_artifacts(inputs: list[Path], output_dir: Path, system_name: str) -> list[dict[str, Any]]:
    """Build deterministic-named artifacts for ordered WAV inputs.

    Timestamps are intentionally absent from asserted JSON fields. SVG rendering has a display
    timestamp, so tests assert artifact existence/shape rather than byte equality.
    """
    if not inputs:
        raise ValueError("Tracking Error requires at least one WAV input")
    output_dir.mkdir(parents=True, exist_ok=True)
    provider = _provider(inputs)
    measurements = [measure_sine_file(path, provider) for path in inputs]
    compiled = compile_sine_results(measurements, provider)
    artifacts: list[dict[str, Any]] = []
    for index, result in enumerate(compiled.single_results):
        svg = output_dir / f"tracking-error-{index + 1}.svg"
        render_compile_validation_svg(result, svg, title=f"Tracking Error — {system_name}")
        artifacts.append(_artifact(svg, "graph_svg", "image/svg+xml"))
        if index == 0:
            pdf = output_dir / "tracking-error.pdf"
            _svg_to_pdf(svg, pdf)
            artifacts.append(_artifact(pdf, "report_pdf", "application/pdf"))
    if compiled.aggregate_summary is not None:
        sweep = output_dir / "tracking-error-sweep.svg"
        render_compile_sweep_svg(compiled, sweep, title=f"Tracking Error sweep — {system_name}")
        artifacts.append(_artifact(sweep, "graph_svg", "image/svg+xml"))
    metrics = output_dir / "metrics.json"
    metrics.write_text(json.dumps({"reportType":"Tracking Error","algorithmVersion":"1.0.0","preset":"RTI Test 1 Track 1 Side A","fixedDemoAssumptions":PRESET,"inputCount":len(inputs),"systemName":system_name,"measurements":[{"file":m.file_stem,"validSegments":m.diagnostics["n_valid_segments"],"processingSeconds":m.processing_time_s} for m in measurements]}, indent=2), encoding="utf-8")
    artifacts.append(_artifact(metrics, "metrics_json", "application/json"))
    manifest = output_dir / "manifest.json"
    manifest.write_text(json.dumps({"algorithm":"tracking-error","algorithmVersion":"1.0.0","presetSnapshot":PRESET,"fixedDemoNotice":"This report uses fixed demonstration alignment assumptions; future parameter resolution may use saved system data.","artifacts":artifacts}, indent=2), encoding="utf-8")
    artifacts.append(_artifact(manifest, "manifest", "application/json"))
    return artifacts

def _provider(inputs: list[Path]) -> InMemoryMetadataProvider:
    track = TestTrackRecord(name=PRESET["name"], outer_radius_mm=PRESET["outer_radius_mm"], inner_radius_mm=PRESET["inner_radius_mm"])
    acquisitions = {path.stem: AcquisitionRecord(file_stem=path.stem, digitizer=PRESET["digitizer"], test_track_name=PRESET["name"], system_id=PRESET["system_id"], cartridge_name=PRESET["cartridge_name"], cantilever_yaw_deg=PRESET["cantilever_yaw_deg"], stylus_yaw_deg=PRESET["stylus_yaw_deg"], effective_length_mm=PRESET["effective_length_mm"], offset_angle_deg=PRESET["offset_angle_deg"], overhang_mm=PRESET["overhang_mm"], actual_pivot_to_spindle_mm=PRESET["actual_pivot_to_spindle_mm"]) for path in inputs}
    cartridge = CartridgeRecord(cartridge_name=PRESET["cartridge_name"], lr_um=PRESET["cartridge_lr_um"])
    return InMemoryMetadataProvider(acquisitions=acquisitions, test_tracks={track.name: track}, cartridges={cartridge.cartridge_name: cartridge}, systems={PRESET["system_id"]: SystemRecord(system_id=PRESET["system_id"])})

def _svg_to_pdf(svg: Path, pdf: Path) -> None:
    try:
        import cairosvg
    except ModuleNotFoundError as error:  # image build installs the pinned dependency
        raise RuntimeError('CairoSVG is required to generate the report PDF.') from error
    cairosvg.svg2pdf(url=str(svg), write_to=str(pdf))

def _artifact(path: Path, kind: str, content_type: str) -> dict[str, Any]:
    return {"kind":kind,"fileName":path.name,"contentType":content_type,"byteLength":path.stat().st_size,"checksumSha256":hashlib.sha256(path.read_bytes()).hexdigest()}

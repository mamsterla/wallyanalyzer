from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Iterable


class SvgRenderError(RuntimeError):
    pass


def find_inkscape_executable() -> str | None:
    return shutil.which("inkscape")


def render_svg_to_png(
    svg_path: str | Path,
    png_path: str | Path | None = None,
    *,
    width: int = 1600,
    inkscape: str | None = None,
) -> Path:
    svg = Path(svg_path)
    if not svg.exists():
        raise SvgRenderError(f"SVG file not found: {svg}")

    exe = inkscape or find_inkscape_executable()
    if not exe:
        raise SvgRenderError("Inkscape not found in PATH")

    png = Path(png_path) if png_path is not None else svg.with_suffix(svg.suffix + ".png")
    png.parent.mkdir(parents=True, exist_ok=True)

    command = [
        exe,
        str(svg),
        "--export-type=png",
        f"--export-filename={png}",
        f"--export-width={int(width)}",
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError as exc:
        raise SvgRenderError(f"Inkscape render failed for {svg}") from exc
    return png


def render_svg_batch_to_png(
    svg_paths: Iterable[str | Path],
    output_dir: str | Path,
    *,
    width: int = 1600,
    inkscape: str | None = None,
) -> list[Path]:
    rendered_dir = Path(output_dir)
    rendered_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[Path] = []
    for svg_path in svg_paths:
        svg = Path(svg_path)
        outputs.append(render_svg_to_png(svg, rendered_dir / f"{svg.name}.png", width=width, inkscape=inkscape))
    return outputs

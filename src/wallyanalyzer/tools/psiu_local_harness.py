"""Local-only PSIU capture harness for algorithm development.

This tool talks only to a PSIU on the local LAN. It never uploads audio or
contacts Wally production services. Captures are written under git-ignored data/
paths for rapid local analysis iteration.
"""
from __future__ import annotations

import argparse
import http.client
import json
import sys
import time
import urllib.parse
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

DEFAULT_BASE_URL = "http://psiu.local"


class PsiuCaptureNotReady(RuntimeError):
    pass


class PsiuSession:
    """One keep-alive HTTP connection, matching the browser bridge lifecycle."""

    def __init__(self, base_url: str):
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme != "http" or not parsed.hostname:
            raise ValueError("PSIU base URL must be an http URL with a hostname.")
        self.base_url = base_url.rstrip("/")
        self.path_prefix = parsed.path.rstrip("/")
        self.connection = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=10)

    def close(self) -> None:
        self.connection.close()

    def request(self, path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> tuple[int, bytes]:
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"content-type": "application/json"} if payload else {}
        try:
            self.connection.request(method, f"{self.path_prefix}{path}", body=payload, headers=headers)
            response = self.connection.getresponse()
            return response.status, response.read()
        except (OSError, http.client.HTTPException) as error:
            self.close()
            raise RuntimeError(f"PSIU is unavailable at {self.base_url}: {error}") from error


def psiu_request(base_url: str, path: str, *, method: str = "GET", body: dict[str, Any] | None = None, session: PsiuSession | None = None) -> bytes:
    temporary = session is None
    active_session = session or PsiuSession(base_url)
    try:
        status, content = active_session.request(path, method=method, body=body)
    finally:
        if temporary:
            active_session.close()
    if status == 404 and path == "/audio.wav":
        raise PsiuCaptureNotReady("PSIU has not finalized the completed WAV.")
    if status < 200 or status >= 300:
        raise RuntimeError(f"PSIU returned HTTP {status} for {path}.")
    return content


def psiu_json(base_url: str, path: str, *, method: str = "GET", body: dict[str, Any] | None = None, session: PsiuSession | None = None) -> dict[str, Any]:
    value = json.loads(psiu_request(base_url, path, method=method, body=body, session=session))
    if not isinstance(value, dict):
        raise RuntimeError(f"PSIU returned an invalid JSON object for {path}.")
    return value


def status_with_retry(base_url: str, session: PsiuSession, attempts: int = 3) -> dict[str, Any]:
    error: RuntimeError | None = None
    for attempt in range(attempts):
        try:
            return psiu_json(base_url, "/status", session=session)
        except RuntimeError as caught:
            error = caught
            if attempt + 1 < attempts:
                time.sleep(1)
    raise error or RuntimeError("PSIU status is unavailable.")


def select_input(base_url: str, xlr: bool) -> dict[str, Any]:
    result = psiu_json(base_url, "/api/inputsel", method="POST", body={"xlr": xlr})
    if result.get("xlr") is not xlr:
        raise RuntimeError("PSIU did not confirm the requested input selection.")
    return result


def set_recording(base_url: str, session: PsiuSession, running: bool) -> dict[str, Any]:
    request_error: RuntimeError | None = None
    try:
        psiu_json(base_url, "/api/sampling", method="POST", body={"running": running}, session=session)
    except RuntimeError as error:
        request_error = error
    status = status_with_retry(base_url, session)
    if status.get("recording") is running:
        return status
    if request_error:
        raise request_error
    raise RuntimeError(f"PSIU did not confirm recording={running}.")


def start_capture(base_url: str, session: PsiuSession) -> dict[str, Any]:
    return set_recording(base_url, session, True)


def stop_capture(base_url: str, session: PsiuSession) -> dict[str, Any]:
    return set_recording(base_url, session, False)


def completed_wav(base_url: str, wait_seconds: float, session: PsiuSession) -> bytes:
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            return psiu_request(base_url, "/audio.wav", session=session)
        except PsiuCaptureNotReady:
            if time.monotonic() >= deadline:
                raise RuntimeError(f"PSIU did not retain a completed WAV within {wait_seconds:.0f} seconds of Stop.")
            time.sleep(1)


def capture(base_url: str, seconds: float, output_dir: Path, audio_wait_seconds: float = 30, status_interval_seconds: float = 5) -> Path:
    if seconds <= 0 or seconds > 3_600:
        raise ValueError("Capture duration must be greater than zero and no more than one hour.")
    if audio_wait_seconds < 0 or audio_wait_seconds > 300:
        raise ValueError("Completed-WAV wait must be from zero to 300 seconds.")
    if status_interval_seconds <= 0 or status_interval_seconds > 60:
        raise ValueError("Status interval must be greater than zero and no more than 60 seconds.")
    session = PsiuSession(base_url)
    try:
        status = start_capture(base_url, session)
        if not status.get("recording"):
            raise RuntimeError("PSIU did not confirm recording after start.")
        started = time.monotonic()
        try:
            while True:
                elapsed = time.monotonic() - started
                progress = status_with_retry(base_url, session)
                print(json.dumps({"event": "capture_progress", "elapsedSeconds": round(elapsed, 1), "remainingSeconds": round(max(0, seconds - elapsed), 1), "status": progress}), file=sys.stderr, flush=True)
                if not progress.get("recording"):
                    raise RuntimeError("PSIU stopped recording before the requested capture duration.")
                remaining = seconds - elapsed
                if remaining <= 0:
                    break
                time.sleep(min(status_interval_seconds, remaining))
        finally:
            stop_capture(base_url, session)
        audio = completed_wav(base_url, audio_wait_seconds, session)
    finally:
        session.close()
    if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise RuntimeError("PSIU did not return a WAV capture.")
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"psiu-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.wav"
    output.write_bytes(audio)
    return output


def wav_metadata(path: Path) -> dict[str, int | float]:
    with wave.open(str(path), "rb") as source:
        if source.getcomptype() != "NONE":
            raise ValueError("Only uncompressed PCM WAV captures are supported.")
        frames = source.getnframes()
        rate = source.getframerate()
        return {
            "sampleRateHz": rate,
            "channels": source.getnchannels(),
            "bitsPerSample": source.getsampwidth() * 8,
            "frames": frames,
            "durationSeconds": frames / rate,
        }


def _pcm_samples(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as source:
        if source.getcomptype() != "NONE" or source.getsampwidth() not in {2, 3, 4}:
            raise ValueError("Expected uncompressed 16-, 24-, or 32-bit PCM WAV.")
        channels, rate, width, frames = source.getnchannels(), source.getframerate(), source.getsampwidth(), source.getnframes()
        raw = source.readframes(frames)
    if width == 2:
        values = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 2**15
    elif width == 4:
        values = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2**31
    else:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        signed = packed[:, 0].astype(np.int32) | (packed[:, 1].astype(np.int32) << 8) | (packed[:, 2].astype(np.int32) << 16)
        values = np.where(signed & 0x800000, signed - 0x1000000, signed).astype(np.float64) / 2**23
    return values.reshape(-1, channels), rate


def active_tone_region(samples: np.ndarray, rate: int, block_seconds: float = 0.25) -> tuple[int, int]:
    """Find the loud contiguous program region, excluding quiet lead-in/runout."""
    block = max(1, round(rate * block_seconds))
    mono = np.mean(samples, axis=1)
    count = len(mono) // block
    if count < 4:
        raise ValueError("Capture is too short to identify lead-in and runout.")
    rms = np.array([np.sqrt(np.mean(mono[index * block : (index + 1) * block] ** 2)) for index in range(count)])
    peak_dbfs = 20 * np.log10(max(float(np.max(rms)), 1e-12))
    threshold = 10 ** ((peak_dbfs - 25) / 20)
    active = rms >= threshold
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(active):
        if value and start is None:
            start = index
        elif not value and start is not None:
            runs.append((start, index))
            start = None
    if start is not None:
        runs.append((start, count))
    if not runs:
        raise ValueError("No sufficiently strong program region was found.")
    first, last = max(runs, key=lambda item: item[1] - item[0])
    return first * block, min(len(mono), last * block)


def estimate_tone_hz(samples: np.ndarray, rate: int, nominal_hz: float) -> list[float]:
    """FFT peak estimate for quick track verification, not a compliance metric."""
    length = min(len(samples), round(rate * 2))
    if length < round(rate * 0.25):
        raise ValueError("Need at least 250 ms to verify the tone frequency.")
    window = np.hanning(length)
    frequencies = np.fft.rfftfreq(length, 1 / rate)
    lower, upper = nominal_hz - 50, nominal_hz + 50
    selected = (frequencies >= lower) & (frequencies <= upper)
    output: list[float] = []
    for channel in range(samples.shape[1]):
        magnitude = np.abs(np.fft.rfft(samples[:length, channel] * window))
        bins = np.flatnonzero(selected)
        peak = bins[np.argmax(magnitude[selected])]
        if peak == 0 or peak == len(magnitude) - 1:
            output.append(float(frequencies[peak])); continue
        left, center, right = np.log(np.maximum(magnitude[peak - 1 : peak + 2], 1e-30))
        offset = 0.5 * (left - right) / (left - 2 * center + right)
        output.append(float((peak + offset) * rate / length))
    return output


def _peak_bin(frequencies: np.ndarray, dbfs: np.ndarray, target_hz: float, search_hz: float = 50) -> int:
    candidates = np.flatnonzero((frequencies >= target_hz - search_hz) & (frequencies <= target_hz + search_hz))
    if not len(candidates):
        raise ValueError(f"No FFT bins are available near {target_hz:.1f} Hz.")
    return int(candidates[np.argmax(dbfs[candidates])])


def spectral_diagnostics(samples: np.ndarray, rate: int, nominal_hz: float) -> tuple[list[dict[str, Any]], np.ndarray, list[np.ndarray]]:
    """Return channel-level FFT signal, noise floor, and harmonic measurements."""
    length = min(len(samples), round(rate * 10))
    if length < round(rate * 1):
        raise ValueError("Need at least one second of program material for FFT diagnostics.")
    window = np.hanning(length)
    frequencies = np.fft.rfftfreq(length, 1 / rate)
    upper_noise_hz = min(20_000.0, rate / 2 - 1)
    diagnostics: list[dict[str, Any]] = []
    spectra: list[np.ndarray] = []
    for channel in range(samples.shape[1]):
        peak_amplitude = 2 * np.abs(np.fft.rfft(samples[:length, channel] * window)) / np.sum(window)
        dbfs = 20 * np.log10(np.maximum(peak_amplitude, 1e-15))
        fundamental = _peak_bin(frequencies, dbfs, nominal_hz)
        fundamental_hz = float(frequencies[fundamental])
        mask = (frequencies >= 20) & (frequencies <= upper_noise_hz)
        for order in range(1, 8):
            target = fundamental_hz * order
            if target > upper_noise_hz:
                break
            mask &= np.abs(frequencies - target) > 5
        noise_floor_dbfs = float(np.median(dbfs[mask]))
        noise_rms = float(np.sqrt(np.sum((peak_amplitude[mask] / np.sqrt(2)) ** 2)))
        fundamental_rms = float(peak_amplitude[fundamental] / np.sqrt(2))
        harmonics = []
        for order in (2, 3):
            target = fundamental_hz * order
            if target >= rate / 2:
                continue
            index = _peak_bin(frequencies, dbfs, target, search_hz=10)
            harmonics.append({"order": order, "frequencyHz": float(frequencies[index]), "levelDbfs": float(dbfs[index]), "levelDbc": float(dbfs[index] - dbfs[fundamental])})
        diagnostics.append({
            "fundamentalHz": fundamental_hz,
            "fundamentalPeakDbfs": float(dbfs[fundamental]),
            "noiseFloorDbfsPerBin": noise_floor_dbfs,
            "peakToNoiseFloorDb": float(dbfs[fundamental] - noise_floor_dbfs),
            "broadbandSnrDb": float(20 * np.log10(max(fundamental_rms, 1e-15) / max(noise_rms, 1e-15))),
            "harmonics": harmonics,
        })
        spectra.append(dbfs)
    return diagnostics, frequencies, spectra


def write_spectrum_svg(path: Path, frequencies: np.ndarray, spectra: list[np.ndarray]) -> None:
    """Write a compact 20 Hz–20 kHz FFT review plot without plotting dependencies."""
    path.parent.mkdir(parents=True, exist_ok=True)
    left, right, top, bottom, width, height = 72, 24, 28, 44, 1080, 480
    limit = min(20_000.0, float(frequencies[-1]))
    selected = (frequencies >= 20) & (frequencies <= limit)
    indices = np.flatnonzero(selected)[::max(1, int(np.count_nonzero(selected) / 2_000))]
    def points(values: np.ndarray) -> str:
        return " ".join(f"{left + (frequencies[index] - 20) / (limit - 20) * width:.1f},{top + (-20 - max(-160.0, min(-20.0, values[index]))) / 140 * height:.1f}" for index in indices)
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{left + width + right}" height="{top + height + bottom}" viewBox="0 0 {left + width + right} {top + height + bottom}">', '<rect width="100%" height="100%" fill="white"/>', '<style>text{font:14px Arial;fill:#222}.axis{stroke:#555}.grid{stroke:#ddd}.left{fill:none;stroke:#b7791f;stroke-width:1}.right{fill:none;stroke:#1a5fb4;stroke-width:1}</style>', f'<text x="{left}" y="18">FFT magnitude (dBFS peak) · 20 Hz–20 kHz</text>']
    for value in (-20, -60, -100, -140):
        y = top + (-20 - value) / 140 * height
        lines.extend([f'<line x1="{left}" y1="{y:.1f}" x2="{left + width}" y2="{y:.1f}" class="grid"/>', f'<text x="{left - 8}" y="{y + 5:.1f}" text-anchor="end">{value}</text>'])
    for value in (20, 1_000, 5_000, 10_000, 20_000):
        x = left + (value - 20) / (limit - 20) * width
        lines.extend([f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{top + height}" class="grid"/>', f'<text x="{x:.1f}" y="{top + height + 22}" text-anchor="middle">{value:g} Hz</text>'])
    lines.extend([f'<line x1="{left}" y1="{top + height}" x2="{left + width}" y2="{top + height}" class="axis"/>', f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + height}" class="axis"/>'])
    if spectra: lines.append(f'<polyline points="{points(spectra[0])}" class="left"/>')
    if len(spectra) > 1: lines.append(f'<polyline points="{points(spectra[1])}" class="right"/>')
    lines.extend([f'<text x="{left + width - 120}" y="18" fill="#b7791f">Left</text>', f'<text x="{left + width - 60}" y="18" fill="#1a5fb4">Right</text>', '</svg>'])
    path.write_text("\n".join(lines), encoding="utf-8")


def trim_wav(source_path: Path, output_path: Path, start_frame: int, end_frame: int) -> None:
    with wave.open(str(source_path), "rb") as source:
        if not 0 <= start_frame < end_frame <= source.getnframes():
            raise ValueError("Trim range is outside the WAV capture.")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(output_path), "wb") as output:
            output.setparams(source.getparams())
            source.setpos(start_frame)
            remaining = end_frame - start_frame
            while remaining:
                take = min(remaining, 1_000_000)
                output.writeframesraw(source.readframes(take))
                remaining -= take


def inspect(path: Path, nominal_hz: float, trim_output: Path | None = None, spectrum_output: Path | None = None) -> dict[str, Any]:
    samples, rate = _pcm_samples(path)
    start, end = active_tone_region(samples, rate)
    program = samples[start:end]
    spectrum, frequencies, spectra = spectral_diagnostics(program, rate, nominal_hz)
    result: dict[str, Any] = {
        "source": str(path),
        "metadata": wav_metadata(path),
        "programRegion": {"startSeconds": start / rate, "endSeconds": end / rate, "durationSeconds": (end - start) / rate},
        "toneHz": estimate_tone_hz(program, rate, nominal_hz),
        "nominalToneHz": nominal_hz,
        "fftDiagnostics": spectrum,
    }
    if trim_output:
        trim_wav(path, trim_output, start, end)
        result["trimmedOutput"] = str(trim_output)
    if spectrum_output:
        write_spectrum_svg(spectrum_output, frequencies, spectra)
        result["spectrumOutput"] = str(spectrum_output)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture and inspect local PSIU WAVs without cloud upload.")
    subcommands = parser.add_subparsers(dest="command", required=True)
    input_parser = subcommands.add_parser("input-select", help="Select PSIU XLR or RCA input.")
    input_group = input_parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--xlr", action="store_true", help="Select XLR input.")
    input_group.add_argument("--rca", action="store_true", help="Select RCA input.")
    input_parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    capture_parser = subcommands.add_parser("capture", help="Start PSIU, wait, stop, and save /audio.wav locally.")
    capture_parser.add_argument("--seconds", type=float, required=True)
    capture_parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    capture_parser.add_argument("--output-dir", type=Path, default=Path("data/local-psiu"))
    capture_parser.add_argument("--audio-wait-seconds", type=float, default=30, help="Wait for PSIU to finalize /audio.wav after Stop.")
    capture_parser.add_argument("--status-interval-seconds", type=float, default=5, help="Poll and print PSIU status during capture.")
    inspect_parser = subcommands.add_parser("inspect", help="Inspect a PSIU WAV and optionally trim lead-in/runout.")
    inspect_parser.add_argument("wav", type=Path)
    inspect_parser.add_argument("--nominal-hz", type=float, default=1_000.0)
    inspect_parser.add_argument("--trim-output", type=Path)
    inspect_parser.add_argument("--spectrum-output", type=Path, help="Write a 20 Hz–20 kHz FFT SVG review plot.")
    args = parser.parse_args()
    if args.command == "input-select":
        selected = select_input(args.base_url, args.xlr)
        print(json.dumps({"xlr": selected["xlr"]}))
    elif args.command == "capture":
        print(capture(args.base_url, args.seconds, args.output_dir, args.audio_wait_seconds, args.status_interval_seconds))
    else:
        print(json.dumps(inspect(args.wav, args.nominal_hz, args.trim_output, args.spectrum_output), indent=2))


if __name__ == "__main__":
    main()

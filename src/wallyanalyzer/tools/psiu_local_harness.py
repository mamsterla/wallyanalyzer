"""Local-only PSIU capture harness for algorithm development.

This tool talks only to a PSIU on the local LAN. It never uploads audio or
contacts Wally production services. Captures are written under git-ignored data/
paths for rapid local analysis iteration.
"""
from __future__ import annotations

import argparse
import http.client
import json
from html import escape
import shutil
import subprocess
import sys
import threading
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

    def __init__(self, base_url: str, timeout_seconds: float = 10):
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme != "http" or not parsed.hostname:
            raise ValueError("PSIU base URL must be an http URL with a hostname.")
        self.base_url = base_url.rstrip("/")
        self.path_prefix = parsed.path.rstrip("/")
        self.connection = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=timeout_seconds)

    def close(self) -> None:
        self.connection.close()

    def request(self, path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> tuple[int, bytes]:
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"connection": "keep-alive", **({"content-type": "application/json"} if payload else {})}
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


def status_with_retry(base_url: str, attempts: int = 3) -> dict[str, Any]:
    """/status is a v1.2.8 hand-written one-request connection endpoint."""
    error: RuntimeError | None = None
    for attempt in range(attempts):
        try:
            return psiu_json(base_url, "/status")
        except RuntimeError as caught:
            error = caught
            if attempt + 1 < attempts:
                time.sleep(1)
    raise error or RuntimeError("PSIU status is unavailable.")


def read_signal(base_url: str, attempts: int = 3) -> dict[str, Any]:
    error: RuntimeError | None = None
    for attempt in range(attempts):
        try:
            # PSIU may close a keep-alive connection after /status. Use a fresh
            # connection for this v1.2.7 diagnostic endpoint.
            signal = psiu_json(base_url, "/api/signal")
            if not isinstance(signal.get("L"), (int, float)) or not isinstance(signal.get("R"), (int, float)):
                raise RuntimeError("PSIU returned an invalid /api/signal response.")
            return {"left": signal["L"], "right": signal["R"]}
        except RuntimeError as caught:
            error = caught
            if attempt + 1 < attempts:
                time.sleep(0.25)
    raise error or RuntimeError("PSIU signal is unavailable.")


def capture_health_error(status: dict[str, Any]) -> str | None:
    if status.get("codec_ok") is False:
        return "PSIU codec initialization failed; check firmware and codec hardware."
    if status.get("audio_alive") is False:
        return "PSIU audio clock is not active; check the input path before capture."
    return None


def health(base_url: str) -> dict[str, Any]:
    session = PsiuSession(base_url)
    try:
        status = status_with_retry(base_url)
        result: dict[str, Any] = {"status": status}
        try:
            result["signal"] = read_signal(base_url)
        except RuntimeError as error:
            result["signalError"] = str(error)
        return result
    finally:
        session.close()


def select_input(base_url: str, xlr: bool, attempts: int = 3) -> dict[str, Any]:
    error: RuntimeError | None = None
    for attempt in range(attempts):
        try:
            result = psiu_json(base_url, "/api/inputsel", method="POST", body={"xlr": xlr})
            if result.get("xlr") is xlr:
                return result
            error = RuntimeError("PSIU did not confirm the requested input selection.")
        except RuntimeError as caught:
            error = caught
        # A reset can occur after PSIU applies the relay command. Confirm its
        # durable state before repeating this idempotent selection.
        try:
            status = psiu_json(base_url, "/status")
            if status.get("xlr") is xlr:
                return status
        except RuntimeError as caught:
            error = caught
        if attempt + 1 < attempts:
            time.sleep(0.5)
    raise error or RuntimeError("PSIU did not confirm the requested input selection.")


def set_recording(base_url: str, session: PsiuSession, running: bool, attempts: int = 3) -> dict[str, Any]:
    error: RuntimeError | None = None
    for attempt in range(attempts):
        try:
            psiu_json(base_url, "/api/sampling", method="POST", body={"running": running}, session=session)
        except RuntimeError as caught:
            error = caught
        try:
            status = status_with_retry(base_url)
            if status.get("recording") is running:
                return status
            error = RuntimeError(f"PSIU did not confirm recording={running}.")
        except RuntimeError as caught:
            error = caught
        if attempt + 1 < attempts:
            time.sleep(0.5)
    action_path = "/api/samplestart" if running else "/api/samplestop"
    try:
        # v1.2.7 documented action form: any non-empty body invokes the same
        # recorder operation when the sampling toggle cannot be confirmed.
        psiu_json(base_url, action_path, method="POST", body={"action": True}, session=session)
        status = status_with_retry(base_url)
        if status.get("recording") is running:
            return status
        error = RuntimeError(f"PSIU action endpoint did not confirm recording={running}.")
    except RuntimeError as caught:
        error = caught
    raise error or RuntimeError(f"PSIU did not confirm recording={running}.")


def start_capture(base_url: str, session: PsiuSession) -> dict[str, Any]:
    return set_recording(base_url, session, True)


def stop_capture(base_url: str, session: PsiuSession) -> dict[str, Any]:
    return set_recording(base_url, session, False)


def emit_status(base_url: str, elapsed: float, seconds: float) -> None:
    session = PsiuSession(base_url, timeout_seconds=2)
    try:
        status = psiu_json(base_url, "/status", session=session)
        event: dict[str, Any] = {"event": "capture_progress", "elapsedSeconds": round(elapsed, 1), "remainingSeconds": round(max(0, seconds - elapsed), 1), "status": status}
        try:
            event["signal"] = read_signal(base_url)
        except RuntimeError as error:
            event["signalError"] = str(error)
    except RuntimeError as error:
        event = {"event": "capture_status_error", "elapsedSeconds": round(elapsed, 1), "message": str(error)}
    finally:
        session.close()
    print(json.dumps(event), file=sys.stderr, flush=True)


def status_reporter(base_url: str, seconds: float, interval_seconds: float, started: float, stop: threading.Event) -> None:
    next_report = started + interval_seconds
    while not stop.wait(max(0, next_report - time.monotonic())):
        emit_status(base_url, time.monotonic() - started, seconds)
        next_report += interval_seconds


def download_completed_wav(base_url: str, output: Path, wait_seconds: float = 300) -> None:
    """Retrieve /audio.wav in bounded, resumable HTTP Range requests."""
    parsed = urllib.parse.urlsplit(base_url)
    part = output.with_suffix(f"{output.suffix}.part")
    deadline = time.monotonic() + wait_seconds
    chunk_bytes = 1 * 1024 * 1024
    output.parent.mkdir(parents=True, exist_ok=True)
    while True:
        offset = part.stat().st_size if part.exists() else 0
        end = offset + chunk_bytes - 1
        connection = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=10)
        try:
            connection.request("GET", f"{parsed.path.rstrip('/')}/audio.wav", headers={"range": f"bytes={offset}-{end}", "connection": "close"})
            response = connection.getresponse()
            if response.status == 404:
                raise PsiuCaptureNotReady("PSIU has not finalized the completed WAV.")
            if response.status != 206:
                raise RuntimeError(f"PSIU returned HTTP {response.status}; expected 206 for a bounded /audio.wav range.")
            content_range = response.getheader("content-range")
            if not content_range or not content_range.startswith(f"bytes {offset}-") or "/" not in content_range:
                raise RuntimeError("PSIU returned an invalid Content-Range for /audio.wav.")
            total_bytes = int(content_range.rsplit("/", 1)[1])
            chunk = response.read()
            if not chunk:
                raise RuntimeError("PSIU returned an empty WAV range.")
            with part.open("ab") as destination:
                destination.write(chunk)
            if part.stat().st_size >= total_bytes:
                if part.stat().st_size != total_bytes or total_bytes < 44:
                    raise RuntimeError("PSIU returned an incomplete WAV.")
                part.replace(output)
                return
        except (PsiuCaptureNotReady, OSError, ValueError, http.client.HTTPException, RuntimeError):
            if time.monotonic() >= deadline:
                raise RuntimeError(f"PSIU did not provide a completed WAV within {wait_seconds:.0f} seconds of Stop; partial data remains at {part}.")
            time.sleep(1)
        finally:
            connection.close()


def capture(base_url: str, seconds: float, output_dir: Path, audio_wait_seconds: float = 30, status_interval_seconds: float = 5) -> Path:
    if seconds <= 0 or seconds > 3_600:
        raise ValueError("Capture duration must be greater than zero and no more than one hour.")
    if audio_wait_seconds < 0 or audio_wait_seconds > 300:
        raise ValueError("Completed-WAV wait must be from zero to 300 seconds.")
    if status_interval_seconds < 0 or status_interval_seconds > 60:
        raise ValueError("Status interval must be from zero to 60 seconds.")
    session = PsiuSession(base_url)
    reporter_stop = threading.Event()
    reporter: threading.Thread | None = None
    try:
        preflight = status_with_retry(base_url)
        if health_error := capture_health_error(preflight):
            raise RuntimeError(health_error)
        status = start_capture(base_url, session)
        if not status.get("recording"):
            raise RuntimeError(capture_health_error(status) or "PSIU did not confirm recording after start.")
        started = time.monotonic()
        print(json.dumps({"event": "capture_progress", "elapsedSeconds": 0, "remainingSeconds": seconds, "status": status}), file=sys.stderr, flush=True)
        if status_interval_seconds:
            reporter = threading.Thread(target=status_reporter, args=(base_url, seconds, status_interval_seconds, started, reporter_stop), daemon=True)
            reporter.start()
        try:
            reporter_stop.wait(seconds)
        finally:
            reporter_stop.set()
            if reporter:
                reporter.join(timeout=3)
            stop_capture(base_url, session)
        output_dir.mkdir(parents=True, exist_ok=True)
        output = output_dir / f"psiu-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.wav"
        download_completed_wav(base_url, output, audio_wait_seconds)
    finally:
        reporter_stop.set()
        session.close()
    with output.open("rb") as completed:
        header = completed.read(12)
    if len(header) < 12 or header[:4] != b"RIFF" or header[8:12] != b"WAVE":
        raise RuntimeError("PSIU did not return a WAV capture.")
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


def _pcm_values(raw: bytes, width: int, channels: int) -> np.ndarray:
    if width == 2:
        values = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 2**15
    elif width == 4:
        values = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2**31
    else:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        signed = packed[:, 0].astype(np.int32) | (packed[:, 1].astype(np.int32) << 8) | (packed[:, 2].astype(np.int32) << 16)
        values = np.where(signed & 0x800000, signed - 0x1000000, signed).astype(np.float64) / 2**23
    return values.reshape(-1, channels)


def _pcm_samples_range(path: Path, start_frame: int = 0, frame_count: int | None = None) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as source:
        if source.getcomptype() != "NONE" or source.getsampwidth() not in {2, 3, 4}:
            raise ValueError("Expected uncompressed 16-, 24-, or 32-bit PCM WAV.")
        if not 0 <= start_frame <= source.getnframes():
            raise ValueError("PCM range starts outside the WAV capture.")
        source.setpos(start_frame)
        raw = source.readframes(source.getnframes() - start_frame if frame_count is None else frame_count)
        return _pcm_values(raw, source.getsampwidth(), source.getnchannels()), source.getframerate()


def _pcm_samples(path: Path) -> tuple[np.ndarray, int]:
    return _pcm_samples_range(path)


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


def write_spectrum_svg(path: Path, frequencies: np.ndarray, spectra: list[np.ndarray], diagnostics: list[dict[str, Any]] | None = None) -> None:
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
    if diagnostics and len(diagnostics) >= 2:
        for order, label_y in ((2, top + 20), (3, top + 40)):
            harmonic = []
            for channel in diagnostics:
                found = next((item for item in channel["harmonics"] if item["order"] == order), None)
                if found:
                    harmonic.append(found)
            if len(harmonic) == 2:
                frequency = float(np.mean([item["frequencyHz"] for item in harmonic]))
                xx = left + (frequency - 20) / (limit - 20) * width
                lines.append(f'<line x1="{xx:.1f}" y1="{top}" x2="{xx:.1f}" y2="{top + height}" stroke="#9a6700" stroke-dasharray="3 3"/>')
                lines.append(f'<text x="{min(xx + 8, left + width - 250):.1f}" y="{label_y:.1f}">{order}nd harmonic: L {harmonic[0]["levelDbc"]:.1f} dBc · R {harmonic[1]["levelDbc"]:.1f} dBc</text>' if order == 2 else f'<text x="{min(xx + 8, left + width - 250):.1f}" y="{label_y:.1f}">3rd harmonic: L {harmonic[0]["levelDbc"]:.1f} dBc · R {harmonic[1]["levelDbc"]:.1f} dBc</text>')
    lines.extend([f'<text x="{left + width - 120}" y="18" fill="#b7791f">Left</text>', f'<text x="{left + width - 60}" y="18" fill="#1a5fb4">Right</text>', '</svg>'])
    path.write_text("\n".join(lines), encoding="utf-8")


def _is_clean_tone_block(samples: np.ndarray, rate: int, nominal_hz: float) -> bool:
    if len(samples) < rate // 2:
        return False
    window = np.hanning(len(samples))
    frequencies = np.fft.rfftfreq(len(samples), 1 / rate)
    candidates = (frequencies >= nominal_hz - 5) & (frequencies <= nominal_hz + 5)
    noise = (frequencies >= 20) & (frequencies <= min(20_000, rate / 2 - 1)) & (np.abs(frequencies - nominal_hz) > 10)
    for channel in range(samples.shape[1]):
        amplitude = 2 * np.abs(np.fft.rfft(samples[:, channel] * window)) / np.sum(window)
        dbfs = 20 * np.log10(np.maximum(amplitude, 1e-15))
        if float(np.max(dbfs[candidates])) < -55 or float(np.max(dbfs[candidates]) - np.median(dbfs[noise])) < 30:
            return False
    return True


def one_khz_cleanup_region(path: Path, nominal_hz: float = 1_000.0, edge_scan_seconds: float = 20, expected_duration_seconds: float = 405) -> tuple[int, int, dict[str, float]]:
    """Find clean 1 kHz markers near each edge without loading a complete side."""
    metadata = wav_metadata(path)
    rate, frames, duration = int(metadata["sampleRateHz"]), int(metadata["frames"]), float(metadata["durationSeconds"])
    block = rate
    scan_seconds = duration if duration > expected_duration_seconds + edge_scan_seconds else min(edge_scan_seconds, duration / 2)
    scan_frames = max(block, min(frames, round(scan_seconds * rate)))
    leading, _ = _pcm_samples_range(path, 0, scan_frames)
    trailing_start = max(0, frames - scan_frames)
    trailing, _ = _pcm_samples_range(path, trailing_start, scan_frames)
    first: int | None = None
    for offset in range(0, len(leading) - block + 1, block):
        if _is_clean_tone_block(leading[offset : offset + block], rate, nominal_hz):
            first = offset
            break
    last: int | None = None
    for offset in range(len(trailing) - block, -1, -block):
        if _is_clean_tone_block(trailing[offset : offset + block], rate, nominal_hz):
            last = trailing_start + offset + block
            break
    if first is None or last is None or first >= last:
        raise ValueError(f"Could not find clean {nominal_hz:g} Hz markers in the scanned capture edges.")
    return first, min(last, frames), {"edgeScanSeconds": scan_seconds, "sourceDurationSeconds": duration}


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


def _interpolated_peak_hz(frequencies: np.ndarray, values: np.ndarray, target_hz: float, search_hz: float = 5) -> tuple[float, float]:
    index = _peak_bin(frequencies, values, target_hz, search_hz)
    if index == 0 or index == len(values) - 1:
        return float(frequencies[index]), float(values[index])
    left, center, right = values[index - 1 : index + 2]
    offset = 0.5 * (left - right) / max(left - 2 * center + right, 1e-15)
    return float((index + offset) * (frequencies[1] - frequencies[0])), float(values[index])


def non_harmonic_peaks(frequencies: np.ndarray, spectra: list[np.ndarray], diagnostics: list[dict[str, Any]], upper_hz: float = 500) -> list[list[dict[str, Any]]]:
    """Return spaced non-harmonic peaks for diagnostic review, not source attribution."""
    result: list[list[dict[str, Any]]] = []
    for channel, dbfs in enumerate(spectra):
        valid = (frequencies >= 20) & (frequencies <= upper_hz)
        for harmonic in [diagnostics[channel]["fundamentalHz"] * order for order in range(1, 8)]:
            valid &= np.abs(frequencies - harmonic) > 5
        indices = np.flatnonzero(valid)[1:-1]
        candidates = indices[(dbfs[indices] > dbfs[indices - 1]) & (dbfs[indices] >= dbfs[indices + 1])]
        candidates = candidates[np.argsort(dbfs[candidates])[::-1]]
        selected: list[int] = []
        for index in candidates:
            if all(abs(frequencies[index] - frequencies[other]) >= 0.5 for other in selected):
                selected.append(int(index))
            if len(selected) == 12:
                break
        peak_level = diagnostics[channel]["fundamentalPeakDbfs"]
        entries = []
        for index in selected:
            frequency = float(frequencies[index])
            if abs(frequency - 100) <= 5:
                candidate = "motor-region candidate"
            elif frequency < 100:
                candidate = "low-frequency rumble or power-region candidate"
            else:
                candidate = "non-harmonic peak"
            entries.append({"frequencyHz": frequency, "levelDbfs": float(dbfs[index]), "levelDbc": float(dbfs[index] - peak_level), "interpretationCandidate": candidate})
        result.append(entries)
    return result


def frequency_modulation_diagnostics(samples: np.ndarray, rate: int, nominal_hz: float) -> list[dict[str, Any]]:
    """Unweighted modulation estimates from a narrow analytic carrier; not IEC/DIN/AES compliant."""
    limit = min(len(samples), round(rate * 20))
    if limit < round(rate * 2):
        raise ValueError("Need at least two seconds for modulation diagnostics.")
    frequencies = np.fft.fftfreq(limit, 1 / rate)
    keep = (frequencies >= nominal_hz - 250) & (frequencies <= nominal_hz + 250)
    decimation = max(1, round(rate / 1_000))
    output: list[dict[str, Any]] = []
    for channel in range(samples.shape[1]):
        transformed = np.fft.fft(samples[:limit, channel] - np.mean(samples[:limit, channel]))
        analytic = np.fft.ifft(np.where(keep, 2 * transformed, 0))
        instantaneous_hz = np.diff(np.unwrap(np.angle(analytic))) * rate / (2 * np.pi)
        carrier_median = float(np.median(instantaneous_hz))
        phase_slips = np.abs(instantaneous_hz - carrier_median) > 10
        # A 10 Hz one-sample jump is phase-tracking corruption, not plausible platter variation.
        instantaneous_hz[phase_slips] = carrier_median
        usable = instantaneous_hz[: len(instantaneous_hz) // decimation * decimation]
        trace_hz = usable.reshape(-1, decimation).mean(axis=1)
        trace_hz = trace_hz[250:-250] if len(trace_hz) > 500 else trace_hz
        mean_hz = float(np.mean(trace_hz))
        deviation_percent = 100 * (trace_hz - mean_hz) / mean_hz
        modulation_frequencies = np.fft.rfftfreq(len(deviation_percent), 1 / (rate / decimation))
        modulation = np.fft.rfft(deviation_percent)
        bands: dict[str, dict[str, float]] = {}
        for name, lower, upper in (("wow", 0.1, 6.0), ("flutter", 6.0, 200.0)):
            selected = (modulation_frequencies >= lower) & (modulation_frequencies < upper)
            filtered = np.fft.irfft(np.where(selected, modulation, 0), n=len(deviation_percent))
            bands[name] = {"rmsPercent": float(np.sqrt(np.mean(filtered**2))), "sigmaPercent": float(np.std(filtered)), "peakPercent": float(np.max(np.abs(filtered)))}
        output.append({"meanFrequencyHz": mean_hz, "phaseSlipRejectedSamples": int(np.count_nonzero(phase_slips)), "overallSigmaPercent": float(np.std(deviation_percent)), "overallPeakPercent": float(np.max(np.abs(deviation_percent))), "bands": bands, "_timeSeconds": (np.arange(len(trace_hz)) + 250) / (rate / decimation), "_speedRpm": 33.333333 * trace_hz / nominal_hz})
    return output


def cyclic_period_candidates(speed_rpm: np.ndarray, sample_rate_hz: float = 1_000.0) -> list[dict[str, float]]:
    """Dominant periodic speed components for investigation, without causal attribution."""
    window = np.hanning(len(speed_rpm))
    deviations = speed_rpm - np.mean(speed_rpm)
    frequencies = np.fft.rfftfreq(len(deviations), 1 / sample_rate_hz)
    amplitudes = 2 * np.abs(np.fft.rfft(deviations * window)) / np.sum(window)
    indices = np.flatnonzero((frequencies >= 0.1) & (frequencies <= 30))[1:-1]
    peaks = indices[(amplitudes[indices] > amplitudes[indices - 1]) & (amplitudes[indices] >= amplitudes[indices + 1])]
    selected = peaks[np.argsort(amplitudes[peaks])[::-1]][:5]
    platter_hz = 33.333333 / 60
    results = []
    for index in selected:
        cycles_per_revolution = float(frequencies[index] / platter_hz)
        nearest = round(cycles_per_revolution)
        interpretation = "cyclic speed candidate"
        if nearest >= 1 and abs(cycles_per_revolution - nearest) <= 0.08:
            interpretation = f"{nearest} cycle(s)-per-platter-revolution candidate"
        results.append({"frequencyHz": float(frequencies[index]), "periodSeconds": float(1 / frequencies[index]), "speedAmplitudeRpm": float(amplitudes[index]), "cyclesPerPlatterRevolution": cycles_per_revolution, "interpretationCandidate": interpretation})
    return results


def write_speed_svg(path: Path, traces: list[tuple[np.ndarray, np.ndarray]], reference_rpm: float = 33.333333) -> None:
    """Write a local time-domain speed review graph with per-channel extrema."""
    path.parent.mkdir(parents=True, exist_ok=True)
    left, right, top, bottom, width, height = 112, 28, 30, 50, 1080, 480
    all_speed = np.concatenate([speed for _, speed in traces])
    # Dynamic, rounded scale: keeps subtle variation visible and expands for bad speed calibration.
    observed_minimum, observed_maximum = float(np.min(all_speed)), float(np.max(all_speed))
    padding = max((observed_maximum - observed_minimum) * 0.15, 0.25)
    raw_minimum, raw_maximum = observed_minimum - padding, observed_maximum + padding
    step = 0.1
    minimum = float(np.floor(raw_minimum / step) * step)
    maximum = float(np.ceil(raw_maximum / step) * step)
    duration = max(float(times[-1]) for times, _ in traces)
    def x(time_value: float) -> float: return left + time_value / duration * width
    def y(speed: float) -> float: return top + (maximum - speed) / (maximum - minimum) * height
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{left + width + right}" height="{top + height + bottom}" viewBox="0 0 {left + width + right} {top + height + bottom}">', '<rect width="100%" height="100%" fill="white"/>', '<style>text{font:13px Arial;fill:#222}.axis{stroke:#555}.grid{stroke:#ddd}.left{fill:none;stroke:#b7791f;stroke-width:1}.right{fill:none;stroke:#1a5fb4;stroke-width:1}.mark{fill:#c01c28}</style>', f'<text x="{left}" y="18">Instantaneous speed estimate · diagnostic only</text>']
    for value in np.arange(minimum, maximum + step / 2, step):
        yy = y(float(value))
        lines.extend([f'<line x1="{left}" y1="{yy:.1f}" x2="{left + width}" y2="{yy:.1f}" class="grid"/>', f'<text x="{left - 8}" y="{yy + 5:.1f}" text-anchor="end">{value:.2f} RPM</text>'])
    reference_y = y(reference_rpm)
    lines.append(f'<line x1="{left}" y1="{reference_y:.1f}" x2="{left + width}" y2="{reference_y:.1f}" stroke="#555" stroke-dasharray="5 4"/>')
    for second in range(0, int(duration) + 1, max(1, round(duration / 5))):
        xx = x(second); lines.extend([f'<line x1="{xx:.1f}" y1="{top}" x2="{xx:.1f}" y2="{top + height}" class="grid"/>', f'<text x="{xx:.1f}" y="{top + height + 22}" text-anchor="middle">{second}s</text>'])
    measured_rpm = float(np.mean(all_speed))
    revolution_period = 60 / measured_rpm
    for revolution in range(1, int(duration / revolution_period) + 1):
        xx = x(revolution * revolution_period)
        lines.append(f'<line x1="{xx:.1f}" y1="{top}" x2="{xx:.1f}" y2="{top + height}" stroke="#2e7d32" stroke-width="1" stroke-dasharray="4 4"/>')
    lines.extend([f'<line x1="{left}" y1="{top + height}" x2="{left + width}" y2="{top + height}" class="axis"/>', f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + height}" class="axis"/>'])
    for index, (times, speeds) in enumerate(traces):
        stride = max(1, len(times) // 2_500)
        points = " ".join(f"{x(float(times[item])):.1f},{y(float(speeds[item])):.1f}" for item in range(0, len(times), stride))
        class_name = "left" if index == 0 else "right"
        lines.append(f'<polyline points="{points}" class="{class_name}"/>')
        for kind, point in (("min", int(np.argmin(speeds))), ("max", int(np.argmax(speeds)))):
            px, py = x(float(times[point])), y(float(speeds[point]))
            lines.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="4" class="mark"/>')
            label_y = py - 8 if kind == "max" else py + 16
            lines.append(f'<text x="{min(px + 7, left + width - 120):.1f}" y="{label_y:.1f}">{("L" if index == 0 else "R")} {kind}: {speeds[point]:.3f} RPM</text>')
    lines.extend([f'<text x="{left + width - 120}" y="18" fill="#b7791f">Left</text>', f'<text x="{left + width - 60}" y="18" fill="#1a5fb4">Right</text>', '</svg>'])
    path.write_text("\n".join(lines), encoding="utf-8")


def write_revolution_folded_speed_svg(path: Path, traces: list[tuple[np.ndarray, np.ndarray]]) -> None:
    """Overlay speed traces by platter phase to expose repeatable per-revolution structure."""
    path.parent.mkdir(parents=True, exist_ok=True)
    left, right, top, bottom, width, height = 112, 28, 30, 50, 1080, 480
    all_speed = np.concatenate([speed for _, speed in traces])
    mean_rpm = float(np.mean(all_speed)); period = 60 / mean_rpm
    minimum, maximum = float(np.min(all_speed)), float(np.max(all_speed))
    padding = max((maximum - minimum) * .15, .05); minimum -= padding; maximum += padding
    def x(phase: float) -> float: return left + phase * width
    def y(speed: float) -> float: return top + (maximum - speed) / (maximum - minimum) * height
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{left + width + right}" height="{top + height + bottom}" viewBox="0 0 {left + width + right} {top + height + bottom}">', '<rect width="100%" height="100%" fill="white"/>', '<style>text{font:13px Arial;fill:#222}.axis{stroke:#555}.grid{stroke:#ddd}.leftraw{fill:none;stroke:#b7791f;stroke-width:.7;opacity:.2}.rightraw{fill:none;stroke:#1a5fb4;stroke-width:.7;opacity:.2}.left{fill:none;stroke:#b7791f;stroke-width:2}.right{fill:none;stroke:#1a5fb4;stroke-width:2}</style>', f'<text x="{left}" y="18">Speed by platter revolution · {period:.3f} s/revolution</text>']
    for fraction in (0, .5, 1):
        value = minimum + fraction * (maximum - minimum); yy = y(value)
        lines.extend([f'<line x1="{left}" y1="{yy:.1f}" x2="{left + width}" y2="{yy:.1f}" class="grid"/>', f'<text x="{left - 8}" y="{yy + 5:.1f}" text-anchor="end">{value:.3f} RPM</text>'])
    for fraction, label in ((0, "0°"), (.25, "90°"), (.5, "180°"), (.75, "270°"), (1, "360°")):
        xx = x(fraction); lines.extend([f'<line x1="{xx:.1f}" y1="{top}" x2="{xx:.1f}" y2="{top + height}" class="grid"/>', f'<text x="{xx:.1f}" y="{top + height + 22}" text-anchor="middle">{label}</text>'])
    lines.extend([f'<line x1="{left}" y1="{top + height}" x2="{left + width}" y2="{top + height}" class="axis"/>', f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + height}" class="axis"/>'])
    bins = np.linspace(0, 1, 241)
    for channel, (times, speeds) in enumerate(traces):
        phase = np.mod(times / period, 1)
        revolutions = np.floor(times / period).astype(int)
        raw_class, mean_class = (("leftraw", "left") if channel == 0 else ("rightraw", "right"))
        for revolution in np.unique(revolutions):
            selected = revolutions == revolution
            if np.count_nonzero(selected) < 2: continue
            stride = max(1, np.count_nonzero(selected) // 300)
            selected_indices = np.flatnonzero(selected)[::stride]
            points = " ".join(f"{x(float(phase[index])):.1f},{y(float(speeds[index])):.1f}" for index in selected_indices)
            lines.append(f'<polyline points="{points}" class="{raw_class}"/>')
        bin_index = np.clip(np.digitize(phase, bins) - 1, 0, len(bins) - 2)
        means = np.array([np.mean(speeds[bin_index == index]) if np.any(bin_index == index) else np.nan for index in range(len(bins) - 1)])
        valid = np.isfinite(means); phases = (bins[:-1] + bins[1:]) / 2
        points = " ".join(f"{x(float(phases[index])):.1f},{y(float(means[index])):.1f}" for index in np.flatnonzero(valid))
        lines.append(f'<polyline points="{points}" class="{mean_class}"/>')
    lines.extend([f'<text x="{left + width - 120}" y="18" fill="#b7791f">Left mean</text>', f'<text x="{left + width - 42}" y="18" fill="#1a5fb4">Right mean</text>', '</svg>'])
    path.write_text("\n".join(lines), encoding="utf-8")


def write_local_report_html(path: Path, report: dict[str, Any], spectrum_filename: str, speed_filename: str, revolution_filename: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    def table(title: str, headers: list[str], rows: list[list[str]]) -> str:
        head = "".join(f"<th>{escape(header)}</th>" for header in headers)
        body = "".join("<tr>" + "".join(f"<td>{escape(value)}</td>" for value in row) + "</tr>" for row in rows)
        return f"<section><h2>{escape(title)}</h2><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></section>"
    capture = report["capture"]
    speed = report["speedAccuracy"]
    channels = report["channels"]
    sections = [
        table("Capture Information", ["Field", "Value"], [["Capture timestamp", report["sourceFileModifiedAt"]], ["Duration", f'{capture["durationSeconds"]:.3f} s'], ["Program region", f'{capture["programDurationSeconds"]:.3f} s'], ["Channels", str(capture["channels"])], ["Sample rate", f'{capture["sampleRateHz"] / 1000:.0f} kHz'], ["Bit depth", f'{capture["bitsPerSample"]}-bit']]),
        table("Speed Accuracy", ["Field", "Value"], [["Reference speed", f'{speed["referenceRpm"]:.5f} RPM'], ["Measured speed", f'{speed["measuredRpm"]:.5f} RPM'], ["Speed error", f'{speed["errorPercent"]:+.4f}%'], ["Minimum / maximum", f'{speed["minimumRpm"]:.5f} / {speed["maximumRpm"]:.5f} RPM'], ["Maximum deviation", f'{speed["maximumDeviationPercent"]:.4f}%'], ["Measured carrier", f'{speed["measuredCarrierHz"]:.5f} Hz'], ["Reference carrier", f'{speed["nominalCarrierHz"]:.3f} Hz']]),
        table("Channel Measurements", ["Channel", "Carrier", "Peak", "Relative level", "2nd harmonic", "3rd harmonic"], [[channel["name"].title(), f'{channel["measuredCarrierHz"]:.5f} Hz', f'{channel["peakDbfs"]:.2f} dBFS', (f'{report["channelBalance"]["peakLevelDifferenceDb"]:+.3f} dB vs Right' if channel["name"] == "left" else "Reference"), f'{channel["harmonics"][0]["levelDbc"]:.2f} dBc', f'{channel["harmonics"][1]["levelDbc"]:.2f} dBc'] for channel in channels]),
        table("Channel Balance", ["Field", "Value"], [["Left relative to right", f'{report["channelBalance"]["peakLevelDifferenceDb"]:+.3f} dB'], ["Carrier difference", f'{report["channelBalance"]["carrierFrequencyDifferenceHz"]:+.5f} Hz']]),
        table("Unweighted Wow / Flutter Diagnostic", ["Channel", "Wow RMS / σ / peak", "Flutter RMS / σ / peak"], [[channel["name"].title(), " / ".join(f'{channel["modulationEstimate"]["bands"]["wow"][key]:.4f}%' for key in ("rmsPercent", "sigmaPercent", "peakPercent")), " / ".join(f'{channel["modulationEstimate"]["bands"]["flutter"][key]:.4f}%' for key in ("rmsPercent", "sigmaPercent", "peakPercent"))] for channel in channels]),
    ]
    cyclic_rows = [[channel["name"].title(), f'{item["frequencyHz"]:.3f} Hz', f'{item["periodSeconds"]:.3f} s', f'{item["cyclesPerPlatterRevolution"]:.3f}', item["interpretationCandidate"]] for channel in channels for item in channel["modulationEstimate"]["cyclicPeriodCandidates"][:3]]
    peak_rows = [[channel["name"].title(), f'{item["frequencyHz"]:.1f} Hz', f'{item["levelDbc"]:.1f} dBc', item["interpretationCandidate"]] for channel in channels for item in channel["nonHarmonicPeaks"][:5]]
    sections.extend([table("Cyclic Speed Candidates", ["Channel", "Frequency", "Period", "Cycles / revolution", "Interpretation"], cyclic_rows), table("Top Non-Harmonic Peaks", ["Channel", "Frequency", "Relative level", "Interpretation"], peak_rows)])
    path.write_text(f"<!doctype html><html><head><meta charset=\"utf-8\"><title>Wally local turntable diagnostic</title><style>body{{font:15px system-ui;margin:2rem;max-width:1100px;color:#17212b}}h1{{margin-bottom:.2rem}}h2{{margin-top:1.8rem}}table{{border-collapse:collapse;width:100%;margin:.5rem 0}}th,td{{border:1px solid #cbd5df;padding:.45rem;text-align:left;vertical-align:top}}th{{background:#eaf0f5}}tr:nth-child(even){{background:#f8fafc}}img{{max-width:100%;border:1px solid #ccc}}.note{{background:#fff8db;padding:.8rem}}</style></head><body><h1>Wally local turntable diagnostic</h1><p class=\"note\"><strong>Diagnostic only:</strong> 1 kHz carrier estimates are unweighted and are not formal IEC/DIN/AES wow/flutter compliance results. Candidate labels identify correlations for investigation, not physical source attribution.</p>{''.join(sections)}<h2>Harmonic Spectrum</h2><img src=\"{escape(spectrum_filename)}\" alt=\"FFT spectrum\"><h2>Speed over Time</h2><img src=\"{escape(speed_filename)}\" alt=\"Instantaneous speed graph\"><h2>Speed by Platter Revolution</h2><img src=\"{escape(revolution_filename)}\" alt=\"Speed folded by platter revolution\"></body></html>", encoding="utf-8")


def write_local_report_pdf(html_path: Path, pdf_path: Path) -> None:
    """Render local HTML to PDF through installed Chrome; production uses its packaged renderer."""
    chrome = shutil.which("google-chrome") or shutil.which("chromium")
    macos_chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if not chrome and macos_chrome.exists():
        chrome = str(macos_chrome)
    if not chrome:
        raise RuntimeError("PDF rendering needs Google Chrome or Chromium installed locally.")
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf_path.resolve()}", html_path.resolve().as_uri()], check=True, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if not pdf_path.exists() or pdf_path.read_bytes()[:5] != b"%PDF-":
        raise RuntimeError("Local HTML-to-PDF rendering did not produce a valid PDF.")


def local_turntable_report(path: Path, nominal_hz: float, output_dir: Path) -> dict[str, Any]:
    samples, rate = _pcm_samples(path)
    start, end = active_tone_region(samples, rate)
    program = samples[start:end]
    diagnostics, frequencies, spectra = spectral_diagnostics(program, rate, nominal_hz)
    tone_hz = estimate_tone_hz(program, rate, nominal_hz)
    modulation = frequency_modulation_diagnostics(program, rate, nominal_hz)
    average_hz = float(np.mean([entry["meanFrequencyHz"] for entry in modulation]))
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = path.stem
    spectrum_path = output_dir / f"{stem}-turntable-spectrum.svg"
    speed_path = output_dir / f"{stem}-turntable-speed.svg"
    revolution_path = output_dir / f"{stem}-turntable-revolution-speed.svg"
    json_path = output_dir / f"{stem}-turntable-report.json"
    html_path = output_dir / f"{stem}-turntable-report.html"
    pdf_path = output_dir / f"{stem}-turntable-report.pdf"
    write_spectrum_svg(spectrum_path, frequencies, spectra, diagnostics)
    speed_traces: list[tuple[np.ndarray, np.ndarray]] = []
    for entry in modulation:
        times = entry.pop("_timeSeconds")
        speeds = entry.pop("_speedRpm")
        minimum = int(np.argmin(speeds)); maximum = int(np.argmax(speeds))
        entry["speedExtrema"] = {"minimumRpm": float(speeds[minimum]), "minimumAtSeconds": float(times[minimum]), "maximumRpm": float(speeds[maximum]), "maximumAtSeconds": float(times[maximum])}
        entry["cyclicPeriodCandidates"] = cyclic_period_candidates(speeds)
        speed_traces.append((times, speeds))
    write_speed_svg(speed_path, speed_traces)
    write_revolution_folded_speed_svg(revolution_path, speed_traces)
    all_speed = np.concatenate([speeds for _, speeds in speed_traces])
    report = {"reportType": "local-1khz-turntable-diagnostic", "algorithmVersion": "local-1.0", "generatedAt": datetime.now(timezone.utc).isoformat(), "source": str(path), "sourceFileModifiedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(), "disclaimer": "Diagnostic-only 1 kHz carrier analysis. Speed and wow/flutter values are unweighted estimates and are not formal compliance results.", "capture": {**wav_metadata(path), "programStartSeconds": start / rate, "programEndSeconds": end / rate, "programDurationSeconds": (end - start) / rate}, "speedAccuracy": {"referenceRpm": 33.333333, "measuredRpm": 33.333333 * average_hz / nominal_hz, "errorPercent": 100 * (average_hz - nominal_hz) / nominal_hz, "measuredCarrierHz": average_hz, "nominalCarrierHz": nominal_hz, "method": "full-program analytic-carrier mean; assumes the test record carrier is exactly nominal", "minimumRpm": float(np.min(all_speed)), "maximumRpm": float(np.max(all_speed)), "maximumDeviationPercent": float(100 * np.max(np.abs(all_speed - np.mean(all_speed))) / np.mean(all_speed))}, "channels": [{"name": name, "measuredCarrierHz": modulation[index]["meanFrequencyHz"], "shortWindowVerificationHz": tone_hz[index], "peakDbfs": diagnostics[index]["fundamentalPeakDbfs"], "harmonics": diagnostics[index]["harmonics"], "modulationEstimate": modulation[index], "nonHarmonicPeaks": non_harmonic_peaks(frequencies, spectra, diagnostics)[index]} for index, name in enumerate(("left", "right"))], "channelBalance": {"peakLevelDifferenceDb": diagnostics[0]["fundamentalPeakDbfs"] - diagnostics[1]["fundamentalPeakDbfs"], "carrierFrequencyDifferenceHz": modulation[0]["meanFrequencyHz"] - modulation[1]["meanFrequencyHz"]}, "artifacts": {"spectrumSvg": str(spectrum_path), "speedSvg": str(speed_path), "revolutionSpeedSvg": str(revolution_path), "reportHtml": str(html_path), "reportPdf": str(pdf_path)}}
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_local_report_html(html_path, report, spectrum_path.name, speed_path.name, revolution_path.name)
    write_local_report_pdf(html_path, pdf_path)
    report["artifacts"]["reportJson"] = str(json_path)
    return report


def trim_one_khz_edges(source_path: Path, output_path: Path, nominal_hz: float = 1_000.0, edge_scan_seconds: float = 20, expected_duration_seconds: float = 405) -> dict[str, Any]:
    start, end, scan = one_khz_cleanup_region(source_path, nominal_hz, edge_scan_seconds, expected_duration_seconds)
    rate = int(wav_metadata(source_path)["sampleRateHz"])
    trim_wav(source_path, output_path, start, end)
    return {"source": str(source_path), "trimmedOutput": str(output_path), "nominalToneHz": nominal_hz, "startSeconds": start / rate, "endSeconds": end / rate, "durationSeconds": (end - start) / rate, **scan}


def inner_outer_one_khz_comparison(path: Path, nominal_hz: float = 1_000.0, edge_scan_seconds: float = 20, expected_duration_seconds: float = 405, analysis_seconds: float = 10) -> dict[str, Any]:
    """Compare representative clean outer/inner 1 kHz windows without loading the full side."""
    start, end, scan = one_khz_cleanup_region(path, nominal_hz, edge_scan_seconds, expected_duration_seconds)
    metadata = wav_metadata(path); rate = int(metadata["sampleRateHz"]); block = round(analysis_seconds * rate)
    if block < rate or end - start < 2 * block:
        raise ValueError("Full-side comparison needs two clean analysis windows of at least one second.")
    outer, _ = _pcm_samples_range(path, start, block)
    inner, _ = _pcm_samples_range(path, end - block, block)
    for samples, label in ((outer, "outer"), (inner, "inner")):
        for offset in range(0, len(samples) - rate + 1, rate):
            if not _is_clean_tone_block(samples[offset : offset + rate], rate, nominal_hz):
                raise ValueError(f"The {label} {analysis_seconds:g}-second analysis window is not continuously clean {nominal_hz:g} Hz material.")
    outer_diagnostics, outer_frequencies, outer_spectra = spectral_diagnostics(outer, rate, nominal_hz)
    inner_diagnostics, inner_frequencies, inner_spectra = spectral_diagnostics(inner, rate, nominal_hz)
    outer_peaks = non_harmonic_peaks(outer_frequencies, outer_spectra, outer_diagnostics)
    inner_peaks = non_harmonic_peaks(inner_frequencies, inner_spectra, inner_diagnostics)
    outer_carrier = estimate_tone_hz(outer, rate, nominal_hz)
    inner_carrier = estimate_tone_hz(inner, rate, nominal_hz)
    def balance(values: list[dict[str, Any]]) -> float: return float(values[0]["fundamentalPeakDbfs"] - values[1]["fundamentalPeakDbfs"])
    def channel_summary(values: list[dict[str, Any]], peaks: list[list[dict[str, Any]]], carrier: list[float]) -> list[dict[str, Any]]:
        return [{"channel": name, "fundamentalHz": values[index]["fundamentalHz"], "carrierEstimateHz": carrier[index], "peakDbfs": values[index]["fundamentalPeakDbfs"], "noiseFloorDbfsPerBin": values[index]["noiseFloorDbfsPerBin"], "peakToNoiseFloorDb": values[index]["peakToNoiseFloorDb"], "broadbandSnrDb": values[index]["broadbandSnrDb"], "harmonics": values[index]["harmonics"], "nonHarmonicPeaks": peaks[index]} for index, name in enumerate(("left", "right"))]
    harmonic_changes = []
    for channel, name in enumerate(("left", "right")):
        outer_harmonics = {item["order"]: item for item in outer_diagnostics[channel]["harmonics"]}
        inner_harmonics = {item["order"]: item for item in inner_diagnostics[channel]["harmonics"]}
        harmonic_changes.append({"channel": name, "harmonicDeltaDb": [{"order": order, "innerMinusOuterDbc": float(inner_harmonics[order]["levelDbc"] - outer_harmonics[order]["levelDbc"])} for order in sorted(set(outer_harmonics) & set(inner_harmonics))]})
    outer_balance, inner_balance = balance(outer_diagnostics), balance(inner_diagnostics)
    return {"reportType": "local-inner-outer-1khz-comparison", "source": str(path), "nominalToneHz": nominal_hz, "analysisWindowSeconds": analysis_seconds, "outerMarker": {"startSeconds": start / rate, "endSeconds": (start + block) / rate, "channels": channel_summary(outer_diagnostics, outer_peaks, outer_carrier), "balanceDbLeftRelativeToRight": outer_balance}, "innerMarker": {"startSeconds": (end - block) / rate, "endSeconds": end / rate, "channels": channel_summary(inner_diagnostics, inner_peaks, inner_carrier), "balanceDbLeftRelativeToRight": inner_balance}, "deltas": {"innerMinusOuterBalanceDb": float(inner_balance - outer_balance), "harmonics": harmonic_changes}, "disclaimer": "Marker comparison is a diagnostic indicator. Inner-groove changes can involve anti-skate, alignment, stylus, groove, pressing, and playback factors; it does not identify a single cause.", **scan}


def full_side_modulation_analysis(path: Path, start_frame: int, end_frame: int, nominal_hz: float, section_seconds: float = 20) -> tuple[dict[str, Any], list[tuple[np.ndarray, np.ndarray]]]:
    """Memory-bounded 1 kHz modulation analysis across contiguous full-side sections."""
    rate = int(wav_metadata(path)["sampleRateHz"])
    section_frames = round(section_seconds * rate)
    sections: list[dict[str, Any]] = []
    channel_traces: list[list[tuple[np.ndarray, np.ndarray]]] = [[], []]
    for section_start in range(start_frame, end_frame, section_frames):
        count = min(section_frames, end_frame - section_start)
        if count < 2 * rate:
            continue
        samples, _ = _pcm_samples_range(path, section_start, count)
        diagnostics = frequency_modulation_diagnostics(samples, rate, nominal_hz)
        section = {"startSeconds": section_start / rate, "endSeconds": (section_start + count) / rate, "channels": []}
        for channel, entry in enumerate(diagnostics):
            times = entry.pop("_timeSeconds") + section_start / rate
            speeds = entry.pop("_speedRpm")
            channel_traces[channel].append((times, speeds))
            section["channels"].append(entry)
        sections.append(section)
    traces = [(np.concatenate([times for times, _ in entries]), np.concatenate([speeds for _, speeds in entries])) for entries in channel_traces]
    aggregate_channels = []
    for channel, (times, speeds) in enumerate(traces):
        values = [section["channels"][channel] for section in sections]
        aggregate_channels.append({"channel": ("left", "right")[channel], "meanFrequencyHz": float(np.mean([value["meanFrequencyHz"] for value in values])), "averageRpm": float(np.mean(speeds)), "medianRpm": float(np.median(speeds)), "minimumRpm": float(np.min(speeds)), "maximumRpm": float(np.max(speeds)), "maximumDeviationPercent": float(100 * np.max(np.abs(speeds - np.mean(speeds))) / np.mean(speeds)), "bands": {name: {"rmsPercent": float(np.sqrt(np.mean([value["bands"][name]["rmsPercent"] ** 2 for value in values]))), "sigmaPercent": float(np.sqrt(np.mean([value["bands"][name]["sigmaPercent"] ** 2 for value in values]))), "peakPercent": float(np.max([value["bands"][name]["peakPercent"] for value in values]))} for name in ("wow", "flutter")}})
    return {"method": "20-second section analysis with RMS-weighted whole-side aggregate", "sectionSeconds": section_seconds, "sections": sections, "wholeSide": aggregate_channels}, traces


def write_full_side_report_html(path: Path, report: dict[str, Any], outer_spectrum_filename: str, inner_spectrum_filename: str, speed_filename: str, revolution_filename: str) -> None:
    comparison = report["innerOuterComparison"]
    def table(title: str, headers: list[str], rows: list[list[str]]) -> str:
        head = "".join(f"<th>{escape(header)}</th>" for header in headers)
        body = "".join("<tr>" + "".join(f"<td>{escape(value)}</td>" for value in row) + "</tr>" for row in rows)
        return f"<section><h2>{escape(title)}</h2><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></section>"
    capture = report["capture"]
    modulation = report["wholeSideModulation"]
    speed_analysis = report["speedAnalysis"]
    disclaimer = escape(comparison["disclaimer"])
    outer, inner, delta = comparison["outerMarker"], comparison["innerMarker"], comparison["deltas"]
    channel_rows = []
    for index, name in enumerate(("Left", "Right")):
        channel_rows.append([name, f'{outer["channels"][index]["peakDbfs"]:.2f} dBFS', f'{inner["channels"][index]["peakDbfs"]:.2f} dBFS', f'{outer["channels"][index]["harmonics"][0]["levelDbc"]:.2f} / {outer["channels"][index]["harmonics"][1]["levelDbc"]:.2f} dBc', f'{inner["channels"][index]["harmonics"][0]["levelDbc"]:.2f} / {inner["channels"][index]["harmonics"][1]["levelDbc"]:.2f} dBc'])
    harmonic_rows = [[item["channel"].title()] + [f'H{change["order"]}: {change["innerMinusOuterDbc"]:+.2f} dB' for change in item["harmonicDeltaDb"]] for item in delta["harmonics"]]
    quality_rows = [[marker, channel["channel"].title(), f'{channel["fundamentalHz"]:.3f} Hz', f'{channel["peakDbfs"]:.2f} dBFS', f'{channel["noiseFloorDbfsPerBin"]:.2f} dBFS/bin', f'{channel["peakToNoiseFloorDb"]:.2f} dB', f'{channel["broadbandSnrDb"]:.2f} dB'] for marker, values in (("Outer", outer), ("Inner", inner)) for channel in values["channels"]]
    peak_rows = [[marker, channel["channel"].title(), f'{peak["frequencyHz"]:.1f} Hz', f'{peak["levelDbc"]:.1f} dBc', peak["interpretationCandidate"]] for marker, values in (("Outer", outer), ("Inner", inner)) for channel in values["channels"] for peak in channel["nonHarmonicPeaks"][:3]]
    speed_rows = [[channel["channel"].title(), f'{channel["averageRpm"]:.5f} RPM', f'{channel["medianRpm"]:.5f} RPM', f'{channel["minimumRpm"]:.4f} / {channel["maximumRpm"]:.4f} RPM', f'{channel["innerMarkerRpm"]:.5f} RPM', f'{channel["innerMinusOuterPercent"]:+.4f}%'] for channel in speed_analysis]
    whole_rows = [[channel["channel"].title(), f'{channel["meanFrequencyHz"]:.4f} Hz', f'{channel["minimumRpm"]:.4f} / {channel["maximumRpm"]:.4f} RPM', " / ".join(f'{channel["bands"]["wow"][key]:.4f}%' for key in ("rmsPercent", "sigmaPercent", "peakPercent")), " / ".join(f'{channel["bands"]["flutter"][key]:.4f}%' for key in ("rmsPercent", "sigmaPercent", "peakPercent"))] for channel in modulation["wholeSide"]]
    section_rows = [[f'{section["startSeconds"]:.0f}–{section["endSeconds"]:.0f} s', channel["channel"].title(), f'{channel["bands"]["wow"]["rmsPercent"]:.4f}%', f'{channel["bands"]["flutter"]["rmsPercent"]:.4f}%'] for section in modulation["sections"] for channel in [{**entry, "channel": ("left", "right")[index]} for index, entry in enumerate(section["channels"])]]
    sections = [table("Capture Information", ["Field", "Value"], [["Capture timestamp", report["sourceFileModifiedAt"]], ["Duration", f'{capture["durationSeconds"]:.3f} s'], ["Channels", str(capture["channels"])], ["Sample rate", f'{capture["sampleRateHz"] / 1000:.0f} kHz']]), table("Outer / Inner 1 kHz Markers", ["Field", "Outer", "Inner"], [["Marker time", f'{outer["startSeconds"]:.3f}–{outer["endSeconds"]:.3f} s', f'{inner["startSeconds"]:.3f}–{inner["endSeconds"]:.3f} s'], ["L relative to R", f'{outer["balanceDbLeftRelativeToRight"]:+.3f} dB', f'{inner["balanceDbLeftRelativeToRight"]:+.3f} dB']]), table("Whole-Side RPM Analysis", ["Channel", "Mean / average RPM", "Median RPM", "Minimum / maximum", "Inner marker RPM", "Inner minus outer"], speed_rows), table("Whole-Side Wow / Flutter", ["Channel", "Mean carrier", "Minimum / maximum", "Wow RMS / σ / peak", "Flutter RMS / σ / peak"], whole_rows), table("Section Wow / Flutter", ["Section", "Channel", "Wow RMS", "Flutter RMS"], section_rows), table("Channel Marker Measurements", ["Channel", "Outer peak", "Inner peak", "Outer H2 / H3", "Inner H2 / H3"], channel_rows), table("Marker Signal Quality",  ["Marker", "Channel", "Carrier", "Peak", "Noise floor", "Peak/noise", "Broadband SNR"], quality_rows), table("Inner Minus Outer Change", ["Channel", "Harmonic changes"], harmonic_rows), table("Balance Change", ["Metric", "Value"], [["Inner minus outer L/R balance", f'{delta["innerMinusOuterBalanceDb"]:+.3f} dB']]), table("Top Non-Harmonic Peaks", ["Marker", "Channel", "Frequency", "Relative level", "Interpretation"], peak_rows)]
    path.write_text(f"<!doctype html><html><head><meta charset=\"utf-8\"><title>Wally local full-side diagnostic</title><style>body{{font:15px system-ui;margin:2rem;max-width:1100px;color:#17212b}}h2{{margin-top:1.8rem}}table{{border-collapse:collapse;width:100%;margin:.5rem 0}}th,td{{border:1px solid #cbd5df;padding:.45rem;text-align:left}}th{{background:#eaf0f5}}tr:nth-child(even){{background:#f8fafc}}.note{{background:#fff8db;padding:.8rem}}</style></head><body><h1>Wally local full-side diagnostic</h1><p class=\"note\">{disclaimer}</p>{''.join(sections)}<h2>Outer Marker Harmonic Spectrum</h2><img src=\"{escape(outer_spectrum_filename)}\" alt=\"Outer marker harmonic spectrum\"><h2>Inner Marker Harmonic Spectrum</h2><img src=\"{escape(inner_spectrum_filename)}\" alt=\"Inner marker harmonic spectrum\"><h2>Whole-Side Speed over Time</h2><img src=\"{escape(speed_filename)}\" alt=\"Whole-side speed graph\"><h2>Whole-Side Speed by Revolution</h2><img src=\"{escape(revolution_filename)}\" alt=\"Whole-side folded speed graph\"></body></html>", encoding="utf-8")


def local_full_side_report(path: Path, nominal_hz: float, output_dir: Path, edge_scan_seconds: float = 20, expected_duration_seconds: float = 405, analysis_seconds: float = 10) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    comparison = inner_outer_one_khz_comparison(path, nominal_hz, edge_scan_seconds, expected_duration_seconds, analysis_seconds)
    stem = path.stem
    json_path = output_dir / f"{stem}-full-side-report.json"
    html_path = output_dir / f"{stem}-full-side-report.html"
    pdf_path = output_dir / f"{stem}-full-side-report.pdf"
    outer_spectrum_path = output_dir / f"{stem}-outer-marker-spectrum.svg"
    inner_spectrum_path = output_dir / f"{stem}-inner-marker-spectrum.svg"
    speed_path = output_dir / f"{stem}-full-side-speed.svg"
    revolution_path = output_dir / f"{stem}-full-side-revolution-speed.svg"
    rate = int(wav_metadata(path)["sampleRateHz"])
    analysis_frames = round(comparison["analysisWindowSeconds"] * rate)
    modulation, speed_traces = full_side_modulation_analysis(path, round(comparison["outerMarker"]["startSeconds"] * rate), round(comparison["innerMarker"]["endSeconds"] * rate), nominal_hz)
    outer_samples, _ = _pcm_samples_range(path, round(comparison["outerMarker"]["startSeconds"] * rate), analysis_frames)
    inner_samples, _ = _pcm_samples_range(path, round(comparison["innerMarker"]["startSeconds"] * rate), analysis_frames)
    outer_diagnostics, outer_frequencies, outer_spectra = spectral_diagnostics(outer_samples, rate, nominal_hz)
    inner_diagnostics, inner_frequencies, inner_spectra = spectral_diagnostics(inner_samples, rate, nominal_hz)
    write_spectrum_svg(outer_spectrum_path, outer_frequencies, outer_spectra, outer_diagnostics)
    write_spectrum_svg(inner_spectrum_path, inner_frequencies, inner_spectra, inner_diagnostics)
    write_speed_svg(speed_path, speed_traces)
    write_revolution_folded_speed_svg(revolution_path, speed_traces)
    speed_analysis = []
    for index, name in enumerate(("left", "right")):
        outer_rpm = 33.333333 * comparison["outerMarker"]["channels"][index]["carrierEstimateHz"] / nominal_hz
        inner_rpm = 33.333333 * comparison["innerMarker"]["channels"][index]["carrierEstimateHz"] / nominal_hz
        speed_analysis.append({"channel": name, **modulation["wholeSide"][index], "outerMarkerRpm": outer_rpm, "innerMarkerRpm": inner_rpm, "innerMinusOuterPercent": 100 * (inner_rpm - outer_rpm) / outer_rpm})
    report = {"reportType": "local-full-side-1khz-diagnostic", "algorithmVersion": "local-1.0", "generatedAt": datetime.now(timezone.utc).isoformat(), "source": str(path), "sourceFileModifiedAt": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(), "capture": wav_metadata(path), "wholeSideModulation": modulation, "speedAnalysis": speed_analysis, "innerOuterComparison": comparison, "artifacts": {"reportJson": str(json_path), "reportHtml": str(html_path), "reportPdf": str(pdf_path), "outerSpectrumSvg": str(outer_spectrum_path), "innerSpectrumSvg": str(inner_spectrum_path), "speedSvg": str(speed_path), "revolutionSpeedSvg": str(revolution_path)}}
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_full_side_report_html(html_path, report, outer_spectrum_path.name, inner_spectrum_path.name, speed_path.name, revolution_path.name)
    write_local_report_pdf(html_path, pdf_path)
    return report


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
    health_parser = subcommands.add_parser("health", help="Show v1.2.7 codec, audio-clock, and signal diagnostics.")
    health_parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    input_parser = subcommands.add_parser("input-select", help="Select PSIU XLR or RCA input.")
    input_group = input_parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--xlr", action="store_true", help="Select XLR input.")
    input_group.add_argument("--rca", action="store_true", help="Select RCA input.")
    input_parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    download_parser = subcommands.add_parser("download", help="Resume or retrieve the last completed PSIU WAV locally.")
    download_parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    download_parser.add_argument("--output", type=Path, default=Path("data/local-psiu/recovered-psiu-capture.wav"))
    download_parser.add_argument("--wait-seconds", type=float, default=300)
    capture_parser = subcommands.add_parser("capture", help="Start PSIU, wait, stop, and save /audio.wav locally.")
    capture_parser.add_argument("--seconds", type=float, required=True)
    capture_parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    capture_parser.add_argument("--output-dir", type=Path, default=Path("data/local-psiu"))
    capture_parser.add_argument("--audio-wait-seconds", type=float, default=30, help="Wait for PSIU to finalize /audio.wav after Stop.")
    capture_parser.add_argument("--status-interval-seconds", type=float, default=5, help="Poll and print PSIU status during capture.")
    report_parser = subcommands.add_parser("report", help="Generate a local diagnostic report from a 1 kHz turntable capture.")
    report_parser.add_argument("wav", type=Path)
    report_parser.add_argument("--nominal-hz", type=float, default=1_000.0)
    report_parser.add_argument("--output-dir", type=Path, default=Path("data/local-psiu"))
    report_parser.add_argument("--full-side", action="store_true", help="Generate memory-bounded outer/inner marker report for a full-side capture.")
    report_parser.add_argument("--edge-scan-seconds", type=float, default=20)
    report_parser.add_argument("--expected-duration-seconds", type=float, default=405)
    report_parser.add_argument("--edge-analysis-seconds", type=float, default=10)
    cleanup_parser = subcommands.add_parser("trim-1khz", help="Trim capture edges to clean 1 kHz markers without loading a full side.")
    cleanup_parser.add_argument("wav", type=Path)
    cleanup_parser.add_argument("--output", type=Path, required=True)
    cleanup_parser.add_argument("--nominal-hz", type=float, default=1_000.0)
    cleanup_parser.add_argument("--edge-scan-seconds", type=float, default=20)
    cleanup_parser.add_argument("--expected-duration-seconds", type=float, default=405)
    comparison_parser = subcommands.add_parser("compare-1khz-edges", help="Compare clean outer and inner 1 kHz markers from a full side.")
    comparison_parser.add_argument("wav", type=Path)
    comparison_parser.add_argument("--nominal-hz", type=float, default=1_000.0)
    comparison_parser.add_argument("--edge-scan-seconds", type=float, default=20)
    comparison_parser.add_argument("--expected-duration-seconds", type=float, default=405)
    comparison_parser.add_argument("--analysis-seconds", type=float, default=10)
    inspect_parser = subcommands.add_parser("inspect", help="Inspect a PSIU WAV and optionally trim lead-in/runout.")
    inspect_parser.add_argument("wav", type=Path)
    inspect_parser.add_argument("--nominal-hz", type=float, default=1_000.0)
    inspect_parser.add_argument("--trim-output", type=Path)
    inspect_parser.add_argument("--spectrum-output", type=Path, help="Write a 20 Hz–20 kHz FFT SVG review plot.")
    args = parser.parse_args()
    if args.command == "health":
        print(json.dumps(health(args.base_url), indent=2))
    elif args.command == "input-select":
        selected = select_input(args.base_url, args.xlr)
        print(json.dumps({"xlr": selected["xlr"]}))
    elif args.command == "download":
        download_completed_wav(args.base_url, args.output, args.wait_seconds)
        print(args.output)
    elif args.command == "capture":
        print(capture(args.base_url, args.seconds, args.output_dir, args.audio_wait_seconds, args.status_interval_seconds))
    elif args.command == "report":
        report = local_full_side_report(args.wav, args.nominal_hz, args.output_dir, args.edge_scan_seconds, args.expected_duration_seconds, args.edge_analysis_seconds) if args.full_side else local_turntable_report(args.wav, args.nominal_hz, args.output_dir)
        print(json.dumps(report, indent=2))
    elif args.command == "trim-1khz":
        print(json.dumps(trim_one_khz_edges(args.wav, args.output, args.nominal_hz, args.edge_scan_seconds, args.expected_duration_seconds), indent=2))
    elif args.command == "compare-1khz-edges":
        print(json.dumps(inner_outer_one_khz_comparison(args.wav, args.nominal_hz, args.edge_scan_seconds, args.expected_duration_seconds, args.analysis_seconds), indent=2))
    else:
        print(json.dumps(inspect(args.wav, args.nominal_hz, args.trim_output, args.spectrum_output), indent=2))


if __name__ == "__main__":
    main()

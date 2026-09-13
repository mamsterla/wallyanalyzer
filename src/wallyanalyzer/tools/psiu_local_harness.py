"""Local-only PSIU capture harness for algorithm development.

This tool talks only to a PSIU on the local LAN. It never uploads audio or
contacts Wally production services. Captures are written under git-ignored data/
paths for rapid local analysis iteration.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

DEFAULT_BASE_URL = "http://psiu.local"


def psiu_request(base_url: str, path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> bytes:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={"content-type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"PSIU returned HTTP {response.status} for {path}.")
            return response.read()
    except urllib.error.URLError as error:
        raise RuntimeError(f"PSIU is unavailable at {base_url}: {error.reason}") from error


def psiu_json(base_url: str, path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    value = json.loads(psiu_request(base_url, path, method=method, body=body))
    if not isinstance(value, dict):
        raise RuntimeError(f"PSIU returned an invalid JSON object for {path}.")
    return value


def start_capture(base_url: str) -> dict[str, Any]:
    psiu_json(base_url, "/api/sampling", method="POST", body={"running": True})
    return psiu_json(base_url, "/status")


def stop_capture(base_url: str) -> dict[str, Any]:
    psiu_json(base_url, "/api/sampling", method="POST", body={"running": False})
    return psiu_json(base_url, "/status")


def capture(base_url: str, seconds: float, output_dir: Path) -> Path:
    if seconds <= 0 or seconds > 3_600:
        raise ValueError("Capture duration must be greater than zero and no more than one hour.")
    status = start_capture(base_url)
    if not status.get("recording"):
        raise RuntimeError("PSIU did not confirm recording after start.")
    try:
        time.sleep(seconds)
    finally:
        stop_capture(base_url)
    audio = psiu_request(base_url, "/audio.wav")
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


def inspect(path: Path, nominal_hz: float, trim_output: Path | None = None) -> dict[str, Any]:
    samples, rate = _pcm_samples(path)
    start, end = active_tone_region(samples, rate)
    result: dict[str, Any] = {
        "source": str(path),
        "metadata": wav_metadata(path),
        "programRegion": {"startSeconds": start / rate, "endSeconds": end / rate, "durationSeconds": (end - start) / rate},
        "toneHz": estimate_tone_hz(samples[start:end], rate, nominal_hz),
        "nominalToneHz": nominal_hz,
    }
    if trim_output:
        trim_wav(path, trim_output, start, end)
        result["trimmedOutput"] = str(trim_output)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture and inspect local PSIU WAVs without cloud upload.")
    subcommands = parser.add_subparsers(dest="command", required=True)
    capture_parser = subcommands.add_parser("capture", help="Start PSIU, wait, stop, and save /audio.wav locally.")
    capture_parser.add_argument("--seconds", type=float, required=True)
    capture_parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    capture_parser.add_argument("--output-dir", type=Path, default=Path("data/local-psiu"))
    inspect_parser = subcommands.add_parser("inspect", help="Inspect a PSIU WAV and optionally trim lead-in/runout.")
    inspect_parser.add_argument("wav", type=Path)
    inspect_parser.add_argument("--nominal-hz", type=float, default=1_000.0)
    inspect_parser.add_argument("--trim-output", type=Path)
    args = parser.parse_args()
    if args.command == "capture":
        print(capture(args.base_url, args.seconds, args.output_dir))
    else:
        print(json.dumps(inspect(args.wav, args.nominal_hz, args.trim_output), indent=2))


if __name__ == "__main__":
    main()

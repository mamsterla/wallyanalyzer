# Local PSIU algorithm harness

`wally-psiu-local` is a local-only developer tool. It starts/stops the PSIU, prints the PSIU `/status` JSON every five seconds during capture, retrieves `/audio.wav`, and saves it under the git-ignored `data/local-psiu/` directory. It does not call Wally production APIs or upload audio to S3.

## Check v1.2.7 audio health

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness health
```

The command reports `/status` codec fields (`codec_ok`, `codec_attempts`, `codec_recoveries`, `audio_alive`, and `level_db`) plus `/api/signal` levels for left and right channels. Capture aborts before Start if the firmware reports an unhealthy codec or inactive audio clock. With firmware v1.2.8, `/status` and `/audio.wav` use a fresh connection per request because they explicitly reply with `Connection: close`; `/api/*` control endpoints retain HTTP keep-alive.

## Select the input relay

For XLR input, select it before capture.

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness input-select --xlr
```

It uses the v1.2.6 public endpoint `POST /api/inputsel` with `{"xlr": true}`. Confirm the output is `{"xlr": true}` before capture.

## Capture a development recording

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness capture \
  --seconds 360 \
  --base-url http://psiu.local \
  --audio-wait-seconds 30
```

The capture command uses only the documented fixed endpoints:

- `POST /api/sampling` with `{"running": true}`
- `POST /api/sampling` with `{"running": false}`
- `GET /status`
- `GET /audio.wav` (polled after Stop, streamed to a resumable `.wav.part` file with Range requests, because PSIU may finalize the file asynchronously or reset a transfer)

## Resume a completed WAV download

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness download \
  --output data/local-psiu/recovered-psiu-capture.wav
```

A reset or host timeout leaves `recovered-psiu-capture.wav.part`; rerun the command to resume it. The harness fetches 1 MiB HTTP ranges so each completed range is persisted.

## Inspect and trim the result

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness inspect \
  data/local-psiu/psiu-YYYYMMDDTHHMMSSZ.wav \
  --nominal-hz 1000 \
  --trim-output data/local-psiu/tone-only.wav \
  --spectrum-output data/local-psiu/tone-spectrum.svg
```

The inspection JSON reports WAV metadata, a loud contiguous program region, and left/right FFT tone estimates near the selected nominal frequency. It also reports per-channel fundamental peak level, median FFT-bin noise floor, peak-to-noise-floor difference, broadband SNR, and second/third harmonic levels in dBFS and dBc. The optional SVG shows the 20 Hz–20 kHz FFT for visual review. The trim copies original PCM frames without re-encoding. It is intended to remove quiet lead-in/runout regions before local algorithm experimentation.

The energy-based trim is a candidate cleanup step, not a production track boundary detector. Review the generated region and WAV manually before using it as a fixture.

## Trim a full side to clean 1 kHz edge markers

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness trim-1khz \
  data/local-psiu/full-side.wav \
  --output data/local-psiu/full-side-1khz-trim.wav \
  --expected-duration-seconds 405
```

The command scans only the first and last 20 seconds for clean 1 kHz blocks, then streams the selected PCM frame range to the output. It expands beyond edge-only scanning only when the source duration materially exceeds the expected duration. This is a marker-based cleanup step, not a full-side analysis.

## Generate a local 1 kHz turntable diagnostic report

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness report \
  data/local-psiu/psiu-v128-fresh.wav \
  --nominal-hz 1000 \
  --output-dir data/local-psiu
```

The local report writes JSON, HTML, PDF, an FFT SVG, and a speed-over-time SVG. Local PDF generation uses installed Google Chrome or Chromium; the production worker will use its packaged renderer. The speed graph marks each channel's highest and lowest instantaneous-speed estimates and shows dashed revolution boundaries. A second graph folds and overlays all measured revolutions by platter phase, exposing repeatable rotation-synchronous structure. The report includes timestamp/duration, carrier frequency, speed estimate relative to 33⅓ RPM, peak/channel balance, second and third harmonics, non-harmonic peaks, and unweighted slow (`wow`, 0.1–6 Hz) and fast (`flutter`, 6–200 Hz) frequency-modulation estimates with RMS, sigma, and peak percentage. It also lists the five strongest 0.1–30 Hz periodic speed components as drivetrain-investigation candidates, including cycles per 33⅓-RPM platter revolution and tentative integer rotation-synchronous labels.

For a full side with clean 1 kHz markers at both edges, use `report --full-side`. It writes a memory-bounded JSON/HTML/PDF report with required outer/inner marker balance and harmonic comparison:

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness report \
  data/local-psiu/full-side.wav --full-side --expected-duration-seconds 405
```

These are diagnostic estimates from a 1 kHz carrier, not formal IEC/DIN/AES compliance measurements. Low-frequency labels such as `motor-region candidate` and `low-frequency rumble or power-region candidate` identify regions for investigation; they do not establish physical source attribution.

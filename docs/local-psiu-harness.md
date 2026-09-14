# Local PSIU algorithm harness

`wally-psiu-local` is a local-only developer tool. It starts/stops the PSIU, prints the PSIU `/status` JSON every five seconds during capture, retrieves `/audio.wav`, and saves it under the git-ignored `data/local-psiu/` directory. It does not call Wally production APIs or upload audio to S3.

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
- `GET /audio.wav` (polled for up to 30 seconds after Stop, because PSIU may finalize the file asynchronously)

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

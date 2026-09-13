# Local PSIU algorithm harness

`wally-psiu-local` is a local-only developer tool. It starts/stops the PSIU, retrieves `/audio.wav`, and saves it under the git-ignored `data/local-psiu/` directory. It does not call Wally production APIs or upload audio to S3.

## Capture a development recording

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness capture \
  --seconds 360 \
  --base-url http://psiu.local
```

The capture command uses only the documented fixed endpoints:

- `POST /api/sampling` with `{"running": true}`
- `POST /api/sampling` with `{"running": false}`
- `GET /status`
- `GET /audio.wav`

## Inspect and trim the result

```sh
PYTHONPATH=src python -m wallyanalyzer.tools.psiu_local_harness inspect \
  data/local-psiu/psiu-YYYYMMDDTHHMMSSZ.wav \
  --nominal-hz 1000 \
  --trim-output data/local-psiu/tone-only.wav
```

The inspection JSON reports WAV metadata, a loud contiguous program region, and left/right FFT tone estimates near the selected nominal frequency. The trim copies original PCM frames without re-encoding. It is intended to remove quiet lead-in/runout regions before local algorithm experimentation.

The energy-based trim is a candidate cleanup step, not a production track boundary detector. Review the generated region and WAV manually before using it as a fixture.

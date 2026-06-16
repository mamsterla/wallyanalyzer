# Data Folder

Place local test and validation data here.

## Intended use
This folder will let us:
- run Python pipelines on real inputs
- compare outputs against Matlab-generated graphs and artifacts
- tighten parity tolerances with real data

## Suggested structure

```text
data/
  raw/
    *.wav
  matlab/
    *.mat
    *.png
    *.jpg
  fixtures/
    acquisitions.json
    cartridges.json
    systems.json
    test_tracks.json
  outputs/
    measurement/
    compile/
```

## Notes
- Keep raw WAV files under `data/raw/`
- Put Matlab reference outputs, exported plots, and screenshots under `data/matlab/`
- Put metadata fixtures under `data/fixtures/`
- Put Python-generated artifacts under `data/outputs/`

## Comparison workflow
1. add input WAV and metadata fixtures
2. run Python measurement pipeline
3. run Python compile pipeline
4. compare Python arrays/metrics against Matlab outputs
5. compare curve shapes against Matlab plots
6. adjust implementation only when evidence shows mismatch

## Important rule
Do not hardcode `data/` paths into core algorithms.

Core code should accept paths and metadata providers from the outside.

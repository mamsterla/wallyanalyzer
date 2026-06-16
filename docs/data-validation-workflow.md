# Data Validation Workflow

## Goal
Use a local `data/` folder to validate Python results against Matlab outputs.

## What to collect

### Inputs
- raw WAV files
- metadata fixtures for acquisitions, cartridges, systems, and test tracks

### Matlab references
- `.mat` files from measurement stage
- plots exported from Matlab
- screenshots when direct data export is not available
- notes about run settings and file versions

### Python outputs
- measurement result arrays
- compile result summaries
- optional plots generated from Python arrays

## Validation stages

### Stage 1 — measurement parity
Compare:
- number of detected segments
- valid/rejected segment pattern
- lag traces
- frequency traces
- harmonic ratios

### Stage 2 — compile parity
Compare:
- reconstructed radius axis
- smoothed lag traces
- apparent tracking error curves
- distortion curves
- fitted LR and yaw values
- peak/rms summary metrics

### Stage 3 — graph parity
Compare:
- curve shape
- extrema location
- sign convention
- overall trend across runs

## Practical rule
When Matlab and Python disagree, classify the mismatch first:
- metadata mismatch
- indexing mismatch
- smoothing/window mismatch
- optimization mismatch
- sign convention mismatch

Do not tune formulas before checking metadata and indexing.

## Immediate next data work
When you add the real `data/` folder, I should add:
- JSON fixture loaders
- CLI entrypoints for local runs
- optional plotting scripts for side-by-side comparison

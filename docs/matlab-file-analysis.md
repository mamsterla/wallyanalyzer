# Matlab File Analysis

## Scope
This document inventories the current Matlab codebase and records what each file does, what it depends on, and how hard it will be to port to Python.

Primary migration goal:
- build a clean Python + NumPy/SciPy implementation first
- separate numeric core from I/O, plotting, and AWS integration

## Repository inventory

### Top-level workflows
- `MeasureSine14.m`
- `CompileSine24.m`
  - historical predecessor retained in repo: `CompileSine23.m`

### Helper functions under `Amster/`
- `baerwaldTE.m`
- `bopper.m`
- `breakstring.m`
- `cellfind.m`
- `choose.m`
- `choosepolyfit1.m`
- `green.m`
- `halffig.m`
- `jacobianest.m`
- `meannan.m`
- `nuttall.m`
- `pwdshort.m`
- `righttext.m`
- `rms.m`
- `stdnan.m`
- `subtext.m`
- `vline.m`

---

## High-level architecture

The codebase has two main stages.

1. **Measurement stage** — `MeasureSine14.m`
   - reads WAV audio
   - reads metadata from an Excel tracking sheet
   - slices the recording into angular snippets
   - estimates inter-channel lag, sine frequency, and harmonic amplitudes
   - writes a `.mat` result file

2. **Compilation / fitting stage** — `CompileSine24.m`
   - loads `.mat` measurement files
   - re-reads tracking metadata from Excel
   - smooths lag and harmonic data
   - fits stylus/tracking parameters with `fminsearch`
   - computes apparent tracking error and distortion summaries
   - produces diagnostic plots

### Key technical domains
- audio signal processing
- FFT-based phase / lag estimation
- tonearm geometry / Baerwald tracking error model
- nonlinear parameter fitting
- outlier rejection
- plotting and manual inspection

### External dependencies baked into Matlab code
- WAV input files
- Excel workbook: `Research Recording Tracking Sheet.xlsx`
- `.mat` intermediate files
- hardcoded Windows paths
- interactive Matlab environment: plots, `keyboard`, sounds

---

## Porting principles

### Keep in Python core
- numerical transforms
- FFT lag estimation
- window generation
- outlier rejection
- geometric error model
- fitting logic
- typed data models for metadata and outputs

### Remove or isolate
- Matlab plotting helpers
- `keyboard` pauses
- sound alerts via `bopper`
- hardcoded local paths
- direct Excel parsing inside numeric functions

### Replace in Python
- `xlsread` -> `pandas.read_excel` or `openpyxl`
- `audioread` / `audioinfo` -> `soundfile`, `scipy.io.wavfile`, or `librosa` if needed
- `.mat` intermediates -> `.npz`, Parquet, or JSON metadata + NumPy arrays
- `fminsearch` -> `scipy.optimize.minimize(method="Nelder-Mead")`
- `conv`, `conv2`, `fft`, `ifft` -> NumPy / SciPy equivalents

---

## File-by-file analysis

## 1) `MeasureSine14.m`

### Role
Primary measurement pipeline. Reads one or more WAV files, extracts usable sine-burst snippets, computes inter-channel lag, frequency, and harmonic distortion measures, then saves a `.mat` file for later compilation.

### Important note
The file is named `MeasureSine14.m`, but the first line defines:
- `function levelcheck`

That mismatch is a migration risk and may reflect Matlab-era experimentation.

### Inputs
- WAV files listed in the script body
- Excel workbook `Research Recording Tracking Sheet.xlsx`
- sheet 1: acquisition metadata
- sheet 2: test track metadata

### Outputs
Saves a `.mat` file with fields including:
- `lag`
- `F`
- `H`
- `dt`
- `hw`
- `Mperiod`
- `mfile`
- `file`
- `pitch`
- `T`
- `V0`
- `Omega`
- `ns`
- `noi`
- `Nrev`
- `FWHM`
- `PT`
- `rbeg`
- `rend`
- `skip`
- `Nskip`
- `ibeg`
- `iend`
- `imid`

### Main algorithm
1. Read workbook metadata.
2. Select digitizer-specific decimation.
3. Read WAV file and optionally decimate by 2.
4. Compute envelope over one-tone-period blocks.
5. Detect start/end of the modulated region.
6. Build fixed-size processing snippets spaced by record angle.
7. Reject snippets with visible white-noise contamination or low level.
8. High-pass by subtracting a smoothed version of the signal.
9. Apply Nuttall window.
10. Call nested `fftlag(...)` to estimate:
   - channel lag
   - mean sine frequency in each channel
   - harmonic amplitudes
11. Reject extreme lag outliers.
12. Save all results to `.mat`.

### Embedded subfunction: `fftlag`
This is core numeric logic.

#### `fftlag` computes
- power spectra for both channels
- dominant spectral peak near the sine fundamental
- relative phase difference between channels
- time lag from phase / frequency
- first, second, and third harmonic amplitudes

#### Special behaviors
- attempts to unwrap phase manually
- uses weighted averaging over spectral bins around the peak
- computes distortion via harmonic amplitudes
- includes extensive diagnostic plotting

### Dependencies
- `pwdshort`
- `cellfind`
- `bopper`
- `nuttall`
- `vline`
- `green`
- `halffig`
- `breakstring`
- Matlab built-ins: `audioinfo`, `audioread`, `xlsread`, `fft`, `ifft`, `ifftshift`, `conv2`, `rms`, plotting

### Side effects
- reads local files from hardcoded Windows path
- opens plots
- pauses with `keyboard`
- writes `.mat`
- may emit beep/sound via `bopper`

### Porting risks
- **High**

### Why high risk
- monolithic script structure
- mixed I/O, plotting, metadata lookup, and math
- nested function with nontrivial FFT/phase logic
- manual snippet rejection heuristics
- several hardcoded parameters
- function/filename mismatch

### Python decomposition target
- `metadata/tracker.py`
- `audio/loaders.py`
- `signal/window.py`
- `signal/snippet_detection.py`
- `signal/fftlag.py`
- `pipelines/measure_sine.py`

---

## 2) `CompileSine24.m`

### Role
Loads `.mat` measurement outputs, joins them with workbook metadata, smooths lag and distortion signals, fits stylus/tracking parameters, and creates summary metrics and plots.

### Important note
The current compile-stage file is named `CompileSine24.m`, but the first line still defines:
- `function CompileSine`

Version number is in the filename, not the function name.

### Inputs
- `.mat` files listed in the script
- Excel workbook `Research Recording Tracking Sheet.xlsx`
- sheet 1: acquisition metadata
- sheet 3: system metadata
- sheet 4: cartridge metadata

### Outputs
- in-memory fit results and plots
- optional `.mat` save is present but commented out
- no clean machine-readable summary file yet

### Main algorithm
1. Select a set of measurement `.mat` files.
2. Read workbook metadata for file, system, cartridge, and geometry values.
3. Load each `.mat`.
4. Remove bad lag points using `choose`.
5. Reconstruct radial positions.
6. Smooth lag, radius, and harmonic arrays by moving averages.
7. Infer playback direction from radius ordering.
8. Fit stylus width and stylus yaw using `fminsearch` against Baerwald-based apparent tracking error.
9. Compute distortion proxy from fitted Baerwald tracking error.
10. Fit cartridge yaw and overhang against measured 2nd-harmonic distortion.
11. Extract summary metrics:
   - peak apparent tracking error
   - mean apparent tracking error
   - fit RMS
   - peak 2nd-harmonic distortion
12. Fit summary curves across cartridge yaw settings.
13. Plot per-file and aggregate summaries.

### Core formulas / concepts
- apparent tracking error from lag:
  - `asind(1000*pi*R*lag/0.9/lr)`
- Baerwald tracking error model from `baerwaldTE`
- distortion proxy proportional to `tand(baerwaldTE(...)) / R`

### Dependencies
- `pwdshort`
- `cellfind`
- `choose`
- `choosepolyfit1`
- `baerwaldTE`
- `rms`
- `halffig`
- `green`
- `righttext`
- `subtext`
- `breakstring`
- `bopper`
- optional `jacobianest`
- Matlab built-ins: `xlsread`, `fminsearch`, `conv`, `conv2`, plotting

### Side effects
- loads `.mat`
- reads local Excel workbook on a hardcoded path
- heavy plotting
- multiple `keyboard` stops

### Porting risks
- **High**

### Why high risk
- mixes experimental notes with production logic
- relies on many hidden conventions from measurement files
- many variables have unclear units unless inferred from comments
- summary fitting section appears partially unfinished or brittle
- uses interactive debugging heavily

### Python decomposition target
- `geometry/baerwald.py`
- `fitting/apparent_tracking.py`
- `fitting/distortion_fit.py`
- `pipelines/compile_sine.py`
- `reports/summary_metrics.py`

---

## 3) `Amster/baerwaldTE.m`

### Role
Implements the Baerwald/Lofgren tracking error geometry model.

### Inputs
- `r` : groove radius in mm
- `L` : effective length in mm
- `OA` : offset angle in degrees
- `OH` : overhang in mm
- `LO` : lathe centering offset in mm
- `plotflag`

### Output
- `eps` : tracking error in degrees

### Formula
```matlab
eps = asind((r.^2+L.^2-PS^2)./(2*r*L)) - OA - asind(LO./r)
```
where `PS = L - OH`.

### Dependencies
- plotting helpers only when `plotflag` is true
- `green`, `righttext`, `pwdshort`

### Porting risk
- **Low**

### Python target
Pure vectorized function in NumPy.

---

## 4) `Amster/bopper.m`

### Role
Sound-based warning/error/prompt utility.

### Output
Plays tones or beeps.

### Dependencies
- Matlab `sound`
- `beep`

### Porting risk
- **None for core math**

### Python target
Drop from core. Replace with logging if needed.

---

## 5) `Amster/breakstring.m`

### Role
Splits a string into chunks of length `n`. If `n < 0`, tries to split on whitespace-like boundaries.

### Porting risk
- **Low**

### Python target
Small utility or omit if plot labels are removed.

---

## 6) `Amster/cellfind.m`

### Role
Returns indices of non-empty cells.

### Porting risk
- **Low**

### Python target
Likely not needed directly. Replace with list comprehension / pandas logic.

---

## 7) `Amster/choose.m`

### Role
Iterative outlier rejection for a 1D array using mean and standard deviation with NaN handling.

### Inputs
- `x`
- `nsig` threshold, default 3

### Outputs
- `M` mean of retained points
- `S` std of retained points
- `igood` kept indices
- `ibad` rejected indices
- cleaned `x` when requested

### Dependencies
- `meannan`
- `stdnan`

### Porting risk
- **Low**

### Python target
Standalone numeric helper using NumPy nan-aware stats.

---

## 8) `Amster/choosepolyfit1.m`

### Role
Iterative polynomial fit with outlier rejection.

### Inputs
- `x`, `y`
- polynomial degree `n`
- sigma threshold `nsig`
- diagnostic plotting flag

### Outputs
- polynomial coefficients
- residual sigma
- good/bad indices
- fit values
- iteration count
- optional figure handle

### Dependencies
- custom `rms`
- plotting

### Porting risk
- **Medium**

### Python target
Useful helper for summary fit logic. Implement with NumPy polynomial fitting and residual screening.

---

## 9) `Amster/green.m`

### Role
Returns a fixed RGB color.

### Porting risk
- **None for core math**

### Python target
Drop unless plotting parity matters.

---

## 10) `Amster/halffig.m`

### Role
Sets a figure to a fixed screen size.

### Porting risk
- **None for core math**

### Python target
Drop or replace in plotting layer only.

---

## 11) `Amster/jacobianest.m`

### Role
Numerically estimates Jacobian matrices for vector-valued functions using finite differences plus Romberg extrapolation.

### Usage in repo
Referenced in `CompileSine24.m`, currently behind an `if 0` block.

### Porting risk
- **Medium**

### Python target
Only port if uncertainty estimation becomes a requirement. SciPy/autodiff tools may replace it.

---

## 12) `Amster/meannan.m`

### Role
Mean ignoring NaNs.

### Porting risk
- **None**

### Python target
Use `numpy.nanmean`.

---

## 13) `Amster/nuttall.m`

### Role
Generates a Nuttall window with selectable coefficient variants.

### Inputs
- `n`
- `ver` coefficient preset

### Output
- window vector

### Porting risk
- **Low**

### Python target
Use `scipy.signal.windows.nuttall` if equivalent, or preserve exact coefficients to avoid drift.

### Migration note
Because this code uses custom coefficient variants, exact reimplementation is safer than assuming SciPy parity.

---

## 14) `Amster/pwdshort.m`

### Role
Returns the last `n` path components of a path.

### Porting risk
- **Low**

### Python target
Use `pathlib`.

---

## 15) `Amster/righttext.m`

### Role
Adds vertical annotation text in a thin side axis.

### Porting risk
- **None for core math**

### Python target
Plotting layer only, likely omitted.

---

## 16) `Amster/rms.m`

### Role
Custom RMS function with optional dimension and NaN omission.

### Porting risk
- **Low**

### Python target
Implement carefully with `np.sqrt(np.nanmean(x**2, axis=...))`.

### Migration note
Check dimension semantics because Matlab default dimension behavior differs from NumPy.

---

## 17) `Amster/stdnan.m`

### Role
Standard deviation ignoring NaNs.

### Porting risk
- **None**

### Python target
Use `numpy.nanstd`, with matching `ddof` if parity matters.

---

## 18) `Amster/subtext.m`

### Role
Adds annotation text with character units offset.

### Porting risk
- **None for core math**

### Python target
Plotting layer only.

---

## 19) `Amster/vline.m`

### Role
Draws vertical line markers on a plot.

### Porting risk
- **None for core math**

### Python target
Plotting layer only.

---

## Dependency summary

### Numeric-core dependencies worth porting
- `baerwaldTE`
- `choose`
- `choosepolyfit1`
- `nuttall`
- `rms`
- `meannan`
- `stdnan`
- `jacobianest` only if uncertainty estimates are needed

### UI / plotting helpers likely to drop or isolate
- `bopper`
- `breakstring`
- `green`
- `halffig`
- `pwdshort`
- `righttext`
- `subtext`
- `vline`
- `cellfind` likely replaced by pandas/index logic

---

## Risks blocking clean translation

### 1. Hardcoded environment assumptions
- absolute Windows paths
- workbook must exist locally
- Matlab interactive workflow assumed

### 2. File/function naming inconsistency
- `MeasureSine14.m` -> `function levelcheck`
- `CompileSine24.m` -> `function CompileSine`

### 3. Mixed concerns
Each top-level file mixes:
- metadata lookup
- signal processing
- model fitting
- plotting
- debugging
- persistence

### 4. Unclear data contracts
`.mat` files act as hidden interfaces between stages. We need explicit Python schemas.

### 5. Numeric parity sensitivity
Lag and distortion estimates may be sensitive to:
- window coefficients
- phase unwrapping logic
- FFT bin weighting
- decimation behavior
- floating-point differences

---

## Proposed translation order

### Stage A — document and freeze interfaces
1. define workbook schema
2. define measurement output schema
3. define compile-stage input schema

### Stage B — port stable helpers
1. `baerwaldTE`
2. `nuttall`
3. `rms`
4. `choose`
5. `choosepolyfit1`

### Stage C — port measurement core
1. WAV loading
2. envelope detection
3. snippet extraction
4. FFT lag estimation
5. harmonic extraction
6. measurement result serialization

### Stage D — port compile/fitting core
1. metadata join
2. lag smoothing
3. apparent tracking error fit
4. distortion fit
5. aggregate summary metrics

### Stage E — add cloud boundary
1. S3 read/write adapters
2. Lambda or batch wrappers
3. structured outputs for downstream systems

---

## Recommended Python module layout

```text
docs/
  matlab-file-analysis.md
  matlab-data-contracts.md
  porting-spec-measure-sine.md
  porting-spec-compile-sine.md

src/wallyanalyzer/
  metadata/
    tracker.py
  audio/
    io.py
  signal/
    windows.py
    snippets.py
    fftlag.py
  geometry/
    baerwald.py
  fitting/
    outliers.py
    apparent_tracking.py
    distortion.py
  pipelines/
    measure_sine.py
    compile_sine.py
  storage/
    s3.py
  schemas/
    measurement.py
    compile_result.py
```

---

## Immediate next docs to create

1. `docs/matlab-data-contracts.md`
   - workbook sheets
   - `.mat` fields
   - units
   - required vs optional fields

2. `docs/porting-spec-measure-sine.md`
   - Python spec for measurement stage

3. `docs/porting-spec-compile-sine.md`
   - Python spec for fitting / summary stage

---

## Initial recommendation

Treat this codebase as an **algorithm extraction project**, not a line-by-line translation.

Best path:
- preserve formulas and heuristics
- rewrite architecture
- isolate I/O from math
- validate every numeric stage against saved Matlab outputs
- add AWS later, after parity is stable

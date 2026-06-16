# Porting Spec: Compile Sine Pipeline

## Source
Matlab source:
- `CompileSine24.m`
  - historical predecessor retained in repo: `CompileSine23.m`

## Goal
Implement a Python compile/fitting pipeline that reproduces the Matlab stage which:
- loads measurement artifacts
- joins workbook metadata
- reconstructs radius-aligned measurement traces
- smooths lag and harmonic signals
- fits effective stylus width and stylus yaw
- fits distortion-related geometry parameters
- emits per-run and aggregate summary metrics

This stage should produce clean machine-readable outputs, not only plots.

---

## 1. Scope

### In scope
- loading measurement outputs from the measurement pipeline
- loading acquisition/system/cartridge workbook metadata
- radius reconstruction
- outlier rejection of lag samples
- moving-average smoothing
- apparent tracking error fit
- distortion fit
- summary metric extraction
- aggregate cross-run summaries

### Out of scope for v1
- Matlab-style figure reproduction
- uncertainty estimation via `jacobianest`
- interactive outlier inspection
- AWS orchestration

---

## 2. Proposed Python API

```python
from wallyanalyzer.schemas import CompileResult, CompileConfig


def compile_sine(
    measurements: list[MeasurementResult],
    metadata_bundle,
    config: CompileConfig,
) -> CompileResult:
    ...
```

### Per-file helper
```python
def compile_one(
    measurement: MeasurementResult,
    acquisition_record,
    system_record,
    cartridge_record,
    config: CompileConfig,
) -> SingleCompileResult:
    ...
```

---

## 3. Required inputs

### Measurement artifact fields
- `lag_s`
- `harmonic_amplitude`
- `fundamental_freq_hz` optional for future reporting
- `outer_radius_mm`
- `inner_radius_mm`
- `skip_deg`
- `periods_per_segment`
- `source_file`
- `pitch_estimate`

### Acquisition metadata fields
- system id
- cartridge name
- mount yaw / cantilever yaw
- stylus yaw
- effective length
- offset angle
- overhang
- required overhang
- overhang adjustment
- pivot-to-spindle adjustment
- actual pivot-to-spindle
- comments

### Cartridge metadata fields
- `LR` stylus width estimate in micrometers

### System metadata fields
- descriptive labels for reporting

---

## 4. Config contract

```python
@dataclass
class CompileConfig:
    smoothing_rotations: int = 16
    lag_outlier_sigma: float = 4.0
    fit_method: str = "Nelder-Mead"
    enable_plots: bool = False
    distortion_use_absolute_value: bool = True
    fit_stylus_width: bool = True
    fit_stylus_yaw: bool = True
```

### Migration note
Matlab has hidden constants like `V0 = 5.5 * .01` in this stage. Python config should expose them when needed.

---

## 5. Detailed algorithm spec

## Step 1 — Join each measurement with workbook metadata

### Behavior
For each measurement artifact:
1. derive file stem
2. find acquisition record by file stem
3. find cartridge record by cartridge name
4. find system record by system id

### Output
Create a normalized joined object.

```python
@dataclass
class CompileInputRecord:
    measurement: MeasurementResult
    acquisition: AcquisitionRecord
    cartridge: CartridgeRecord | None
    system: SystemRecord | None
```

### Failure rules
- missing acquisition record -> fail fast
- missing cartridge/system record -> configurable warning or fail, depending on downstream dependence

---

## Step 2 — Normalize metadata and derive geometry values

### Matlab behavior
Current code derives:
- `OH1 = OH0 + DOH - DPS`

Where:
- `OH0` is nominal overhang from workbook
- `DOH` is overhang adjustment
- `DPS` is pivot/spindle adjustment term

### Python target behavior
Normalize and expose:
- `mount_yaw_deg` from workbook Wally Zenith / cantilever yaw
- `stylus_yaw_input_deg`
- `effective_length_mm`
- `offset_angle_deg`
- `nominal_overhang_mm`
- `effective_overhang_mm = nominal_overhang_mm + overhang_adjustment_mm - pivot_spindle_adjustment_mm`

### Consistency check
Matlab warns if:
```matlab
abs(EL - OH1 - P2S) > .001
```
Python should preserve this validation and report it structurally.

---

## Step 3 — Clean lag and reconstruct radius axis

### Matlab behavior
1. call `choose(lag, 4)` to reject lag outliers
2. set rejected lag points to `NaN`
3. compute radial step:
   - `dr = (rend - rbeg) / (length(lag) - 1)`
4. reconstruct nominal radius vector:
   - `rs = rbeg:dr:rend`
5. keep only valid samples

### Python target behavior
Implement the same sequence.

### Outputs
- `lag_clean_s`
- `valid_indices`
- `radius_nominal_mm`
- `radius_valid_mm`

### Important note
This assumes a linear radius progression across snippets. Preserve for parity.

---

## Step 4 — Smooth lag, radius, and harmonics

### Matlab behavior
- `nrot = round(360 / skip)`
- `lavg = nrot * navg`
- moving-average smooth over `lavg` samples using `conv(..., 'valid')`

Applied to:
- lag -> `LAG`
- radius -> `RS`
- harmonic amplitudes -> `HD`

### Python target behavior
Use same valid-window moving average.

### Outputs
- `lag_smooth_s`
- `radius_smooth_mm`
- `harmonic_smooth`

### Direction inference
- if first smoothed radius < last smoothed radius -> CCW (`rot = -1`)
- else CW (`rot = 1`)

This sign influences modeled apparent tracking error.

---

## Step 5 — Fit stylus width and stylus yaw

This is the first major nonlinear fit.

### Parameters fitted in Matlab
- effective stylus width `lr`
- effective stylus yaw `sz`

### Initial guess
- `p0 = [LR0, SY]`
- `LR0` from cartridge metadata
- `SY` from acquisition stylus yaw after sign correction already applied upstream in code

### Measured apparent tracking error function
Matlab:
```matlab
atemeas = @(lr) asind(1000*pi*RS.*LAG/0.9/lr)
```

### Modeled apparent tracking error function
Matlab:
```matlab
atemod = @(sz) rot*baerwaldTE(RS, EL, OA, OH1, 0, 0) + sz + CY
```

Where:
- `RS` smoothed radius vector
- `EL` effective length
- `OA` offset angle
- `OH1` effective overhang
- `CY` mount yaw / cantilever yaw

### Error function
```matlab
err(p) = atemeas(p[0]) - atemod(p[1])
```

### Objective
Matlab uses custom `rms(err(p))`.

### Python target behavior
Use `scipy.optimize.minimize(method="Nelder-Mead")` on:
```python
objective(p) = rms_nan(atemeas(p[0]) - atemod(p[1]))
```

### Outputs
- fitted stylus width `effective_lr_um`
- fitted stylus yaw `effective_stylus_yaw_deg`
- fit RMS
- measured ATE trace
- fitted ATE trace
- raw ATE trace for unsmoothed data where available

### Recommended constraints
Matlab is unconstrained. Python v1 should match that for parity, but record if optimizer wanders into invalid physical values.

---

## Step 6 — Compute theoretical distortion proxy

### Matlab behavior
First compute nominal Baerwald tracking error with mount-yaw-adjusted offset angle:
```matlab
baer00 = baerwaldTE(RS, EL, OA - CY, OH1, 0, 0)
```

Then compute distortion proxy:
```matlab
D = V0 * tand(baer00) ./ RS * 1000 / Omega
```

### Python target behavior
Implement same formula and store as theoretical distortion trace.

### Units note
This is a modeled distortion parameter, not yet a percentage. Comparison to measurement happens through harmonic ratios.

---

## Step 7 — Fit distortion-related geometry parameters

This is the second nonlinear fit.

### Measured distortion trace
Matlab:
```matlab
D2 = HD[:,2] ./ HD[:,1]
```
which is the 2nd harmonic amplitude ratio.

### Parameters fitted
- cartridge yaw / mount yaw correction term
- effective overhang

Initial guess:
```matlab
dp0 = [CY, OH1]
```

### Model
```matlab
dist(dp) = V0 * tand(baerwaldTE(RS, EL, OA - dp[0], dp[1], 0, 0)) ./ RS * 1000 / Omega
```

### Objective
Matlab minimizes:
```matlab
sum((abs(dist(dp)) - abs(D2)).^2)
```

### Python target behavior
Replicate with `Nelder-Mead`.

### Outputs
- fitted yaw parameter for distortion model
- fitted overhang parameter for distortion model
- fitted distortion trace
- objective value

---

## Step 8 — Extract single-measurement summary metrics

### Matlab metrics observed
- `ATEpk` = max absolute fitted apparent tracking error
- `ATEpos` = max signed fitted apparent tracking error
- `ATEsign` = sign at peak absolute ATE
- `ATErng` = max - min fitted ATE
- `ATEmean` = mean fitted ATE
- `Rms` = fit RMS
- `D2pk` = max measured 2nd-harmonic ratio * 100
- `D2rms` = RMS measured 2nd-harmonic ratio * 100
- `Noise` estimated from raw-minus-smoothed ATE

### Python target behavior
Create explicit summary dataclass.

```python
@dataclass
class SingleCompileSummary:
    file_stem: str
    effective_lr_um: float
    effective_stylus_yaw_deg: float
    apparent_tracking_error_peak_abs_deg: float
    apparent_tracking_error_peak_signed_deg: float
    apparent_tracking_error_range_deg: float
    apparent_tracking_error_mean_deg: float
    apparent_tracking_fit_rms_deg: float
    distortion_second_harmonic_peak_pct: float
    distortion_second_harmonic_rms_pct: float
    noise_estimate_deg: float | None
```

---

## Step 9 — Aggregate across multiple measurements

`CompileSine24.m` then compares multiple runs across different mount yaw values.

### Inputs to aggregate stage
Per measurement:
- mount yaw `CY`
- `ATEpk`
- `ATEpos`
- `D2pk`
- `D2rms`
- fitted `LR`

### Sorting
Sort records by mount yaw.

### Sign split for peak ATE
Matlab splits runs into:
- positive-peak branch
- negative-peak branch

Then fits lines separately using `choosepolyfit1`.

### Aggregate outputs desired in Python
- sorted summaries by mount yaw
- positive-branch line fit
- negative-branch line fit
- inferred crossing yaw where branches intersect
- distortion-vs-yaw fit if retained

### Caution
The tail of the Matlab file appears partially brittle or unfinished:
- references variables like `igoodpk`, `ibadpk`, `CYfit`, `D2fit`, `CYD2min` not defined in the visible code block

Python should not mirror that ambiguity. Define aggregate stage cleanly.

---

## 6. Proposed result schemas

### Single-run detailed result
```python
@dataclass
class SingleCompileResult:
    input_record: CompileInputRecord
    radius_valid_mm: np.ndarray
    radius_smooth_mm: np.ndarray
    lag_clean_s: np.ndarray
    lag_smooth_s: np.ndarray
    harmonic_smooth: np.ndarray
    ate_measured_deg: np.ndarray
    ate_fitted_deg: np.ndarray
    ate_raw_deg: np.ndarray | None
    distortion_model: np.ndarray
    distortion_fit: np.ndarray
    stylus_fit_params: dict
    distortion_fit_params: dict
    summary: SingleCompileSummary
    diagnostics: dict
```

### Multi-run aggregate result
```python
@dataclass
class CompileResult:
    single_results: list[SingleCompileResult]
    aggregate_tables: dict
    aggregate_fits: dict
    diagnostics: dict
```

---

## 7. Supporting numeric helpers

### Required helpers
- `baerwald_tracking_error(...)`
- `rms_nan(...)`
- `reject_outliers_sigma(...)`
- `moving_average_valid(...)`
- `polyfit_with_outlier_rejection(...)`

### Fit engine
Use SciPy:
- `scipy.optimize.minimize(..., method="Nelder-Mead")`

### Future option
If bounds are needed later, evaluate `Powell` or bounded least-squares reformulation.

---

## 8. Validation plan

## Single-run parity tests
Given one known measurement artifact and workbook rows, verify:
- same valid lag count after outlier rejection
- same smoothed array lengths
- fitted stylus width close to Matlab
- fitted stylus yaw close to Matlab
- ATE peak/mean/RMS close to Matlab
- distortion fit parameters close to Matlab

## Multi-run parity tests
Given a small set of measurements:
- same sort order by mount yaw
- same per-run summary trends
- line-fit coefficients reasonably close to Matlab

### Acceptance targets
Initial draft:
- fit RMS within a few percent
- fitted `LR` within a few percent
- fitted stylus yaw within small fractions of a degree
- aggregate crossing yaw within a small fraction of a degree if data is stable

---

## 9. Known risks

### Risk: hidden variable conventions
Some terms are only explained in comments and may have evolved across file versions.

### Risk: sign conventions
This stage mixes:
- playback direction sign
- mount yaw sign
- stylus yaw sign
- modeled vs measured ATE sign

Need one canonical sign convention table in Python docs.

### Risk: objective function sensitivity
`Nelder-Mead` may converge to slightly different values than Matlab depending on initialization and tolerances.

### Risk: incomplete aggregate section
The end-of-file sweep logic differs between `CompileSine23.m` and `CompileSine24.m`. Python should follow the newer `CompileSine24.m` branch structure rather than the older, more brittle 23 logic.

---

## 10. Refactoring target structure

```text
src/wallyanalyzer/
  geometry/
    baerwald.py
  fitting/
    outliers.py
    apparent_tracking.py
    distortion.py
    aggregate.py
  pipelines/
    compile_sine.py
  schemas/
    compile_result.py
```

### Responsibilities
- `apparent_tracking.py` -> stylus width/yaw fit
- `distortion.py` -> distortion model and fit
- `aggregate.py` -> cross-run sorting and line fits
- `compile_sine.py` -> orchestration and output assembly

---

## 11. Output requirements for Python v1

### Required machine-readable outputs
- per-run summary table
- per-run detailed arrays
- aggregate summary table
- fit parameters and objective values
- diagnostics/warnings list

### Suggested file formats
- Parquet for per-run summaries
- NPZ/HDF5 for detailed arrays
- JSON for metadata and diagnostics

---

## 12. Recommended implementation sequence

1. port `baerwaldTE`
2. port `rms`, `choose`, `choosepolyfit1`
3. implement radius reconstruction + smoothing
4. implement stylus width/yaw fit
5. implement distortion fit
6. build explicit summary dataclasses
7. build aggregate multi-run stage
8. add plots only if needed for debugging

---

## 13. First-version rule

Do not copy Matlab plotting and interactive flow into core Python.

Core output must be deterministic, testable, and machine-readable.

Plots belong in optional reporting utilities, not in fitting logic.

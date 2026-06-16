# Porting Spec: Measure Sine Pipeline

## Source
Matlab source:
- `MeasureSine14.m`

## Goal
Implement a Python measurement pipeline that reproduces the Matlab stage which:
- reads a stereo WAV recording
- detects valid modulated audio region
- slices the signal into angular snippets
- estimates inter-channel lag
- estimates fundamental frequency per channel
- estimates harmonic amplitudes
- emits a structured measurement artifact for later fitting

This spec defines the target behavior, module boundaries, and validation rules.

---

## 1. Scope

### In scope
- workbook metadata lookup needed for measurement
- stereo WAV loading
- digitizer-based decimation rule
- envelope estimation
- modulation start/end detection
- snippet extraction
- snippet rejection
- high-pass detrending by subtraction of smoothed signal
- Nuttall windowing
- FFT-based lag and harmonic measurement
- structured output format

### Out of scope
- Matlab-style interactive plots
- `keyboard` pauses
- sound notifications
- AWS integration
- aggregate cartridge/system fitting

---

## 2. Proposed Python API

```python
from pathlib import Path
from wallyanalyzer.schemas import MeasurementResult, MeasureSineConfig


def measure_sine(
    audio_path: Path,
    acquisition_record,
    test_track_record,
    config: MeasureSineConfig,
) -> MeasurementResult:
    ...
```

### Batch entrypoint
```python
def measure_many(audio_paths: list[Path], workbook_path: Path, config: MeasureSineConfig):
    ...
```

---

## 3. Inputs

### Required direct inputs
- stereo WAV file
- acquisition metadata row for that file
- test track metadata row referenced by acquisition metadata
- measurement config

### Required metadata fields
From acquisition sheet:
- file name or file stem
- digitizer
- test track name

From test track sheet:
- outer radius mm
- inner radius mm

---

## 4. Config contract

```python
@dataclass
class MeasureSineConfig:
    skip_deg: float = 10.0
    periods_per_segment: int = 64
    spectral_half_width_bins: int = 5
    rotation_period_s: float = 1.8
    cut_velocity_m_per_s: float = 0.06
    angular_velocity_rad_per_s: float = 100/3 * 2*np.pi/60
    envelope_threshold_fraction: float = 0.3
    noise_reject_rms_multiplier: float = 2.0
    lag_outlier_abs_s: float = 1.5e-5
    highpass_window_base: int = 500
    enable_debug_plots: bool = False
```

### Migration rule
All hardcoded Matlab constants must be externalized into config or documented computed values.

---

## 5. Detailed algorithm spec

## Step 1 — Load metadata

### Behavior
- find acquisition row matching audio file stem
- read digitizer type
- read test track name
- find corresponding test track row

### Required normalization
- case-insensitive filename matching
- prefer exact stem match when possible
- preserve raw workbook values for traceability

### Failure cases
- no acquisition row found -> fail fast
- multiple ambiguous acquisition rows -> fail with diagnostic
- test track missing -> fail fast

---

## Step 2 — Load audio and apply digitizer rule

### Matlab behavior
- `audioinfo(file)`
- `audioread(file, 'native')`
- if digitizer contains `tascam`, keep every other sample
- if digitizer contains `cosmos`, no decimation

### Python target behavior
- load audio into `float64` or `float32`, then promote to `float64` for analysis
- require exactly 2 channels
- apply decimation factor:
  - `2` for `tascam`
  - `1` for `cosmos`
  - fallback behavior configurable; default should be explicit warning + factor `1`

### Derived quantities
- `N0 = total_samples_after_decimation`
- `Fs = sample_rate_hz / decimation_factor`
- `dt = 1 / Fs`
- `Nrev = rotation_period_s / dt`
- `Nperiod = round(0.001 / dt)` for nominal 1 kHz period
- `Nskip = round(Nrev / 360 * skip_deg)`

### Validation
- `Nperiod > 0`
- `Nskip > 0`
- enough total samples for at least several snippets

---

## Step 3 — Build envelope and detect modulation bounds

### Matlab behavior
1. Partition left and right channels into blocks of one nominal sine period.
2. For each block, record max absolute sample value per channel.
3. Use median left-channel envelope as `level`.
4. Detect beginning where 9 consecutive envelope samples exceed `0.3 * level`.
5. Detect end similarly from the back.

### Python target behavior
Implement same logic first for parity.

### Outputs
- `start_env_sample`
- `end_env_sample`
- envelope arrays for debug diagnostics

### Failure cases
- cannot find stable start or end
- detected region too short for one processing snippet

### Notes
This is heuristic, not a general VAD. Preserve current behavior before improving it.

---

## Step 4 — Compute pitch estimate and playback direction

### Matlab behavior
- `T = (endEnv - startEnv + 1) * dt`
- `pitch = (rbeg - rend) * rotation_period_s / T`
- if `rend > rbeg`, set `rot = -1`, else `rot = 1`

### Python target behavior
Compute and store these values.

### Ambiguity
`pitch` physical interpretation is not fully documented. Preserve formula and metadata label until confirmed.

---

## Step 5 — Construct processing snippet geometry

### Matlab behavior
- smoothing filter length `nfilt = 500/decimate + 1`
- snippet length `noi = Mperiod * Nperiod`
- processing domain `Noi = noi + nfilt - 1`
- snippet center indices:
  - from `start_env + ceil(Noi/2)`
  - to `end_env - Noi`
  - step `Nskip`

### Python target behavior
Preserve the same index math.

### Derived arrays
- `soi`: segment-of-interest indices after removing convolution padding
- `Irng`: full pre-convolution index range
- `irng`: snippet-local index range
- `frng`: FFT frequency axis

---

## Step 6 — Reject unusable snippets before FFT analysis

### Matlab rejection rules
Reject snippet if any of these are true:
1. first 500 samples in either channel look like white-noise burst
2. last 500 samples in either channel look like white-noise burst
3. max absolute amplitude in either channel is below half the envelope level

Noise test:
- reject if `2 * rms(window) < max(abs(window))`

### Python target behavior
Replicate these exact checks first.

### Output
- `valid_mask`
- rejected snippets should produce `NaN` results in `lag` and `F`

---

## Step 7 — High-pass detrend and window the snippet

### Matlab behavior
For valid snippets:
- subtract moving low-pass trend using convolution with Nuttall filter
- keep only centered valid region after convolution
- multiply by Nuttall window of length `noi`

### Python formula
```python
y2 = (y1[soi] - conv2_valid(y1, filt)) * win
```

Where:
- `y1` is `(Noi, 2)` raw snippet
- `filt` is normalized Nuttall smoothing window
- `win` is snippet Nuttall apodization window broadcast to both channels

### Implementation guidance
- use explicit 1D convolution per channel for clarity
- verify index alignment matches Matlab `conv2(..., 'valid')`

---

## Step 8 — FFT lag and harmonic extraction

This is the core measurement routine.

### Proposed module
- `signal/fftlag.py`

### Function API
```python
def fftlag(segment: np.ndarray, dt_s: float, spectral_half_width_bins: int) -> FFTLagResult:
    ...
```

### Inputs
- `segment`: shape `(n_samples, 2)` after detrend + window
- `dt_s`
- `spectral_half_width_bins = hw`

### Outputs
```python
@dataclass
class FFTLagResult:
    lag_s: float
    fundamental_freq_hz: np.ndarray   # shape (2,)
    harmonic_amplitude: np.ndarray    # shape (3,)
    diagnostics: dict
```

### Algorithm details
1. normalize each channel by its standard deviation
2. FFT with `ifftshift`-compatible centering behavior
3. compute power spectrum per channel and mean power across channels
4. find positive-frequency peak below Nyquist
5. choose bins `ipeak = ipeak0 + [-hw, ..., +hw]`
6. compute phase at those bins for both channels
7. compute channel phase difference `dphi`
8. manually unwrap large phase jumps around the median phase difference
9. convert phase difference to lag per bin:
   - `lag_bin = dphi / (2*pi*f)`
10. weighted-average lag across bins
11. weighted-average frequency per channel across bins
12. compute harmonic amplitudes:
   - fundamental near `ipeak0`
   - second harmonic near `2 * ipeak0`
   - third harmonic near `3 * ipeak0`

### Important parity details
- preserve Matlab frequency indexing conventions
- preserve weighted averaging logic
- preserve manual phase-wrap fix before averaging
- preserve exact harmonic search neighborhood widths first

### Harmonic amplitude semantics
Return amplitudes, not percent distortion. Distortion ratios are derived later.

---

## Step 9 — Post-process lag array

### Matlab behavior
After looping over snippets:
- mark lag values with absolute value above `1.5e-5` as invalid (`NaN`)

### Python target behavior
Apply same absolute lag outlier mask first.

### Recommendation
Store both:
- raw lag output
- cleaned lag output

This will help debugging parity issues later.

---

## Step 10 — Emit structured result

### Required arrays
- `lag_s`
- `fundamental_freq_hz`
- `harmonic_amplitude`
- `valid_mask`
- `segment_centers_sample`

### Required metadata
- source file
- sample rate
- decimation factor
- outer/inner radii
- config parameters used
- start/end bounds
- derived quantities like `Nrev`, `Nskip`, `pitch`

### Storage recommendation
Write two files:
1. compact array store, e.g. `.npz`
2. JSON metadata sidecar

Optional:
- single Parquet segment table for cloud workflows

---

## 6. Proposed module decomposition

```text
src/wallyanalyzer/
  metadata/
    tracker.py
  audio/
    io.py
  signal/
    windows.py
    envelope.py
    snippets.py
    fftlag.py
  pipelines/
    measure_sine.py
  schemas/
    measurement.py
```

### Suggested responsibilities
- `tracker.py` -> workbook loading and row matching
- `io.py` -> WAV loading and decimation
- `windows.py` -> exact Nuttall coefficients
- `envelope.py` -> envelope extraction and boundary detection
- `snippets.py` -> center index generation and rejection checks
- `fftlag.py` -> spectral lag/harmonic estimation
- `measure_sine.py` -> orchestration

---

## 7. Non-goals for first Python version

Do not attempt in v1:
- improving the detection heuristic
- changing window type
- changing harmonic search strategy
- changing lag unwrapping method
- cloud-native refactor in the same step

First objective is Matlab parity.

---

## 8. Validation plan

## Unit tests

### `nuttall`
- exact coefficient parity for chosen `ver`
- odd/even length behavior

### `envelope detection`
- synthetic signal with known start/end
- parity with Matlab logic for threshold windows

### `fftlag`
- synthetic stereo sines with known lag
- cases with second/third harmonics
- small phase-wrap stress cases

## Integration tests

Given one known WAV + workbook row:
- same snippet count
- same valid mask or near-equivalent mask
- lag values close to Matlab
- frequencies close to Matlab
- harmonic ratios close to Matlab

## Acceptance targets
Initial targets, refine after first sample dataset.
- lag median absolute error within a few microseconds
- frequency error well below 1 Hz or within interpolation tolerance
- harmonic ratio relative error within a few percent

---

## 9. Known risks

### Risk: sample indexing mismatch
Matlab 1-based indexing and convolution slicing may shift results if translated loosely.

### Risk: FFT convention mismatch
`ifftshift` placement and frequency-axis construction must be replicated carefully.

### Risk: audio loader normalization
Different WAV loaders may scale integer PCM differently. Normalize explicitly and record loader behavior.

### Risk: digitizer handling ambiguity
Current code has a catch path that silently sets `decimate=1`. Python should log this clearly.

---

## 10. Deliverables for this stage

### Required code
- measurement config schema
- workbook loaders
- WAV loader
- exact Nuttall helper
- snippet detector
- FFT lag analyzer
- measurement pipeline orchestrator

### Required docs
- this spec
- data contracts doc
- one worked example once sample data is available

### Required outputs
- deterministic measurement artifact
- diagnostic logs with counts of valid/rejected snippets

---

## 11. Future cloud boundary

After parity is stable, this stage can be wrapped as:
- local CLI
- Lambda for small files
- batch job for large files

The core `measure_sine(...)` function must stay pure and storage-agnostic.

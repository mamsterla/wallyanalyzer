# Matlab Data Contracts

## Purpose
This document turns the current Matlab scripts into explicit data contracts for Python implementation.

It covers:
- workbook inputs
- audio inputs
- `.mat` measurement outputs
- compile-stage derived structures
- units and assumptions

---

## 1. Input workbook contract

Current Matlab code reads a workbook named:
- `Research Recording Tracking Sheet.xlsx`

It uses multiple sheets by numeric index.

### Sheet 1 — acquisition metadata
Used by both `MeasureSine14.m` and `CompileSine24.m`.

#### Fields referenced by `MeasureSine14.m`
- `File`
- `Digit...` or `Digitizer`-like header matched by `regexp(AcqText(1,:),'Digit')`
- `Test Track`

#### Fields referenced by `CompileSine24.m`
Column positions are effectively hardcoded after an override block. Intended semantic fields:
- `File`
- `Date`
- `System`
- `Cartridge`
- `Wally Zenith` / cantilever zenith
- `Stylus Zenith`
- `Effective Length`
- `Offset Angle`
- `Overhang`
- `Required Overhang`
- `Overhang Adjustment`
- `Effective Length Adjustment` or spindle/pivot delta
- `Actual Pivot to Spindle`
- `Test Track`
- `Digitizer`
- `Comments`

### Proposed Python schema: `AcquisitionRecord`

```python
from dataclasses import dataclass
from typing import Optional
from datetime import date

@dataclass
class AcquisitionRecord:
    file_stem: str
    file_name: Optional[str]
    date: Optional[str]
    system_id: Optional[float]
    cartridge_name: Optional[str]
    cantilever_yaw_deg: Optional[float]      # Wally Zenith / mount yaw
    stylus_yaw_deg: Optional[float]          # source sheet sign convention preserved
    effective_length_mm: Optional[float]
    offset_angle_deg: Optional[float]
    overhang_mm: Optional[float]
    required_overhang_mm: Optional[float]
    overhang_adjustment_mm: Optional[float]
    pivot_spindle_adjustment_mm: Optional[float]
    actual_pivot_to_spindle_mm: Optional[float]
    test_track_name: Optional[str]
    digitizer: Optional[str]
    comments: Optional[str]
```

### Normalization rules
- `file_stem` should be the filename without extension.
- blank numeric fields -> `None`
- blank text fields -> `None`
- preserve original raw row for traceability if possible
- sign conventions should be normalized later, not during raw load

---

## 2. Workbook sheet 2 — test track metadata

Used by `MeasureSine14.m`.

### Fields referenced
- `Name`
- `Outer radius`
- `Inner radius`

### Proposed Python schema: `TestTrackRecord`

```python
@dataclass
class TestTrackRecord:
    name: str
    outer_radius_mm: float
    inner_radius_mm: float
```

### Semantics
- `outer_radius_mm` maps to Matlab `rbeg`
- `inner_radius_mm` maps to Matlab `rend`
- if `rend > rbeg`, code interprets playback as CCW

---

## 3. Workbook sheet 3 — system metadata

Used by `CompileSine24.m`.

### Fields referenced by position
- system identifier
- tonearm
- headshell
- shim
- isolation
- system notes

The Matlab code uses positional access, not reliable header names.

### Proposed Python schema: `SystemRecord`

```python
@dataclass
class SystemRecord:
    system_id: float
    turntable: Optional[str]
    tonearm: Optional[str]
    headshell: Optional[str]
    shim: Optional[str]
    isolation: Optional[str]
    notes: Optional[str]
```

### Migration note
Need one calibration pass against the real workbook to confirm actual header names and column mapping.

---

## 4. Workbook sheet 4 — cartridge metadata

Used by `CompileSine24.m`.

### Fields referenced
- cartridge name
- `LR`
- `ZE`
- `WZcart`
- `SRA`
- `VTA`

Only `LR` is clearly consumed in current code.

### Proposed Python schema: `CartridgeRecord`

```python
@dataclass
class CartridgeRecord:
    cartridge_name: str
    lr_um: Optional[float]
    ze_deg: Optional[float]
    wally_zenith_deg: Optional[float]
    sra_deg: Optional[float]
    vta_deg: Optional[float]
```

---

## 5. Audio input contract

Current code reads WAV files.

### Required properties
- stereo, 2 channels
- sample rate currently expected near 192000 Hz
- long-form recording containing repeated 1 kHz burst regions
- file path associated with a workbook acquisition record

### Digitizer-dependent logic
Current Matlab behavior:
- if digitizer contains `tascam` -> decimate by 2
- if digitizer contains `cosmos` -> no decimation
- otherwise fall back to `decimate=1` in catch path

### Proposed Python schema: `AudioSource`

```python
@dataclass
class AudioSource:
    path: str
    sample_rate_hz: int
    num_channels: int
    total_samples: int
    digitizer: Optional[str]
```

### Validation rules
- must be exactly 2 channels
- reject unsupported bit depth only if loader cannot decode it
- preserve original sample rate in metadata
- record applied decimation factor in measurement output

---

## 6. Measurement-stage parameter contract

These constants are hardcoded in `MeasureSine14.m` and should become explicit config.

### Current defaults
- `skip = 10` degrees between segment centers
- `Mperiod = 64` sine periods per segment
- `navg = 16` used later in compile stage, not measurement output config
- `SPR = 1.8` seconds per rotation
- `V0 = 0.06` m/s cut velocity
- `Omega = 100/3 * 2*pi/60` rad/s rotational angular velocity
- `hw = 5` half-width of spectral peak window
- `nfilt = 500/decimate + 1` smoothing filter size for high-pass subtraction

### Proposed Python schema: `MeasureSineConfig`

```python
@dataclass
class MeasureSineConfig:
    skip_deg: float = 10.0
    periods_per_segment: int = 64
    spectral_half_width_bins: int = 5
    rotation_period_s: float = 1.8
    cut_velocity_m_per_s: float = 0.06
    angular_velocity_rad_per_s: float = 100/3 * 2*np.pi/60
    highpass_filter_length_rule: str = "500/decimate + 1"
```

---

## 7. Measurement `.mat` output contract

Current Matlab saves one `.mat` file per WAV input.

### Saved fields observed
- `lag`
- `F`
- `H`
- `dt`
- `hw`
- `Mperiod`
- `mfile`
- `file`
- `pathstr`
- `pitch`
- `is`
- `is1`
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

### Field semantics

#### `lag`
- shape: `(ns,)`
- unit: seconds
- meaning: estimated channel lag per processed segment
- invalid segments are `NaN`

#### `F`
- shape: `(ns, 2)`
- unit: Hz
- meaning: estimated fundamental frequency per channel per segment

#### `H`
- shape: `(ns, 3)`
- unit: amplitude-like FFT magnitude
- meaning:
  - column 1: fundamental amplitude
  - column 2: second harmonic amplitude
  - column 3: third harmonic amplitude

#### `dt`
- unit: seconds/sample
- decimated sample interval

#### `hw`
- unitless
- spectral half-width in bins used around fundamental peak

#### `Mperiod`
- unitless count
- number of sine periods per snippet

#### `pitch`
- likely groove pitch estimate
- computed as `(rbeg - rend) * SPR / T`
- unit appears to be mm per rotation or related radial increment measure
- needs confirmation against domain notes

#### `T`
- unit: seconds
- duration of modulated region from `startEnv` to `endEnv`

#### `V0`
- unit: m/s
- cut velocity constant

#### `Omega`
- unit: rad/s
- platter angular velocity constant

#### `ns`
- count of segments considered

#### `noi`
- count of samples in segment of interest

#### `Nrev`
- samples per revolution

#### `FWHM`
- stored as string in current Matlab code
- full-width-half-max description of effective angular window
- Python should store numeric value instead

#### `PT`
- unit: seconds
- processing time reported by `tic/toc`

#### `rbeg`, `rend`
- unit: mm
- nominal outer and inner playback radii for test track

#### `skip`
- unit: degrees
- angular separation between snippet centers

#### `Nskip`
- samples between snippet centers

#### `ibeg`, `iend`
- envelope-detected beginning and ending index markers

#### `imid`
- array of center indices used for snippet extraction

### Proposed Python schema: `MeasurementResult`

```python
@dataclass
class MeasurementResult:
    source_file: str
    file_stem: str
    sample_rate_hz: float
    decimation_factor: int
    dt_s: float
    skip_deg: float
    periods_per_segment: int
    spectral_half_width_bins: int
    cut_velocity_m_per_s: float
    angular_velocity_rad_per_s: float
    outer_radius_mm: float
    inner_radius_mm: float
    pitch_estimate: Optional[float]
    segment_centers_sample: np.ndarray
    lag_s: np.ndarray                  # shape (n_segments,)
    fundamental_freq_hz: np.ndarray    # shape (n_segments, 2)
    harmonic_amplitude: np.ndarray     # shape (n_segments, 3)
    valid_mask: np.ndarray             # shape (n_segments,)
    envelope_start_sample: int
    envelope_end_sample: int
    samples_per_revolution: float
    samples_per_segment: int
    processing_time_s: Optional[float]
```

### Format recommendation
Do not keep `.mat` as the long-term contract.

Prefer one of:
- `.npz` for arrays + JSON metadata
- Parquet for tabular segment-level data + JSON sidecar
- HDF5 if large array grouping is needed

---

## 8. Compile-stage derived input contract

`CompileSine24.m` expects measurement outputs plus workbook metadata.

### Required measurement fields at compile time
- `lag`
- `F`
- `H`
- `pitch`
- `rbeg`
- `rend`
- `skip`
- `Mperiod`
- `file`

### Required metadata per measurement
- system id
- cartridge name
- cantilever yaw / Wally Zenith
- stylus yaw
- effective length
- offset angle
- overhang
- required overhang
- overhang adjustment
- pivot-to-spindle adjustment
- actual pivot-to-spindle
- cartridge `LR`
- system descriptive fields for reporting

### Derived structures inside compile stage
For each measurement file, Python should produce a normalized joined object.

```python
@dataclass
class CompileInputRecord:
    measurement: MeasurementResult
    acquisition: AcquisitionRecord
    cartridge: Optional[CartridgeRecord]
    system: Optional[SystemRecord]
```

---

## 9. Compile-stage internal arrays and semantics

These are not persisted cleanly in Matlab, but they are core parts of the algorithm.

### Reconstructed radial axis
- `dr = (rend - rbeg) / (len(lag) - 1)`
- `rs = rbeg:dr:rend`
- `Rs = rs[valid lag indices]`

Meaning:
- reconstruct nominal radius per snippet by linear interpolation between track start and end radii

### Smoothed arrays
Using `navg` rotations worth of moving average:
- `LAG`
- `RS`
- `HD`

These are denoised versions of lag, radius, and harmonics.

### Apparent tracking error arrays
- `ATEraw`
- `ATEmeas`
- `ATEfit`

### Distortion arrays
- `D2` measured 2nd harmonic ratio
- `D` theoretical distortion proxy from nominal geometry
- `Dfit` distortion proxy after fitted yaw/overhang parameters

---

## 10. Unit conventions

### Explicit units from code/comments
- radii: `mm`
- effective length / overhang / offsets: `mm`
- lag: `s`
- frequency: `Hz`
- angular values: `deg`
- velocity `V0`: `m/s`
- `Omega`: `rad/s`
- cartridge `LR`: appears to be `um`

### Important mixed-unit formula
Apparent tracking error from lag in `CompileSine24.m`:

```matlab
asind(1000*pi*R*lag/0.9/lr)
```

Interpretation:
- `R` in mm
- `lag` in s
- `lr` in um
- factor `1000` converts mm to m-scale compatibility with `lr`
- `0.9` is likely time scaling tied to 1 kHz burst geometry or playback speed assumptions

This formula must be validated against domain notes before freezing Python docs.

---

## 11. Known ambiguities to resolve

### Workbook mapping ambiguities
`CompileSine24.m` first searches by header names, then overrides with positional column indices. Real workbook inspection is needed.

### Sign conventions
- stylus zenith is negated in one place because measurement orientation is inverted
- playback direction flips modeled sign
- tracking error and yaw sign conventions need one canonical Python definition

### `pitch` meaning
Formula is clear; physical interpretation needs confirmation.

### `FWHM` type
Matlab stores as a string. Python should store numeric angle width and optional display string separately.

### `LR` semantics
Comments suggest lateral/ridge stylus width in micrometers. Need confirmation from cartridge sheet definitions.

---

## 12. Validation requirements for Python port

Before replacing Matlab outputs, Python must reproduce:
- same valid/invalid snippet mask
- lag estimates within tolerance
- channel frequencies within tolerance
- harmonic ratios within tolerance
- fitted effective stylus width and yaw within tolerance
- summary ATE and distortion metrics within tolerance

### Suggested tolerances
Initial draft only; refine after sample data is available.
- lag: within low microseconds or relative tolerance tied to SNR
- frequency: within a few FFT-bin interpolation error margins
- harmonic ratios: within a few percent relative
- fit parameters: within a few percent of Matlab result

---

## 13. Recommended storage contracts for Python

### Measurement output JSON sidecar
```json
{
  "source_file": "RTI2P30.wav",
  "file_stem": "RTI2P30",
  "sample_rate_hz": 192000,
  "decimation_factor": 1,
  "skip_deg": 10,
  "periods_per_segment": 64,
  "spectral_half_width_bins": 5,
  "outer_radius_mm": 146.0,
  "inner_radius_mm": 57.0
}
```

### Segment-level table columns
- `segment_index`
- `center_sample`
- `is_valid`
- `lag_s`
- `freq_left_hz`
- `freq_right_hz`
- `harm1`
- `harm2`
- `harm3`
- optional diagnostics fields

This makes later compile-stage jobs and cloud storage easier.

---

## 14. Next contract work

After one real workbook and one real measurement file are available, update this doc with:
- exact headers
- actual units from source workbook
- sign convention table
- example records

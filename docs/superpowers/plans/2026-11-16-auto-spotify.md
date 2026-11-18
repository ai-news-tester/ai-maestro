# AUTO Spotify (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop in a raw Suno WAV, diagnose it full-track, and export a Spotify-ready master at -14 LUFS / -1 dBTP, with live playback matching the download.

**Architecture:** analyzer.js measures full-track stereo loudness, true peak and artifacts; auto.js maps the report deterministically to clamped params; dsp.js builds one shared mastering chain used by live playback and exportWAV; app.js shows the report and AUTO progress.

**Tech Stack:** Vanilla JS, Web Audio, no dependencies, no build step.

**Spec:** docs/superpowers/specs/2026-11-16-auto-spotify-design.md
**Deshimmer spec:** docs/superpowers/specs/2026-11-16-deshimmer-auto-design.md
**Deshimmer plan:** docs/superpowers/plans/2026-11-16-deshimmer-auto.md

## Global Constraints
- Vanilla JS only, Web Audio only, no new dependencies, no build step, no ML.
- Target is Spotify only in v1: -14 LUFS integrated, -1 dBTP, 16-bit WAV, filename name.auto-master.wav.
- Live chain and exportWAV use identical mastering constants, order and formulas; any new stage goes into both or it does not ship.
- Manual mode unchanged; original file never edited; deshimmer default 0.
- Deterministic rules only; every AUTO value clamped to existing preset ranges; low confidence falls back to standardEvasion and deshimmer 0.
- UI and report copy: Deshimmer is artifact removal for sound quality only; it does not remove watermarks and does not affect AI detection.
- node --check on touched modules; node bug-repro.mjs must still pass (crest 0, bandwidthHeal 0.25, qualityGate 6 -> -2.9 dB, outputGain 6 dB -> 1.9953).
- Do not commit without the user go-ahead. Sonnet and Fable review code and send bug reports; fix them and send fixes back.

## Review Focus
- Long track exhausts OfflineAudioContext memory: MustaJaa-v2.wav is 46,546,938 bytes, so export must process it without crashing; test in Task 7.
- Clean track is over-cleaned or dulled by AUTO: clean input must get deshimmer near 0 and no harsh corrective EQ; test in Task 5.
- Silence or a track shorter than one 2048-sample frame returns NaN or crashes: it must return score 0, confidence 0, LUFS -Infinity handled as no value; test in Tasks 1 and 2.
- Live and export disagree on mastering: A/B must match the download; test in Task 4.
- Manual knob move after AUTO is silently overwritten: it must stay until the next AUTO run; test in Task 6.

---

### Task 1: K-weighted LUFS meter and 4x true peak, reference test first

**Files:**
- Modify: `docs/modules/analyzer.js`
- Test: `auto-repro.mjs` (new, repo root, same style as `bug-repro.mjs`)

**Interfaces:**
- Consumes: channel Float32Arrays, sample rate
- Produces: `SpectralAnalyzer.measureLoudness(left, right, sr) => { integratedLUFS: number, loudnessRange: number, truePeakDBTP: number }`, `SpectralAnalyzer.measureTruePeak(samples, sr) => number`

- [ ] **Step 1: Write the failing test in `auto-repro.mjs`**

```js
const sine = new Float32Array(44100); // 1 s, 1 kHz sine, amplitude 0.5, at 44100 Hz
for (let i = 0; i < sine.length; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 44100);
const m = SpectralAnalyzer.measureLoudness(sine, sine, 44100);
// assert Math.abs(m.integratedLUFS - (-9.0)) < 0.5
// assert Math.abs(m.truePeakDBTP - (-6.0)) < 0.5
const silence = new Float32Array(44100);
const s = SpectralAnalyzer.measureLoudness(silence, silence, 44100);
// assert s.integratedLUFS is -Infinity or null, and not NaN; s.truePeakDBTP is -Infinity, not NaN
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node auto-repro.mjs`
Expected: FAIL with `measureLoudness is not a function`

- [ ] **Step 3: Implement `measureLoudness` and `measureTruePeak` in `docs/modules/analyzer.js`**

K-weighting per BS.1770-5: shelving filter plus high-pass, applied per channel, then gated integrated loudness (absolute gate -70 LUFS, relative gate -10 LU below ungated). Loudness range is 10th to 95th percentile of 3 s short-term loudness. True peak is 4x oversampling by linear interpolation between samples, then peak in dBTP. No library. Return -Infinity, not NaN, on silence.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node auto-repro.mjs`
Expected: PASS - sine near -9.0 LUFS and -6.0 dBTP, silence handled
Run: `node --check docs/modules/analyzer.js`
Expected: no output (pass)

- [ ] **Step 5: Commit**

```bash
git add docs/modules/analyzer.js auto-repro.mjs
git commit -m "feat: add K-weighted LUFS and 4x true-peak meter"
```

### Task 2: Full-track stereo analysis in analyzer.js

**Files:**
- Modify: `docs/modules/analyzer.js`
- Test: `auto-repro.mjs`

**Interfaces:**
- Consumes: `AudioBuffer` channels, `measureLoudness`, `SpectralAnalyzer.measureShimmer` from the deshimmer plan
- Produces: `SpectralAnalyzer.analyzeFullTrack(buffer) => { integratedLUFS, loudnessRange, truePeakDBTP, peakDBFS, rmsDBFS, crestFactorDB, clippingCount, dcOffsetL, dcOffsetR, silenceRanges, fadeIn, fadeOut, stereoWidth, correlation, monoLowsDB, spectralTilt, harshPeaks, sibilance, hfCutoff, carriers, echoConfidence, shimmer, sampleRate, duration }`

- [ ] **Step 1: Write the failing test in `auto-repro.mjs`**

```js
// synthetic stereo buffer: left 440 Hz sine, right same sine at 0.5 gain, plus 5 clipped samples at 1.0 and 0.5 s silence at start
const r = SpectralAnalyzer.analyzeFullTrack(fakeBuffer);
// assert r.clippingCount === 5
// assert r.correlation > 0.9
// assert r.silenceRanges[0].start === 0
// assert r.shimmer.score is a number 0-1, not NaN
// assert r.duration and r.sampleRate match the buffer
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node auto-repro.mjs`
Expected: FAIL with `analyzeFullTrack is not a function`

- [ ] **Step 3: Implement `analyzeFullTrack(buffer)` in `docs/modules/analyzer.js`**

Sample up to 8 windows evenly across the full track, each 2048 samples, channels kept separate, never mono-mixed for stereo metrics. Keep existing carrier, echo, flatness, peak/RMS/crest logic and reuse it per window. Add clipping count (samples at or above 0.999), DC offset (mean per channel), silence ranges (below -60 dBFS for over 0.2 s, with start/end seconds), fade in/out seconds, stereo width (mean side/mid ratio), correlation (Pearson L/R), mono lows below 120 Hz, spectral tilt, harsh resonance peaks, sibilance (5-8 kHz energy vs band), HF cutoff frequency, shimmer via `measureShimmer`. Silence or under 2048 samples returns score 0, confidence 0, no NaN.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node auto-repro.mjs`
Expected: PASS - all Task 1 and Task 2 cases
Run: `node --check docs/modules/analyzer.js`
Expected: no output (pass)

- [ ] **Step 5: Commit**

```bash
git add docs/modules/analyzer.js auto-repro.mjs
git commit -m "feat: add full-track stereo analysis"
```

### Task 3: Deshimmer knob and live stage

**Files:**
- Modify: `docs/knob-registry.json`
- Modify: `docs/modules/dsp.js` (`init()`, `updateFromKnob()`)
- Test: `deshimmer-repro.mjs` from the deshimmer plan, or `auto-repro.mjs` if that file does not exist yet

**Interfaces:**
- Consumes: registry `compositeKnobs`, `NaSunoDSP.params`
- Produces: `params.deshimmer` (0-100, default 0), `this.deshimmerShelf` (BiquadFilter), `updateFromKnob('deshimmer', val)`

- [ ] **Step 1: Write the failing test**

Use the mock AudioContext from `bug-repro.mjs`. After `dsp.init(ctx)`, `dsp.updateFromKnob('deshimmer', 0)` asserts shelf gain 0 and effective neuralScrub equals base. `dsp.updateFromKnob('deshimmer', 100)` asserts shelf gain -6, effective neuralScrub `min(100, base + 20)`, effective spectralBlend `min(100, base + 15)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node deshimmer-repro.mjs` or `node auto-repro.mjs`
Expected: FAIL - `deshimmer` has no effect / shelf missing

- [ ] **Step 3: Add the knob to `docs/knob-registry.json`**

Exact entry: id `deshimmer`, label `DESHIMMER`, module `naturalization`, moduleTitle `NATURALIZATION`, ring `green`, min 0, max 100, step 1, default 0, unit `%`, liveDSP true. Preset values: off 0, lowProfile 10, standardEvasion 0, deepClean 35, fullScrub 55. Info description must contain `does not remove watermarks` and `does not affect AI detection`.

- [ ] **Step 4: Implement the live stage in `docs/modules/dsp.js`**

Create `this.deshimmerShelf` in `init()` as a `highshelf` BiquadFilter at 10000 Hz, Q 0.7, gain 0, inserted after the neural filter and before the blend filters. In `updateFromKnob('deshimmer', val)`, set shelf gain to `-0.06 * val`, and set effective neuralScrub to `min(100, base + 0.20 * val)` and effective spectralBlend to `min(100, base + 0.15 * val)`, where base is the current knob value for that stage.

- [ ] **Step 5: Run tests to verify it passes**

Run: `node deshimmer-repro.mjs` or `node auto-repro.mjs`
Expected: PASS
Run: `node --check docs/modules/dsp.js`
Expected: no output (pass)

- [ ] **Step 6: Commit**

```bash
git add docs/knob-registry.json docs/modules/dsp.js deshimmer-repro.mjs auto-repro.mjs
git commit -m "feat: add deshimmer knob and live stage"
```

### Task 4: One shared mastering chain in dsp.js

**Files:**
- Modify: `docs/modules/dsp.js` (`init()`, `updateFromKnob()`, `exportWAV()`)
- Test: `auto-repro.mjs`

**Interfaces:**
- Consumes: `params` object with all 14 composite knobs plus `deshimmer`, `deesser`, `airShelf`, `msBass`
- Produces: `NaSunoDSP.buildMasterChain(ctx, params) => { input, output }`, used by both `init()` and `exportWAV()`

- [ ] **Step 1: Write the failing test in `auto-repro.mjs`**

Read `docs/modules/dsp.js` as text and assert `buildMasterChain` is defined once, and both `init()` and `exportWAV()` call it. Assert the chain text contains, in order: deshimmer shelf 10000 Hz, de-esser peaking 6500 Hz, air highshelf 16000 Hz, glue compressor, loudness gain to -14 LUFS, limiter -1 dBTP. Assert no second hand-copied chain remains in `exportWAV()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node auto-repro.mjs`
Expected: FAIL - `buildMasterChain` not found

- [ ] **Step 3: Implement `buildMasterChain(ctx, params)` in `docs/modules/dsp.js`**

Order: existing 14-node cleanup, Deshimmer shelf from Task 3, de-esser (peaking 6500 Hz, gain -6 dB when sibilance is high, else 0), air restoration (highshelf 16000 Hz, +2 dB when HF cutoff is at or below 16000 Hz, else 0), spectral dehaze 8-16 kHz via the existing spectralBlend stage, M/S bass anchoring as detection plus fixed mono-lows gain below 120 Hz when correlation is below 0.3 (full splitter/merger rebuild is out of scope for v1), dynamic EQ for harsh peaks via existing blend filters, glue compression from crest, loudness normalise gain computed from Task 1 integrated LUFS to reach -14 LUFS, true-peak limiter at -1 dBTP, dither on export only. Both live and export call this one builder with the same params and constants.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node auto-repro.mjs`
Expected: PASS
Run: `node --check docs/modules/dsp.js`
Expected: no output (pass)
Run: `node bug-repro.mjs`
Expected: PASS - crest 0, bandwidthHeal 0.25, qualityGate 6 -> -2.9 dB, outputGain 6 dB -> 1.9953

- [ ] **Step 5: Commit**

```bash
git add docs/modules/dsp.js auto-repro.mjs
git commit -m "feat: add one shared mastering chain for live and export"
```

### Task 5: AUTO mapper in auto.js

**Files:**
- Create: `docs/modules/auto.js`
- Test: `auto-repro.mjs`

**Interfaces:**
- Consumes: `SpectralAnalyzer.analyzeFullTrack()` result from Task 2
- Produces: `export function mapAutoReport(report) => { params, reasons, presetKey }`, `export function deshimmerStrengthFromShimmer(shimmer) => number`

- [ ] **Step 1: Write the failing test in `auto-repro.mjs`**

```js
deshimmerStrengthFromShimmer({ score: 0.8, confidence: 0.9 }) === 80
deshimmerStrengthFromShimmer({ score: 0.8, confidence: 0.3 }) === 0
deshimmerStrengthFromShimmer({ score: 0.1, confidence: 0.9 }) === 0
// mapAutoReport on a clean report: integrated -14 LUFS, true peak -1 dBTP, no carriers, low shimmer
// assert params.deshimmer === 0 and params.carrierErase <= 50
// mapAutoReport on a loud clipped report: integrated -8 LUFS, clippingCount > 100
// assert params.outputGain < 0 and limiter is engaged
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node auto-repro.mjs`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `docs/modules/auto.js`**

Deterministic rules only, no ML. Carrier prominence over 3 dB raises carrierErase, echo confidence raises stegoStrip, flatness and harsh peaks raise spectralBlend, low crest raises dynamicsNatural, low loudness raises outputGain, high shimmer raises deshimmer via `deshimmerStrengthFromShimmer`, high sibilance enables de-esser, low width or correlation below 0.3 enables M/S bass anchoring, HF cutoff at 16000 Hz enables air shelf. Clamp every value to preset ranges. If confidence is below 0.5 or the track is clean, return deshimmer 0 and presetKey `standardEvasion` with reason `Shimmer low or uncertain - deshimmer off`. Each applied value carries a one-line reason naming the measurement that caused it.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node auto-repro.mjs`
Expected: PASS - all five cases above
Run: `node --check docs/modules/auto.js`
Expected: no output (pass)

- [ ] **Step 5: Commit**

```bash
git add docs/modules/auto.js auto-repro.mjs
git commit -m "feat: add AUTO mapper"
```

### Task 6: UI and report wiring in app.js

**Files:**
- Modify: `docs/app.js`
- Test: `auto-repro.mjs`

**Interfaces:**
- Consumes: `mapAutoReport()` from Task 5, `dsp.updateFromKnob()`, `registryDom.knobsMap`
- Produces: `applyAutoReport(report)` in `app.js` (internal, not exported)

- [ ] **Step 1: Write the failing test in `auto-repro.mjs`**

Assert the registry JSON parses and contains `deshimmer`, and its info description contains both `does not remove watermarks` and `does not affect AI detection`. Assert manual override: after AUTO sets deshimmer 80, calling the knob `setValue(20)` keeps 20 until AUTO is run again.

- [ ] **Step 2: Run test to verify it fails**

Run: `node auto-repro.mjs`
Expected: FAIL - AUTO wiring or disclaimer text missing

- [ ] **Step 3: Implement AUTO UI in `docs/app.js`**

One AUTO button with progress text Detect, Clean, Master, Export. On run, call `SpectralAnalyzer.analyzeFullTrack(currentBuffer)`, then `mapAutoReport(report)`, then apply every param via `dsp.updateFromKnob()` and the matching knob `setValue()`, and set `#forensicStatus` to the report summary. Report panel shows what was detected, where (time ranges from Task 2), what was applied, and before/after loudness and peak. Buttons: Play original, Play AUTO, Download, Revert to manual preset. No new knobs in AUTO view; applied values shown read-only. A manual knob move after AUTO must show `Custom` and must not be overwritten until AUTO runs again. Reuse the existing `#forensicStatus` element; do not add a new panel in this task.

Spectrum overlay, bars and sliders (extends docs/modules/spectrum.js SpectrumRenderer, does not replace it): after full-track analysis, draw persistent markers/bands on the spectrum even when not playing, at rumble/DC below 30 Hz, mud excess 200-500 Hz, harsh resonances and sibilance peaks, de-esser band around 6.5 kHz, shimmer/dehaze 8-16 kHz, Suno HF cutoff near 16 kHz, carriers 15.5/17.5/19.5 kHz, coloured by severity and labelled with measured dB over target. Under the spectrum, one row per detected issue with name, where it is (frequency band and time window), measured value vs target, and a horizontal severity bar; include non-EQ issues too: integrated LUFS vs -14, true peak vs -1 dBTP, clipping count, loudness range, stereo width/correlation. One slider per issue, reusing existing FLKnob/slider conventions and ranges: value is correction strength/amount, default is the AUTO-computed value from mapAutoReport, moving a slider switches only that issue to manual and re-renders live so A/B updates, 0 means no correction. AUTO applies all sliders automatically to the recommended values, then Clean/Master/Export runs the shared buildMasterChain — user never has to touch a slider to get a finished file. Repro/check in auto-repro.mjs: an analysis report with a known issue (e.g. carrier prominence, LUFS off target) produces a marker, a bar and a non-zero default slider for that issue, and AUTO sets it.

- [ ] **Step 4: Run tests to verify it passes**

Run: `node auto-repro.mjs`
Expected: PASS
Run: `node --check docs/app.js`
Expected: no output (pass)

- [ ] **Step 5: Commit**

```bash
git add docs/app.js auto-repro.mjs
git commit -m "feat: wire AUTO UI and report"
```

### Task 7: Final verification on MustaJaa-v2.wav and demo_original.wav

**Files:**
- None (checks only, plus a short results note in the plan handoff)

- [ ] **Step 1: Run all automated checks**

Run: `node --check docs/modules/analyzer.js docs/modules/dsp.js docs/modules/auto.js docs/app.js`
Run: `node bug-repro.mjs`
Expected: crest 0, bandwidthHeal 0.25, qualityGate 6 -> -2.9 dB, outputGain 6 dB -> 1.9953
Run: `node auto-repro.mjs`
Expected: PASS - all Task 1-6 cases
Run: `node deshimmer-repro.mjs` if it exists
Expected: PASS

- [ ] **Step 2: Real Suno track check on `docs/audio/MustaJaa-v2.wav`**

Load the file in the browser, run full-track analysis, record before measurements: integrated LUFS, true peak dBTP, carrier prominence per carrier, shimmer score, clipping count, stereo width and correlation. Run AUTO, export `MustaJaa-v2.auto-master.wav`, record after measurements: integrated LUFS near -14, true peak at or below -1 dBTP, carrier prominence down, no new clipping. A/B listen live vs export; they must sound the same. If the file fails to load or export runs out of memory, record that as a failure, do not claim it passed.

- [ ] **Step 3: Demo check on `docs/audio/demo_original.wav`**

Same AUTO run and A/B listen as Step 2. Record before/after loudness, true peak, carriers, shimmer, clipping and stereo.

- [ ] **Step 4: Report, do not commit**

No new code in this task. Report what passed, what was skipped, and any risk. Do not commit in this task; the strip plus bugfix pass is still uncommitted and a commit needs the user go-ahead.

<p align="center">
  <a href="https://ai-news-tester.github.io/aim/">
    <img src="docs/assets/humanized_knob_banner_large.png" alt="HUMANIZER - Dial from AI to Human" width="100%"/>
  </a>
</p>

<h1 align="center">HUMANIZER</h1>

<p align="center">
  <strong>Browser-based audio DSP rack for AI-generated music: forensic analysis, cleanup, and Spotify-ready AUTO mastering.</strong><br>
  <em>Drop in a raw Suno WAV, see what is wrong and where, and export a -14 LUFS / -1 dBTP master that sounds like what you heard live.</em>
</p>

<p align="center">
  <a href="https://ai-news-tester.github.io/aim/"><img src="https://img.shields.io/badge/Live%20Studio-Web%20DSP%20Rack-00F2FE?logo=googlechrome&logoColor=white" alt="Live Studio"></a>
  <a href="https://github.com/ai-news-tester/aim/actions/workflows/ci.yml"><img src="https://github.com/ai-news-tester/aim/actions/workflows/ci.yml/badge.svg" alt="CI Status"></a>
  <a href="https://ai-news-tester.github.io/aim/"><img src="https://github.com/ai-news-tester/aim/actions/workflows/pages.yml/badge.svg" alt="Pages Deployment"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Dependencies-zero-brightgreen" alt="Zero dependencies">
</p>

---

## What it is

HUMANIZER (v2.5) is a single-page Web Audio application. Everything runs client-side in your browser: no uploads, no server processing, no accounts, no build step, no dependencies — plain JavaScript ES modules and the Web Audio API.

It does three things:

1. **Forensic analysis** — measures a track's loudness (BS.1770-5 K-weighted LUFS + loudness range), 4x-oversampled true peak, clipping, DC offset, silence and fades, stereo width and correlation, spectral tilt, sibilance, HF cutoff, Suno-style ultrasonic carrier prominence (15.5 / 17.5 / 19.5 kHz bands), cepstral echo confidence, and an HF shimmer score.
2. **Manual DSP rack** — 15 knobs in four groups (Watermark Erase, Fingerprint Scatter, Naturalization, Mastering & Quality) with five presets, live A/B bypass, a dual-trace 2048-point FFT spectrum, and 16-bit PCM WAV export.
3. **AUTO Spotify mastering** — one button: analyze the full track, map the findings to clamped cleanup/mastering values with a written reason for every choice, calibrate loudness from a real render, and export `name.auto-master.wav` at -14 LUFS integrated / -1 dBTP. Live playback and the download run the identical shared chain.

**Honest scope:** the cleanup stages target measurable artifacts (carrier tones, comb peaks, HF shimmer, squashed dynamics). Deshimmer is sound-quality cleanup only — it does not remove watermarks and does not affect AI detection. No claim is made that any processing defeats provenance systems such as SynthID or C2PA.

---

## AUTO mastering

Click **AUTO MASTER** with a track loaded:

- **Detect** — full-track analysis (not a 12-second window): every metric above, with silence handling (no NaN on silent or sub-frame input).
- **Clean** — deterministic rules map measurements to knob values, each clamped to the preset ranges: carrier prominence over 3 dB raises Carrier Erase, echo confidence raises Stego Strip, shimmer raises Deshimmer (gated by confidence — clean tracks stay at 0), high sibilance enables a 6.5 kHz de-esser, low HF cutoff enables an air shelf, low correlation enables M/S bass anchoring, low crest raises glue compression. Every choice comes with a reason string shown in the report.
- **Master** — the app renders the full track once through the shared chain, measures the render with the same BS.1770 meter, and stores a reduction-only trim so the result lands on target. The trim is a gain node inside the chain, after a hard -1 dB ceiling, so live playback matches the export sample-for-sample (verified within one 16-bit LSB).
- **Export** — 16-bit PCM WAV named `name.auto-master.wav`. Targets: Streaming -14 (default), Loud -12, Club -10 LUFS.

The report panel lists each detected issue with its frequency band, time range, measured value vs target, a severity bar, and a slider pre-set to the AUTO value. Moving a slider switches that issue to manual and it stays until the next AUTO run. **Play Original / Play AUTO** A/B, **Revert to Manual** restores your previous preset.

### Verified results

Full-track renders through the real UI (headless Chromium, fresh profile):

| Track | Before | After AUTO export |
|---|---|---|
| 242 s Suno track (46 MB WAV) | -16.21 LUFS / -3.86 dBTP / 0 clipped samples | **-14.0 LUFS / -6.47 dBTP / 0 clipped samples**; top carrier 2.95 → 0.02 dB |
| 8 s demo | -12.59 LUFS / -0.03 dBTP / 0 clipped samples | **-14.0 LUFS / -5.25 dBTP / 0 clipped samples** |

Live-vs-export maximum sample difference: 0.000031 (one 16-bit LSB). The 242-second track exports without memory issues.

---

## The 15 knobs

| Group | Knob | Range | Default | What it does |
|---|---|---|---|---|
| Watermark Erase | Carrier Erase | 0–100 | 50 | Notches at 15.5 / 17.5 / 19.5 kHz; Q widens with strength |
| Watermark Erase | Stride Remove | 0–100 | 35 | Peaking cuts at 172.3 / 344.6 Hz frame harmonics |
| Watermark Erase | Stego Strip | 0–100 | 45 | 3.8 kHz comb cut for cepstral echo artifacts |
| Watermark Erase | Neural Scrub | 0–100 | 45 | High-shelf HF residual attenuation (19 → 11 kHz) |
| Fingerprint Scatter | Spectral Blend | 0–100 | 40 | Resonant peak smoothing at 4.2 / 7.6 kHz |
| Fingerprint Scatter | Phase Scatter | 0–100 | 40 | 3-stage all-pass phase dispersion |
| Fingerprint Scatter | Stat Normalize | 0–100 | 40 | Soft-knee waveshaper for statistical outliers |
| Fingerprint Scatter | Hash Break | 0–100 | 30 | LFO-modulated micro-delay (anti audio-fingerprint) |
| Naturalization | Room Inject | 0–100 | 35 | Multi-tap early reflections |
| Naturalization | Texture Inject | 0–100 | 35 | Harmonic tape/tube-style saturation |
| Naturalization | Deshimmer | 0–100 | 0 | 10 kHz shelf + HF cleanup boosts (sound quality only) |
| Naturalization | Bandwidth Heal | -6–+6 dB | 0.25 | 12 kHz air shelf |
| Mastering | Dynamics | 0–100 | 40 | Crest-aware glue compression |
| Mastering | Quality Gate | 1–6 | 3 | Safety limiter threshold |
| Mastering | Output | -12–+6 dB | 0 | Output gain staging |

Presets: **Off** (bit-transparent bypass), **Low Profile**, **Standard Evasion**, **Deep Clean**, **Full Scrub**. Shift-drag any knob for fine steps. Settings and uploaded audio persist in the browser (LocalStorage + IndexedDB) across refreshes.

---

## Run it

No install, no build:

```bash
cd docs
python -m http.server 8123
# open http://127.0.0.1:8123/
```

Or use the hosted studio: **https://ai-news-tester.github.io/aim/**

Upload a WAV (or use the built-in demo), turn knobs or press AUTO MASTER, then EXPORT CLEANED WAV.

### Tests

Node 20+, from the repo root — no framework, plain assert scripts:

```bash
node bug-repro.mjs        # knob math, fine steps, limiter thresholds, gain staging
node auto-repro.mjs       # meter reference tests, full-track analysis, chain order,
                          # AUTO mapper, UI wiring, loudness correction + parity cases
node deshimmer-repro.mjs  # deshimmer knob + stage behavior
node track-report.mjs docs/audio/your-track.wav   # measure any WAV: LUFS, dBTP, clips, carriers, shimmer
```

---

## Architecture

One shared mastering chain, two consumers — the rule that keeps live and export identical:

```text
docs/app.js                 orchestration: upload, playback, AUTO flow, report, export
docs/modules/
  analyzer.js               AudioMath (STFT), SunoDetector, StegoDetector,
                            SpectralAnalyzer: BS.1770-5 LUFS/LRA, 4x polyphase true peak,
                            analyzeFullTrack, measureShimmer
  auto.js                   mapAutoReport: deterministic report -> clamped params + reasons
  dsp.js                    NaSunoDSP: buildMasterChain (the one shared chain),
                            live connect/bypass, renderChain, exportWAV (16-bit PCM)
  spectrum.js               SpectrumRenderer + buildAutoIssues (overlay bands, issue rows)
  knob.js / registry.js     FLKnob widget + knob-registry.json driven DOM
  ui.js / storage.js        UI controller, LocalStorage/IndexedDB persistence
```

- `buildMasterChain` is called by live playback, offline export, and AUTO calibration — same nodes, same order, same constants, same LFO. Any new stage goes into both paths or it does not ship.
- AUTO-only parameters (de-esser, air shelf, M/S bass, calibrated trim) travel in the params object, not as new knobs.
- The loudness meter is verified against a known-value reference sine before anything downstream trusts it; true peak uses 4x polyphase FIR interpolation, not a sample-peak proxy.

Design documents: [AUTO Spotify spec](docs/superpowers/specs/2026-11-16-auto-spotify-design.md), [Deshimmer spec](docs/superpowers/specs/2026-11-16-deshimmer-auto-design.md), [implementation plan](docs/superpowers/plans/2026-11-16-auto-spotify.md).

---

## Repository structure

```text
aim/
├── .github/                 CI (registry/syntax checks), Pages deploy, issue templates
├── docs/                    the entire application (GitHub Pages root)
│   ├── index.html           single-page studio
│   ├── app.js               orchestration
│   ├── modules/             analyzer / auto / dsp / spectrum / knob / registry / ui / storage
│   ├── knob-registry.json   knob definitions, ranges, presets
│   ├── style.css            dark skeuomorphic rack stylesheet
│   ├── assets/              banners and UI imagery
│   ├── audio/               demo stems (large test WAVs are not committed)
│   └── superpowers/         specs and implementation plan
├── bug-repro.mjs            regression suite: knob math and gain staging
├── auto-repro.mjs           regression suite: meter, analysis, chain, AUTO, parity
├── deshimmer-repro.mjs      regression suite: deshimmer
├── track-report.mjs         WAV measurement tool
├── CHANGELOG.md
├── LICENSE                  MIT
└── README.md
```

---

## Known limits

- Export is 16-bit PCM WAV only — no FLAC/MP3/OGG.
- Manual `?v=` cache-bust on module imports must be bumped when modules change.
- Changing the AUTO target re-runs the full calibration render (~30 s for a 4-minute track).
- Loudness correction is reduction-only, so masters can sit well below the -1 dBTP ceiling; the Spotify gate is met either way.
- Shimmer scoring is heuristic; the confidence gate keeps uncertain or clean tracks from being dulled.

## Community

- **Issues:** [github.com/ai-news-tester/aim/issues](https://github.com/ai-news-tester/aim/issues)
- **Security:** see [SECURITY.md](.github/SECURITY.md)
- **Contributing:** see [CONTRIBUTING.md](.github/CONTRIBUTING.md) and the [Code of Conduct](.github/CODE_OF_CONDUCT.md)

Licensed under the [MIT License](LICENSE). Based on the NaSuno project; this repository is the maintained HUMANIZER studio fork.
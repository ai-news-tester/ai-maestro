<p align='center'>
  <a href='https://ai-news-tester.github.io/ai-maestro/'>
    <img src='docs/assets/mark.svg' alt='AI-Maestro mark' width='96'/>
  </a>
</p>

<h1 align='center'>AI-Maestro</h1>

<p align='center'>
  <strong>Browser-based audio DSP studio for AI-generated music: analysis, cleanup, and AUTO mastering.</strong><br/>
  <em>Drop in a track, see what is wrong and where, and export a -14 LUFS / -1 dBTP master that sounds like what you heard live.</em>
</p>

<p align='center'>
  <a href='https://github.com/ai-news-tester/ai-maestro/actions/workflows/ci.yml'><img src='https://github.com/ai-news-tester/ai-maestro/actions/workflows/ci.yml/badge.svg' alt='CI Status'/></a>
  <a href='https://github.com/ai-news-tester/ai-maestro/actions/workflows/pages.yml'><img src='https://github.com/ai-news-tester/ai-maestro/actions/workflows/pages.yml/badge.svg' alt='Pages Deployment'/></a>
  <a href='LICENSE'><img src='https://img.shields.io/badge/License-MIT-blue.svg' alt='MIT License'/></a>
</p>

---

## What it is

AI-Maestro is a single-page Web Audio application. Everything runs client-side in your browser: no uploads, no server processing, no accounts, no build step, no dependencies - plain JavaScript ES modules and the Web Audio API.

It does three things:

1. **Analysis** - measures a track across the full length, with silence handling, and reports each finding with its band, time range, and measured value against target.
2. **Manual DSP rack** - 15 knobs in four groups with five presets, live A/B bypass, a live spectrum display, and 16-bit PCM WAV export.
3. **AUTO mastering** - one button: analyze the full track, map the findings to clamped cleanup and mastering values with a written reason for every choice, calibrate loudness from a real render, and export at -14 LUFS integrated / -1 dBTP. Live playback and the download run the identical shared chain.

**Honest scope:** the cleanup stages target measurable artifacts (carrier tones, comb peaks, HF shimmer, squashed dynamics). Deshimmer is sound-quality cleanup only - it does not remove watermarks and does not affect AI detection. No claim is made that any processing defeats provenance systems such as SynthID or C2PA.

### What it measures

- BS.1770-5 K-weighted integrated loudness (LUFS) and loudness range (LRA)
- 4x-oversampled true peak (dBTP), sample peak, RMS, and crest factor
- Clipping count and DC offset
- Silence ranges, fade-in, and fade-out
- Stereo width, correlation, and mono low-band energy
- Spectral tilt, sibilance, and HF cutoff
- Ultrasonic carrier prominence in the 15.5 / 17.5 / 19.5 kHz bands
- Cepstral echo confidence
- HF shimmer score, with a confidence value
- Spectral flatness

---

## AUTO mastering

Click **AUTO MASTER** with a track loaded:

- **Detect** - full-track analysis (not a short window): every metric above, with silence handling.
- **Clean** - deterministic rules map measurements to knob values, each clamped to the preset ranges: carrier prominence over 3 dB raises Carrier Erase, echo confidence raises Stego Strip, shimmer raises Deshimmer (gated by confidence - clean tracks stay at 0), high sibilance enables a 6.5 kHz de-esser, low HF cutoff enables an air shelf, low correlation enables M/S bass anchoring, low crest raises glue compression. Every choice comes with a reason string shown in the report.
- **Master** - the app renders the full track once through the shared chain, measures the render with the same BS.1770 meter, and stores a reduction-only trim so the result lands on target. The trim is a gain node inside the chain, after a hard -1 dB ceiling, so live playback matches the export.
- **Export** - 16-bit PCM WAV named `<track>.auto-master.wav`. Targets: -14 (default), -12, -10 LUFS.

The report panel lists each detected issue with its frequency band, time range, measured value vs target, a severity bar, and a slider pre-set to the AUTO value. Moving a slider switches that issue to manual and it stays until the next AUTO run. **Play Original / Play AUTO** A/B, **Revert to Manual** restores your previous preset.

---

## The 15 knobs

| Group | Knob | Range | Default | What it does |
|---|---|---|---|---|
| RESONANCE CLEANUP | Carrier Erase | 0-100 | 50 | Notches at 15.5 / 17.5 / 19.5 kHz; width grows with strength |
| RESONANCE CLEANUP | Stride Remove | 0-100 | 35 | Peaking cuts at 172.3 / 344.6 Hz |
| RESONANCE CLEANUP | Stego Strip | 0-100 | 45 | Single peaking cut at 3.8 kHz |
| RESONANCE CLEANUP | Neural Scrub | 0-100 | 45 | High-shelf cut; corner slides from 19 kHz down to 11 kHz |
| PHASE & TEXTURE | Spectral Blend | 0-100 | 40 | Peaking cuts at 4.2 / 7.6 kHz for harsh resonances |
| PHASE & TEXTURE | Phase Scatter | 0-100 | 40 | 3-stage all-pass phase dispersion; magnitude untouched |
| PHASE & TEXTURE | Stat Normalize | 0-100 | 40 | Soft-knee waveshaper, normalized to unity peak |
| PHASE & TEXTURE | Hash Break | 0-100 | 30 | LFO-modulated micro-delay (3 ms delay, slow sine) |
| NATURALIZATION | Room Inject | 0-100 | 35 | Early reflections from 16 ms and 31 ms delay taps |
| NATURALIZATION | Texture Inject | 0-100 | 35 | Asymmetric tanh saturation for harmonic texture |
| NATURALIZATION | Deshimmer | 0-100 | 0 | 10 kHz shelf plus extra scrub and blend strength; sound quality only |
| NATURALIZATION | Bandwidth Heal | -6 to +6 dB | 0.25 | 12 kHz air shelf |
| MASTERING | Dynamics | 0-100 | 40 | Crest-aware glue compression |
| MASTERING | Quality Gate | 1-6 | 3 | Limiter ceiling; higher level lowers the ceiling |
| MASTERING | Output | -12 to +6 dB | 0 | Output gain staging |

Presets: **Off** (bypass), **Gentle**, **Standard**, **Deep**, **Full**. Shift-drag any knob for fine steps. Settings and uploaded audio persist in the browser (LocalStorage + IndexedDB) across refreshes.

---

## Run it

No install, no build. Run this from the repository root — `--directory` serves the
app folder directly, so it works without changing directories:

```bash
python -m http.server 8123 --directory docs
# open http://127.0.0.1:8123/
```

If the page shows a "Directory listing for /" instead of the studio, the server is
serving the repo root rather than `docs/` — add `--directory docs` as above.

Or use the hosted studio: **https://ai-news-tester.github.io/ai-maestro/**

Upload a WAV (or use the built-in demo), turn knobs or press AUTO MASTER, then export.

### Tests

Node 20+, from the repo root - no framework, plain assert scripts:

```bash
node bug-repro.mjs        # knob math, fine steps, limiter thresholds, gain staging
node auto-repro.mjs       # meter reference tests, full-track analysis, chain order,
                          # AUTO mapper, UI wiring, loudness correction + parity cases
node deshimmer-repro.mjs  # deshimmer knob + stage behavior
node dom-contract.mjs     # JS-DOM contract: IDs, runtime classes, flat theme
node link-check.mjs       # relative links resolve, no banned branding
```

---

## Architecture

One shared mastering chain, two consumers - the rule that keeps live and export identical:

```text
docs/app.js                 orchestration: upload, playback, AUTO flow, report, export
docs/modules/
  analyzer.js               AudioMath (STFT), CarrierDetector, StegoDetector,
                            SpectralAnalyzer: BS.1770-5 LUFS/LRA, 4x polyphase true peak,
                            analyzeFullTrack, measureShimmer
  auto.js                   mapAutoReport: deterministic report -> clamped params + reasons
  dsp.js                    MaestroDSP: buildMasterChain (the one shared chain),
                            live connect/bypass, renderChain, exportWAV (16-bit PCM)
  spectrum.js               SpectrumRenderer + buildAutoIssues (overlay bands, issue rows)
  knob.js / registry.js     FLKnob widget + knob-registry.json driven DOM
  ui.js / storage.js        UI controller, LocalStorage/IndexedDB persistence
```

- `buildMasterChain` is called by live playback, offline export, and AUTO calibration - same nodes, same order, same constants, same LFO. Any new stage goes into both paths or it does not ship.
- AUTO-only parameters (de-esser, air shelf, M/S bass, calibrated trim) travel in the params object, not as new knobs.
- The loudness meter is verified against a known-value reference sine before anything downstream trusts it; true peak uses 4x polyphase FIR interpolation, not a sample-peak proxy.

---

## Repository structure

```text
ai-maestro/
├── .github/                 CI (registry/syntax checks), Pages deploy, issue templates
├── docs/                    the entire application (GitHub Pages root)
│   ├── index.html           single-page studio
│   ├── app.js               orchestration
│   ├── modules/             analyzer / auto / dsp / spectrum / knob / registry / ui / storage
│   ├── knob-registry.json   knob definitions, ranges, presets
│   ├── style.css            minimal flat theme
│   ├── assets/              mark.svg
│   └── audio/               demo stems (large test WAVs are not committed)
├── bug-repro.mjs            regression suite: knob math and gain staging
├── auto-repro.mjs           regression suite: meter, analysis, chain, AUTO, parity
├── deshimmer-repro.mjs      regression suite: deshimmer
├── dom-contract.mjs         JS-DOM contract gate
├── link-check.mjs           link and branding gate
├── CHANGELOG.md
├── LICENSE                  MIT
└── README.md
```

---

## Known limits

- Export is 16-bit PCM WAV only - no FLAC/MP3/OGG.
- Loudness correction is reduction-only, so masters can sit below the -1 dBTP ceiling; the target LUFS is still met.
- Changing the AUTO target re-runs the full calibration render.
- Shimmer scoring is heuristic; the confidence gate keeps uncertain or clean tracks from being dulled.

## Community

- **Issues:** [github.com/ai-news-tester/ai-maestro/issues](https://github.com/ai-news-tester/ai-maestro/issues)
- **Security:** see [SECURITY.md](.github/SECURITY.md)
- **Contributing:** see [CONTRIBUTING.md](.github/CONTRIBUTING.md) and the [Code of Conduct](.github/CODE_OF_CONDUCT.md)

Licensed under the [MIT License](LICENSE).

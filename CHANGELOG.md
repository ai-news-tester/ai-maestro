# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-20

### Added
- AI-Maestro: a zero-dependency browser Web Audio studio served from `docs/`, with no build step and no server.
- Full-track analysis: BS.1770-5 K-weighted LUFS and loudness range, 4x-oversampled true peak, clipping, DC offset, silence and fades, stereo width and correlation, spectral tilt, sibilance, HF cutoff, ultrasonic carrier prominence (15.5 / 17.5 / 19.5 kHz), cepstral echo confidence, and an HF shimmer score.
- AUTO mastering: detect, clean, master, and export in one run, with a reason for every mapped value and a reduction-only loudness trim calibrated from a real render.
- 15 knobs in four groups (RESONANCE CLEANUP, PHASE & TEXTURE, NATURALIZATION, MASTERING) with five presets: Off, Gentle, Standard, Deep, Full.
- Live playback and export sharing one chain (`buildMasterChain`), with 16-bit PCM WAV export named `<track>.auto-master.wav` at -14 (default), -12, or -10 LUFS.
- Plain-assert test suites: `bug-repro.mjs`, `auto-repro.mjs`, `deshimmer-repro.mjs`, `dom-contract.mjs`, and `link-check.mjs`.
- Minimal flat paper theme and single-column studio layout, with the new `docs/assets/mark.svg` mark.

### Changed
- Rebranded from the upstream fork to AI-Maestro; renamed the engine to `MaestroDSP` and the detector to `CarrierDetector`.

### Notes
- Knob settings carry over from the previous build (the legacy storage key is still read), but uploaded audio must be re-added.

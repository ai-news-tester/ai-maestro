# AUTO Spotify (A) - Design
Date: 2026-11-16
Status: Draft, for approval - no product code built yet
Replaces: docs/AUTO-MODE-PLAN.md as the reference for AUTO work

## Intent
Drop in a raw Suno WAV, auto-detect what is wrong or excessive including inaudible issues, show what is wrong and where, then auto-master it Spotify-ready at -14 LUFS integrated and -1 dBTP. Manual mode stays, the original file is never edited, the app stays vanilla JS in the browser with no new dependencies.

## Goals
- One AUTO button: Detect, Clean, Master, Export.
- Full-track diagnosis, not only the first 12 s, with channels kept separate.
- Report says what was detected, where in the track, what was applied, and why, with before/after loudness and peak.
- Export is Spotify-ready: -14 LUFS, -1 dBTP, 16-bit WAV, filename name.auto-master.wav.
- Live playback and the downloaded file use the same mastering, so A/B does not lie about the download.
- Deshimmer is included as a cleanup stage before loudness and limiting.

## Non-goals
- No Local -16 LUFS / -2 dBTP target in v1, no 30 s previews, no Demucs stems, no Matchering ref match, no Splice/Heal/Bridge repair in v1.
- No server, no Python rewrite, no AI model, no new dependencies, no removal of manual mode.
- No watermark-removal claim and no AI-detection claim. Deshimmer is artifact removal for sound quality only.

## Constraints
- Vanilla JS only, Web Audio only, no build step, no package.json change.
- Deterministic rules, no ML. Every AUTO value is clamped to the safe range of the existing presets.
- Low confidence falls back to standardEvasion for the other knobs and deshimmer 0.
- node --check on touched modules; node bug-repro.mjs must still pass: crest 0, bandwidthHeal 0.25, qualityGate 6 to -2.9 dB, outputGain 6 dB to 1.9953.
- Do not commit without the user go-ahead. Sonnet and Fable review code and send bug reports; fix them and send fixes back.

## References to port from, not rewrite
- StreamMaster (ivibestuff/streammaster, Python/Flask, MIT, v2.3.3.1): Analyse tab heuristics, 15-stage Master chain, Export Both targets, automatic QC. Steal heuristics from spotify_master.py, analyser.py, mastering_extras.py, qc.py, dejinx.py, repair.py where they fit. Chain ideas used here: air restoration above the Suno 16 kHz cutoff, spectral dehaze 8-16 kHz, M/S bass anchoring, de-esser, harmonic saturation, glue compression, dynamic EQ, transient shaping, vocal ride, macro dynamics, loudness normalisation, true-peak limiting.
- Lacquer (audiotools.com.ar/lacquer, JUCE C++, AGPL, v1.0.4): detection rules and report model. BS.1770-5 loudness, true peak, loudness range, spectrum of loud parts, stereo width and mono lows, harsh resonances, sibilance, clipping, HF cutoff. Every module says what it did and why. Targets noted: Streaming -14, Apple -16, Loud -11, Club -8, CD -9, Broadcast -23 LUFS, -1 dBTP for streaming. This design uses Streaming -14 only.
- Deshimmer: cleanup stage before loudness/limiting. Shimmer, noise, resonances, phase swish, automatic parameter search. Ported as described stages, not as code, and only as sound-quality cleanup.

## Approaches
- A (chosen): Minimal Spotify AUTO. Full-track sampled windows, K-weighted LUFS plus 4x true-peak, one shared mastering builder used by live and export, Deshimmer cleanup before loudness/limiting, cheap de-esser, air shelf above 16 kHz, and M/S bass anchoring. Report says what was done and why. Spotify target only.
- B (rejected): Full StreamMaster port. All 15 stages, both export targets, QC, previews, De-Jinx, Splice/Heal/Bridge, Demucs stems, Matchering ref match. Most faithful, most code and most risk.
- C (rejected for this brief): Detection first, mastering later. You see the diagnosis sooner, but no Spotify-ready file until phase 2.

## Design

### 1. Measure - extend docs/modules/analyzer.js
Keep existing Suno carriers 15.5/17.5/19.5 kHz, cepstral echo/stego, spectral flatness, peak/RMS/crest. Extend to sampled windows across the full track, up to 8 windows evenly spaced, each 2048 samples, channels kept separate.
Add: K-weighted LUFS integrated plus loudness range, 4x oversampled true peak, peak/RMS/crest per channel, clipping count (samples at or above 0.999), DC offset (mean per channel), silence segments and fades with start/end times, sample rate, stereo width and correlation, mono lows below 120 Hz, spectral tilt and low-end energy, harsh resonance peaks, sibilance score (5-8 kHz energy vs band), HF cutoff frequency, carrier prominence per carrier, echo confidence, shimmer score (HF flatness, frame-to-frame HF variance, resonance prominence, from the deshimmer design).
Output one AnalysisReport: measurements, per-issue severity and confidence, time ranges where each issue occurs, and the reason for each AUTO choice. Silence or a track shorter than one frame returns score 0, confidence 0, no NaN.

### 2. Map - new docs/modules/auto.js
Deterministic rules only. Examples: carrier prominence over 3 dB raises carrierErase, echo confidence raises stegoStrip, flatness and harsh peaks raise spectralBlend, low crest raises dynamicsNatural, low loudness raises outputGain, high shimmer raises deshimmer, high sibilance enables de-esser, low width or out-of-phase lows enables M/S bass anchoring, HF cutoff at 16 kHz enables air shelf. Clamp every value to preset ranges. Low confidence or a clean track leaves deshimmer and corrective stages at or near 0.

### 3. Master - one shared chain in dsp.js
Put mastering in one builder both live and export use, for example buildMasterChain(ctx, params) returning the node list, or add a parity check that live and export contain the same constants and order. This closes the A/B lie: live init/updateFromKnob and exportWAV must not be two hand-copied chains.
Order: existing 14-node cleanup, Deshimmer HF shelf plus neuralScrub/spectralBlend boosts, de-esser (fixed cut at 6.5 kHz when sibilance score is high), air restoration (gentle highshelf above 16 kHz), spectral dehaze 8-16 kHz, M/S bass anchoring (mono lows below 120 Hz when correlation is low), dynamic EQ for harsh peaks, glue compression from crest, loudness normalise to -14 LUFS, true-peak limiter at -1 dBTP, dither on export. Any new stage must go into both live and export or it does not ship.
Loudness: implement K-weighted LUFS in JS per BS.1770-5 (shelving plus high-pass, gated integrated). True peak: 4x oversampling, not a -1 dBFS proxy. Verify the meter first with one reference file with a known value before Phase 3.

### 4. Deshimmer stage
Per docs/superpowers/specs/2026-11-16-deshimmer-auto-design.md and docs/superpowers/plans/2026-11-16-deshimmer-auto.md: one deshimmer knob 0-100, default 0, driving the existing neuralScrub and spectralBlend stages plus one gentle HF shelf at 10 kHz, Q 0.7, gain -0.06 dB per point. AUTO sets it from the shimmer score; manual keeps the knob. Label text: reduces metallic shimmer and watery sustain for sound quality. It does not remove watermarks and does not affect AI detection.

### 5. UI and report - docs/app.js
One AUTO button with progress: Detect, Clean, Master, Export. Report panel: what was detected, where, what was applied, before/after loudness and peak. Buttons: Play original, Play AUTO, Download, Revert to manual preset. No new knobs in AUTO view; applied values shown read-only. Keep the existing forensic panel and manual knobs working.

Analysis overlay (extends docs/modules/spectrum.js SpectrumRenderer, does not replace it): after full-track analysis, draw persistent markers/bands on the spectrum even when not playing, at the exact frequency ranges where a problem was measured — rumble/DC below 30 Hz, mud excess 200-500 Hz, harsh resonances and sibilance peaks, de-esser band around 6.5 kHz, shimmer/dehaze 8-16 kHz, Suno HF cutoff near 16 kHz, carriers 15.5/17.5/19.5 kHz. Colour by severity, label each with measured dB over target.

Per-issue bars under the spectrum: one row per detected issue with name, where it is (frequency band and time window in the track), measured value vs target, and a horizontal severity bar showing how far over it is. Include non-EQ issues too: integrated LUFS vs -14, true peak vs -1 dBTP, clipping count, loudness range, stereo width/correlation.

Per-issue slider: reuse existing FLKnob/slider conventions and ranges; slider value is the correction strength/amount for that issue, default is the AUTO-computed value from auto.js mapAutoReport, moving a slider switches only that issue to manual and re-renders live so A/B updates, 0 means no correction. AUTO button applies all sliders automatically to the recommended values, then Clean/Master/Export runs the shared chain — user never has to touch a slider to get a finished file. Keep manual mode and the original untouched, keep live and export identical through the shared buildMasterChain, vanilla JS only, no new dependencies. Repro/check: an analysis report with a known issue (e.g. carrier prominence, LUFS off target) produces a marker, a bar and a non-zero default slider for that issue, and AUTO sets it.

## Verification
- node --check on analyzer.js, dsp.js, auto.js, app.js.
- node bug-repro.mjs still passes, plus deshimmer-repro.mjs from the deshimmer plan.
- LUFS reference-file test with a known value before Phase 3; shimmer known-value test on a synthetic shimmer signal and on silence.
- Manual browser check on docs/audio/demo_original.wav: AUTO run, A/B listen, export WAV, confirm the export sounds like live playback.
- A real Suno track is still missing from docs/audio. The Suno-track test is blocked until one is added; do not claim it passed.

## Risks and open decisions
- LUFS and true-peak math are unproven until the reference-file test passes.
- Shimmer score is unproven until measured on a real Suno track; too much strength dulls highs, mitigated by the confidence gate and 0-for-clean fallback.
- Long tracks and OfflineAudioContext memory need a real-track test.
- M/S bass anchoring and dropout/phase repair may be more code than cheap in Web Audio. If M/S costs a splitter/merger rebuild, keep it as detection plus a fixed mono-lows gain only. Dropout repair stays detection-only in v1 unless bridging falls out of the existing chain for free.
- StreamMaster, Lacquer and Deshimmer source was not read line by line for this design; heuristics are taken from the brief and from their described stages, to be checked against source during implementation.

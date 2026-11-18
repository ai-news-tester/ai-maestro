# NaSuno AUTO Mode - Plan
Date: 2026-11-15
Status: Draft, for approval - no AUTO code built yet

## 1. Cleaned base - done
- Removed docs/modules/auth.js - disabled GitHub star/follow gate, ENABLE_AUTH_GATE=false, isUnlocked always true.
- Removed auth import, setupAuthGate, show/hide gate, isEngineUnlocked guards in docs/app.js.
- Removed pre-auth inline script, verified pill, auth-gate modal in docs/index.html.
- Removed auth, verified-pill, unstarred, community and star-modal CSS in docs/style.css, about 540 lines.
- Removed Advanced Mode: docs/modules/composite.js, config-io.js, 91 raw params, renderAdvancedPanel/renderConfigPanel, updateFromRawKey, currentRawState. Only the 14 composite knobs remain.
- Removed docs/api-reference.md, architecture.md, deployment.md, roadmap.md and docs/research/*.
- Verified by grep: no AuthPersistence, verifyGitHub, isEngineUnlocked, setupAuthGate, ENABLE_AUTH, nasunoAuthGate, CompositeEngine, ConfigIO, rawParams, renderAdvancedPanel, demo_cleaned or updateFromRawKey left in app.js, index.html, modules or style.css.
- Kept: app.js, index.html, style.css, knob-registry.json (14 composite knobs, 5 presets), modules analyzer.js, dsp.js, knob.js, registry.js, spectrum.js, storage.js, ui.js.
- Demo: app.js loads audio/demo_original.wav in 5 places (exists, plus .ogg fallback in loadAudioFile).
- Bugfixes verified 2026-11-15 (bug-repro.mjs): silent crest 0 not NaN, bandwidthHeal 0.25 exact, qualityGate max 6 (-2.9 dB), outputGain labelled dB in live and export, knob ring arc 141.4, hashBreak LFO in export, silent peak/RMS display "-∞".

## 2. Still to do - Phase 0, do before AUTO
- Smoke check: node --check on JS modules, plus a grep check that auth/raw symbols stay gone. No package.json, no dependencies. Vanilla JS plus Web Audio, no build step. CI only checks JSON validity and file existence.
- Name test tracks for Phases 2 and 5: docs/audio has only demo_original.wav and demo_original.ogg. Need a Suno track and a loud/clipped track before those phases.
- Commit the strip + bugfix pass first: it is uncommitted vs HEAD 2883dfa, one reset --hard erases it.

## 3. AUTO mode - goal
- Drop in a track, detect what is in it, clean it, master it, export a finished file. No knobs to turn.
- Keep manual mode. Keep the original untouched. Always offer A/B original vs AUTO.

## 4. Detection - extend analyzer.js
- Reuse SunoDetector, StegoDetector, SpectralAnalyzer, now only on the first 12 s and only for display.
- Extend to sampled windows across the full track and add: loudness, true peak, peak/RMS/crest, clipping count, DC offset, silence and fades, sample rate, stereo width and correlation, spectral tilt and low-end energy, harsh peaks, carrier prominence per carrier, echo confidence.
- Output one AnalysisReport: measurements, confidence, and the reason for each AUTO choice.

## 5. Mapping - new docs/modules/auto.js
- Deterministic rules, no ML, no new dependency.
- Examples: carrier prominence over 3 dB raises carrierErase, echo confidence raises stegoStrip, flatness and harsh peaks raise spectralBlend, low crest raises dynamicsNatural, low loudness raises outputGain.
- Clamp every value to the safe range of the existing presets. Low confidence falls back to standardEvasion.
- AUTO never edits the input file.

## 6. Mastering - extend dsp.js exportWAV, keep live chain in sync
- Order: existing 14-node cleanup, corrective EQ (high-pass 20-30 Hz, cut harsh peaks, tilt), compressor from crest, loudness normalize, limiter, dither.
- Any new mastering stage must go into both the live chain (dsp.js init/updateFromKnob) and exportWAV, or A/B lies about the download.
- Proposed default target: -14 LUFS integrated, -1 dBTP, streaming. Open decision: confirm target, or pick -9 LUFS for loud.
- Export: keep 16-bit WAV, add 24-bit WAV. Filename: name.auto-master.wav.
- Loudness needs a K-weighted LUFS implementation in JS, no library. True-peak needs oversampling, or use -1 dBFS ceiling as a safe proxy and say so.

## 7. UI - minimal
- One AUTO button with progress: Detect, Clean, Master, Export.
- Report panel: what was detected, what was applied, before/after loudness and peak.
- Buttons: Play original, Play AUTO, Download, Revert to manual preset.
- No new knobs in AUTO view, show applied values read-only.

## 8. Phases
- Phase 0: finish base - demo fix, raw-param audit, smoke check.
- Phase 1: analyzer extension plus AnalysisReport, tested on demo_original.
- Phase 2: auto.js mapper plus clamps, tested on a Suno track and a clean track.
- Phase 3: mastering - loudness, EQ, limiter, dither, 24-bit export.
- Phase 4: UI, report, A/B, download.
- Phase 5: verification - 3 tracks (Suno, clean, loud/clipped), check carrier prominence down, loudness on target, peak under ceiling, no clipping, listening check.

## 9. Non-goals
- No server, no Python CLI rewrite, no AI model, no new dependencies, no removal of manual mode, no claim that detection is guaranteed removed.

## 10. Risks and open decisions
- AUTO can over-clean a clean track or over-compress a dynamic one if detection is wrong. Mitigation: confidence gates, fallback preset, A/B, original kept.
- Loudness target not yet chosen.
- Long tracks and OfflineAudioContext memory, and true-peak accuracy in the browser, need a real-track test.
- LUFS/true-peak math needs one reference-file test with a known value before Phase 3.
- Stereo width/correlation need channel-separate analysis input: runForensicAnalysis currently mono-mixes at app.js:115-124.
- The research docs claim strong evasion results. Do not repeat those claims in AUTO output until measured on a real track.

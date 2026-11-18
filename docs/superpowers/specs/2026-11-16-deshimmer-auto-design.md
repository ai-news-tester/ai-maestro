# Deshimmer (A + C) - Design
Date: 2026-11-16
Status: Draft, for approval - no product code built yet

## Intent
Add deshimmer to NaSuno as sound-quality artifact removal for AI-generated tracks: metallic shimmer, watery sustain, harsh resonances and phase swish. AUTO mode is required, so the strength is set automatically from measurement, with a manual knob as override. This is not watermark removal and does not claim to affect AI detection.

## Goals
- One deshimmer strength, 0-100, following existing knob conventions.
- AUTO sets it from a measured shimmer score with confidence and a stated reason.
- Live playback and exportWAV use identical formulas so A/B matches the download.
- Clean tracks are left near 0 so AUTO does not dull them.
- Vanilla JS only, no new dependencies, no ML, manual mode unchanged, original untouched.

## Non-goals
- No separate deshimmer.js module, no ported Python, no server.
- No watermark removal or AI-detection claims.
- No Residual/Diff solo in v1 unless it falls out of the existing dry/wet path for free.

## Approaches
- A (chosen): one knob reusing neuralScrub and spectralBlend plus one gentle HF smoothing stage.
- C (chosen): analyzer measures shimmer, auto.js maps score to strength, per AUTO-MODE-PLAN Phases 1-2.
- B (rejected): separate module duplicating spectralBlend and neuralScrub.

## Design
### Measure - analyzer.js
Sampled windows across the full track (AUTO Phase 1). Shimmer score 0-1 from high-band spectral flatness, frame-to-frame HF magnitude variance, and harsh resonance peak prominence, plus confidence. Output in AnalysisReport with the reason.
### Map - docs/modules/auto.js
Deterministic rule: strength = clamp(round(score * 100)) within preset ranges. Low confidence or low score: strength 0 and fallback preset standardEvasion for the other knobs.
### Apply - dsp.js and knob-registry.json
Add composite knob deshimmer (default 0). It drives the existing neuralScrub and spectralBlend stages plus one gentle HF smoothing/resonance stage, implemented in init/updateFromKnob and in exportWAV with the same constants.
### UI and report
Manual: knob like the other 14. AUTO: strength shown read-only with score, confidence and reason, plus Play original / Play AUTO / Download per AUTO-MODE-PLAN. Label text: Deshimmer reduces metallic shimmer and watery sustain for sound quality. It does not remove watermarks and does not affect AI detection.

## Verification
- node --check on analyzer.js, dsp.js, registry.js, app.js and auto.js.
- node bug-repro.mjs still passes: crest 0, bandwidthHeal 0.25, qualityGate 6 to -2.9 dB, outputGain 6 dB to 1.9953.
- Known-value test for the shimmer score on a synthetic shimmer signal and on silence.
- A/B listening on docs/audio/demo_original.wav and on a real Suno track, which must be added to docs/audio first.

## Risks and open decisions
- Deshimmer source was not found by web search, so this ports its described stages, not its code.
- Shimmer score is unproven until measured on a real Suno track.
- Too much strength dulls highs; mitigated by confidence gate and 0-for-clean fallback.

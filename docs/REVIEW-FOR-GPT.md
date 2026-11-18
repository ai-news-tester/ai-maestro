# NaSuno-SongHumanizer — Bare-Bones Cleanup — Review Request

Please review this cleanup. The goal was: keep only the working load / play / clean / export path, remove everything else that is not needed.

## What remains (verified)

- `docs/app.js` — 798 lines
- `docs/index.html` — 268 lines
- `docs/style.css` — about 1,200 lines
- `docs/knob-registry.json` — 401 lines, 14 composite knobs, presets: off, lowProfile, standardEvasion, deepClean, fullScrub
- `docs/modules/analyzer.js` — 431 lines
- `docs/modules/dsp.js` — 845 lines
- `docs/modules/knob.js` — 164 lines
- `docs/modules/registry.js` — 144 lines
- `docs/modules/spectrum.js` — 303 lines
- `docs/modules/storage.js` — 136 lines
- `docs/modules/ui.js` — 234 lines
- `docs/audio/demo_original.wav` and `demo_original.ogg`
- `docs/assets/` images, `docs/robots.txt`, `docs/sitemap.txt`, `docs/AUTO-MODE-PLAN.md`

Total code is about 4,950 lines, down from about 8,863 lines before this pass.

App imports in `app.js` are now only: analyzer.js, dsp.js, spectrum.js, ui.js, registry.js, storage.js.

## What was removed

1. Auth / community gate: `docs/modules/auth.js`, auth import and `setupAuthGate` / `isEngineUnlocked` guards in `app.js`, pre-auth inline script, verified pill and auth-gate modal in `index.html`, about 540 lines of auth / verified-pill / unstarred / community / star-modal CSS in `style.css`.
2. Advanced Mode: 91 raw parameters, accordions, `renderAdvancedPanel`, `setRawInputValue`, `getAllRawValues`, `updateFromRawKey` in `dsp.js`, `currentRawState` in `app.js`, raw-state restore from saved settings.
3. Config I/O: `docs/modules/config-io.js`, `renderConfigPanel`, template download, JSON import/export, quick Export Config button, star-on-GitHub export link.
4. Composite mapping: `docs/modules/composite.js`, `CompositeEngine.mapForward` / `mapReverse`, CUSTOM badge and `setCustom` / `isCustom` in `knob.js`, panel tabs in `index.html` and `initTabs` / `switchPanel` in `ui.js`, `showRawParamInfo` in `ui.js`.
5. Registry pruning: removed `rawParams`, `presetParams`, `fixedParams`, `totalEngineParams`, per-knob `curves`, and preset `cli` strings from `knob-registry.json` (2,807 lines to 401 lines).
6. Dead docs: `docs/research/`, `docs/superpowers/`, `docs/api-reference.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/roadmap.md`.
7. Dead CSS: Advanced / Config panel styles, panel-tab styles, CUSTOM badge styles, dead responsive rules for the removed panels.

## Bug fixed during cleanup

- `app.js` loaded `audio/demo_cleaned.wav` in 5 places, but that file does not exist in `docs/audio/`. All 5 references now point to `audio/demo_original.wav`, which exists, with the existing `.ogg` fallback.

## Verification done

- `node --check` passed for `app.js` and all remaining modules: analyzer, dsp, knob, registry, spectrum, storage, ui.
- `knob-registry.json` parses, 14 knobs, 5 presets listed above.
- Grep for removed symbols in code (`CompositeEngine`, `ConfigIO`, `rawParams`, `renderAdvancedPanel`, `renderConfigPanel`, `panel-tab`, `advancedPanel`, `configPanel`, `demo_cleaned`, `AuthPersistence`, `verifyGitHub`, `isEngineUnlocked`, `currentRawState`, `updateFromRawKey`) found no matches in the remaining code. Only stale mentions remain in `docs/AUTO-MODE-PLAN.md`.

## What was NOT checked

- No browser runtime test, no playback test, no WAV export test, no listening test.
- No test on a real Suno track, a clean track, or a loud / clipped track.
- `docs/AUTO-MODE-PLAN.md` is now stale: it still describes 222 params, `updateFromRawKey`, `config-io.js`, and `demo_cleaned.wav`. It was not updated or deleted in this pass.

## Please review for

1. Any dead code, dead CSS, or broken references left behind.
2. Any broken import, missing DOM id, or UI wiring after removing Advanced / Config / tabs.
3. Whether `dsp.js` `updateFromKnob` and offline `exportWAV` still agree — both should use only the 14 composite knobs now.
4. Whether removing Config I/O / raw params breaks saved settings or presets in a way that needs migration, or whether dropping them silently is acceptable.
5. Whether the remaining claims in the UI and registry (for example evasion / watermark wording) are honest about what the DSP actually does.
6. Any security, data-loss, or UX risk in the remaining load / play / bypass / export flow.
7. What, if anything, should be deleted next, and what should be kept.

Please be concrete: file and line where possible, what breaks, and what to change. Do not assume the cleanup is correct because the syntax checks passed.

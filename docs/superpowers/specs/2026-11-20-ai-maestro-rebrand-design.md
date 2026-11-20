# AI-Maestro Rebrand & Minimal Restyle — Design

## Intent

This repo is a fork whose docs, community files and changelog still describe the
upstream Python project it came from. The application that actually ships is a
zero-dependency browser Web Audio rack in `docs/`. The user wants the repo to read
as a fresh, self-consistent project named **AI-Maestro**, with dead links gone and
a calmer, minimal interface instead of the current neon "FL Studio rack" look.

The why: the inherited material is not just off-brand, it is wrong. Roughly 70% of
what the old docs describe does not exist here, so a reader cannot trust any of it.

## Goals

- One name everywhere: AI-Maestro. No `NaSuno`, `Suno`, `HUMANIZER` or `geeknik`
  branding in product surface, docs or identifiers.
- Every link resolves. No reference to a file, badge, endpoint or email that does
  not exist.
- Every remaining document describes this app: vanilla JS, Web Audio, no build step.
- `docs/index.html` + `docs/style.css` rebuilt as a minimal, flat, paper-toned
  interface. No glow, grid background, chassis screws or neon.
- Behaviour unchanged: same DSP chain, same AUTO calibration, same export bytes.

## Non-goals

- No new DSP, no new knobs, no new features.
- No change to the shared-chain architecture or the loudness meter.
- No framework, bundler or dependency.
- No GitHub-side operations (repo creation/rename, remote changes, pushes).

## Anti-goals

- A restyle that silently drops an element ID or runtime class and breaks a control.
- Marketing copy that claims the tool defeats AI detection, watermarks or
  provenance systems. The DSP is a fixed bank of filters, shapers and compressors;
  copy describes what each stage measurably does, nothing more.
- Losing a user's saved knob settings on upgrade.

## Constraints

- 53 element IDs are read by `app.js` (39), `ui.js` (13) and `registry.js`
  (`evasionPanel`); all must survive.
- Runtime class names written by JS must exist in the stylesheet: `meter-fill`,
  `alert`, `playing`, `active`, `bypassed`, `open`, `auto-issue-row|-name|-where|
  -bar|-bar-fill|-val|-slider|-manual`, `popover-badge`, `badge-cyan|green|orange`,
  `popover-section|-section-title|-highlight`.
- `knob.js` queries `.knob-rotor` and `.ring-active` inside each knob element and
  sets `strokeDasharray` against the `0 0 76 76` viewBox — keep that geometry.
- Test suites pin these values, so they are frozen: knob `id`s, `module` ids,
  preset **keys** (`off`, `lowProfile`, `standardEvasion`, `deepClean`, `fullScrub`),
  `deshimmer.label === 'DESHIMMER'`, `deshimmer.ring === 'green'`,
  `naturalization.moduleTitle === 'NATURALIZATION'`, and the deshimmer disclaimer
  strings. Display names may change; keys may not (keys are persisted in
  LocalStorage, so renaming them would orphan saved settings).
- `spectrum.js` hardcodes canvas colours; the palette change must reach it.
- MIT upstream copyright notice is retained.

## Approaches considered

1. **Rename in place, restyle the existing stylesheet.** Cheapest diff, but the
   1279-line sheet is built around chassis gradients, screws and glow; stripping
   those leaves a skeleton that still reads as a rack. Rejected: does not deliver
   "whole new layout".
2. **Rebuild `index.html` and `style.css` against the extracted DOM contract,
   rename identifiers, rewrite the docs.** Chosen. The contract is mechanical to
   extract and cheap to assert, which makes a full visual rewrite safe.
3. **Rewrite the app shell in a framework.** Rejected: adds a build step and
   dependencies the project deliberately does not have.

## Decisions

- **Name** AI-Maestro; repo slug `ai-maestro`; class prefix `Maestro`.
- **URLs** Prefer relative links for everything in-repo. Absolute URLs are limited
  to one repo base (`https://github.com/ai-news-tester/ai-maestro`) and its Pages
  base, used only where the format demands it (canonical, sitemap, robots).
  Badges that point at services which do not exist for this repo are deleted
  rather than repointed.
- **Storage** New keys `maestro_settings_v1` / `MaestroAudioDB`. `loadSettings`
  falls back to the legacy key once so existing knob settings survive. Uploaded
  audio is not migrated (one re-upload); noted in the changelog.
- **Assets** Delete all eight inherited banners/hero images (~2.2 MB). One small
  hand-written SVG mark replaces them. `og:image` / `twitter:image` are dropped
  rather than pointed at a file that would not exist.
- **Type** System font stack. Google Fonts links removed.
- **Palette** Paper `#f7f6f3`, surface `#ffffff`, hairline `#e2dfd9`, ink `#1c1b19`,
  muted `#6f6b64`, accent slate `#2f4858`, alert brick `#a33a2a`. The three ring
  classes keep their names and map to slate / moss `#4a6b52` / ochre `#8a5a2b`.
- **Copy** `info.defeats` becomes `info.purpose`; the popover heading
  "DEFEATS DETECTION VECTOR" becomes "WHAT IT DOES". Group titles become
  RESONANCE CLEANUP / PHASE & TEXTURE / NATURALIZATION / MASTERING. Preset display
  names become Off / Gentle / Standard / Deep / Full.

## Left to the builder

- Exact spacing, type scale and responsive breakpoints within the palette above.
- Prose wording of the rewritten docs, subject to the copy rule.
- Whether the legacy settings fallback is removed in a later release.
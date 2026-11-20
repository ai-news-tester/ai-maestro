# AI-Maestro Rebrand & Minimal Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this fork into a self-consistent repo named AI-Maestro with a minimal interface, no dead links, and no reference to the upstream project.

**Architecture:** The app is static vanilla-JS ES modules served from `docs/`. The visual rewrite is safe only because the JS↔DOM contract is finite and enumerable, so Task 1 pins that contract with a test before any markup changes. Renames are identifier-level and behaviour-preserving; the DSP chain and meter are untouched.

**Tech Stack:** Vanilla JS ES modules, Web Audio API, plain CSS, Node 20 assert scripts (no framework), Python only for CI JSON validation.

**Spec:** `docs/superpowers/specs/2026-11-20-ai-maestro-rebrand-design.md`

## Global Constraints

- Product name `AI-Maestro`; repo slug `ai-maestro`; class prefix `Maestro`.
- Zero new dependencies, no build step, no bundler.
- Repo base URL `https://github.com/ai-news-tester/ai-maestro`; Pages base `https://ai-news-tester.github.io/ai-maestro/`. Absolute URLs only where the format requires it (canonical, og:url, sitemap, robots). Everything in-repo uses relative links.
- All 53 element IDs read by `docs/app.js` (39), `docs/modules/ui.js` (13) and `docs/modules/registry.js` (`evasionPanel`) must survive the rewrite.
- Frozen values pinned by existing tests: knob `id`s, `module` ids, preset keys `off` / `lowProfile` / `standardEvasion` / `deepClean` / `fullScrub`, `deshimmer.label === 'DESHIMMER'`, `deshimmer.ring === 'green'`, `naturalization.moduleTitle === 'NATURALIZATION'`, and the substrings `does not remove watermarks` and `does not affect AI detection` in the deshimmer description.
- Palette: paper `#f7f6f3`, surface `#ffffff`, hairline `#e2dfd9`, ink `#1c1b19`, muted `#6f6b64`, slate `#2f4858`, moss `#4a6b52`, ochre `#8a5a2b`, brick `#a33a2a`. No gradients, glows, shadows beyond a single hairline, no grid background.
- System font stack only: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; mono `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.
- Copy rule: describe what each stage measurably does. No claim of defeating AI detection, watermarks, fingerprinting or provenance systems.
- Keep the MIT upstream copyright line in `LICENSE`.
- Never modify `.claude/worktrees/` — a separate worktree, out of scope.
- Existing suites must stay green: `node bug-repro.mjs`, `node auto-repro.mjs`, `node deshimmer-repro.mjs`.

## Review Focus

- A dropped element ID or runtime class name after the markup rewrite → a control silently does nothing. Pinned by Task 1's contract test, re-run in Task 4.
- A knob whose `.knob-rotor` / `.ring-active` is missing or whose SVG viewBox changed → drag works but nothing moves visually. Pinned by Task 1 and checked in Task 4.
- The spectrum canvas with no CSS height → `getBoundingClientRect()` returns 0 and the chart draws nothing. Pinned by Task 1's canvas-size assertion, verified in Task 4.
- An existing user upgrading with saved knobs under the old LocalStorage key → settings silently reset. Pinned by Task 2's migration test.
- A doc or CI step referencing a deleted file → broken link or red CI. Pinned by Task 5's link-check script.

---

### Task 1: Pin the JS↔DOM contract with a test

**Files:**
- Create: `dom-contract.mjs` (repo root, alongside the other `*-repro.mjs` suites)

**Interfaces:**
- Consumes: nothing.
- Produces: `node dom-contract.mjs`, exit 0 on pass. Exports nothing. Later tasks run it unchanged as their regression gate.

- [ ] **Step 1: Write the failing test**

Create `dom-contract.mjs`. It reads `docs/index.html`, `docs/app.js`, `docs/modules/ui.js`, `docs/modules/registry.js` and `docs/style.css` as text with `readFileSync`, then asserts:

1. Every ID matched by `/getElementById\('([^']+)'\)/g` across `app.js`, `ui.js` and `registry.js` appears in `index.html` as `id="<name>"`. Collect into a `Set`, assert the set size is `>= 53` so a future deletion of a lookup cannot quietly shrink the contract, and report every missing ID by name in the failure message.
2. Every class the JS writes at runtime is styled: for each of `meter-fill`, `alert`, `playing`, `active`, `bypassed`, `open`, `auto-issue-row`, `auto-issue-name`, `auto-issue-where`, `auto-issue-bar`, `auto-issue-bar-fill`, `auto-issue-val`, `auto-issue-slider`, `auto-issue-manual`, `popover-badge`, `badge-cyan`, `badge-green`, `badge-orange`, `popover-section`, `popover-section-title`, `popover-highlight`, assert `style.css` contains `.<class>`. Also assert the classes `registry.js` emits from its knob template: `rack-module-card`, `module-header`, `module-title-wrap`, `module-pill`, `module-desc`, `module-count`, `module-knobs-grid`, `knob-col`, `knob-label-row`, `knob-label`, `info-btn`, `fl-knob-wrapper`, `knob-ring-svg`, `ring-bg`, `ring-active`, `knob-rotor`, `rotor-cap`, `rotor-pointer`, `knob-readout-row`, `knob-readout`, plus `border-cyan|green|orange`, `pill-cyan|green|orange` and `ring-cyan|green|orange`.
3. `index.html` contains `id="scopeCanvas"`, and `style.css` gives the canvas a non-zero height. Accept EITHER an explicit `#scopeCanvas { … height: <non-zero> … }` rule OR a descendant `canvas` rule with a non-zero height (the current sheet uses `.scope-display-container canvas { height: 100% }` with the container supplying the height). Assert at least one of the two matches. Task 3 adds the explicit `#scopeCanvas` rule.
4. The knob markup template in `docs/modules/registry.js` still contains `class="knob-rotor"`, `class="ring-active` and `viewBox="0 0 76 76"`.
5. No banned branding in the app surface: for each of `docs/index.html`, `docs/app.js`, `docs/style.css`, `docs/knob-registry.json` and every file in `docs/modules/`, assert the text does not match `/nasuno|suno(?!mic)|humanizer/i`. (Task 1 only writes the test; this assertion is expected to fail until Task 2.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node dom-contract.mjs`
Expected: FAIL — assertion 5 reports `NaSuno` in `index.html`/`app.js`/`style.css` and `Suno` in `analyzer.js`/`dsp.js`. Assertions 1–4 pass against the current markup; if any of them fails now, the extraction is wrong — fix the test, not the app.

- [ ] **Step 3: Commit the failing gate**

```bash
git add dom-contract.mjs
git commit -m "test: pin JS-to-DOM contract before the AI-Maestro restyle"
```

---

### Task 2: Rename identifiers, storage keys and product copy

**Files:**
- Modify: `docs/modules/dsp.js` (class `NaSunoDSP` → `MaestroDSP`, 13 refs), `docs/modules/analyzer.js` (`SunoDetector` → `CarrierDetector`, header comment), `docs/app.js` (imports + 6 `NaSunoDSP` refs + local `suno` variable), `docs/modules/registry.js`, `docs/modules/ui.js`, `docs/modules/storage.js`, `docs/modules/knob.js`, `docs/modules/spectrum.js` (header comments + copy)
- Modify: `docs/knob-registry.json` (description, group titles, `info.defeats` → `info.purpose`, preset display names)
- Modify: `auto-repro.mjs`, `bug-repro.mjs`, `deshimmer-repro.mjs` (import + call sites only)
- Modify: `docs/index.html` (title, meta, JSON-LD only — layout comes in Task 4)
- Modify: `docs/style.css` (header comment ONLY — the full rewrite is Task 3)

**Interfaces:**
- Consumes: `dom-contract.mjs` from Task 1 as the gate.
- Produces: `export class MaestroDSP` from `docs/modules/dsp.js` with every existing static and instance member unchanged (`buildMasterChain`, `renderChain`, `measureRender`, `correctionGainDb`, `applyCorrectionDb`, `exportWAV`, `makeStatCurve`, `makeTextureCurve`, `makeCeilingCurve`). `export class CarrierDetector` from `analyzer.js` with the same `static analyze(mono, sr)` signature and return shape. `registry.compositeKnobs[].info.purpose` replaces `.defeats`.

- [ ] **Step 1: Update the three suites to the new names**

In `auto-repro.mjs`, `bug-repro.mjs`, `deshimmer-repro.mjs`: replace `NaSunoDSP` with `MaestroDSP` in the import statement and every call site. Change nothing else — the frozen assertions listed in Global Constraints stay exactly as they are.

- [ ] **Step 2: Run the suites to verify they fail**

Run: `node bug-repro.mjs`
Expected: FAIL — `SyntaxError: The requested module './docs/modules/dsp.js' does not provide an export named 'MaestroDSP'`.

- [ ] **Step 3: Rename the classes and their call sites**

`dsp.js`: `export class NaSunoDSP` → `export class MaestroDSP`, and all 12 internal `NaSunoDSP.` static references. `analyzer.js`: `export class SunoDetector` → `export class CarrierDetector` plus its internal call in `analyzeFullTrack`; rename the local `suno` variable to `carrier` there and in `app.js`. `app.js`: update both import statements and the 6 `NaSunoDSP.` references. Rewrite the file header comments in all eight modules to name AI-Maestro; delete the `Ported from src/nasuno/...` line in `analyzer.js` rather than renaming it.

Do not touch any DSP constant, node order, filter frequency or gain expression.

- [ ] **Step 4: Rename storage keys with a one-time fallback**

In `docs/modules/storage.js` set `SETTINGS_KEY = 'maestro_settings_v1'` and `DB_NAME = 'MaestroAudioDB'`. Add above them `const LEGACY_SETTINGS_KEY = 'nasuno_engine_settings_v3';` and in `loadSettings()`, when the new key returns nothing, read the legacy key and return that parsed value instead. One `if`, no migration write, no new export. Leave a one-line comment saying why the legacy read exists.

- [ ] **Step 5: Rewrite product copy in the registry and popover**

In `docs/knob-registry.json`: `description` names AI-Maestro; rename the `defeats` key to `purpose` on all 15 knobs and rewrite each value as a plain statement of what the stage does (e.g. carrierErase: "Narrow tonal peaks near 15.5 / 17.5 / 19.5 kHz"). Rewrite every `description` / `howItWorks` / `tradeoff` to match the actual DSP: biquad notches, peaking cuts, all-pass stages, waveshapers, an LFO-modulated delay, multi-tap delays, a compressor and limiters. Delete claims about Mel filterbanks, Benford's Law, Wiener filtering, LPC modelling, QIM lattices, ENF hum, Shazam/ContentID and "turning detectors into coin flips" — none of that is implemented. Group titles: `watermarkErase` → `RESONANCE CLEANUP`, `fingerprintScatter` → `PHASE & TEXTURE`, `naturalization` → `NATURALIZATION` (frozen), `masteringQuality` → `MASTERING`. Preset `name` values → `Off`, `Gentle`, `Standard`, `Deep`, `Full`; keys and all `compositeValues` unchanged. Keep the deshimmer description's two required substrings verbatim.

Group titles live in TWO places and must agree: each knob's `moduleTitle` / `moduleSubtitle` in `knob-registry.json` (15 entries, 4 distinct values) AND the hardcoded `modules[]` array in `docs/modules/registry.js`. Update both to the same strings — `ui.js` builds the popover badge from `knob.moduleTitle` while `registry.js` builds the panel header from its own array, so a one-sided edit makes them disagree. `naturalization`'s `moduleTitle` must stay exactly `NATURALIZATION` (a test pins it).

In `docs/modules/registry.js`: change the `VECTORS` count suffix to `CONTROLS`, and the info-button label from "Vector information" to "About this control". In `docs/modules/ui.js`: read `knob.info.purpose`, change the popover heading `DEFEATS DETECTION VECTOR` → `WHAT IT DOES`, and rewrite `showDspBypassInfo()` body copy to describe A/B between the processed chain and the raw signal without any detection claim (keep the `.popover-section` / `.popover-section-title` / `.popover-highlight` structure and the `badge-orange` class). In `docs/modules/spectrum.js`: the issue name `'Suno HF cutoff / air'` → `'HF cutoff / air'`.

- [ ] **Step 6: Update the page metadata**

In `docs/index.html` replace `<title>`, `description`, `keywords`, `og:*`, `twitter:*` and the JSON-LD block: name AI-Maestro, describe measurement and mastering, drop every watermark-evasion keyword, drop the `author` Person block and the `og:image`/`twitter:image` tags (their target file is deleted in Task 5). Keep `canonical`, `og:url`, `twitter:url` pointing at the Pages base from Global Constraints. Leave the body markup alone.

- [ ] **Step 7: Run all four suites**

Run: `node bug-repro.mjs && node auto-repro.mjs && node deshimmer-repro.mjs && node dom-contract.mjs`
Expected: all PASS. `dom-contract.mjs` assertion 5 now passes for `docs/`; if it still names a file, that file has a missed reference.

- [ ] **Step 8: Commit**

```bash
git add docs auto-repro.mjs bug-repro.mjs deshimmer-repro.mjs
git commit -m "refactor: rename engine to AI-Maestro and rewrite control copy"
```

---

### Task 3: Rebuild the stylesheet

**Files:**
- Modify: `docs/style.css` (full rewrite, ~1279 lines → target under 600)
- Modify: `docs/modules/spectrum.js` (canvas palette only)

**Interfaces:**
- Consumes: the class list asserted by `dom-contract.mjs` (Task 1); the palette in Global Constraints.
- Produces: a stylesheet defining every class in that list, plus `#scopeCanvas { height: … }`. Task 4's markup uses only classes defined here.

- [ ] **Step 1: Write the failing assertion**

Add to `dom-contract.mjs`: assert `style.css` does not match `/box-shadow:[^;]*(glow|rgba\(0, 229, 255)|radial-gradient/i` and does not contain `.daw-background` or `.ambient-glow`; assert it contains `--paper: #f7f6f3`.

- [ ] **Step 2: Run to verify it fails**

Run: `node dom-contract.mjs`
Expected: FAIL — `.daw-background` present, `--paper` absent.

- [ ] **Step 3: Rewrite the stylesheet**

Replace `docs/style.css` wholesale. Define the palette as `:root` tokens with the exact values from Global Constraints. Flat surfaces, 1px `--hairline` borders, 4px radii, no gradients, no `box-shadow`, no `filter: blur`, no `::before` screws. Delete `.daw-background`, `.ambient-glow`, the chassis/screw rules and the dual-mode tab block (dead markup). Keep every class named in the contract test, restyled: knobs become a flat dial with a thin progress arc, `.ring-cyan|green|orange` map to slate/moss/ochre, `.meter-fill` is a solid slate bar and `.alert` brick. Preserve `user-select: none` on controls only, not on `*` — body text must stay selectable. `#scopeCanvas` gets an explicit `width: 100%; height: 180px; display: block` rule (do not rely only on the container for its height — `getBoundingClientRect()` must return non-zero). Keep the two existing breakpoints (960px, 600px) and make the knob grid reflow to 3 then 2 columns.

- [ ] **Step 4: Repaint the canvas**

In `docs/modules/spectrum.js` replace the hardcoded colours in `draw()`: background `#090b0e` → `#ffffff`, grid `#181e26` → `#e2dfd9`, tick text `#4a5362` → `#6f6b64`, the font string → `9px ui-monospace, Menlo, Consolas, monospace`, the original trace cyan `rgba(0, 229, 255, …)` → slate `rgba(47, 72, 88, …)` at the same alphas, the processed trace `#ff7a00` / `rgba(255, 122, 0, …)` → ochre `#8a5a2b` / `rgba(138, 90, 43, …)` at the same alphas. This includes BOTH `createLinearGradient` fill ramps (`rawGrad` and `procGrad`, three `addColorStop` calls each) and the legend swatch strokes near the end of `draw()` — not just the two trace strokes. Delete the `shadowColor`/`shadowBlur` glow lines (reset `shadowBlur = 0` is then unnecessary). Relabel the two legend strings, which appear twice each: `'┄┄ AI ORIGINAL (RAW INPUT)'` → `'┄┄ Original'` and `'── HUMANIZED (OUTPUT)'` → `'── Processed'`. Keep every geometry, scale and dB-tick calculation unchanged.

- [ ] **Step 5: Run the suites**

Run: `node dom-contract.mjs && node auto-repro.mjs && node deshimmer-repro.mjs`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/style.css docs/modules/spectrum.js dom-contract.mjs
git commit -m "style: replace the neon rack stylesheet with a minimal flat theme"
```

---

### Task 4: Rebuild the page layout

**Files:**
- Modify: `docs/index.html` (body rewrite, plus the favicon `href` in the head)
- Modify: `docs/modules/registry.js` (knob markup classes only, if the new grid needs them)
- Create: `docs/assets/mark.svg` (if Task 5 has not run yet — Task 5 keeps it if present)

**Interfaces:**
- Consumes: the stylesheet from Task 3; the ID list from Task 1.
- Produces: markup containing all 53 IDs and every contract class. No JS logic changes.

- [ ] **Step 1: Run the contract test as the pre-check**

Run: `node dom-contract.mjs`
Expected: PASS. This is the baseline the rewrite must not regress.

- [ ] **Step 2: Rewrite the body**

New structure, top to bottom, single column, max-width 1040px, centred, generous whitespace:
1. `<header>` — wordmark "AI-Maestro" as plain text (no logo image), one-line subtitle, preset selector and bypass control on the right. Delete the `.daw-background` / `.ambient-glow` divs and the GitHub icon link's neon styling (keep the link, retarget to the repo base).
2. Transport section — play button, the two demo pills, upload, reset, and the seeker row with both time readouts.
3. `<canvas id="scopeCanvas">` in a bordered surface, with `scopeModeLabel` rewritten to plain wording: "2048-point FFT — slate: original, ochre: processed". This string is ALSO hardcoded in `docs/app.js` at three sites (in the reset-demo handler, the upload handler, and the persisted-audio restore path) with the old neon wording "ORANGE GHOST … CYAN: LIVE EVASION". Replace all three with the same new string, or the JS overwrites the HTML at runtime and the edit does nothing.
4. Measurements — the six metric cards as a flat definition grid, hairline separators instead of card chrome. Keep every metric ID and the `.metric-meter-bar` / `.meter-fill` structure.
5. `<section id="evasionPanel">` — still empty in markup, still populated by `registry.js`.
6. AUTO section — button, progress, target select, `autoIssues`.
7. Footer — export button, status, and the three A/B buttons as quiet text buttons.
8. The popover and backdrop, unchanged in structure.

Every `id` from the current file must appear exactly once. Keep `data-preset` values, `accept="audio/*"` on the upload input, the seeker's `min`/`max`/`step`, and `aria-label`s. Keep `<script type="module" src="app.js?v=10">` (bumped from `v=9` because modules changed) and bump the `?v=` on the `dsp.js` import in `app.js` to match. Remove the Google Fonts `<link>`/`preconnect` tags.

Inline `style=` attributes: remove the purely cosmetic ones (the brand-logo overrides and the neon `color`/`font-weight` spans in the header), but KEEP the four `style="width: 0%;"` initial values on `carrier1Bar`/`carrier2Bar`/`carrier3Bar`/`echoBar` and `style="display: none;"` on `resetDemoBtn`. Those are functional initial state, not decoration: `app.js` writes `.style.width` on the bars and toggles `resetDemoBtn.style.display` between `none` and `inline-flex`. Dropping the reset button's inline `display: none` makes it visible on first load with no uploaded track; give it a CSS default of `display: none` instead if you remove the attribute.

Repoint `<link rel="icon">` from `assets/humanized_knob_logo.svg` to `assets/mark.svg`, creating that file if it does not exist yet: a hand-authored ~15-line monochrome mark (a circle with three vertical bars of differing height), `currentColor`, no text. Task 5 deletes the old logo file and keeps this one.

- [ ] **Step 3: Run the contract test and the suites**

Run: `node dom-contract.mjs && node bug-repro.mjs && node auto-repro.mjs && node deshimmer-repro.mjs`
Expected: all PASS. A missing-ID failure here names the exact element to restore.

- [ ] **Step 4: Verify in a real browser**

Serve `docs/` (`python -m http.server 8123` from `docs/`) and drive it with the Playwright MCP tools: load the page, assert zero console errors, press play on the demo, confirm the canvas has non-zero painted pixels, drag one knob and confirm its readout changes, open one info popover, press AUTO MASTER and confirm issue rows render, then confirm the export button produces a download. Take a screenshot at 1280px and at 390px.
Expected: no console errors, every control responds, no horizontal scroll at 390px.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html docs/app.js docs/modules/registry.js
git commit -m "feat: minimal single-column layout for the AI-Maestro studio"
```

---

### Task 5: Rewrite the docs and remove everything unrelated

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.github/CONTRIBUTING.md`, `.github/SECURITY.md`, `.github/SUPPORT.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/workflows/ci.yml`, `docs/robots.txt`, `docs/sitemap.xml`, `LICENSE`, `.gitignore`
- Create: `docs/assets/mark.svg`, `link-check.mjs`
- Delete: `docs/assets/humanized_knob_banner.png|.svg`, `humanized_knob_banner_large.png|.svg`, `humanized_knob_logo.png|.svg`, `plugin_hero.jpg`, `checkpoint.md`, `docs/AUTO-MODE-PLAN.md`, `docs/REVIEW-FOR-GPT.md`, `docs/superpowers/plans/2026-11-16-auto-spotify.md`, `docs/superpowers/specs/2026-11-16-auto-spotify-design.md`, `docs/superpowers/specs/2026-11-16-deshimmer-auto-design.md`

**Interfaces:**
- Consumes: the new name and URL bases from Global Constraints.
- Produces: `node link-check.mjs`, exit 0 when every relative link and every referenced local asset in tracked `.md`/`.html`/`.yml` files resolves, and no tracked file contains banned branding.

- [ ] **Step 1: Write the failing link/branding check**

Create `link-check.mjs`. Enumerate tracked files with `execFileSync('git', ['ls-files'])`. For each `.md`, `.html`, `.yml`, `.xml`, `.txt` file: extract relative link targets from `](...)` and `(href|src)="..."`, skip anything starting `http`, `#` or `mailto:`, resolve against the file's directory, and assert the path exists. Separately assert no tracked file matches `/nasuno|suno(?!mic)|humanizer|geeknik|AhmadHassan|Turnitout|Fractal-Compute/i` — excluding `LICENSE` (upstream notice is required) and this plan/spec pair, which quote the old names as history.

- [ ] **Step 2: Run to verify it fails**

Run: `node link-check.mjs`
Expected: FAIL — `.github/SUPPORT.md` references `../docs/architecture.md`, `../docs/api-reference.md`, `../docs/deployment.md`, `../docs/research/forensic-taxonomy.md`, none of which exist; branding hits across `.github/` and `CHANGELOG.md`.

- [ ] **Step 3: Delete the unrelated files and assets**

`git rm` every path in the Delete list above. The three old superpowers specs/plans, `checkpoint.md`, `AUTO-MODE-PLAN.md` and `REVIEW-FOR-GPT.md` are working notes for the upstream fork, not documentation for this app. `docs/assets/mark.svg` is created by Task 4 and referenced by the favicon — keep it if it exists; only author it if absent (a hand-authored ~15-line monochrome mark: a circle with three vertical bars of differing height, `currentColor`, no text).

- [ ] **Step 4: Rewrite README.md**

Write it fresh against the code, not the old text. Sections: what it is (one paragraph, browser-only, no build); what it measures (the real metric list from `analyzer.js`); AUTO mastering (detect → clean → master → export, reduction-only trim, live/export parity); the 15 controls table with the new group names and honest one-line descriptions; run instructions (`cd docs && python -m http.server 8123`); tests (the four `node *.mjs` commands plus `link-check.mjs`); architecture (the module list with `MaestroDSP` / `CarrierDetector`); known limits. Drop the "Verified results" table — those numbers came from tracks that are not in the repo and cannot be reproduced by a reader. Drop the "Based on the NaSuno project" line; the `LICENSE` notice carries attribution. Use the new `mark.svg`, and keep only badges whose targets exist: the two workflow badges for this repo and the MIT badge. Link the new spec at `docs/superpowers/specs/2026-11-20-ai-maestro-rebrand-design.md`.

- [ ] **Step 5: Rewrite the community files**

`CONTRIBUTING.md`: Node 20+, clone/fork, `python -m http.server` from `docs/`, run the four suites, conventional commits, the one architectural rule that matters (any new DSP stage goes into `buildMasterChain` so live and export stay identical). Delete all Python/pytest/Docker/Protocol content. `SECURITY.md`: supported version 1.x only; report via GitHub Security Advisories on this repo (delete the `security@nasuno.org` address); threat model rewritten for a client-side app — untrusted audio decoded by the browser, no server, no uploads, no `eval`, output clamped. `SUPPORT.md`: point at `README.md` and the spec, remove all four dead doc links and the non-existent FAQ anchor, fix the issue-template paths to `ISSUE_TEMPLATE/...` relative to `.github/`. `PULL_REQUEST_TEMPLATE.md`: replace the Python checklist with "all four suites pass", "no new dependencies", "new DSP stage present in the shared chain". Both issue templates: browser/OS fields instead of Python version, and reproduction steps that use the UI instead of a `nasuno clean` command. `config.yml`: retarget discussions and security URLs to the repo base. `CODE_OF_CONDUCT.md`: keep the Contributor Covenant text, replace the enforcement contact with GitHub Security Advisories on this repo.

- [ ] **Step 6: Rewrite CHANGELOG, LICENSE, gitignore, SEO files**

`CHANGELOG.md`: delete the 2.0.0 and 1.0.0 Python entries entirely; one `[1.0.0] - 2026-11-20` entry describing this app, with a note that knob settings carry over from the previous build but uploaded audio must be re-added. `LICENSE`: keep `Copyright (c) 2025 geeknik` and add a second line `Copyright (c) 2026 AI-Maestro contributors` — MIT requires the upstream notice, so this line is deliberately exempt from the branding check. `.gitignore`: delete the Python blocks (`__pycache__`, `.venv`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `*.egg-info`, etc.), keep the audio ignores and `!docs/audio/**`, add `.claude/` and `.playwright-mcp/`. `docs/robots.txt` and `docs/sitemap.xml`: retarget to the Pages base, collapse the sitemap to the single canonical URL, set `lastmod` to `2026-11-20`.

- [ ] **Step 7: Fix CI**

In `.github/workflows/ci.yml` replace the "Verify Documentation & Public Assets" step's assertions on `docs/architecture.md` and the two `docs/research/*.md` files (they do not exist — this is why CI is red) with `test -f docs/index.html`, `test -f docs/sitemap.xml`, `test -f README.md`. Add a `actions/setup-node@v4` step with `node-version: 20` and a step running all five suites: `node bug-repro.mjs`, `node auto-repro.mjs`, `node deshimmer-repro.mjs`, `node dom-contract.mjs`, `node link-check.mjs`. Keep the existing registry JSON validation and the BOM on line 1 as-is. Leave `pages.yml` alone — it already deploys `./docs` correctly.

- [ ] **Step 8: Run the checks**

Run: `node link-check.mjs && node dom-contract.mjs && node bug-repro.mjs && node auto-repro.mjs && node deshimmer-repro.mjs`
Expected: all PASS, zero missing links, zero branding hits outside the exempt files.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs: rewrite all documentation for AI-Maestro and remove fork leftovers"
```

---

### Task 6: Whole-repo verification

**Files:**
- Modify: nothing expected; fix only what verification turns up.

- [ ] **Step 1: Grep the whole tracked tree for leftovers**

Run: `git ls-files -z | xargs -0 grep -inE 'nasuno|humanizer|suno|geeknik|AhmadHassan|Fractal-Compute|Turnitout'`
Expected: hits only in `LICENSE` (upstream copyright) and the 2026-11-20 spec/plan pair. Anything else is a miss — fix it.

- [ ] **Step 2: Confirm no orphaned references to deleted files**

Run: `git ls-files -z | xargs -0 grep -nE 'humanized_knob|plugin_hero|architecture\.md|api-reference\.md|deployment\.md|forensic-taxonomy|psychoacoustics-reference|AUTO-MODE-PLAN|REVIEW-FOR-GPT|checkpoint\.md|2026-11-16'`
Expected: no output.

- [ ] **Step 3: Re-run the browser pass on the final tree**

Serve `docs/` and repeat Task 4 Step 4 end to end, including a knob drag, an AUTO run and a WAV export. Confirm the exported file is named `<track>.auto-master.wav` and that the page shows no console errors.

- [ ] **Step 4: Report**

State plainly what passed, what was skipped, and the two things a reader must know: the repo slug `ai-maestro` is assumed (GitHub-side rename and remote updates are not done here), and uploaded audio must be re-added once after this upgrade.
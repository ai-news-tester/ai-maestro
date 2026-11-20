// JS<->DOM contract gate — assert-based, same style as auto-repro.mjs.
// Run: node dom-contract.mjs   (exit 0 = contract intact)
// Pins the finite set of IDs/classes the JS reaches for, so a visual rewrite
// cannot silently drop a control. All checks run before the process exits.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const html = read('./docs/index.html');
const css = stripComments(read('./docs/style.css'));
const registrySrc = read('./docs/modules/registry.js');
const LOOKUP_FILES = ['docs/app.js', 'docs/modules/ui.js', 'docs/modules/registry.js'];

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`${name}: PASS`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`${name}: FAIL\n  ${err.message.split('\n').join('\n  ')}`);
  }
}

// ---- 1. Every getElementById lookup resolves to an id in index.html ----
check('1 ID contract', () => {
  const ids = new Set();
  for (const file of LOOKUP_FILES) {
    for (const m of read(`./${file}`).matchAll(/getElementById\('([^']+)'\)/g)) ids.add(m[1]);
  }
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.equal(missing.length, 0,
    `docs/index.html is missing ${missing.length} id(s) the JS looks up: ${missing.join(', ')}`);
  assert.ok(ids.size >= 53,
    `ID contract shrank: ${ids.size} unique getElementById lookups across ${LOOKUP_FILES.join(', ')}, expected >= 53. ` +
    'A lookup was deleted — restore it or update this floor deliberately.');
  console.log(`  ${ids.size} unique IDs, all present in index.html`);
});

// ---- 2. Every class the JS writes at runtime is styled ----
check('2 runtime + registry classes are styled', () => {
  const runtimeClasses = [
    'meter-fill', 'alert', 'playing', 'active', 'bypassed', 'open',
    'auto-issue-row', 'auto-issue-name', 'auto-issue-where', 'auto-issue-bar',
    'auto-issue-bar-fill', 'auto-issue-val', 'auto-issue-slider', 'auto-issue-manual',
    'popover-badge', 'badge-cyan', 'badge-green', 'badge-orange',
    'popover-section', 'popover-section-title', 'popover-highlight',
  ];
  const registryClasses = [
    'rack-module-card', 'module-header', 'module-title-wrap', 'module-pill',
    'module-desc', 'module-count', 'module-knobs-grid', 'knob-col',
    'knob-label-row', 'knob-label', 'info-btn', 'fl-knob-wrapper',
    'knob-ring-svg', 'ring-bg', 'ring-active', 'knob-rotor', 'rotor-cap',
    'rotor-pointer', 'knob-readout-row', 'knob-readout',
    ...['border', 'pill', 'ring'].flatMap((p) => ['cyan', 'green', 'orange'].map((c) => `${p}-${c}`)),
  ];
  const all = [...runtimeClasses, ...registryClasses];
  // Boundary-aware: `.knob-label` must not be satisfied by `.knob-label-row`,
  // several pinned classes are prefixes of others.
  const styled = (c) => new RegExp(`\\.${c}(?![\\w-])`).test(css);
  const missing = all.filter((c) => !styled(c));
  assert.equal(missing.length, 0,
    `docs/style.css has no rule for ${missing.length} class(es) the JS writes: ` +
    missing.map((c) => `.${c}`).join(', '));
  console.log(`  ${all.length} classes styled`);
});

// ---- 3. The scope canvas exists and has a non-zero height ----
check('3 scopeCanvas has height', () => {
  assert.ok(html.includes('id="scopeCanvas"'), 'docs/index.html is missing id="scopeCanvas"');
  // A height of 0 / 0px / 0% collapses the canvas; anything else is usable.
  const nonZeroHeight = (body) => [...body.matchAll(/(?:^|;)\s*height\s*:\s*([^;}]+)/g)]
    .some((m) => !/^0(?:\.0+)?(?:px|%|em|rem|vh|vw)?$/.test(m[1].trim()));
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  // Either an explicit #scopeCanvas rule, or a descendant `canvas` type selector
  // (the current sheet uses .scope-display-container canvas { height: 100% }).
  const explicit = rules.filter(([, sel, body]) => sel.includes('#scopeCanvas') && nonZeroHeight(body));
  const descendant = rules.filter(([, sel, body]) =>
    /(?:^|[\s>+~,(])canvas(?![\w-])/.test(sel.trim()) && nonZeroHeight(body));
  assert.ok(explicit.length > 0 || descendant.length > 0,
    'docs/style.css gives the scope canvas no non-zero height. Add either ' +
    '#scopeCanvas { height: <non-zero> } or a descendant rule such as ' +
    '.scope-display-container canvas { height: 100% } with a sized container.');
  const via = explicit.length ? `#scopeCanvas (${explicit.length} rule(s))` : `descendant canvas (${descendant.length} rule(s))`;
  console.log(`  height supplied by ${via}`);
});

// ---- 4. The knob SVG template keeps its rotor, active ring and viewBox ----
check('4 knob template markers', () => {
  for (const marker of ['class="knob-rotor"', 'class="ring-active', 'viewBox="0 0 76 76"']) {
    assert.ok(registrySrc.includes(marker),
      `docs/modules/registry.js knob template lost \`${marker}\` — FLKnob queries it to render/rotate the knob.`);
  }
});

// ---- 5. No banned branding left on the app surface ----
// RED until the AI-Maestro rebrand lands: NaSuno/Suno/Humanizer are still present.
check('5 no banned branding', () => {
  const BANNED = /nasuno|suno(?!mic)|humanizer/i;
  const targets = [
    'docs/index.html', 'docs/app.js', 'docs/style.css', 'docs/knob-registry.json',
    ...readdirSync(new URL('./docs/modules/', import.meta.url)).map((f) => `docs/modules/${f}`),
  ];
  const hits = [];
  for (const file of targets) {
    const lines = read(`./${file}`).split('\n');
    const found = [];
    lines.forEach((line, i) => {
      for (const m of line.matchAll(new RegExp(BANNED.source, 'gi'))) found.push(`${m[0]}@L${i + 1}`);
    });
    if (found.length) hits.push(`${file} (${found.length}): ${found.join(', ')}`);
  }
  assert.equal(hits.length, 0,
    `banned branding /nasuno|suno(?!mic)|humanizer/i still present in ${hits.length} file(s):\n` +
    hits.join('\n'));
  console.log(`  ${targets.length} files clean`);
});

if (failures.length) {
  console.log(`\nCONTRACT FAIL (${failures.length} of 5):`);
  failures.forEach((f) => console.log(`- ${f.split('\n')[0]}`));
  process.exitCode = 1;
} else {
  console.log('\nCONTRACT PASS (5 of 5)');
}
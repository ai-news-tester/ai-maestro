// Link and branding gate, assert-based, same style as dom-contract.mjs.
// Run: node link-check.mjs (exit 0 = every relative link resolves, no banned branding)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const NL = String.fromCharCode(10);
const tracked = execFileSync('git', ['ls-files'], { cwd: rootDir, encoding: 'utf8' }).split(NL).map((s) => s.trim()).filter(Boolean);
const trackedSet = new Set(tracked.map((f) => f.split('\\').join('/')));
const read = (file) => readFileSync(join(rootDir, file), 'utf8');

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(name + ': PASS');
  } catch (err) {
    failures.push(name + ': ' + err.message);
    console.log(name + ': FAIL');
    console.log('  ' + err.message.split(NL).join(NL + '  '));
  }
}

// ---- 1. Relative links and referenced local assets resolve ----
check('1 relative links resolve', () => {
  const LINK_EXTS = new Set(['.md', '.html', '.yml', '.yaml', '.xml', '.txt']);
  const patterns = [/\]\(([^)]+)\)/g, /(?:href|src)\s*=\s*["']([^"']+)["']/g];
  const missing = [];
  let checked = 0;
  for (const file of tracked) {
    if (!LINK_EXTS.has(extname(file).toLowerCase())) continue;
    // Code is not links: fenced blocks and inline spans routinely contain
    // `](...)` examples and src="..." snippets that are not real references.
    const text = read(file)
      .replace(/^```[\s\S]*?^```/gm, '')
      .replace(/`[^`\n]*`/g, '');
    for (const pattern of patterns) {
      for (const m of text.matchAll(pattern)) {
        let target = m[1].trim().split(/\s+/)[0].replace(/^<|>$/g, '');
        if (!target || target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:') || target.startsWith('data:') || target.startsWith('//')) continue;
        const clean = target.split('#')[0].split('?')[0];
        if (!clean) continue;
        let decoded = clean;
        try { decoded = decodeURIComponent(clean); } catch {}
        checked++;
        const resolved = normalize(join(dirname(file), decoded)).split('\\').join('/');
        // A target that exists locally but is untracked would 404 on GitHub.
        if (!existsSync(join(rootDir, resolved))) missing.push(file + ' -> ' + target + ' (missing on disk)');
        else if (!trackedSet.has(resolved)) missing.push(file + ' -> ' + target + ' (exists but UNTRACKED — would 404 on GitHub)');
      }
    }
  }
  assert.equal(missing.length, 0, missing.length + ' relative link(s) do not resolve:' + NL + missing.join(NL));
  console.log('  ' + checked + ' relative links checked');
});

// ---- 2. No banned branding in tracked files ----
check('2 no banned branding', () => {
  const BANNED = /nasuno|suno(?!mic)|humanizer|geeknik|Turnitout|Fractal-Compute/gi;
  const TEXT_EXTS = new Set(['.md', '.html', '.yml', '.yaml', '.xml', '.txt', '.js', '.mjs', '.css', '.json', '.svg']);
  // LICENSE keeps the upstream MIT notice.
  // link-check.mjs and dom-contract.mjs must name the banned pattern to detect it.
  const EXEMPT = new Set(['LICENSE', 'link-check.mjs', 'dom-contract.mjs']);
  // One legacy storage key must stay byte-exact so saved settings still load; only that exact line is exempt.
  const LEGACY_LINES = new Map([
    ['docs/modules/storage.js', /^const LEGACY_SETTINGS_KEY = 'nasuno_engine_settings_v3';\s*$/],
    ['bug-repro.mjs', /^const LEGACY = 'nasuno_engine_settings_v3';\s*$/],
  ]);
  const hits = [];
  for (const file of tracked) {
    if (EXEMPT.has(file) || !TEXT_EXTS.has(extname(file).toLowerCase())) continue;
    const legacy = LEGACY_LINES.get(file);
    read(file).split(NL).forEach((line, i) => {
      if (legacy && legacy.test(line)) return;
      for (const m of line.matchAll(BANNED)) hits.push(file + ': ' + m[0] + ' at L' + (i + 1));
    });
  }
  assert.equal(hits.length, 0, 'banned branding in ' + hits.length + ' place(s):' + NL + hits.join(NL));
  console.log('  ' + tracked.length + ' tracked files scanned');
});

// ---- 3. Every module a tracked JS file references is tracked ----
// Same failure mode as check 1, other syntax: an untracked module loads fine
// locally but 404s on Pages. The Worker behind full-track analysis shipped that
// way — the catch silently fell back to a 5 s main-thread freeze.
check('3 JS module references resolve', () => {
  const patterns = [
    /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
    /(?:^|\s)from\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const missing = [];
  let checked = 0;
  for (const file of tracked) {
    // The deployed surface only: Pages serves docs/, and the root test scripts
    // quote module paths inside source-inspection assertions, which are not references.
    if (!file.startsWith('docs/') || !['.js', '.mjs'].includes(extname(file).toLowerCase())) continue;
    for (const pattern of patterns) {
      for (const m of read(file).matchAll(pattern)) {
        const target = m[1].trim();
        // Relative specifiers only: bare and scheme'd ones are Node builtins or packages.
        if (!target.startsWith('./') && !target.startsWith('../')) continue;
        if (target.endsWith('/')) continue; // a directory handed to readdirSync, not a module
        const clean = target.split('?')[0]; // ?v=N cache-bust queries are not part of the path
        if (!clean) continue;
        checked++;
        const resolved = normalize(join(dirname(file), clean)).split('\\').join('/');
        if (!existsSync(join(rootDir, resolved))) missing.push(file + ' -> ' + target + ' (missing on disk)');
        else if (!trackedSet.has(resolved)) missing.push(file + ' -> ' + target + ' (exists but UNTRACKED — would 404 on Pages)');
      }
    }
  }
  assert.ok(checked > 0, 'no module references were checked — the scan matched nothing, so the gate is inert');
  assert.equal(missing.length, 0, missing.length + ' module reference(s) do not resolve:' + NL + missing.join(NL));
  console.log('  ' + checked + ' module references checked');
});

if (failures.length) {
  console.log(NL + 'LINK CHECK FAIL (' + failures.length + ' of 3):');
  failures.forEach((f) => console.log('- ' + f.split(NL)[0]));
  process.exitCode = 1;
} else {
  console.log(NL + 'LINK CHECK PASS (3 of 3)');
}

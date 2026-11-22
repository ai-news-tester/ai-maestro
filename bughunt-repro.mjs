// Bughunt regression tests - fixes 4, 6, 7, 8, 10, 12.
// Run: node bughunt-repro.mjs
import assert from 'node:assert/strict';

// --- 6. HTML escaping ---
const { escapeHtml } = await import('./docs/modules/registry.js');
assert.equal(typeof escapeHtml, 'function', 'registry must export escapeHtml');
assert.equal(escapeHtml('a"b<c>&d'), 'a&quot;b&lt;c&gt;&amp;d');

// --- 7 & 8. Knob window listeners ---
const windowListeners = [];
globalThis.window = {
  addEventListener(type, cb, opts) { windowListeners.push({ type, cb, opts }); },
};
globalThis.document = { body: { style: {} } };
// One fake element per knob, each keeping its own listeners.
const makeFakeEl = () => ({
  listeners: {},
  querySelector() { return null; },
  addEventListener(type, cb, opts) { this.listeners[type] = { cb, opts }; },
  setAttribute() {},
  style: {},
});
const { FLKnob } = await import('./docs/modules/knob.js');
const knobs = [];
for (let i = 0; i < 15; i++) {
  knobs.push(new FLKnob(makeFakeEl(), { knobId: 'k' + i, min: 0, max: 100, step: 1, default: 50, val: 50, unit: '%' }));
}
const winMove = windowListeners.filter((l) => l.type === 'mousemove');
assert.ok(winMove.length <= 4, '15 knobs must not add 15 mousemove listeners, got ' + winMove.length);
assert.equal(windowListeners.filter((l) => l.type === 'touchmove').length, 0, 'touchmove must not be a window listener');
const touchMove = knobs[0].el.listeners['touchmove'];
assert.ok(touchMove && touchMove.opts && touchMove.opts.passive === false, 'knob touchmove must be non-passive');
let prevented = false;
knobs[0].onStart(100);
touchMove.cb({ touches: [{ clientY: 90 }], preventDefault() { prevented = true; } });
assert.ok(prevented, 'touchmove must preventDefault while dragging');
assert.ok(knobs[0].val > 50, 'touch drag must raise the value');
knobs[0].onEnd();
knobs[0].val = 50; // reset so later assertions start from 50

// Shared handlers must route only to the active knob.
const mouseMove = winMove[0].cb;
knobs[0].onStart(100);
knobs[3].onStart(100); // last grab wins
mouseMove({ clientY: 80, shiftKey: false });
assert.notEqual(knobs[3].val, 50, 'active knob must receive the move');
assert.equal(knobs[0].val, 50, 'inactive knob must not move');
windowListeners.filter((l) => l.type === 'mouseup')[0].cb();
assert.equal(FLKnob._active, null, 'mouseup must clear the active knob');

// --- 4. IndexedDB transaction completion ---
let closes = 0;
let putSuccessCb = null, txCompleteCb = null, txAbortCb = null;
// IDBRequest: both setter and getter, because _runTx probes req.onsuccess.
const fakeRequest = (capture, result) => {
  const req = { result, onsuccess: null, onerror: null };
  return new Proxy(req, {
    set(target, prop, value) { target[prop] = value; if (prop === 'onsuccess' && capture) capture(value); return true; },
  });
};
const fakeDb = {
  close() { closes++; },
  transaction() {
    const tx = {
      error: null, oncomplete: null, onabort: null, onerror: null,
      objectStore() {
        return {
          put() { return fakeRequest((cb) => { putSuccessCb = cb; }, undefined); },
          get() { return fakeRequest(null, { data: new ArrayBuffer(4), fileName: 'x.wav' }); },
          delete() { return fakeRequest(null, undefined); },
        };
      },
    };
    return new Proxy(tx, {
      set(target, prop, value) {
        target[prop] = value;
        if (prop === 'oncomplete') txCompleteCb = value;
        if (prop === 'onabort') txAbortCb = value;
        return true;
      },
    });
  },
};
const fakeIDB = {
  open() {
    const req = { result: fakeDb, onupgradeneeded: null, onerror: null };
    return new Proxy(req, {
      set(target, prop, value) { target[prop] = value; if (prop === 'onsuccess') value(); return true; },
    });
  },
};
globalThis.indexedDB = fakeIDB;
globalThis.window.indexedDB = fakeIDB;
const { PersistenceManager } = await import('./docs/modules/storage.js');
let saved = false;
const saveP = PersistenceManager.saveUploadedAudio(new ArrayBuffer(8), 'x.wav').then((v) => { saved = v; });
await new Promise((r) => setTimeout(r, 10));
assert.equal(typeof putSuccessCb, 'function', 'put request must have an onsuccess handler');
putSuccessCb();
await new Promise((r) => setTimeout(r, 10));
assert.equal(saved, false, 'save must not resolve on put success alone');
txCompleteCb();
await saveP;
assert.equal(saved, true, 'save must resolve on tx.oncomplete');
assert.ok(closes >= 1, 'db must be closed after transaction');

// Abort must reject (save returns false) and still close the connection.
const closesBeforeAbort = closes;
let aborted = 'pending';
const abortP = PersistenceManager.saveUploadedAudio(new ArrayBuffer(8), 'y.wav').then((v) => { aborted = v; });
await new Promise((r) => setTimeout(r, 10));
txAbortCb();
await abortP;
assert.equal(aborted, false, 'aborted transaction must not report success');
assert.ok(closes > closesBeforeAbort, 'db must be closed after abort');

// --- 10. Slider ranges come from the registry, not a second table ---
const { readFileSync } = await import('node:fs');
const spectrumSrc = readFileSync(new URL('./docs/modules/spectrum.js', import.meta.url), 'utf8');
assert.ok(!spectrumSrc.includes('AUTO_RANGES'), 'AUTO_RANGES must be deleted');
const { buildAutoIssues } = await import('./docs/modules/spectrum.js');
const regJson = JSON.parse(readFileSync(new URL('./docs/knob-registry.json', import.meta.url), 'utf8'));
const issues10 = buildAutoIssues(
  { integratedLUFS: -20, truePeakDBTP: -0.2, clippingCount: 5, carriers: [{ freqHz: 15500, prominenceDB: 6 }], echoConfidence: 0, duration: 10 },
  { outputGain: -3, qualityGate: 4.5, targetLUFS: -14 }, {}, -14, regJson);
const loud10 = issues10.find((i) => i.id === 'loudness');
assert.ok(loud10, 'loudness issue present');
assert.deepEqual([loud10.sliderMin, loud10.sliderMax, loud10.sliderStep], [-12, 6, 0.5], 'outputGain slider range must match the registry');
const clip10 = issues10.find((i) => i.id === 'clipping');
assert.deepEqual([clip10.sliderMin, clip10.sliderMax, clip10.sliderStep], [1, 6, 0.1], 'qualityGate slider range must match the registry');
// No registry passed: safe fallback range, not a crash.
const fallback10 = buildAutoIssues({ integratedLUFS: -20, duration: 10 }, {}, {}, -14, null);
assert.ok(fallback10.length >= 1 && Number.isFinite(fallback10[0].sliderMax), 'fallback range without registry');

// --- 12. Spectrum theme cache ---
assert.ok(spectrumSrc.includes('themeKey') || spectrumSrc.includes('cachedTheme'), 'theme colours must be cached');
let gcsCalls = 0;
const realGCS = globalThis.getComputedStyle;
globalThis.getComputedStyle = () => { gcsCalls++; return { getPropertyValue: () => '#123456' }; };
globalThis.document = { documentElement: { dataset: { theme: 'night' } } };
const { SpectrumRenderer } = await import('./docs/modules/spectrum.js');
const fakeCtx = {
  scale() {}, save() {}, restore() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
  stroke() {}, fill() {}, fillText() {}, measureText: () => ({ width: 10 }), setLineDash() {},
  createLinearGradient: () => ({ addColorStop() {} }),
};
const canvas = { getContext: () => fakeCtx, getBoundingClientRect: () => ({ width: 100, height: 50 }) };
const renderer = new SpectrumRenderer(canvas, {
  getDSP: () => null, getAudioCtx: () => null, getIsPlaying: () => false,
});
renderer.draw();
renderer.draw();
assert.equal(gcsCalls, 1, 'two draws in one theme must read computed style once, got ' + gcsCalls);
globalThis.document = { documentElement: { dataset: { theme: 'day' } } };
renderer.draw();
assert.equal(gcsCalls, 2, 'theme change must re-read once, got ' + gcsCalls);
globalThis.getComputedStyle = realGCS;

console.log('bughunt-repro: PASS');

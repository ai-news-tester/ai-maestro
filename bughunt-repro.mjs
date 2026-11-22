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

// --- 13. Loudness-matched A/B ---
const { MaestroDSP } = await import('./docs/modules/dsp.js');
const { SpectralAnalyzer } = await import('./docs/modules/analyzer.js');
assert.equal(typeof MaestroDSP.auditionGains, 'function', 'dsp must expose auditionGains');
const dbToLin = (db) => Math.pow(10, db / 20);
// A master 6 LU louder than the original must not win the A/B by being louder.
const g13 = MaestroDSP.auditionGains(
  { integratedLUFS: -20, truePeakDBTP: -6 },
  { integratedLUFS: -14, truePeakDBTP: -1 });
assert.ok(Number.isFinite(g13.dry) && Number.isFinite(g13.wet), 'audition gains must be finite');
const dryLUFS = -20 + 20 * Math.log10(g13.dry);
const wetLUFS = -14 + 20 * Math.log10(g13.wet);
assert.ok(Math.abs(dryLUFS - wetLUFS) < 0.001, 'A and B must be loudness-matched, got ' + dryLUFS + ' vs ' + wetLUFS);
assert.ok(-1 + 20 * Math.log10(g13.wet) <= -0.999, 'monitor must keep the master under -1 dBTP');
assert.ok(-6 + 20 * Math.log10(g13.dry) <= -0.999, 'monitor must keep the lifted original under -1 dBTP');
// Quiet master: the original is pulled down, never pushed above unity.
const g13b = MaestroDSP.auditionGains(
  { integratedLUFS: -14, truePeakDBTP: -1 },
  { integratedLUFS: -20, truePeakDBTP: -7 });
assert.ok(g13b.dry <= 1.0000001 && g13b.wet <= 1.0000001, 'audition must never boost above unity');
assert.ok(Math.abs((-14 + 20 * Math.log10(g13b.dry)) - (-20 + 20 * Math.log10(g13b.wet))) < 0.001, 'quiet master still matched');
// Missing measurements: unity, no crash, no NaN.
const g13c = MaestroDSP.auditionGains({ integratedLUFS: -Infinity, truePeakDBTP: -Infinity }, { integratedLUFS: -14, truePeakDBTP: -1 });
assert.equal(g13c.dry, 1, 'unmeasured original falls back to unity dry');
assert.equal(g13c.wet, 1, 'unmeasured original falls back to unity wet');

// --- 13b. Live A/B playback uses the audition gains ---
const mkParam = () => { const o = { v: 0 }; o.setValueAtTime = (v) => { o.v = v; }; o.setTargetAtTime = (v) => { o.v = v; }; return o; };
const fakeCtx13 = { currentTime: 0, createGain: () => ({ gain: mkParam(), connect() {}, disconnect() {} }) };
const dsp13 = new MaestroDSP();
dsp13.ctx = fakeCtx13;
dsp13.wetGain = fakeCtx13.createGain();
dsp13.dryGain = fakeCtx13.createGain();
dsp13.setAudition(g13);
dsp13.setBypass(false);
assert.ok(Math.abs(dsp13.wetGain.gain.v - g13.wet) < 1e-9, 'engaged playback must use the audition wet gain, got ' + dsp13.wetGain.gain.v);
dsp13.setBypass(true);
assert.ok(Math.abs(dsp13.dryGain.gain.v - g13.dry) < 1e-9, 'bypass must use the audition dry gain, got ' + dsp13.dryGain.gain.v);
// An audition set mid-playback must take effect immediately, not at the next toggle.
dsp13.setBypass(false);
dsp13.setAudition({ dry: 0.5, wet: 0.25 });
assert.equal(dsp13.wetGain.gain.v, 0.25, 'setAudition must re-apply while engaged');
// Without an audition the A/B stays exactly as it was: unity.
const dsp13b = new MaestroDSP();
dsp13b.ctx = fakeCtx13;
dsp13b.wetGain = fakeCtx13.createGain();
dsp13b.dryGain = fakeCtx13.createGain();
dsp13b.setBypass(false);
assert.equal(dsp13b.wetGain.gain.v, 1, 'without an audition the wet path stays unity');
dsp13b.setBypass(true);
assert.equal(dsp13b.dryGain.gain.v, 1, 'without an audition the dry path stays unity');
// Junk input must not poison the gains.
dsp13b.setAudition({ dry: NaN, wet: 2 });
dsp13b.setBypass(false);
assert.equal(dsp13b.wetGain.gain.v, 1, 'non-finite audition falls back to unity');
// app.js must feed the monitor from the AUTO measurement and clear it per track.
const appSrc13 = readFileSync(new URL('./docs/app.js', import.meta.url), 'utf8');
assert.ok(appSrc13.includes('auditionGains'), 'app.js must compute audition gains');
assert.ok(appSrc13.includes('setAudition'), 'app.js must feed them to the live chain');
assert.ok(/setAudition\(null\)/.test(appSrc13), 'AUTO state must be cleared for a new track or preset');
// Every place that re-pushes persisted AUTO chain params must also restore the
// audition, or a reload silently reverts BYPASS to an unmatched unity A/B.
const restoreBlocks13 = appSrc13.split('autoTrimDb: autoParams.autoTrimDb || 0,').slice(1);
assert.equal(restoreBlocks13.length, 2, 'expected two AUTO restore sites, got ' + restoreBlocks13.length);
for (const [i, block] of restoreBlocks13.entries()) {
  assert.ok(block.slice(0, 400).includes('setAudition'), 'AUTO restore site ' + (i + 1) + ' must restore the audition gains');
}

// --- 14. Export re-verifies true peak after the clamp ---
const SR14 = 44100;
const mkBuf = (chans, sr) => ({
  numberOfChannels: chans.length, length: chans[0].length, sampleRate: sr,
  getChannelData: (c) => chans[c],
});
// Clamping a hot signal creates inter-sample overs the sample peak cannot see.
const hot = new Float32Array(SR14);
for (let i = 0; i < hot.length; i++) hot[i] = 1.6 * Math.sin((2 * Math.PI * 11025 * i) / SR14 + Math.PI / 4);
const hotBuf = mkBuf([hot, Float32Array.from(hot)], SR14);
MaestroDSP.applyCorrectionDb(hotBuf, -3);
const tpAfter = SpectralAnalyzer.measureTruePeak(hotBuf.getChannelData(0), SR14);
assert.ok(tpAfter <= -1.0, 'applyCorrectionDb must leave true peak at or under -1 dBTP, got ' + tpAfter);
assert.ok(Math.abs(hotBuf.getChannelData(0)[100]) <= dbToLin(-1) + 1e-6, 'sample peak still respects the ceiling');
// A signal already under the ceiling is left alone.
const calm = new Float32Array(2048);
for (let i = 0; i < calm.length; i++) calm[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / SR14);
const calmCopy = Float32Array.from(calm);
MaestroDSP.applyCorrectionDb(mkBuf([calm], SR14), -6);
assert.ok(Math.abs(calm[100] - calmCopy[100] * dbToLin(-6)) < 1e-6, 'quiet signal is scaled, not reshaped');

// --- 15. Audition must account for the chain's own calibrated trim ---
// The live wet path runs through trimGain (autoTrimDb), so matching against the
// pre-trim render leaves the A/B mismatched by exactly the trim.
const g15 = MaestroDSP.auditionGains(
  { integratedLUFS: -20, truePeakDBTP: -6 },
  { integratedLUFS: -12, truePeakDBTP: 0 },
  -2);
const g15ref = MaestroDSP.auditionGains(
  { integratedLUFS: -20, truePeakDBTP: -6 },
  { integratedLUFS: -14, truePeakDBTP: -2 });
assert.ok(Math.abs(g15.dry - g15ref.dry) < 1e-12 && Math.abs(g15.wet - g15ref.wet) < 1e-12,
  'trim must shift the master before matching');
const g15b = MaestroDSP.auditionGains({ integratedLUFS: -20, truePeakDBTP: -6 }, { integratedLUFS: -14, truePeakDBTP: -1 });
const g15c = MaestroDSP.auditionGains({ integratedLUFS: -20, truePeakDBTP: -6 }, { integratedLUFS: -14, truePeakDBTP: -1 }, 0);
assert.deepEqual(g15b, g15c, 'zero trim must not change the match');
// Junk trim must not poison the match.
assert.deepEqual(MaestroDSP.auditionGains({ integratedLUFS: -20, truePeakDBTP: -6 }, { integratedLUFS: -14, truePeakDBTP: -1 }, NaN), g15b, 'NaN trim is ignored');
assert.ok(/auditionGains\([^)]*autoTrimDb/s.test(appSrc13), 'app.js must feed the calibrated trim to auditionGains');

console.log('bughunt-repro: PASS');

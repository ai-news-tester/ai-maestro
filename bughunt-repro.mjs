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

// --- 6b. Overlapping transactions must not share a result slot ---
// _runTx used to park the request result on this._txResult, so an upload save
// completing between a boot load's get-success and its tx.oncomplete resolved
// the load with the save's (undefined) result and dropped the restored track.
{
  const pending = [];
  const trackingDb = {
    close() {},
    transaction(_storeName, mode) {
      const rec = { mode, result: undefined, req: null, tx: null };
      const store = {
        put() {
          const req = { result: undefined, onsuccess: null, onerror: null };
          rec.req = req;
          return req;
        },
        get() {
          const req = { result: { data: new ArrayBuffer(4), fileName: 'boot.wav' }, onsuccess: null, onerror: null };
          rec.req = req;
          return req;
        },
      };
      const tx = { error: null, oncomplete: null, onabort: null, onerror: null, objectStore: () => store };
      rec.tx = tx;
      pending.push(rec);
      return tx;
    },
  };
  const trackingIDB = {
    open() {
      const req = { result: trackingDb, onupgradeneeded: null, onerror: null, onsuccess: null };
      return new Proxy(req, { set(t, p, v) { t[p] = v; if (p === 'onsuccess') v(); return true; } });
    },
  };
  const realIDB = globalThis.indexedDB;
  globalThis.indexedDB = trackingIDB;
  globalThis.window.indexedDB = trackingIDB;
  try {
    const loadP = PersistenceManager.loadUploadedAudio();
    const saveP = PersistenceManager.saveUploadedAudio(new ArrayBuffer(8), 'upload.wav');
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(pending.length, 2, 'both transactions must be in flight');
    const load = pending.find((p) => p.mode === 'readonly');
    const save = pending.find((p) => p.mode === 'readwrite');
    // Interleave: load's get succeeds, then the save's put succeeds AND completes
    // before the load's own transaction completes.
    load.req.onsuccess();
    save.req.onsuccess();
    save.tx.oncomplete();
    load.tx.oncomplete();
    const [loaded, savedOk] = await Promise.all([loadP, saveP]);
    assert.ok(loaded && loaded.fileName === 'boot.wav',
      'overlapping save must not resolve the boot load with its own result, got ' + JSON.stringify(loaded));
    assert.equal(savedOk, true, 'the overlapping save must still report success');
  } finally {
    globalThis.indexedDB = realIDB;
    globalThis.window.indexedDB = realIDB;
  }
}

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
// The loudness row is read-only now (audit 5): in AUTO the calibrated trim does the
// work and OUTPUT is held at unity, so it carries no knob and no slider range.
assert.equal(loud10.knobId, null, 'loudness row must not offer an OUTPUT slider');
const clip10 = issues10.find((i) => i.id === 'clipping');
assert.equal(clip10.knobId, 'qualityGate', 'clipping row still drives qualityGate');
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

// --- 12b. Idle spectrum must not repaint an identical grid at 60 fps ---
{
  let rafCb = null;
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
  globalThis.document = { documentElement: { dataset: { theme: 'night' } } };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456' });
  let playing = false;
  const idleRenderer = new SpectrumRenderer(canvas, {
    getDSP: () => null, getAudioCtx: () => null, getIsPlaying: () => playing,
  });
  let draws = 0;
  const realDraw = idleRenderer.draw.bind(idleRenderer);
  idleRenderer.draw = () => { draws++; realDraw(); };
  const heartbeat = () => { const cb = rafCb; rafCb = null; cb(); };
  try {
    idleRenderer.start();
    idleRenderer.dirty = false; // settle the initial resize
    draws = 0;
    for (let i = 0; i < 10; i++) heartbeat();
    assert.equal(draws, 0, 'idle spectrum must not redraw an unchanged grid, got ' + draws + ' draws in 10 frames');
    assert.ok(rafCb, 'the rAF heartbeat must keep running while idle');

    // Each dirty event must render exactly once, then go quiet again.
    idleRenderer.setAutoIssues([]);
    assert.equal(draws, 1, 'setAutoIssues must render immediately');
    heartbeat();
    assert.equal(draws, 1, 'the issue redraw must not repeat on the next frame');
    idleRenderer.resize();
    heartbeat();
    assert.equal(draws, 2, 'resize must repaint once');
    heartbeat();
    assert.equal(draws, 2, 'the resize repaint must not repeat');
    globalThis.document = { documentElement: { dataset: { theme: 'day' } } };
    heartbeat();
    assert.equal(draws, 3, 'a theme change must repaint the idle grid once');
    heartbeat();
    assert.equal(draws, 3, 'the theme repaint must not repeat');

    // While playing, every frame must still draw: the traces are live data.
    playing = true;
    for (let i = 0; i < 5; i++) heartbeat();
    assert.equal(draws, 8, 'playing must repaint every frame');
    playing = false;
    idleRenderer.dirty = false;
    heartbeat();
    assert.equal(draws, 8, 'stopping playback must settle back to no redraws');
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.getComputedStyle = realGCS;
  }
}

// --- 12c. Horizontal wheel must not step every knob down ---
// The handler read only deltaY, so a trackpad's deltaX-only gesture always fell
// into the "deltaY >= 0" branch and decreased the value either way.
{
  const wheelEl = makeFakeEl();
  const wheelKnob = new FLKnob(wheelEl, { knobId: 'qualityGate', min: 1, max: 6, step: 0.1, default: 3, val: 3, unit: '' });
  const wheel = wheelEl.listeners['wheel'].cb;
  const noop = () => {};
  // Scroll right raises, left lowers — the same direction as ArrowRight/ArrowLeft.
  wheel({ deltaY: 0, deltaX: 40, shiftKey: false, preventDefault: noop });
  assert.ok(Math.abs(wheelKnob.val - 3.1) < 1e-9, 'scroll right must raise the value, got ' + wheelKnob.val);
  wheel({ deltaY: 0, deltaX: -40, shiftKey: false, preventDefault: noop });
  assert.ok(Math.abs(wheelKnob.val - 3) < 1e-9, 'scroll left must lower it back, got ' + wheelKnob.val);
  // Vertical wheel keeps its original direction, and dominates when both move.
  wheel({ deltaY: -40, deltaX: 0, shiftKey: false, preventDefault: noop });
  assert.ok(Math.abs(wheelKnob.val - 3.1) < 1e-9, 'wheel up must still raise the value');
  wheel({ deltaY: 40, deltaX: -10, shiftKey: false, preventDefault: noop });
  assert.ok(Math.abs(wheelKnob.val - 3) < 1e-9, 'the dominant axis must decide the direction');
  wheel({ deltaY: 0, deltaX: 0, shiftKey: false, preventDefault: noop });
  assert.ok(Math.abs(wheelKnob.val - 3) < 1e-9, 'a zero-delta wheel event must not move the knob');
}

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

// --- 16. Every non-bypass export must honour the true-peak ceiling ---
// The verification lived inside applyCorrectionDb, which exportWAV only calls
// when autoTrimDb is absent. AUTO always sets it, so the check never ran there;
// and a manual OUTPUT boost lands after the chain's ceiling with no check at all.
const decodeWav16 = async (blob) => {
  const raw = new DataView(await blob.arrayBuffer());
  const n = (raw.byteLength - 44) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw.getInt16(44 + i * 2, true) / 32768;
  return out;
};
const hotRender = () => {
  const d = new Float32Array(44100);
  for (let i = 0; i < d.length; i++) d[i] = 1.4 * Math.sin((2 * Math.PI * 11025 * i) / 44100 + Math.PI / 4);
  return mkBuf([d], 44100);
};
const realRenderChain16 = MaestroDSP.renderChain;
try {
  MaestroDSP.renderChain = async () => hotRender();
  // AUTO export: autoTrimDb is always finite, so the old guard skipped the check.
  const autoBlob = await MaestroDSP.exportWAV(hotRender(), { integratedLUFS: -20, targetLUFS: -14, autoTrimDb: 0 }, false);
  const autoTP = SpectralAnalyzer.measureTruePeak(await decodeWav16(autoBlob), 44100);
  assert.ok(autoTP <= -1.0, 'AUTO export must respect the true-peak ceiling, got ' + autoTP.toFixed(3));
  // Manual export: no integratedLUFS, OUTPUT boost applied after the ceiling.
  const manualBlob = await MaestroDSP.exportWAV(hotRender(), { outputGain: 6 }, false);
  const manualTP = SpectralAnalyzer.measureTruePeak(await decodeWav16(manualBlob), 44100);
  assert.ok(manualTP <= -1.0, 'manual export must respect the true-peak ceiling, got ' + manualTP.toFixed(3));
  // BYPASS promises pristine PCM. Comparing against encodeWAV of the same buffer
  // proved nothing: both used the same lossy scale, so they agreed while both
  // differed from the source. Compare against the ORIGINAL int16 samples.
  const srcSr = 44100, srcN = 4096;
  const origInts = new Int16Array(srcN);
  let lcg = 20261124;
  for (let i = 0; i < srcN; i++) {
    lcg = (lcg * 1103515245 + 12345) & 0x7fffffff;
    // Span the whole int16 range, including both endpoints and zero.
    origInts[i] = i < 3 ? [-32768, 32767, 0][i] : (lcg % 65536) - 32768;
  }
  const srcChans = Float32Array.from(origInts, (v) => v / 32768);
  const srcBuf = mkBuf([srcChans], srcSr);
  const bypassBlob = await MaestroDSP.exportWAV(srcBuf, { autoTrimDb: 0 }, true);
  const bypassView = new DataView(await bypassBlob.arrayBuffer());
  let mismatches = 0;
  for (let i = 0; i < srcN; i++) {
    if (bypassView.getInt16(44 + i * 2, true) !== origInts[i]) mismatches++;
  }
  assert.equal(mismatches, 0, `bypass export must round-trip the original int16 samples exactly, ${mismatches} of ${srcN} differ`);
  // Every int16 value must survive, not just the ones a random draw happened to hit.
  const allInts = new Int16Array(65536);
  for (let v = 0; v < 65536; v++) allInts[v] = v - 32768;
  const allBuf = mkBuf([Float32Array.from(allInts, (v) => v / 32768)], srcSr);
  const allView = new DataView(await (await MaestroDSP.exportWAV(allBuf, {}, true)).arrayBuffer());
  let allBad = 0;
  for (let v = 0; v < 65536; v++) if (allView.getInt16(44 + v * 2, true) !== allInts[v]) allBad++;
  assert.equal(allBad, 0, `all 65536 int16 values must round-trip, ${allBad} failed`);
  // +1.0 must clamp to 32767, never wrap to -32768.
  const hotBuf = mkBuf([new Float32Array([1.0, -1.0, 1.5, -1.5])], srcSr);
  const hotView = new DataView(await (MaestroDSP.encodeWAV(hotBuf)).arrayBuffer());
  assert.equal(hotView.getInt16(44, true), 32767, '+1.0 must clamp to 32767');
  assert.equal(hotView.getInt16(46, true), -32768, '-1.0 must encode to -32768');
  assert.equal(hotView.getInt16(48, true), 32767, 'over-range positive must clamp, not wrap');
  assert.equal(hotView.getInt16(50, true), -32768, 'over-range negative must clamp, not wrap');
} finally {
  MaestroDSP.renderChain = realRenderChain16;
}

// --- 16b. Waveshaper curves must sit on the grid a WaveShaperNode reads ---
// A node reads index i at 2i/(n-1)-1. The /n grid put every curve half a step off
// its own axis: measured cascade DC -1.52e-3 on a DC-free sine, and Stat
// Normalize's "unity peak" landed at 0.999141 instead of 1.0.
{
  // The spec's interpolation, so the test reads curves the way the node does.
  const shape = (curve, v) => {
    const n = curve.length;
    const pos = ((Math.max(-1, Math.min(1, v)) + 1) / 2) * (n - 1);
    const lo = Math.floor(pos), hi = Math.min(n - 1, lo + 1), f = pos - lo;
    return curve[lo] * (1 - f) + curve[hi] * f;
  };
  // Identity curve is the grid probe: it must reproduce (v+1)/2 exactly.
  const n9 = 9;
  const identity = Float32Array.from({ length: n9 }, (_, i) => i / (n9 - 1));
  for (const v of [-1, -0.75, -0.5, 0, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(shape(identity, v) - (v + 1) / 2) < 1e-6, `grid probe failed at v=${v}`);
  }
  // Endpoints: the curve array must span exactly [-1, 1].
  for (const [name, curve] of [['stat', MaestroDSP.makeStatCurve(0.55)], ['texture', MaestroDSP.makeTextureCurve(0.5)], ['ceiling', MaestroDSP.makeCeilingCurve()]]) {
    const n = curve.length;
    assert.ok(Math.abs(shape(curve, -1) - curve[0]) < 1e-6, `${name}: f(-1) must read curve[0]`);
    assert.ok(Math.abs(shape(curve, 1) - curve[n - 1]) < 1e-6, `${name}: f(+1) must read curve[n-1]`);
  }
  // Stat Normalize claims unity peak: both endpoints must be exactly +/-1.
  for (const amount of [0, 0.25, 0.55, 1]) {
    const c = MaestroDSP.makeStatCurve(amount);
    assert.ok(Math.abs(shape(c, 1) - 1) < 1e-6, `stat ${amount}: f(+1) must be unity, got ${shape(c, 1)}`);
    assert.ok(Math.abs(shape(c, -1) + 1) < 1e-6, `stat ${amount}: f(-1) must be -1, got ${shape(c, -1)}`);
  }
  // The ceiling curve must clamp at exactly +/-0.891, symmetrically.
  {
    const c = MaestroDSP.makeCeilingCurve();
    const ceil = Math.pow(10, -1 / 20);
    assert.ok(Math.abs(shape(c, 1) - ceil) < 1e-6, 'ceiling f(+1) must be +0.891');
    assert.ok(Math.abs(shape(c, -1) + ceil) < 1e-6, 'ceiling f(-1) must be -0.891');
    assert.ok(Math.abs(shape(c, 0)) < 1e-6, 'ceiling must pass zero unchanged');
  }
  // Odd symmetry: a DC-free signal through stat+texture must stay DC-free.
  {
    const sr = 48000, len = sr * 2;
    const stat = MaestroDSP.makeStatCurve(0.55), tex = MaestroDSP.makeTextureCurve(0.5);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const x = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr);
      sum += shape(tex, shape(stat, x));
    }
    const dc = sum / len;
    console.log('stat+texture cascade DC on a DC-free sine:', dc.toExponential(3));
    assert.ok(Math.abs(dc) < 1e-4, `cascade injected DC ${dc.toExponential(3)} — the curve grid is off axis`);
  }
  // Texture is odd-symmetric: tanh (odd) times an even factor is odd, so it adds
  // odd harmonics only. The docs claimed an even-harmonic term that never existed.
  for (const amount of [0.15, 0.35, 0.5, 0.7, 1.0]) {
    const c = MaestroDSP.makeTextureCurve(amount);
    let worst = 0;
    for (let i = 1; i < c.length; i++) worst = Math.max(worst, Math.abs(c[i] + c[c.length - 1 - i]));
    assert.ok(worst < 1e-6, `texture ${amount} must be odd-symmetric, max|f(x)+f(-x)| = ${worst}`);
  }
}

// --- 17. The measurement panel must actually run, not just contain the words ---
// 29 of auto-repro's assertions grep app.js source text, which is why the fmtProm
// temporal-dead-zone crash shipped with a green CI: the string was right there.
// This calls the real function against a stub page and checks the cards changed.
{
  const els = new Map();
  const mkEl = (id) => ({ id, textContent: '', style: {}, className: '', classList: { add() {}, remove() {}, toggle() {} } });
  const realDoc = globalThis.document;
  globalThis.document = {
    addEventListener() {},
    getElementById: (id) => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => mkEl('created'),
    documentElement: { dataset: {} },
  };
  try {
    const { updateTelemetryUI } = await import('./docs/app.js');
    assert.equal(typeof updateTelemetryUI, 'function', 'app.js must export updateTelemetryUI so it can be tested');
    const carrier = { carriers: [
      { freqHz: 15500, prominenceDB: 4.2, confidence: 0.6 },
      { freqHz: 17500, prominenceDB: -1.5, confidence: 0.1 },
      { freqHz: 19500, prominenceDB: 0, confidence: 0 },
    ] };
    const stego = { echoes: [{ delayMs: 2.993, score: 14.5 }], confidence: 0.9 };
    const spec = { spectralFlatness: 0.1234, crestFactorDB: 14.8, peakDBFS: -0.5, rmsDBFS: -15.3 };
    const buffer = { duration: 8, sampleRate: 48000, numberOfChannels: 2 };
    updateTelemetryUI(carrier, stego, spec, buffer);

    // Every card must be written: the TDZ throw stopped at the first one.
    assert.equal(els.get('carrier1Prom').textContent, '+4.20 dB', 'carrier 1 card must fill in');
    assert.equal(els.get('carrier1Freq').textContent, '15.50 kHz', 'carrier 1 frequency');
    assert.equal(els.get('carrier2Prom').textContent, '-1.50 dB', 'negative prominence must not render "+-1.50 dB"');
    assert.equal(els.get('carrier3Prom').textContent, '0.00 dB', 'zero prominence carries no sign');
    assert.equal(els.get('echoDelay').textContent, '2.99 ms', 'echo card must fill in');
    assert.equal(els.get('valFlatness').textContent, '0.1234', 'flatness card must fill in');
    assert.equal(els.get('valCrest').textContent, 'Crest 14.8 dB', 'crest card must fill in');
    assert.equal(els.get('valPeak').textContent, 'Peak -0.5 dBFS', 'peak card must fill in');
    assert.equal(els.get('valRms').textContent, 'RMS -15.3 dBFS', 'rms card must fill in');
    // Silence reads -Infinity, which must print as a symbol, not "-Infinity".
    updateTelemetryUI({ carriers: [] }, { echoes: [], confidence: 0 },
      { spectralFlatness: 0, crestFactorDB: 0, peakDBFS: -Infinity, rmsDBFS: -Infinity }, buffer);
    assert.equal(els.get('valPeak').textContent, 'Peak -∞ dBFS', 'silence peak must print the infinity symbol');
    assert.equal(els.get('echoDelay').textContent, 'None', 'no echo reads None');

    // The cases above hand-build a complete spec, so they cannot catch a field a
    // real report omits. Feed the panel actual analyzeFullTrack output instead.
    const feed = (buf) => {
      const rep = SpectralAnalyzer.analyzeFullTrack(buf);
      updateTelemetryUI({ carriers: rep.carriers }, { echoes: rep.echoes, confidence: rep.echoConfidence }, rep, buf);
      return rep;
    };
    const mkBuf = (chans, sr) => ({
      numberOfChannels: chans.length, length: chans[0].length, sampleRate: sr,
      duration: chans[0].length / sr, getChannelData: (c) => chans[c],
    });

    // A file under 2048 samples takes the short-buffer branch. Its report had no
    // spectralFlatness, so the panel threw on .toFixed and left every card below
    // the throw unwritten.
    const click = new Float32Array(1000).fill(0.9);
    const shortBuf = mkBuf([click, click], 48000);
    feed(shortBuf);
    assert.equal(typeof els.get('valFlatness').textContent, 'string', 'flatness card must be written');
    assert.ok(els.get('valFlatness').textContent.length > 0, 'short file must still fill the flatness card');
    assert.ok(/Crest /.test(els.get('valCrest').textContent), 'short file must fill the crest card below it');
    assert.ok(/RMS /.test(els.get('valRms').textContent), 'short file must fill the rms card');
    assert.equal(els.get('carrier3Prom').textContent, 'n/a', 'a file with no carriers must not keep an old reading');

    // 32 kHz material: bands above Nyquist are skipped, so only one carrier comes
    // back. Cards 2 and 3 must say n/a rather than show the previous track.
    const sr32 = 32000;
    const n32 = sr32 * 3;
    const tone32 = new Float32Array(n32);
    for (let i = 0; i < n32; i++) tone32[i] = 0.4 * Math.sin((2 * Math.PI * 15500 * i) / sr32);
    const buf32 = mkBuf([tone32, tone32], sr32);
    const rep32 = feed(buf32);
    assert.ok(rep32.carriers.length < 3, `32 kHz must skip bands above Nyquist, got ${rep32.carriers.length}`);
    for (let slot = rep32.carriers.length + 1; slot <= 3; slot++) {
      assert.equal(els.get(`carrier${slot}Freq`).textContent, 'n/a', `absent band ${slot} frequency must read n/a`);
      assert.equal(els.get(`carrier${slot}Prom`).textContent, 'n/a', `absent band ${slot} prominence must read n/a`);
      assert.equal(els.get(`carrier${slot}Bar`).style.width, '0%', `absent band ${slot} bar must reset`);
    }
    // A full-rate track after a narrow one must overwrite all three again.
    const sr48 = 48000, n48 = sr48 * 2;
    const tone48 = new Float32Array(n48);
    for (let i = 0; i < n48; i++) tone48[i] = 0.4 * Math.sin((2 * Math.PI * 1000 * i) / sr48);
    const rep48 = feed(mkBuf([tone48, tone48], sr48));
    assert.equal(rep48.carriers.length, 3, '48 kHz returns all three bands');
    for (let slot = 1; slot <= 3; slot++) {
      assert.notEqual(els.get(`carrier${slot}Prom`).textContent, 'n/a', `band ${slot} must be written again`);
    }
  } finally {
    globalThis.document = realDoc;
  }
}

// --- 17b. The panel and AUTO must share one analysis per buffer ---
// Both ran the same 8 s job on the same audio, each copying the channels to its
// own worker: 16 s where 8 would do, and two workers analysing at once.
{
  const shareBody = appSrc13.slice(appSrc13.indexOf('function reportFor'), appSrc13.indexOf('async function analyzeFullTrackOffThread'));
  assert.ok(shareBody.includes('analysisBuffer !== buffer'), 'the cached report must be keyed by the buffer');
  assert.ok(shareBody.includes('analysisPromise'), 'an in-flight run must be shared, not started twice');
  assert.ok(shareBody.includes('.catch('), 'a failed run must not be cached for the next caller');
  // Both callers must go through the shared accessor.
  for (const fn of ['async function runForensicAnalysis', 'async function runAutoMaster']) {
    const start = appSrc13.indexOf(fn);
    const body = appSrc13.slice(start, start + 1600);
    assert.ok(body.includes('await reportFor(buffer)'), `${fn} must reuse the shared report`);
    assert.ok(!body.includes('await analyzeFullTrackOffThread(buffer)'), `${fn} must not start its own analysis`);
  }
}

// --- 17c. The K-weighting scratch array must be reused, not reallocated ---
{
  const analyzerSrc = readFileSync(new URL('./docs/modules/analyzer.js', import.meta.url), 'utf8');
  const loudBody = analyzerSrc.slice(analyzerSrc.indexOf('static measureLoudness'), analyzerSrc.indexOf('static measureTruePeak'));
  assert.ok(!/this\.biquad\(ch, shelf\)/.test(loudBody), 'the first filter stage must not allocate its own full-length array');
  assert.equal((loudBody.match(/new Float64Array\(n\)/g) || []).length, 1, 'one scratch array, reused across stages and channels');
  assert.ok(loudBody.includes('biquadInto(ch, shelf, scratch)') && loudBody.includes('biquadInto(scratch, hp, kw)'),
    'both stages must filter into buffers the caller supplies');
}

// --- 18. A bypassed export must not be named .auto-master.wav ---
// The name came from autoParams while the content came from isBypassed, so
// AUTO -> Play original -> Export produced raw PCM labelled as a master.
{
  const setupBody = appSrc13.slice(appSrc13.indexOf('function setupExportWAV'));
  assert.ok(/a\.download = \(autoParams && !isBypassed\)/.test(setupBody),
    'export filename must use the same bypass condition as the content');
}

// --- 19. Re-picking the same file must fire change again ---
{
  const uploadBody = appSrc13.slice(appSrc13.indexOf("uploadInput.addEventListener('change'"));
  assert.ok(/e\.target\.value = ''/.test(uploadBody.slice(0, 400)),
    'upload handler must clear the input value so the same file can be picked twice');
}

// --- 20. Mono must not trigger M/S bass anchoring ---
// A mono file has side energy 0, so width is 0 and correlation is 1: the old
// `width < 0.5 ||` clause cut 3 dB of bass from every mono upload.
{
  const { mapAutoReport } = await import('./docs/modules/auto.js');
  const mono = mapAutoReport({ integratedLUFS: -14, truePeakDBTP: -6, crestFactorDB: 14, clippingCount: 0, carriers: [], echoConfidence: 0, stereoWidth: 0, correlation: 1 });
  assert.equal(mono.params.msBass, 0, 'mono (width 0, correlation 1) must not anchor the bass');
  const wide = mapAutoReport({ integratedLUFS: -14, truePeakDBTP: -6, crestFactorDB: 14, clippingCount: 0, carriers: [], echoConfidence: 0, stereoWidth: 0.9, correlation: 0.1 });
  assert.equal(wide.params.msBass, 1, 'decorrelated audio must still anchor the bass');
}

// --- 21. OUTPUT drives the limiters; the ceiling is genuinely last ---
// Browser-measured before the fix: manual OUTPUT +6 dB reached the speakers at
// 1.7829 linear (+5.02 dBFS) while the export of the same params read -1 dBTP.
// Between limiter and ceiling it hit the hard clipper, so OUTPUT now feeds the
// 20:1 limiter and the ceiling closes the chain.
{
  const mkParam = () => { const o = { v: 0 }; o.setValueAtTime = (v) => { o.v = v; }; o.setTargetAtTime = (v) => { o.v = v; }; return o; };
  const edges = [];
  const mkNode = () => {
    const n = { type: '', frequency: mkParam(), Q: mkParam(), gain: mkParam(), delayTime: mkParam(), threshold: mkParam(), knee: mkParam(), ratio: mkParam(), attack: mkParam(), release: mkParam(), curve: null, oversample: '' };
    n.connect = (d) => { edges.push([n, d]); return d; };
    n.start = () => {};
    return n;
  };
  const recCtx = { currentTime: 0, createBiquadFilter: mkNode, createGain: mkNode, createWaveShaper: mkNode, createDelay: mkNode, createOscillator: mkNode, createDynamicsCompressor: mkNode };
  const built = MaestroDSP.buildMasterChain(recCtx, { outputGain: 6 }, {});
  const linked = (a, b) => edges.some(([s, d]) => s === a && d === b);
  assert.ok(linked(built.nodes.outGain, built.nodes.qualityLimiter), 'OUTPUT must drive the limiter, not the clipper');
  assert.ok(!linked(built.nodes.outGain, built.nodes.ceiling), 'OUTPUT must not feed the ceiling directly');
  assert.ok(!linked(built.nodes.ceiling, built.nodes.outGain), 'the ceiling must not feed OUTPUT');
  assert.ok(linked(built.nodes.trimGain, built.nodes.ceiling), 'the trim feeds the ceiling');
  assert.equal(built.output, built.nodes.ceiling, 'the chain output must be the ceiling node');
  // Nothing may hang off the ceiling: it is genuinely last.
  assert.equal(edges.filter(([s]) => s === built.nodes.ceiling).length, 0, 'no node may follow the ceiling');
}

// --- 22. One STFT pass feeds flatness and shimmer, with identical numbers ---
{
  const sr22 = 44100;
  const n22 = sr22 * 2;
  const sig = new Float32Array(n22);
  for (let i = 0; i < n22; i++) {
    sig[i] = 0.3 * Math.sin((2 * Math.PI * 9000 * i) / sr22) * (0.5 + 0.5 * Math.sin((2 * Math.PI * 7 * i) / sr22))
      + 0.05 * Math.sin((2 * Math.PI * 440 * i) / sr22);
  }
  const pass = SpectralAnalyzer._spectralPass(sig, sr22);
  assert.deepEqual(SpectralAnalyzer._analyzeFromPass(sig, pass), SpectralAnalyzer.analyze(sig, sr22),
    'shared-pass flatness must equal a standalone analyze()');
  assert.deepEqual(SpectralAnalyzer._shimmerFromPass(pass), SpectralAnalyzer.measureShimmer(sig, sr22),
    'shared-pass shimmer must equal a standalone measureShimmer()');
  // The full-track report must use the shared pass, not a second one.
  const fullSrc = readFileSync(new URL('./docs/modules/analyzer.js', import.meta.url), 'utf8');
  const body = fullSrc.slice(fullSrc.indexOf('static analyzeFullTrack'));
  assert.ok(body.includes('_spectralPass('), 'analyzeFullTrack must run the shared pass');
  assert.ok(!body.includes('this.measureShimmer(mono'), 'analyzeFullTrack must not re-run the shimmer STFT');
}

// --- 23. Unread pass-throughs must be gone ---
{
  const { mapAutoReport } = await import('./docs/modules/auto.js');
  const p23 = mapAutoReport({ integratedLUFS: -8, truePeakDBTP: 0.5, crestFactorDB: 4, clippingCount: 150, carriers: [], echoConfidence: 0, stereoWidth: 0.3, correlation: 0.2, hfCutoff: 16000 }).params;
  for (const dead of ['stereoWidth', 'truePeakDBTP', 'clippingCount', 'airShelf', 'limiterEngaged']) {
    assert.equal(p23[dead], undefined, `params.${dead} travelled but nothing read it — must be deleted`);
  }
  // The chain reads hfCutoff and correlation, so those must survive.
  assert.equal(p23.hfCutoff, 16000, 'hfCutoff is read by the chain and must stay');
  assert.equal(p23.correlation, 0.2, 'correlation is read by the chain and must stay');
}

console.log('bughunt-repro: PASS');

globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null };
import assert from 'node:assert/strict';
import { SpectralAnalyzer } from './docs/modules/analyzer.js';
import { FLKnob } from './docs/modules/knob.js';
import { MaestroDSP } from './docs/modules/dsp.js';
import { PersistenceManager } from './docs/modules/storage.js';

// 1. Silent track: crest should not be NaN
const silent = new Float32Array(16384);
const spec = SpectralAnalyzer.analyze(silent, 44100);
console.log('silent crest:', spec.crestFactorDB, 'peak:', spec.peakDBFS, 'rms:', spec.rmsDBFS);
console.log('BUG crest NaN?', Number.isNaN(spec.crestFactorDB));

// 2. bandwidthHeal step 0.25: 0.25 must stay 0.25, not round to 0.3
function makeEl() { return { dataset: {}, querySelector: () => null, addEventListener() {}, dispatchEvent() {}, style: {} }; }
const readout = { textContent: '' };
const knob = new FLKnob(makeEl(), { knobId: 'bandwidthHeal', min: -6, max: 6, step: 0.25, default: 0.25, val: 0.25, unit: 'dB', readoutEl: readout });
knob.setValue(0.25, false);
console.log('bandwidthHeal set 0.25 ->', knob.val, 'readout:', readout.textContent, 'expected 0.25');
knob.setValue(0.75, false);
console.log('bandwidthHeal set 0.75 ->', knob.val, 'expected 0.75');

// 3. DSP: qualityGate max is 6 in registry, outputGain 6 dB must be 10^(6/20)
function p() { const o = {}; o.setValueAtTime = (v) => { o.v = v; }; o.setTargetAtTime = (v) => { o.v = v; }; o.value = 0; return o; }
function mockFilter() { return { type: '', frequency: p(), Q: p(), gain: p(), connect() {}, disconnect() {} }; }
const ctx = {
  currentTime: 0,
  createBiquadFilter: () => mockFilter(),
  createWaveShaper: () => ({ curve: null, oversample: '', connect() {}, disconnect() {} }),
  createDelay: () => ({ delayTime: p(), connect() {}, disconnect() {} }),
  createOscillator: () => ({ type: '', frequency: p(), connect() {}, start() {}, disconnect() {} }),
  createGain: () => ({ gain: p(), connect() {}, disconnect() {} }),
  createDynamicsCompressor: () => ({ threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(), connect() {}, disconnect() {} }),
  createAnalyser: () => ({ fftSize: 2048, smoothingTimeConstant: 0.8, connect() {}, disconnect() {} }),
};
const dsp = new MaestroDSP();
dsp.init(ctx);
dsp.updateFromKnob('qualityGate', 6);
console.log('qualityGate 6 -> limiter thresh:', dsp.qualityLimiter.threshold.v, 'expected -2.9 if max 6, -2.45 if clamped to 5');
dsp.updateFromKnob('outputGain', 6);
console.log('outputGain 6dB -> gain:', dsp.outGain.gain.v, 'expected:', Math.pow(10, 6 / 20).toFixed(4));

// 3b. Glue compressor threshold: live knob path must equal the shared chain path.
// A crest of 20 dB caps the threshold at -16.2 dB; the live path ignored the cap
// and reported -6 dB, so what you heard was not what export rendered.
dsp.params.crestFactorDB = 20;
dsp.updateFromKnob('dynamicsNatural', 0);
const liveGlueThresh = dsp.dynamicsComp.threshold.v;
const chainGlueThresh = MaestroDSP.buildMasterChain(ctx, { crestFactorDB: 20, dynamicsNatural: 0 }, {}).nodes.dynamicsComp.threshold.v;
console.log('glue threshold crest 20 dynamics 0 -> live:', liveGlueThresh, 'chain:', chainGlueThresh);
assert.equal(liveGlueThresh, chainGlueThresh, 'live glue threshold must match the shared chain (export) threshold');

// 3c. OUTPUT knob must reach the rendered output. It used to be a dangling node
// in buildMasterChain, so export ignored it while live playback applied it.
// The chain's output is now the ceiling (OUTPUT moved before it), so read the
// outGain node itself — its position is pinned separately in 3c-3.
const manualBase = { carrierErase: 0, strideRemove: 0, stegoStrip: 0, neuralScrub: 0, spectralBlend: 0, phaseScatter: 0, statNormalize: 0, hashBreak: 0, roomInject: 0, textureInject: 0, deshimmer: 0, bandwidthHeal: 0, dynamicsNatural: 0, qualityGate: 1 };
const gainOf = (p) => MaestroDSP.buildMasterChain(ctx, p, {}).nodes.outGain.gain.v;
const unity = gainOf({ ...manualBase, outputGain: 0 });
const plus6 = gainOf({ ...manualBase, outputGain: 6 });
console.log('manual output gain: unity', unity, '+6dB', plus6, 'expected ratio', Math.pow(10, 6 / 20).toFixed(4));
assert.ok(Math.abs(plus6 / unity - Math.pow(10, 6 / 20)) < 1e-6, 'export must apply the OUTPUT knob');
// AUTO holds output at unity: its calibrated trim does the loudness work.
const autoUnity = gainOf({ ...manualBase, outputGain: 6, integratedLUFS: -10, targetLUFS: -14 });
assert.equal(autoUnity, unity, 'AUTO must hold output at unity regardless of the knob');

// 3c-2. The live OUTPUT knob must be inert under AUTO too. buildMasterChain holds
// output at unity when integratedLUFS is finite, so applying the knob live made
// playback louder than the export it was auditioning.
{
  const liveDsp = new MaestroDSP();
  liveDsp.init(ctx);
  liveDsp.updateFromKnob('outputGain', 6);
  const manualLive = liveDsp.outGain.gain.v;
  assert.ok(Math.abs(manualLive - Math.pow(10, 6 / 20)) < 1e-9, 'manual OUTPUT must still reach live playback');
  liveDsp.params.integratedLUFS = -10;
  liveDsp.params.targetLUFS = -14;
  liveDsp.outGain.gain.v = 1; // what buildMasterChain sets under AUTO
  liveDsp.updateFromKnob('outputGain', 6);
  console.log('AUTO live OUTPUT gain:', liveDsp.outGain.gain.v, 'expected 1');
  assert.equal(liveDsp.outGain.gain.v, 1, 'under AUTO the live OUTPUT knob must not move outGain');
  assert.equal(liveDsp.outGain.gain.v, gainOf({ ...manualBase, outputGain: 6, integratedLUFS: -10, targetLUFS: -14 }),
    'live and export OUTPUT must agree after AUTO');
}

// 4. Shift+wheel fine tune: 0.25 + 0.05 (0.2*step) must land on 0.30, not snap back to 0.25
const fineKnob = new FLKnob(makeEl(), { knobId: 'bandwidthHeal', min: -6, max: 6, step: 0.25, default: 0.25, val: 0.25, unit: 'dB', readoutEl: { textContent: '' } });
fineKnob.setValue(0.25 + 0.05, false, 0.25 * 0.2);
console.log('fine-tune 0.25 + 0.05 ->', fineKnob.val, 'expected 0.3');
console.log('BUG fine-tune no-op?', fineKnob.val === 0.25);

// 5. qualityGate step 0.1: fine step must be clean 0.02, not 0.020000000000000004
const qReadout = { textContent: '' };
const qKnob = new FLKnob(makeEl(), { knobId: 'qualityGate', min: 1, max: 6, step: 0.1, default: 3, val: 3, unit: '', readoutEl: qReadout });
qKnob.setValue(3 + qKnob.fineStep(), false, qKnob.fineStep());
console.log('qualityGate fine 3 -> 3.02:', qKnob.val, 'readout:', qReadout.textContent);
console.log('BUG fine-step float pollution?', qKnob.val !== 3.02 || qReadout.textContent !== '3.02');

// 6. Restore path: saved fine value 0.3 must survive setValue with fineStep, not snap to 0.25
const rKnob = new FLKnob(makeEl(), { knobId: 'bandwidthHeal', min: -6, max: 6, step: 0.25, default: 0.25, val: 0.25, unit: 'dB', readoutEl: { textContent: '' } });
rKnob.setValue(0.3, false, rKnob.fineStep());
console.log('restore fine 0.3 ->', rKnob.val, 'expected 0.3');
console.log('BUG restore loses fine value?', rKnob.val !== 0.3);

// 7. Settings migration: saved knobs under the pre-rebrand key must survive the rename.
const LEGACY = 'nasuno_engine_settings_v3';
const NEW = 'maestro_settings_v1';
function stubStorage(seed = {}) {
  const store = { ...seed };
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  return store;
}
const legacyPayload = { knobs: { qualityGate: 4.2 }, preset: 'standard', bypass: false };
const newPayload = { knobs: { qualityGate: 1.5 }, preset: 'gentle', bypass: true };

stubStorage({ [LEGACY]: JSON.stringify(legacyPayload) });
assert.deepEqual(PersistenceManager.loadSettings(), legacyPayload, 'legacy-only session lost its saved knobs');

stubStorage({ [LEGACY]: JSON.stringify(legacyPayload), [NEW]: JSON.stringify(newPayload) });
assert.deepEqual(PersistenceManager.loadSettings(), newPayload, 'new key must win over the legacy key');

// The pre-rebrand payload really was {presetKey, compositeValues, rawState,
// isBypassed} (git 3fb9216 app.js saveSettings), not {knobs, preset, bypass} —
// so boot reads a legacy session as-is and no shape mapping is needed.
const realLegacyPayload = { presetKey: 'standardEvasion', compositeValues: { qualityGate: 4.2 }, rawState: {}, isBypassed: true, timestamp: 1 };
stubStorage({ [LEGACY]: JSON.stringify(realLegacyPayload) });
const restoredLegacy = PersistenceManager.loadSettings();
assert.ok(restoredLegacy.compositeValues, 'a real legacy session must expose compositeValues to boot');
assert.equal(restoredLegacy.compositeValues.qualityGate, 4.2, 'legacy knob values survive the key rename');
assert.equal(restoredLegacy.presetKey, 'standardEvasion', 'legacy preset key is already the current name');
assert.equal(restoredLegacy.isBypassed, true, 'legacy bypass flag is already the current name');

stubStorage();
assert.equal(PersistenceManager.loadSettings(), null, 'empty store must load null');

const saved = stubStorage();
PersistenceManager.saveSettings(newPayload);
assert.equal(saved[NEW], JSON.stringify(newPayload), 'saveSettings did not write the new key');
assert.ok(!(LEGACY in saved), 'saveSettings must never write the legacy key');

// clearSettings must also remove the legacy key, else a legacy-only
// user's cleared settings resurrect on the next loadSettings() fallback.
const legacyOnly = stubStorage({ [LEGACY]: JSON.stringify(legacyPayload) });
PersistenceManager.clearSettings();
assert.equal(PersistenceManager.loadSettings(), null, 'clearSettings left the legacy key behind — settings resurrect');
assert.ok(!(LEGACY in legacyOnly), 'clearSettings did not remove the legacy key');

// 8. Keyboard operation: arrows step like the wheel, Shift = fine step, Home/End bounds.
{
  const handlers = {};
  const kbEl = { dataset: {}, querySelector: () => null, addEventListener: (t, fn) => { handlers[t] = fn; }, dispatchEvent() {}, style: {}, setAttribute() {}, tabIndex: 0 };
  const kb = new FLKnob(kbEl, { knobId: 'qualityGate', min: 1, max: 6, step: 0.1, default: 3, val: 3, unit: '', readoutEl: { textContent: '' } });
  const press = (key, shiftKey = false) => handlers.keydown({ key, shiftKey, preventDefault() {} });
  press('ArrowUp');
  assert.ok(Math.abs(kb.val - 3.1) < 1e-9, `ArrowUp must step by step, got ${kb.val}`);
  press('ArrowUp', true);
  assert.ok(Math.abs(kb.val - 3.12) < 1e-9, `Shift+ArrowUp must step by the fine step, got ${kb.val}`);
  press('End');
  assert.equal(kb.val, 6, 'End must jump to max');
  press('Home');
  assert.equal(kb.val, 1, 'Home must jump to min');
  console.log('keyboard: ArrowUp/fine/Home/End all step correctly');
}
// 3d. Export must render past the last input sample: the chain has a 3 ms hash
// delay, a 47 ms room path and 50-140 ms compressor releases, so rendering
// exactly buffer.length cuts the chain's own tail off.
const SR_TAIL = 44100;
let capturedLength = 0;
globalThis.OfflineAudioContext = class {
  constructor(channels, length, sampleRate) {
    capturedLength = length;
    Object.assign(this, ctx);
    this.destination = { connect() {} };
    this.createBufferSource = () => ({ buffer: null, connect() {}, start() {}, disconnect() {} });
    this.startRendering = async () => ({ length, numberOfChannels: channels, sampleRate, getChannelData: () => new Float32Array(length) });
  }
};
const tailBuf = { numberOfChannels: 2, length: SR_TAIL, sampleRate: SR_TAIL, getChannelData: () => new Float32Array(SR_TAIL) };
await MaestroDSP.renderChain(tailBuf, {});
console.log('renderChain length:', capturedLength, 'input:', SR_TAIL, 'extra:', capturedLength - SR_TAIL);
assert.ok(capturedLength > SR_TAIL, 'renderChain must render a tail so the room/limiter decay is not cut off');
assert.ok(capturedLength - SR_TAIL >= Math.round(0.1 * SR_TAIL), 'tail must cover at least 100 ms of chain decay');

// 3e. Room Inject must be TWO parallel taps at 16/31 ms (README, registry
// purpose, dsp header), not the cascaded single 47 ms slap it was wired as.
{
  const edges = [];
  const mkRec = () => {
    const n = { type: '', frequency: p(), Q: p(), gain: p(), delayTime: p(), threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(), curve: null, oversample: '', fftSize: 2048, smoothingTimeConstant: 0.8 };
    n.connect = (dst) => { edges.push([n, dst]); };
    n.disconnect = () => {};
    n.start = () => {};
    return n;
  };
  const recCtx = { currentTime: 0, createBiquadFilter: mkRec, createGain: mkRec, createWaveShaper: mkRec, createDelay: mkRec, createOscillator: mkRec, createDynamicsCompressor: mkRec, createAnalyser: mkRec };
  const chain = MaestroDSP.buildMasterChain(recCtx, {}, {});
  const linked = (a, b) => edges.some(([s, d]) => s === a && d === b);
  const { roomSend, roomDelay1, roomDelay2, roomFilter } = chain.nodes;
  console.log('room wiring: send->d1', linked(roomSend, roomDelay1), 'send->d2', linked(roomSend, roomDelay2), 'd1->d2', linked(roomDelay1, roomDelay2));
  assert.ok(linked(roomSend, roomDelay1) && linked(roomSend, roomDelay2), 'room taps must be parallel: send feeds both the 16 ms and the 31 ms delay');
  assert.ok(linked(roomDelay1, roomFilter) && linked(roomDelay2, roomFilter), 'both room taps must reach the lowpass');
  assert.ok(!linked(roomDelay1, roomDelay2), 'cascading the taps into one 47 ms path is the bug being pinned away');
}

console.log('Storage fallback: PASS');

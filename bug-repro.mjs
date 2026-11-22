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
const manualBase = { carrierErase: 0, strideRemove: 0, stegoStrip: 0, neuralScrub: 0, spectralBlend: 0, phaseScatter: 0, statNormalize: 0, hashBreak: 0, roomInject: 0, textureInject: 0, deshimmer: 0, bandwidthHeal: 0, dynamicsNatural: 0, qualityGate: 1 };
const gainOf = (p) => MaestroDSP.buildMasterChain(ctx, p, {}).output.gain.v;
const unity = gainOf({ ...manualBase, outputGain: 0 });
const plus6 = gainOf({ ...manualBase, outputGain: 6 });
console.log('manual output gain: unity', unity, '+6dB', plus6, 'expected ratio', Math.pow(10, 6 / 20).toFixed(4));
assert.ok(Math.abs(plus6 / unity - Math.pow(10, 6 / 20)) < 1e-6, 'export must apply the OUTPUT knob');
// AUTO holds output at unity: its calibrated trim does the loudness work.
const autoUnity = gainOf({ ...manualBase, outputGain: 6, integratedLUFS: -10, targetLUFS: -14 });
assert.equal(autoUnity, unity, 'AUTO must hold output at unity regardless of the knob');

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
console.log('Storage fallback: PASS');

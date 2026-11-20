globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null };
import { SpectralAnalyzer } from './docs/modules/analyzer.js';
import { FLKnob } from './docs/modules/knob.js';
import { MaestroDSP } from './docs/modules/dsp.js';

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

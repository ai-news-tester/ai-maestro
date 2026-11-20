// Deshimmer regression tests - assert-based, mock AudioContext style from bug-repro.mjs
globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null };
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MaestroDSP } from './docs/modules/dsp.js';

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
const approx = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, label + ': expected ' + expected + ', got ' + actual);

// Registry entry (Task 3 Step 3 values)
const registry = JSON.parse(readFileSync(new URL('./docs/knob-registry.json', import.meta.url), 'utf8'));
const knob = registry.compositeKnobs.find((k) => k.id === 'deshimmer');
assert.ok(knob, 'deshimmer knob missing from registry');
assert.equal(knob.label, 'DESHIMMER');
assert.equal(knob.module, 'naturalization');
assert.equal(knob.moduleTitle, 'NATURALIZATION');
assert.equal(knob.ring, 'green');
assert.equal(knob.min, 0);
assert.equal(knob.max, 100);
assert.equal(knob.step, 1);
assert.equal(knob.default, 0);
assert.equal(knob.unit, '%');
assert.equal(knob.liveDSP, true);
assert.ok(knob.info.description.includes('does not remove watermarks'), 'info must say it does not remove watermarks');
assert.ok(knob.info.description.includes('does not affect AI detection'), 'info must say it does not affect AI detection');
assert.equal(registry.presets.off.compositeValues.deshimmer, 0, 'preset off deshimmer');
assert.equal(registry.presets.lowProfile.compositeValues.deshimmer, 10, 'preset lowProfile deshimmer');
assert.equal(registry.presets.standardEvasion.compositeValues.deshimmer, 0, 'preset standardEvasion deshimmer');
assert.equal(registry.presets.deepClean.compositeValues.deshimmer, 35, 'preset deepClean deshimmer');
assert.equal(registry.presets.fullScrub.compositeValues.deshimmer, 55, 'preset fullScrub deshimmer');

// DSP live stage (Task 3 Step 4)
const dsp = new MaestroDSP();
dsp.init(ctx);
assert.equal(dsp.params.deshimmer, 0, 'params.deshimmer default must be 0');
assert.ok(dsp.deshimmerShelf, 'deshimmerShelf missing after init');
assert.equal(dsp.deshimmerShelf.type, 'highshelf');
approx(dsp.deshimmerShelf.frequency.v, 10000, 'shelf frequency');
approx(dsp.deshimmerShelf.Q.v, 0.7, 'shelf Q');
approx(dsp.deshimmerShelf.gain.v, 0, 'shelf gain at init');

const baseNeural = dsp.params.neuralScrub;
const baseBlend = dsp.params.spectralBlend;

dsp.updateFromKnob('deshimmer', 0);
approx(dsp.deshimmerShelf.gain.v, 0, 'shelf gain at 0');
approx(dsp.neuralFilter.gain.v, -12 * (baseNeural / 100), 'neural gain at 0 equals base');
approx(dsp.blendFilter1.gain.v, -6 * (baseBlend / 100), 'blend1 gain at 0 equals base');

dsp.updateFromKnob('deshimmer', 100);
approx(dsp.deshimmerShelf.gain.v, -6, 'shelf gain at 100');
const effNeural = Math.min(100, baseNeural + 20);
approx(dsp.neuralFilter.gain.v, -12 * (effNeural / 100), 'neural gain at 100');
approx(dsp.neuralFilter.frequency.v, 19000 - 8000 * (effNeural / 100), 'neural freq at 100');
const effBlend = Math.min(100, baseBlend + 15);
approx(dsp.blendFilter1.gain.v, -6 * (effBlend / 100), 'blend1 gain at 100');
approx(dsp.blendFilter2.gain.v, -7 * (effBlend / 100), 'blend2 gain at 100');
assert.equal(dsp.params.neuralScrub, baseNeural, 'base neuralScrub must not be overwritten by deshimmer');
assert.equal(dsp.params.spectralBlend, baseBlend, 'base spectralBlend must not be overwritten by deshimmer');

console.log('Deshimmer: PASS');

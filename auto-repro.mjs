// AUTO mode regression tests — assert-based, same style as bug-repro.mjs
globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null };
import assert from 'node:assert/strict';
import { SpectralAnalyzer } from './docs/modules/analyzer.js';

// ---- Task 1: K-weighted LUFS + 4x true peak ----
// Reference: EBU R128 calibration — 1 kHz stereo sine reads its dBFS value in LUFS.
// Amplitude 0.5 = -6.02 dBFS, dual mono => ~-6.0 LUFS (plan's -9.0 was mono RMS, ruled wrong).
const sine = new Float32Array(44100);
for (let i = 0; i < sine.length; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / 44100);
const m = SpectralAnalyzer.measureLoudness(sine, sine, 44100);
console.log('sine LUFS:', m.integratedLUFS, 'truePeak:', m.truePeakDBTP, 'LRA:', m.loudnessRange);
assert.ok(Math.abs(m.integratedLUFS - (-6.0)) < 0.5, `integrated ${m.integratedLUFS} not near -6.0`);
assert.ok(Math.abs(m.truePeakDBTP - (-6.0)) < 0.5, `truePeak ${m.truePeakDBTP} not near -6.0`);

const silence = new Float32Array(44100);
const s = SpectralAnalyzer.measureLoudness(silence, silence, 44100);
console.log('silence LUFS:', s.integratedLUFS, 'truePeak:', s.truePeakDBTP);
assert.ok(s.integratedLUFS === -Infinity || s.integratedLUFS === null, 'silence LUFS must be -Infinity/null');
assert.ok(!Number.isNaN(s.integratedLUFS), 'silence LUFS NaN');
assert.equal(s.truePeakDBTP, -Infinity, 'silence truePeak must be -Infinity');

// True peak must catch inter-sample overs: 11.025 kHz sine at 44.1k sampled at zero crossings
// (4 samples/cycle, all samples ~0) still has analog peak 1.0 => ~0 dBTP, not -inf.
const isp = new Float32Array(4410);
for (let i = 0; i < isp.length; i++) isp[i] = Math.sin(2 * Math.PI * 11025 * i / 44100 + Math.PI / 4);
const tp = SpectralAnalyzer.measureTruePeak(isp, 44100);
console.log('inter-sample truePeak:', tp, '(sample peak:', SpectralAnalyzer.analyze(isp, 44100).peakDBFS, ')');
assert.ok(tp > -1.0, `true peak ${tp} must see the ~0 dBTP analog peak`);

console.log('Task 1: PASS');
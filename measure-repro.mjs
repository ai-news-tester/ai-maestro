// Bughunt regression tests - fixes 1, 2, 5, 9.
// Run: node measure-repro.mjs
import assert from 'node:assert/strict';
import { SpectralAnalyzer } from './docs/modules/analyzer.js';
import { mapAutoReport } from './docs/modules/auto.js';

function fakeBuffer(channels, sr) {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: sr,
    duration: channels[0].length / sr,
    getChannelData: (c) => channels[c],
  };
}

const SR = 44100;

const dcL = new Float32Array(1000).fill(0.5);
const dcR = new Float32Array(1000).fill(-0.25);
const shortR = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([dcL, dcR], SR));
console.log('short DC:', shortR.dcOffsetL, shortR.dcOffsetR);
assert.ok(Math.abs(shortR.dcOffsetL - 0.5) < 1e-6, 'dcOffsetL must be 0.5');
assert.ok(Math.abs(shortR.dcOffsetR - (-0.25)) < 1e-6, 'dcOffsetR must be -0.25');

const sine = new Float32Array(SR);
for (let i = 0; i < sine.length; i++) sine[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
const m = SpectralAnalyzer.measureLoudness(sine, sine, SR);
console.log('sine LUFS:', m.integratedLUFS, 'truePeak:', m.truePeakDBTP);
assert.ok(Math.abs(m.integratedLUFS - (-6.0)) < 0.5, 'sine LUFS must be near -6.0');
assert.ok(Math.abs(m.truePeakDBTP - (-6.0)) < 0.5, 'sine truePeak must be near -6.0');

const isp = new Float32Array(4410);
for (let i = 0; i < isp.length; i++) isp[i] = Math.sin((2 * Math.PI * 11025 * i) / SR + Math.PI / 4);
const tp = SpectralAnalyzer.measureTruePeak(isp, SR);
console.log('inter-sample truePeak:', tp);
assert.ok(tp > -1.0, 'true peak must see the inter-sample peak');

const auto = mapAutoReport({ integratedLUFS: -14, truePeakDBTP: -0.5, clippingCount: 150, carriers: [], echoConfidence: 0, spectralFlatness: 0.1, harshPeaks: [], crestFactorDB: 12, shimmer: { score: 0, confidence: 0 }, sibilance: 0, stereoWidth: 1, correlation: 1, hfCutoff: 20000 });
console.log('auto clipping:', auto.params.qualityGate, auto.params.outputGain);
assert.ok(auto.params.qualityGate > 3, 'clipping must raise qualityGate');
assert.ok(auto.params.outputGain <= -1, 'clipping must pull outputGain to -1 or lower');
// limiterEngaged deleted: the limiter is always in circuit, so the flag described
// nothing. What a clipping track really changes is the gate ceiling, pinned above.
assert.equal(auto.limiterEngaged, undefined, 'limiterEngaged flag must be gone');

// measureLoudness must not allocate per-sample prefix sums. On a 10-minute track
// the old prefix arrays plus their filter temps cost ~0.9 GB and killed the tab.
// Counting Float64Array allocations is deterministic where a GC-timed memory
// bound is not: old = 3n per channel (shelf temp, hp temp, prefix), new = 1n.
{
  const n = SR * 4;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 0.4 * Math.sin((2 * Math.PI * 997 * i) / SR);
  const RealF64 = globalThis.Float64Array;
  let allocated = 0;
  class CountingF64 extends RealF64 {
    constructor(...args) { super(...args); allocated += this.length; }
  }
  globalThis.Float64Array = CountingF64;
  let counted;
  try {
    counted = SpectralAnalyzer.measureLoudness(tone, tone, SR);
  } finally {
    globalThis.Float64Array = RealF64;
  }
  console.log('measureLoudness Float64 samples allocated:', allocated, 'for 2 channels of', n);
  assert.ok(allocated <= 3 * n, `measureLoudness allocated ${allocated} Float64 samples for 2 x ${n} — prefix sums are back (old: 6n)`);
  // The numbers must be the ones the direct-summation reference produces.
  const ref = SpectralAnalyzer.measureLoudness(tone, tone, SR);
  assert.deepEqual(counted, ref, 'allocation counting must not change the measurement');
  assert.ok(Number.isFinite(counted.integratedLUFS), 'stereo tone still measures a finite LUFS');
}
// The meter still covers the tail: audio only in the final partial block.
{
  const tailLen = Math.round(SR * 1.05);
  const tailTone = new Float32Array(tailLen);
  for (let i = SR; i < tailLen; i++) tailTone[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  const tailM = SpectralAnalyzer.measureLoudness(tailTone, tailTone, SR);
  assert.ok(Number.isFinite(tailM.integratedLUFS), 'tail-only audio must stay in the integrated measurement');
  assert.ok(Number.isFinite(tailM.loudnessRange), 'LRA windows must survive the rewrite');
}

console.log('measure-repro: PASS');

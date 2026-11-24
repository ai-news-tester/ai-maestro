// AUTO mode regression tests — assert-based, same style as bug-repro.mjs
globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null, addEventListener() {} };
import assert from 'node:assert/strict';
import { SpectralAnalyzer, StegoDetector, AudioMath } from './docs/modules/analyzer.js';

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

// ---- Task 2: full-track stereo analysis ----
function fakeBuffer(channels, sr) {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: sr,
    duration: channels[0].length / sr,
    getChannelData: (c) => channels[c],
  };
}
const SR = 44100, N = SR * 4; // 4 s
const L = new Float32Array(N), R = new Float32Array(N);
const silenceLen = Math.round(0.5 * SR);
for (let i = silenceLen; i < N; i++) {
  L[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR);
  R[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / SR);
}
for (let i = SR; i < SR + 5; i++) L[i] = 1.0; // 5 clipped samples at 1.0 s
const r = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([L, R], SR));
console.log('full-track: clip', r.clippingCount, 'corr', r.correlation, 'silence', JSON.stringify(r.silenceRanges), 'shimmer', r.shimmer);
assert.equal(r.clippingCount, 5, 'clippingCount must be 5');
assert.ok(r.correlation > 0.9, `correlation ${r.correlation} must be > 0.9`);
assert.equal(r.silenceRanges[0].start, 0, 'first silence range starts at 0');
assert.ok(typeof r.shimmer.score === 'number' && !Number.isNaN(r.shimmer.score) && r.shimmer.score >= 0 && r.shimmer.score <= 1, 'shimmer score 0-1');
assert.equal(r.duration, 4, 'duration');
assert.equal(r.sampleRate, SR, 'sampleRate');
assert.ok(Number.isFinite(r.integratedLUFS), 'integrated LUFS finite for non-silent track');

// MONO accuracy AND parity. Agreement alone was not enough: both sides used the
// same dual-mono rule, so they matched while both read 3.01 dB high and every
// mono export landed 3 dB under target. BS.1770 measures mono as ONE channel.
const monoBuf = fakeBuffer([sine], SR);
const monoReport = SpectralAnalyzer.analyzeFullTrack(monoBuf).integratedLUFS;
const monoRender = MaestroDSP.measureRender(monoBuf).integratedLUFS;
console.log('mono parity: report', monoReport, 'render', monoRender);
assert.ok(Math.abs(monoReport - monoRender) < 0.05, `mono report ${monoReport} vs render ${monoRender} must agree`);
{
  // Reference, derived not borrowed: BS.1770 sums channel energies, and at 1 kHz
  // the K-weighting (+0.65 dB) cancels the -0.691 offset. So ONE channel reads
  // dBFS - 3.01, and dual-mono stereo reads dBFS. The stereo sine at the top of
  // this file pins the second case; these pin the first.
  const refAmp = Math.pow(10, -23 / 20);
  const refMono = new Float32Array(SR * 2);
  for (let i = 0; i < refMono.length; i++) refMono[i] = refAmp * Math.sin((2 * Math.PI * 1000 * i) / SR);
  const refBuf = fakeBuffer([refMono], SR);
  const refReport = SpectralAnalyzer.analyzeFullTrack(refBuf).integratedLUFS;
  const refRender = MaestroDSP.measureRender(refBuf).integratedLUFS;
  console.log('mono reference: -23 dBFS sine reads', refReport, 'LUFS (render', refRender + ')');
  assert.ok(Math.abs(refReport - (-26.02)) < 0.2, `mono -23 dBFS sine must read ~-26 LUFS, got ${refReport} (dual mono reads ~-23)`);
  assert.ok(Math.abs(refRender - (-26.02)) < 0.2, `measureRender must read ~-26 LUFS on mono, got ${refRender}`);
  // The 0.5 sine is -6.02 dBFS, so mono reads -9.03; dual mono read -6.02.
  assert.ok(Math.abs(monoReport - (-9.03)) < 0.2, `mono 0.5 sine must read ~-9.0 LUFS, got ${monoReport}`);
  // Stereo of the same signal legitimately reads 3 dB higher: the rule is per
  // channel count, not a blanket -3 dB correction.
  const stereoSame = SpectralAnalyzer.measureLoudness(sine, sine, SR).integratedLUFS;
  assert.ok(Math.abs((stereoSame - monoReport) - 3.01) < 0.1,
    `dual-mono stereo must read 3.01 dB above mono, got ${(stereoSame - monoReport).toFixed(2)}`);
}

// The chain is stereo: live playback downmixes while export writes every channel,
// so a 5.1 file got a gain chosen from its quiet L/R applied to a loud centre.
// app.js must refuse >2 channels at every entry point rather than measure two.
{
  const { requireSupportedChannels } = await import('./docs/app.js');
  const six = fakeBuffer([sine, sine, sine, sine, sine, sine], SR);
  assert.throws(() => requireSupportedChannels(six), /6-channel audio is not supported/,
    'a 6-channel buffer must be refused with a clear message');
  assert.equal(requireSupportedChannels(monoBuf), monoBuf, 'mono must pass through');
  assert.equal(requireSupportedChannels(fakeBuffer([sine, sine], SR)).numberOfChannels, 2, 'stereo must pass through');
  // All three entry points must call the guard: demo load, upload, restore.
  const appSrcCh = readFs(new URL('./docs/app.js', import.meta.url), 'utf8');
  assert.equal((appSrcCh.match(/requireSupportedChannels\(decoded\)/g) || []).length, 3,
    'demo load, upload and IndexedDB restore must all reject unsupported channel counts');
  // The upload guard must run BEFORE persisting, or a rejected file replaces the good one.
  const upBody = appSrcCh.slice(appSrcCh.indexOf("uploadInput.addEventListener('change'"));
  assert.ok(upBody.indexOf('requireSupportedChannels(decoded)') < upBody.indexOf('saveUploadedAudio'),
    'the channel guard must precede the IndexedDB write');
}

// silence / short buffer: no NaN anywhere, shimmer 0
const shortR = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([new Float32Array(1024), new Float32Array(1024)], SR));
assert.equal(shortR.shimmer.score, 0, 'short buffer shimmer 0');
assert.equal(shortR.shimmer.confidence, 0, 'short buffer confidence 0');
assert.ok(!Number.isNaN(shortR.crestFactorDB), 'short buffer crest not NaN');
const silentR = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([new Float32Array(N), new Float32Array(N)], SR));
assert.equal(silentR.shimmer.score, 0, 'silent shimmer 0');
assert.ok(silentR.silenceRanges.length >= 1 && silentR.silenceRanges[0].start === 0, 'all-silence range');

// synthetic shimmer signal must score higher than a pure sine
const shim = new Float32Array(SR * 2);
for (let i = 0; i < shim.length; i++) {
  shim[i] = 0.3 * Math.sin((2 * Math.PI * 9000 * i) / SR) * (0.5 + 0.5 * Math.sin((2 * Math.PI * 7 * i) / SR))
    + 0.1 * (Math.random() * 2 - 1) * (i % 997 < 500 ? 1 : 0.2); // watery HF bursts
}
const shimScore = SpectralAnalyzer.measureShimmer(shim, SR);
const pureSine = new Float32Array(SR * 2);
for (let i = 0; i < pureSine.length; i++) pureSine[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);
const sineScore = SpectralAnalyzer.measureShimmer(pureSine, SR);
console.log('shimmer synthetic:', shimScore.score, 'vs pure sine:', sineScore.score);
assert.ok(shimScore.score > sineScore.score, 'shimmer signal must score above pure sine');

// Stego echo detector: a pure tone has no echo. The low-quefrency cepstrum is
// lifted by the spectral envelope, so scoring against a global median reads
// the envelope shoulder as a strong echo (demo track: 0.42 ms, conf 0.84).
const stegoSine = new Float32Array(SR * 4);
for (let i = 0; i < stegoSine.length; i++) stegoSine[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
const sineEcho = StegoDetector.analyze(stegoSine, SR);
console.log('stego pure sine confidence:', sineEcho.confidence);
assert.ok(sineEcho.confidence < 0.5, `pure sine reported as echo conf ${sineEcho.confidence} — baseline skewed by spectral envelope`);
// A real 3 ms echo (deterministic LCG noise + delayed copy) must still be found.
let lcgSeed = 12345;
const lcg = new Float32Array(SR * 4);
for (let i = 0; i < lcg.length; i++) { lcgSeed = (lcgSeed * 1103515245 + 12345) & 0x7fffffff; lcg[i] = (lcgSeed / 0x3fffffff) - 1; }
const d3ms = Math.round(0.003 * SR);
const echoedNoise = new Float32Array(SR * 4);
for (let i = 0; i < echoedNoise.length; i++) echoedNoise[i] = lcg[i] + (i >= d3ms ? 0.6 * lcg[i - d3ms] : 0);
const realEcho = StegoDetector.analyze(echoedNoise, SR);
console.log('stego real echo:', realEcho.confidence, realEcho.echoes[0] ? realEcho.echoes[0].delayMs + ' ms' : 'none');
assert.ok(realEcho.confidence > 0.9, 'real 3 ms echo must be detected');
assert.ok(realEcho.echoes[0] && Math.abs(realEcho.echoes[0].delayMs - 3) < 0.2, 'real echo delay near 3 ms');

// Pitch-vs-echo: a pitched tone's period rides a ladder of strong cepstral
// multiples (2x >= 0.5x of the fundamental); echo rahmonics decay as alpha^m.
// A sawtooth must NOT be reported as an echo (real tracks: 440 Hz => 2.27 ms).
const sawTone = new Float32Array(SR * 4);
for (let i = 0; i < sawTone.length; i++) sawTone[i] = 0.5 * (((2 * Math.PI * 220 * i) / SR) % (2 * Math.PI) / Math.PI - 1);
const sawEcho = StegoDetector.analyze(sawTone, SR);
console.log('stego sawtooth confidence:', sawEcho.confidence);
assert.ok(sawEcho.confidence < 0.5, `pitched tone (sawtooth) reported as echo conf ${sawEcho.confidence} — pitch ladder not rejected`);

// Whole-track coverage: the detector must sample frames across the ENTIRE
// track, not just its first ~0.77 s. Common master: silent intro, then a
// watermark echo that runs through the rest of the song.
let introSeed = 424242;
const introNoise = new Float32Array(SR * 12);
for (let i = 0; i < introNoise.length; i++) { introSeed = (introSeed * 1103515245 + 12345) & 0x7fffffff; introNoise[i] = (introSeed / 0x3fffffff) - 1; }
const introTrack = new Float32Array(SR * 12);
for (let i = 3 * SR; i < introTrack.length; i++) introTrack[i] = introNoise[i] + (i >= d3ms ? 0.6 * introNoise[i - d3ms] : 0);
const introEcho = StegoDetector.analyze(introTrack, SR);
console.log('stego echo behind 3s silent intro:', introEcho.confidence, introEcho.echoes[0] ? introEcho.echoes[0].delayMs + ' ms' : 'none');
assert.ok(introEcho.confidence > 0.5, `echo behind a silent intro reported conf ${introEcho.confidence} — detector only read the track's first second`);
assert.ok(introEcho.echoes[0] && Math.abs(introEcho.echoes[0].delayMs - 3) < 0.2, 'intro-case echo delay near 3 ms');

// The AUTO mapper must receive the track's real spectral flatness, or the
// flatness rule can never fire and spectralBlend silently stays at base.
let flatSeed = 777;
const noiseTrack = new Float32Array(SR * 4);
for (let i = 0; i < noiseTrack.length; i++) { flatSeed = (flatSeed * 1103515245 + 12345) & 0x7fffffff; noiseTrack[i] = ((flatSeed / 0x3fffffff) - 1) * 0.3; }
const noiseReport = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([noiseTrack, noiseTrack], SR));
console.log('noise-track flatness:', noiseReport.spectralFlatness);
assert.ok(Number.isFinite(noiseReport.spectralFlatness), 'analyzeFullTrack must report spectralFlatness for the AUTO mapper');
assert.ok(noiseReport.spectralFlatness > 0.3, `white noise flatness ${noiseReport.spectralFlatness} should exceed the 0.3 rule threshold`);
const flatMapped = mapAutoReport(noiseReport, -14);
assert.ok(flatMapped.params.spectralBlend > 40, `flat track must raise spectralBlend above base 40, got ${flatMapped.params.spectralBlend}`);

// Whole-track band coverage: sibilance must see a defect anywhere in the track,
// not only inside a handful of sampled windows. A 2 s burst at 60-62 s of a
// 120 s track falls between the old 8 windows (~17 s apart) and was missed.
const longN = SR * 120;
const longTrack = new Float32Array(longN);
for (let i = 0; i < longN; i++) longTrack[i] = 0.05 * Math.sin((2 * Math.PI * 300 * i) / SR);
for (let i = 60 * SR; i < 62 * SR; i++) longTrack[i] += 0.3 * Math.sin((2 * Math.PI * 6000 * i) / SR);
const longBuf = fakeBuffer([longTrack, longTrack], SR);
const longReport = SpectralAnalyzer.analyzeFullTrack(longBuf);
console.log('late-mid sibilance burst:', longReport.sibilance);
assert.ok(longReport.sibilance > 0.05, `6 kHz burst mid-track missed: sibilance ${longReport.sibilance} — band energy sampled only a few windows`);

// A buffer under 2048 samples is real audio, not silence: a full-scale click
// must report its true peak and no silence range.
const click = new Float32Array(1000).fill(0.999);
const clickReport = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([click, click], SR));
console.log('short click buffer: peak', clickReport.peakDBFS, 'silence', JSON.stringify(clickReport.silenceRanges));
assert.ok(Number.isFinite(clickReport.peakDBFS) && clickReport.peakDBFS > -1, `1000-sample click read as silent (peak ${clickReport.peakDBFS})`);
assert.equal(clickReport.silenceRanges.length, 0, 'full-scale click must not be reported as a silence range');

// Loudness gating must cover the END of the track: blocks stop at the last full
// 400 ms window, so audio only in the final partial window used to be unheard
// by the integrated measurement. BS.1770-5 anchors a final block at n - blockLen.
{
  const tailLen = Math.round(SR * 1.05); // 50 ms past the last full block grid point
  const tailTone = new Float32Array(tailLen);
  for (let i = Math.round(SR * 1.0); i < tailLen; i++) tailTone[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  const tailM = SpectralAnalyzer.measureLoudness(tailTone, tailTone, SR);
  console.log('tail-only loudness:', tailM.integratedLUFS);
  assert.ok(Number.isFinite(tailM.integratedLUFS), `audio only in the last 50 ms was excluded from integrated loudness (${tailM.integratedLUFS})`);
}

// Harsh resonances: a strong narrow 7 kHz peak must be measured as a harshPeak
// and raise spectralBlend. The mapper rule existed but analyzeFullTrack never
// filled the field, so it could never fire on real audio.
{
  const harsh = new Float32Array(SR * 4);
  for (let i = 0; i < harsh.length; i++) harsh[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR) + 0.25 * Math.sin((2 * Math.PI * 7000 * i) / SR);
  const harshReport = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([harsh, harsh], SR));
  console.log('harsh peaks:', JSON.stringify(harshReport.harshPeaks));
  assert.ok(harshReport.harshPeaks.length > 0, '7 kHz resonance must be measured as a harsh peak');
  assert.ok(harshReport.harshPeaks[0].prominenceDB > 6, `harsh prominence ${harshReport.harshPeaks[0].prominenceDB} must exceed the 6 dB rule threshold`);
  const harshMapped = mapAutoReport(harshReport, -14);
  assert.ok(harshMapped.params.spectralBlend > 40, `harsh track must raise spectralBlend above base 40, got ${harshMapped.params.spectralBlend}`);
}

// Streaming STFT: stft must not retain every magnitude frame (a 10-min track
// retained ~800 MB of Float64 frames and could kill a browser tab). Detector
// parity is pinned by the tests above; this pins the memory behaviour.
{
  // A single FFT window must yield exactly one frame.
  const single = AudioMath.stft(new Float32Array(4096).fill(0.1), 4096, 1024);
  assert.ok(!Array.isArray(single.magnitudes), 'stft must return a streaming API, not a retained frame array');
  let count = 0;
  single.forEachFrame(() => count++);
  assert.equal(count, 1, `single-window signal must yield exactly 1 frame, got ${count}`);
  assert.equal(single.numFrames, 1, 'numFrames must report the frame count');

  // A long signal must not keep frames REACHABLE after the pass. Typed-array
  // backing stores live outside the JS heap, so measure `external`. The old
  // retaining implementation kept ~42 MB alive on a 60 s signal; streamed frames
  // leave only uncollected garbage (observed ~5 MB), so 25 MB separates the two.
  const before = process.memoryUsage().external;
  AudioMath.stft(new Float32Array(SR * 60).fill(0.1), 4096, 1024).forEachFrame(() => {});
  const growth = process.memoryUsage().external - before;
  console.log('stft retained after 60s pass:', (growth / 1048576).toFixed(1), 'MB');
  assert.ok(growth < 25 * 1048576, `stft retained ${(growth / 1048576).toFixed(1)} MB of frames — must stream, not retain`);
}

console.log('Task 2: PASS');
// ---- Task 4: one shared mastering chain ----
import { readFileSync as readFs } from 'node:fs';
import { MaestroDSP } from './docs/modules/dsp.js';
const dspSrc = readFs(new URL('./docs/modules/dsp.js', import.meta.url), 'utf8');
assert.equal((dspSrc.match(/buildMasterChain\s*\(/g) || []).length >= 3, true, 'buildMasterChain defined + called by init and exportWAV');
const initBody = dspSrc.slice(dspSrc.indexOf('init(ctx)'), dspSrc.indexOf('connect(sourceNode'));
const exportBody = dspSrc.slice(dspSrc.indexOf('static async exportWAV'));
assert.ok(initBody.includes('buildMasterChain('), 'init must call buildMasterChain');
// export may go through renderChain (shared with AUTO calibration) — it must
// still reach buildMasterChain, never a hand-copied chain.
const renderBody = dspSrc.slice(dspSrc.indexOf('static async renderChain'), dspSrc.indexOf('static measureRender'));
assert.ok(renderBody.includes('buildMasterChain('), 'renderChain must call buildMasterChain');
assert.ok(exportBody.includes('buildMasterChain(') || exportBody.includes('this.renderChain('), 'exportWAV must use the shared chain');
assert.ok(!exportBody.includes('createBiquadFilter'), 'no hand-copied chain left in exportWAV');
const chainBody = dspSrc.slice(dspSrc.indexOf('buildMasterChain(ctx'), dspSrc.indexOf('// MASTER_CHAIN_END'));
const order = ['deshimmerShelf', '10000', 'deesser', '6500', 'airShelfNode', '16000', 'glueComp', 'loudnessGain', '-14', 'tpLimiter'];
let lastIdx = -1;
for (const token of order) {
  const idx = chainBody.indexOf(token);
  assert.ok(idx > lastIdx, `chain order: ${token} must appear after previous stage`);
  lastIdx = idx;
}
assert.ok(chainBody.includes('-1'), 'limiter ceiling -1 dBTP present');
console.log('Task 4: PASS');

// ---- Task 5: AUTO mapper ----
import { mapAutoReport, deshimmerStrengthFromShimmer, SIBILANCE_THRESHOLD } from './docs/modules/auto.js';
// One source of default knob values: dsp.js reuses auto.js BASE, so the
// glue-threshold style drift between mapper base and live defaults cannot recur.
{
  const { BASE } = await import('./docs/modules/auto.js');
  const freshDsp = new MaestroDSP();
  assert.deepEqual(freshDsp.params, BASE, 'dsp default params must deep-equal auto.js BASE');
  // The chain's own defaults must come from BASE too, not a second literal.
  const chainDefaultsLine = chainBody.slice(chainBody.indexOf('const defaults'), chainBody.indexOf('const p = {'));
  assert.ok(/const defaults = BASE;/.test(chainDefaultsLine), 'buildMasterChain defaults must reuse auto.js BASE');
}
assert.equal(deshimmerStrengthFromShimmer({ score: 0.8, confidence: 0.9 }), 80);
assert.equal(deshimmerStrengthFromShimmer({ score: 0.8, confidence: 0.3 }), 0);
assert.equal(deshimmerStrengthFromShimmer({ score: 0.1, confidence: 0.9 }), 0);
assert.equal(deshimmerStrengthFromShimmer(null), 0);

const cleanReport = {
  integratedLUFS: -14, truePeakDBTP: -1, crestFactorDB: 14, clippingCount: 0,
  carriers: [{ freqHz: 15500, prominenceDB: 1.2, confidence: 0 }], echoConfidence: 0,
  spectralFlatness: 0.1, harshPeaks: [], shimmer: { score: 0.05, confidence: 0.9 },
  sibilance: 0.05, stereoWidth: 0.8, correlation: 0.9, hfCutoff: 20000,
};
const clean = mapAutoReport(cleanReport);
assert.equal(clean.params.deshimmer, 0, 'clean track deshimmer 0');
assert.ok(clean.params.carrierErase <= 50, 'clean carrierErase <= 50');
assert.equal(clean.presetKey, 'standardEvasion', 'clean preset');
assert.equal(clean.params.deesser, 0, 'clean deesser off');
// airShelf pass-through deleted (audit 15): the chain reads params.hfCutoff, so
// pin the observable effect instead — a clean track keeps the base air shelf.
assert.equal(clean.params.bandwidthHeal, 0.25, 'clean air shelf stays at base');

const loudReport = {
  integratedLUFS: -8, truePeakDBTP: 0.5, crestFactorDB: 4, clippingCount: 150,
  carriers: [{ freqHz: 15500, prominenceDB: 6.0, confidence: 0.6 }], echoConfidence: 0.4,
  spectralFlatness: 0.5, harshPeaks: [{ freqHz: 7000, prominenceDB: 13 }],
  shimmer: { score: 0.6, confidence: 0.8 }, sibilance: 0.3, stereoWidth: 0.3, correlation: 0.2, hfCutoff: 16000,
};
const loud = mapAutoReport(loudReport);
assert.ok(loud.params.outputGain < 0, 'loud report outputGain < 0');
// limiterEngaged deleted (audit 12): the limiter is always in circuit, so the flag
// described nothing. Pin what a clipping track actually changes: the gate ceiling.
assert.ok(loud.params.qualityGate > 3, 'clipping track raises qualityGate');
assert.ok(loud.params.deshimmer > 0, 'loud shimmer deshimmer > 0');
assert.equal(loud.params.deesser, 1, 'high sibilance deesser on');
assert.equal(loud.params.msBass, 1, 'low correlation msBass on');
assert.ok(loud.params.bandwidthHeal >= 2, 'hf cutoff 16k lifts the air shelf');
assert.equal(loud.presetKey, 'deepClean', 'heavy track must keep deepClean (no standardEvasion veto)');
assert.ok(typeof loud.reasons.carrierErase === 'string' && loud.reasons.carrierErase.length > 0, 'reasons present');

// Threshold sides: named constant used everywhere
const sib = (v) => mapAutoReport({ ...cleanReport, sibilance: v }).params.deesser;
assert.equal(sib(SIBILANCE_THRESHOLD - 0.01), 0, 'below threshold off');
assert.equal(sib(SIBILANCE_THRESHOLD + 0.01), 1, 'above threshold on');

// Real-track-style shimmer (score 0.29 conf 0.25 was blocked by cap) must fire when confidence is real
assert.ok(deshimmerStrengthFromShimmer({ score: 0.29, confidence: 0.6 }) > 0, 'moderate shimmer fires');

// Clamps: extreme report values stay inside registry ranges
const extreme = mapAutoReport({ ...loudReport, integratedLUFS: -40, truePeakDBTP: 6, carriers: [{ prominenceDB: 40 }], echoConfidence: 1 });
assert.ok(extreme.params.outputGain <= 6 && extreme.params.outputGain >= -12, 'outputGain clamped');
assert.ok(extreme.params.carrierErase <= 100 && extreme.params.stegoStrip <= 100, 'percent knobs clamped');

console.log('Task 5: PASS');

// ---- Task 6: AUTO UI wiring, issues model ----
import { readFileSync as rf6 } from 'node:fs';
import { FLKnob } from './docs/modules/knob.js';
const appSrc6 = rf6(new URL('./docs/app.js', import.meta.url), 'utf8');
const reg6 = JSON.parse(rf6(new URL('./docs/knob-registry.json', import.meta.url), 'utf8'));
const dsh = reg6.compositeKnobs.find((k) => k.id === 'deshimmer');
assert.ok(dsh && dsh.info.description.includes('does not remove watermarks') && dsh.info.description.includes('does not affect AI detection'), 'registry disclaimer');
assert.ok(appSrc6.includes('applyAutoReport'), 'app.js must define applyAutoReport');
assert.ok(appSrc6.includes('analyzeFullTrack'), 'app.js must call analyzeFullTrack');
assert.ok(appSrc6.includes('mapAutoReport'), 'app.js must call mapAutoReport');
assert.ok(/Detect/.test(appSrc6) && /Master/.test(appSrc6) && /Export/.test(appSrc6), 'AUTO progress stages');

// Manual override: AUTO sets 80, knob setValue(20) keeps 20
const mk6 = () => ({ dataset: {}, querySelector: () => null, addEventListener() {}, dispatchEvent() {}, style: {} });
const k6 = new FLKnob(mk6(), { knobId: 'deshimmer', min: 0, max: 100, step: 1, default: 0, val: 0, unit: '%', readoutEl: { textContent: '' } });
k6.setValue(80, false);
k6.setValue(20, false);
assert.equal(k6.val, 20, 'manual override keeps 20');

// Issues model: known-issue report produces marker/bar/slider with non-zero default
const { buildAutoIssues } = await import('./docs/modules/spectrum.js');
const auto6 = mapAutoReport(loudReport);
const issues = buildAutoIssues(loudReport, auto6.params, auto6.reasons);
assert.ok(Array.isArray(issues) && issues.length > 0, 'issues list non-empty');
const carrierIssue = issues.find((i) => i.id === 'carrier');
assert.ok(carrierIssue, 'carrier issue present');
assert.ok(carrierIssue.freqLo >= 15000 && carrierIssue.freqHi <= 20000, 'carrier band 15-20k');
assert.ok(carrierIssue.severity > 0, 'carrier severity > 0');
assert.ok(carrierIssue.sliderDefault > 50, 'carrier slider default from AUTO (raised above base 50)');
const lufsIssue = issues.find((i) => i.id === 'loudness');
assert.ok(lufsIssue, 'LUFS issue present');
assert.equal(lufsIssue.target, -14, 'LUFS target -14');
// In AUTO the calibrated trim does the loudness work and OUTPUT is held at unity,
// so these two rows must be read-only: a slider would move a knob that cannot act.
assert.equal(lufsIssue.knobId, null, 'loudness row must not offer an OUTPUT slider');
assert.ok(lufsIssue.sliderDefault !== 0, 'LUFS row still reports a non-zero state');
const tpIssue = issues.find((i) => i.id === 'truePeak');
assert.ok(tpIssue, 'true-peak issue present');
assert.equal(tpIssue.knobId, null, 'true-peak row must not offer an OUTPUT slider');
const clipIssue = issues.find((i) => i.id === 'clipping');
assert.ok(clipIssue && clipIssue.sliderDefault === auto6.params.qualityGate, 'clipping slider wired to qualityGate');
assert.ok(typeof clipIssue.reason === 'string' && clipIssue.reason.length > 0, 'clipping reason non-empty');
for (const i of issues) {
  assert.ok(typeof i.name === 'string' && i.name.length > 0, `issue ${i.id} name`);
  assert.ok(Number.isFinite(i.severity) && i.severity >= 0 && i.severity <= 1, `issue ${i.id} severity 0-1`);
  assert.ok(Number.isFinite(i.sliderDefault), `issue ${i.id} slider finite`);
}
// AUTO must disengage BYPASS (RAW): applyAutoReport routes through the shared
// helper so dsp, ui, pills and the export track type all flip together.
const autoBody6 = appSrc6.slice(appSrc6.indexOf('function applyAutoReport'), appSrc6.indexOf('async function runAutoMaster'));
assert.ok(autoBody6.includes('applyBypassState(false)'), 'applyAutoReport disengages DSP bypass');
assert.ok(appSrc6.includes('function applyBypassState(bypassed)'), 'single bypass source of truth exists');
console.log('Task 6: PASS');

// ---- Task 7 fix: closed-loop loudness, gain before limiters ----
// RED: correctionGainDb does not exist yet; loudnessDb still subtracts
// outputGain; exportWAV still puts outGain after tpLimiter.
assert.equal(typeof MaestroDSP.correctionGainDb, 'function', 'dsp exposes correctionGainDb');
// MustaJaa after-state: -8.09 LUFS, +0.56 dBTP, target -14 -> -5.91 dB
assert.ok(Math.abs(MaestroDSP.correctionGainDb(-8.09, 0.56, -14) - (-5.91)) < 0.01, 'MustaJaa correction -5.91 dB');
// TP-limited case: LUFS on target but TP 0 dBTP -> gain down 1 dB, no clipping
assert.ok(Math.abs(MaestroDSP.correctionGainDb(-14, 0, -14) - (-1)) < 0.01, 'TP-limited correction -1 dB');
const chainBody7 = dspSrc.slice(dspSrc.indexOf('buildMasterChain(ctx'), dspSrc.indexOf('// MASTER_CHAIN_END'));
assert.ok(!chainBody7.includes('targetLUFS - p.integratedLUFS - (p.outputGain'), 'loudnessGain must not subtract outputGain');
const exportBody7 = dspSrc.slice(dspSrc.indexOf('static async exportWAV'), dspSrc.indexOf('static encodeWAV'));
assert.ok(!exportBody7.includes('chain.nodes.outGain'), 'export must not put outGain after tpLimiter');
assert.ok(exportBody7.includes('correctionGainDb') || exportBody7.includes('measureLoudness'), 'export measures and corrects');
console.log('Task 7 fix: PASS');

// ---- Task 7 parity: calibrated trim must be IN the shared chain ----
// RED: no trimGain node, no renderChain helper, AUTO does not calibrate.
assert.ok(chainBody7.includes('autoTrimDb'), 'chain reads autoTrimDb');
// The ceiling must be LAST, and OUTPUT must drive the limiters rather than follow
// them: after the ceiling it reached the speakers at +5 dBFS, and between limiter
// and ceiling a +6 dB boost hit the hard clipper instead of the 20:1 limiter.
assert.ok(chainBody7.includes('loudnessGain.connect(outGain)'), 'OUTPUT sits after the loudness gain');
assert.ok(chainBody7.includes('outGain.connect(qualityLimiter)'), 'OUTPUT drives the Quality Gate limiter');
assert.ok(chainBody7.includes('tpLimiter.connect(trimGain)'), 'trim after the true-peak limiter');
assert.ok(chainBody7.includes('trimGain.connect(ceiling)'), 'ceiling after the trim, so nothing bypasses it');
assert.ok(chainBody7.includes('output: ceiling'), 'chain output is the ceiling node');
assert.equal(typeof MaestroDSP.renderChain, 'function', 'renderChain helper shared by export and calibration');
const autoRunBody = appSrc6.slice(appSrc6.indexOf('async function runAutoMaster'), appSrc6.indexOf('// ============================================================================\n// Preset Profile Management'));
assert.ok(autoRunBody.includes('renderChain'), 'AUTO calibrates from a real render');
assert.ok(autoRunBody.includes('correctionGainDb'), 'AUTO computes the trim from measurement');
assert.ok(autoRunBody.includes('autoTrimDb'), 'AUTO stores the trim in params');
assert.ok(autoBody6.includes('autoTrimDb'), 'applyAutoReport pushes trim to live dsp.params');
const revertIdx = appSrc6.indexOf('revertManualBtn');
const revertBody = appSrc6.slice(revertIdx, revertIdx + 600);
assert.ok(revertBody.includes('clearAutoParams()'), 'revert clears AUTO state via the shared helper');
const clearBody = appSrc6.slice(appSrc6.indexOf('function clearAutoParams'), appSrc6.indexOf('/** Cancel an in-flight AUTO run'));
assert.ok(clearBody.includes('autoTrimDb: 0') && clearBody.includes('integratedLUFS: null'), 'clearAutoParams resets AUTO trim and loudness');
console.log('Task 7 parity: PASS');

// ---- Final review fix pass: races, export clobber, refresh persistence ----
// RED before fixes: no run token, export overlays autoParams over manual knobs,
// persistCurrentSettings stores only composite knobs.
const autoRunBody2 = appSrc6.slice(appSrc6.indexOf('async function runAutoMaster'), appSrc6.indexOf('// ============================================================================\n// Preset Profile Management'));
assert.ok(autoRunBody2.includes('autoRunToken'), 'runAutoMaster guards stale runs with a token');
const exportSetupBody = appSrc6.slice(appSrc6.indexOf('function setupExportWAV'), appSrc6.indexOf('// ============================================================================\n// Application Boot'));
assert.ok(!exportSetupBody.includes('Object.assign(currentKnobValues, autoParams)'), 'export must not clobber manual knob moves with autoParams');
const persistBody = appSrc6.slice(appSrc6.indexOf('function persistCurrentSettings'), appSrc6.indexOf('/** Composite knob turned'));
assert.ok(persistBody.includes('autoParams'), 'persistCurrentSettings saves AUTO params');
const bootBody = appSrc6.slice(appSrc6.indexOf("const savedSettings = PersistenceManager.loadSettings()"));
assert.ok(bootBody.includes('savedSettings.autoParams'), 'boot restores AUTO params');
console.log('Final fixes: PASS');

// Refresh parity: dsp is created in ensureAudioContext AFTER boot step 9,
// so AUTO chain params must be re-pushed there, not only at step 9.
const ensureBody = appSrc6.slice(appSrc6.indexOf('function ensureAudioContext'), appSrc6.indexOf('function applyCompositeKnobDSP'));
assert.ok(ensureBody.includes('autoParams'), 'ensureAudioContext restores AUTO chain params on dsp creation');
const uploadBody = appSrc6.slice(appSrc6.indexOf("uploadInput.addEventListener('change'"), appSrc6.indexOf('// 7. WAV Export setup'));
assert.ok(uploadBody.includes('cancelAutoRun()'), 'upload cancels an in-flight AUTO run');
const cancelBody = appSrc6.slice(appSrc6.indexOf('/** Cancel an in-flight AUTO run'), appSrc6.indexOf('function ensureAudioContext'));
assert.ok(cancelBody.includes('autoRunToken') && cancelBody.includes('disabled = false'), 'cancel re-enables the AUTO button');
console.log('Refresh parity: PASS');

// ---- Audit pass: live/export parity outside the AUTO flow ----
// 2. Preset switch mid-playback must rebuild the chain: clearAutoParams only
// resets params, so the old track's AUTO de-esser/trim stayed audible while
// export rendered the cleared params.
{
  const presetBody = appSrc6.slice(appSrc6.indexOf('function applyPreset'), appSrc6.indexOf('// ============================================================================\n// AUTO Controls Wiring'));
  assert.ok(presetBody.includes('clearAutoParams()'), 'applyPreset clears AUTO params');
  const rebuild = presetBody.slice(presetBody.indexOf('persistCurrentSettings()'));
  assert.ok(/if \(dsp && currentSource\) dsp\.connect\(currentSource, audioCtx\.destination\)/.test(rebuild),
    'applyPreset must rebuild the live chain in place when a source is playing');
}

// 3. Reset to demo must cancel an in-flight AUTO run, or a finishing run applies
// the old track's trim/issues to the demo.
{
  const resetIdx = appSrc6.indexOf("resetDemoBtn.addEventListener('click'");
  assert.ok(resetIdx > 0, 'reset handler present');
  const resetBody = appSrc6.slice(resetIdx, resetIdx + 400);
  assert.ok(resetBody.includes('cancelAutoRun()'), 'reset-to-demo must cancel an in-flight AUTO run');
  assert.ok(resetBody.indexOf('cancelAutoRun()') < resetBody.indexOf('uploadedBuffer = null'),
    'cancel must come first, before the reset starts touching state');
}

// 5. Restarting playback must resume from the current position: playbackOffset
// is stale while playing, so a bare startPlayback() jumped back to it.
{
  const applyBody = appSrc6.slice(appSrc6.indexOf('function applyAutoReport'), appSrc6.indexOf('/**\n * Full-track analysis in a module Worker'));
  assert.ok(applyBody.includes('startPlayback(getCurrentPlaybackTime())'), 'applyAutoReport must restart at the current time');
  const autoCtrlBody = appSrc6.slice(appSrc6.indexOf('function setupAutoControls'), appSrc6.indexOf('// ============================================================================\n// Export WAV Offline Handler'));
  assert.ok(!/startPlayback\(\)/.test(autoCtrlBody), 'AUTO controls must not restart from the stale offset while playing');
  assert.equal((autoCtrlBody.match(/startPlayback\(getCurrentPlaybackTime\(\)\)/g) || []).length, 3,
    'both A/B play buttons and revert must pass the current playback time');
}

// 7. The telemetry panel labels the whole track, so it must analyse the whole track.
// It now reuses AUTO's off-thread full-track report instead of re-running the
// detectors on the main thread (5.4 s of frozen page on a 4-minute track).
{
  const forensicBody = appSrc6.slice(appSrc6.indexOf('function runForensicAnalysis'), appSrc6.indexOf('export function updateTelemetryUI'));
  assert.ok(!forensicBody.includes('sr * 12'), 'telemetry must not cap analysis at 12 s while labelling the full duration');
  assert.ok(forensicBody.includes('reportFor(buffer)'),
    'telemetry must analyse the full buffer off the main thread, reusing the shared report');
  assert.ok(!/CarrierDetector\.analyze|StegoDetector\.analyze/.test(forensicBody),
    'telemetry must not re-run the detectors the full-track report already ran');
  assert.ok(forensicBody.includes('forensicToken'), 'a newer track load must supersede an in-flight telemetry run');
}

// 11. Full-track analysis runs off the main thread, cancellable by the run token.
{
  const workerBody = appSrc6.slice(appSrc6.indexOf('async function analyzeFullTrackOffThread'), appSrc6.indexOf('async function runAutoMaster'));
  assert.ok(workerBody.includes("new Worker(new URL('./modules/analyzer-worker.js', import.meta.url), { type: 'module' })"),
    'analysis must use a module Worker resolved relative to app.js (static hosting, no build step)');
  assert.ok(workerBody.includes('terminate()'), 'a settled/cancelled run must terminate its worker');
  assert.ok(workerBody.includes('SpectralAnalyzer.analyzeFullTrack'), 'a main-thread fallback keeps AUTO working without module workers');
  const runBody = appSrc6.slice(appSrc6.indexOf('async function runAutoMaster'), appSrc6.indexOf('// ============================================================================\n// Preset Profile Management'));
  const awaitIdx = runBody.indexOf('await reportFor(buffer)');
  assert.ok(awaitIdx > 0, 'runAutoMaster must await the shared worker report');
  assert.ok(runBody.slice(awaitIdx, awaitIdx + 200).includes('token !== autoRunToken'),
    'the run token must be re-checked after the await so cancelAutoRun still works');
  // The worker wrapper is additive: analyzer.js keeps its Node import surface.
  const workerSrc = readFs(new URL('./docs/modules/analyzer-worker.js', import.meta.url), 'utf8');
  assert.ok(workerSrc.includes("import { SpectralAnalyzer } from './analyzer.js'"), 'worker imports the same analyzer module the tests use');
  assert.ok(workerSrc.includes('analyzeFullTrack'), 'worker runs the real full-track analysis');
  assert.ok(!readFs(new URL('./docs/modules/analyzer.js', import.meta.url), 'utf8').includes('self.onmessage'),
    'analyzer.js must stay worker-agnostic for the Node suites');

  // The worker module itself must produce the same report as a direct call.
  // It only touches `self`, so a shim runs the real file here.
  const posted = [];
  globalThis.self = { onmessage: null, postMessage: (m) => posted.push(m) };
  await import('./docs/modules/analyzer-worker.js');
  assert.equal(typeof globalThis.self.onmessage, 'function', 'worker must install an onmessage handler');
  const wLen = SR * 2;
  const wL = new Float32Array(wLen), wR = new Float32Array(wLen);
  for (let i = 0; i < wLen; i++) { wL[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR); wR[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR); }
  const direct = SpectralAnalyzer.analyzeFullTrack(fakeBuffer([wL, wR], SR));
  globalThis.self.onmessage({ data: { channels: [wL, wR], sampleRate: SR } });
  assert.equal(posted.length, 1, 'worker must post exactly one reply');
  assert.ok(!posted[0].error, 'worker must not report an error on a valid buffer: ' + posted[0].error);
  assert.deepEqual(posted[0].report, direct, 'worker report must equal the main-thread analysis');
  // A bad payload must surface as an error message, not a silent hang.
  globalThis.self.onmessage({ data: { channels: [], sampleRate: SR } });
  assert.ok(posted[1] && posted[1].error, 'worker must post an error instead of throwing');
  delete globalThis.self;

  // The app-side wrapper: resolves the worker report, terminates, and falls back
  // to the main thread when workers are unavailable or fail.
  const fnSrc = appSrc6.slice(appSrc6.indexOf('async function analyzeFullTrackOffThread'), appSrc6.indexOf('async function runAutoMaster'));
  // import.meta.url is not legal inside new Function; pin it to app.js's own URL.
  const shimmed = fnSrc.replace('import.meta.url', JSON.stringify(new URL('./docs/app.js', import.meta.url).href));
  const makeWrapper = (WorkerImpl) => new Function('SpectralAnalyzer', 'Worker', 'console',
    shimmed + '\nreturn analyzeFullTrackOffThread;')(SpectralAnalyzer, WorkerImpl, { warn() {} });
  const wBuf = fakeBuffer([wL, wR], SR);
  let terminated = 0, sawUrl = '', sawOpts = null;
  class GoodWorker {
    constructor(url, opts) { sawUrl = String(url); sawOpts = opts; }
    postMessage(msg) { this.onmessage({ data: { report: SpectralAnalyzer.analyzeFullTrack(fakeBuffer(msg.channels, msg.sampleRate)) } }); }
    terminate() { terminated++; }
  }
  const viaWorker = await makeWrapper(GoodWorker)(wBuf);
  assert.deepEqual(viaWorker, direct, 'wrapper must resolve the worker report unchanged');
  assert.ok(sawUrl.endsWith('modules/analyzer-worker.js'), 'worker URL must resolve next to app.js, got ' + sawUrl);
  assert.deepEqual(sawOpts, { type: 'module' }, 'worker must be a module worker (static hosting, no build)');
  assert.equal(terminated, 1, 'the wrapper must terminate the worker once it settles');
  // A worker that reports an error must not lose the analysis.
  class BadWorker {
    postMessage() { this.onmessage({ data: { error: 'boom' } }); }
    terminate() {}
  }
  assert.deepEqual(await makeWrapper(BadWorker)(wBuf), direct, 'worker failure must fall back to the main thread');
  // No Worker constructor at all (file:// origin): still analyse.
  const ThrowingWorker = function () { throw new Error('module workers unsupported'); };
  assert.deepEqual(await makeWrapper(ThrowingWorker)(wBuf), direct, 'missing worker support must fall back to the main thread');
}

// 13. Negative carrier prominence must not render "+-4.20 dB".
{
  const telemetryBody = appSrc6.slice(appSrc6.indexOf('function updateTelemetryUI'), appSrc6.indexOf('function formatPlaybackTime'));
  assert.ok(!/`\+\$\{c\d?\.prominenceDB/.test(telemetryBody), 'carrier readouts must not hardcode a + prefix');
  // One loop over three slots now writes all three cards (audit 9): a per-card
  // copy is why a stale third card could exist in the first place.
  assert.ok(/for \(let slot = 1; slot <= 3; slot\+\+\)/.test(telemetryBody), 'the three tone cards must be written from one loop');
  assert.ok(telemetryBody.includes('fmtProm(c.prominenceDB)'), 'the card loop must use the sign-aware formatter');
  const fmtPromSrc = telemetryBody.slice(telemetryBody.indexOf('const fmtProm'), telemetryBody.indexOf('\n', telemetryBody.indexOf('const fmtProm')));
  const fmtProm = new Function('return ' + fmtPromSrc.replace(/^const fmtProm = /, '').replace(/;$/, ''))();
  assert.equal(fmtProm(4.2), '+4.20 dB', 'positive prominence keeps the explicit +');
  assert.equal(fmtProm(-4.2), '-4.20 dB', 'negative prominence must read -4.20 dB, not +-4.20 dB');
  assert.equal(fmtProm(0), '0.00 dB', 'zero carries no sign');
}

// 14. The target selector must work after a reload: autoParams is restored while
// autoReport is still null.
{
  const autoCtrlBody = appSrc6.slice(appSrc6.indexOf('function setupAutoControls'), appSrc6.indexOf('// ============================================================================\n// Export WAV Offline Handler'));
  assert.ok(/if \(autoReport \|\| autoParams\) runAutoMaster\(\)/.test(autoCtrlBody),
    'target change must re-run AUTO when only the restored autoParams exist');
}
console.log('Audit pass: PASS');

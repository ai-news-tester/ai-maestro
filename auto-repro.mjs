// AUTO mode regression tests — assert-based, same style as bug-repro.mjs
globalThis.window = { addEventListener() {} };
globalThis.document = { getElementById: () => null };
import assert from 'node:assert/strict';
import { SpectralAnalyzer, StegoDetector } from './docs/modules/analyzer.js';

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

// MONO parity: measureRender must use analyzeFullTrack's dual-mono convention,
// otherwise AUTO's trim under-measures by 3.01 dB and exports too loud.
const monoBuf = fakeBuffer([sine], SR);
const monoReport = SpectralAnalyzer.analyzeFullTrack(monoBuf).integratedLUFS;
const monoRender = MaestroDSP.measureRender(monoBuf).integratedLUFS;
console.log('mono parity: report', monoReport, 'render', monoRender);
assert.ok(Math.abs(monoReport - monoRender) < 0.05, `mono report ${monoReport} vs render ${monoRender} must agree`);

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
assert.equal(clean.params.airShelf, 0, 'clean air off');

const loudReport = {
  integratedLUFS: -8, truePeakDBTP: 0.5, crestFactorDB: 4, clippingCount: 150,
  carriers: [{ freqHz: 15500, prominenceDB: 6.0, confidence: 0.6 }], echoConfidence: 0.4,
  spectralFlatness: 0.5, harshPeaks: [{ freqHz: 7000, prominenceDB: 13 }],
  shimmer: { score: 0.6, confidence: 0.8 }, sibilance: 0.3, stereoWidth: 0.3, correlation: 0.2, hfCutoff: 16000,
};
const loud = mapAutoReport(loudReport);
assert.ok(loud.params.outputGain < 0, 'loud report outputGain < 0');
assert.equal(loud.limiterEngaged, true, 'loud limiter engaged');
assert.ok(loud.params.deshimmer > 0, 'loud shimmer deshimmer > 0');
assert.equal(loud.params.deesser, 1, 'high sibilance deesser on');
assert.equal(loud.params.msBass, 1, 'low correlation msBass on');
assert.equal(loud.params.airShelf, 1, 'hf cutoff 16k air on');
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
assert.ok(lufsIssue.sliderDefault !== 0, 'LUFS slider non-zero when off target');
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
assert.ok(chainBody7.includes('ceiling.connect(trimGain)'), 'trim after ceiling, inside shared chain');
assert.ok(chainBody7.includes('trimGain.connect(outGain)'), 'output knob wired after trim, inside shared chain');
assert.ok(chainBody7.includes('output: outGain'), 'chain output is the output knob node');
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

/**
 * AUTO mapper — deterministic rules from a full-track analysis report
 * to mastering params. No ML. Every value is clamped to the preset
 * ranges in docs/knob-registry.json (standardEvasion is the base).
 * Consumes SpectralAnalyzer.analyzeFullTrack() output.
 */

const TARGET_LUFS = -14;
const TARGET_TP = -1;

export const SIBILANCE_THRESHOLD = 0.15;

// Exported so dsp.js can reuse it as the single source of default knob values.
export const BASE = {
  carrierErase: 50,
  strideRemove: 35,
  stegoStrip: 45,
  neuralScrub: 45,
  spectralBlend: 40,
  phaseScatter: 40,
  statNormalize: 40,
  hashBreak: 30,
  roomInject: 35,
  textureInject: 35,
  deshimmer: 0,
  bandwidthHeal: 0.25,
  dynamicsNatural: 40,
  qualityGate: 3,
  outputGain: 0,
};

const RANGES = {
  carrierErase: [0, 100],
  strideRemove: [0, 100],
  stegoStrip: [0, 100],
  neuralScrub: [0, 100],
  spectralBlend: [0, 100],
  phaseScatter: [0, 100],
  statNormalize: [0, 100],
  hashBreak: [0, 100],
  roomInject: [0, 100],
  textureInject: [0, 100],
  deshimmer: [0, 100],
  bandwidthHeal: [-6, 6],
  dynamicsNatural: [0, 100],
  qualityGate: [1, 6],
  outputGain: [-12, 6],
};

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function clampParam(key, v) {
  const [lo, hi] = RANGES[key];
  return clamp(v, lo, hi);
}

/**
 * Deshimmer strength 0-100 from a shimmer measurement.
 * Gated: confidence below 0.5, or a low score below 0.2, means no
 * deshimmer — a clean or uncertain track must not be dulled.
 * Otherwise strength is score * 100, rounded to an integer.
 */
export function deshimmerStrengthFromShimmer(shimmer) {
  if (!shimmer || typeof shimmer !== 'object') return 0;
  const score = shimmer.score;
  const confidence = shimmer.confidence;
  if (!Number.isFinite(score) || !Number.isFinite(confidence)) return 0;
  if (confidence < 0.5) return 0;
  if (score < 0.2) return 0;
  return Math.round(clamp(score * 100, 0, 100));
}

export function mapAutoReport(report = {}, targetLUFS = TARGET_LUFS) {
  const target = Number.isFinite(targetLUFS) ? targetLUFS : TARGET_LUFS;
  const r = report || {};
  const params = { ...BASE };
  const reasons = {};

  const carriers = Array.isArray(r.carriers) ? r.carriers : [];
  const prominences = carriers.map((c) => (typeof c === 'number' ? c : c && c.prominenceDB)).filter(Number.isFinite);
  const maxCarrier = prominences.length ? Math.max(...prominences) : 0;
  const topCarrier = carriers.find((c) => c && c.prominenceDB === maxCarrier);

  // Carrier prominence over 3 dB raises carrierErase.
  if (maxCarrier > 3) {
    params.carrierErase = Math.round(clampParam('carrierErase', BASE.carrierErase + (maxCarrier - 3) * 5));
    reasons.carrierErase = `Carrier prominence ${maxCarrier.toFixed(1)} dB${topCarrier && topCarrier.freqHz ? ` at ${Math.round(topCarrier.freqHz)} Hz` : ''} raised carrierErase to ${params.carrierErase}`;
  } else {
    reasons.carrierErase = `No carrier above 3 dB (max ${maxCarrier.toFixed(1)} dB) - carrierErase stays ${params.carrierErase}`;
  }

  // Echo confidence raises stegoStrip.
  const echo = Number.isFinite(r.echoConfidence) ? r.echoConfidence : 0;
  if (echo > 0) {
    params.stegoStrip = Math.round(clampParam('stegoStrip', BASE.stegoStrip + echo * 30));
    reasons.stegoStrip = `Echo confidence ${echo.toFixed(3)} raised stegoStrip to ${params.stegoStrip}`;
  } else {
    reasons.stegoStrip = `Echo confidence ${echo.toFixed(3)} - stegoStrip stays ${params.stegoStrip}`;
  }

  // Flatness and harsh peaks raise spectralBlend.
  const flatness = Number.isFinite(r.spectralFlatness) ? r.spectralFlatness : 0;
  const harshPeaks = Array.isArray(r.harshPeaks) ? r.harshPeaks : [];
  const harshProms = harshPeaks.map((p) => p && p.prominenceDB).filter(Number.isFinite);
  const maxHarsh = harshProms.length ? Math.max(...harshProms) : 0;
  let blend = BASE.spectralBlend;
  if (flatness > 0.3) blend += (flatness - 0.3) * 50;
  if (maxHarsh > 6) blend += (maxHarsh - 6) * 2;
  params.spectralBlend = Math.round(clampParam('spectralBlend', blend));
  reasons.spectralBlend = `Spectral flatness ${flatness.toFixed(3)} and harsh peak prominence ${maxHarsh.toFixed(1)} dB set spectralBlend to ${params.spectralBlend}`;

  // Low crest raises dynamicsNatural (more glue compression for squashed tracks).
  const crest = Number.isFinite(r.crestFactorDB) ? r.crestFactorDB : 12;
  if (crest < 12) {
    params.dynamicsNatural = Math.round(clampParam('dynamicsNatural', BASE.dynamicsNatural + (12 - crest) * 4));
    reasons.dynamicsNatural = `Crest factor ${crest.toFixed(1)} dB raised dynamicsNatural to ${params.dynamicsNatural}`;
  } else {
    reasons.dynamicsNatural = `Crest factor ${crest.toFixed(1)} dB - dynamicsNatural stays ${params.dynamicsNatural}`;
  }

  // Loudness: gain toward target LUFS, clamped to the outputGain range.
  // True peak above -1 dBTP pulls gain down further; clipping forces it down.
  const lufs = r.integratedLUFS;
  const tp = r.truePeakDBTP;
  const clippingCount = Number.isFinite(r.clippingCount) ? r.clippingCount : 0;
  let gain = BASE.outputGain;
  if (Number.isFinite(lufs)) gain = target - lufs;
  if (Number.isFinite(tp) && tp > TARGET_TP) gain = Math.min(gain, TARGET_TP - tp);
  if (clippingCount > 100) gain = Math.min(gain, -1);
  gain = Math.round(clampParam('outputGain', gain) * 2) / 2;
  params.outputGain = gain;
  params.targetLUFS = target;
  if (clippingCount > 0) {
    params.qualityGate = clampParam('qualityGate', BASE.qualityGate + Math.min(3, Math.ceil(clippingCount / 50)));
    reasons.qualityGate = `Clipping count ${clippingCount} raised qualityGate to ${params.qualityGate}`;
  } else {
    reasons.qualityGate = `Clipping count ${clippingCount} - qualityGate stays ${params.qualityGate}`;
  }
  reasons.outputGain = `Integrated loudness ${Number.isFinite(lufs) ? lufs.toFixed(1) : 'n/a'} LUFS (target ${target}), true peak ${Number.isFinite(tp) ? tp.toFixed(1) : 'n/a'} dBTP, clipping count ${clippingCount} set outputGain to ${params.outputGain} dB`;

  // Shimmer raises deshimmer, via the gated helper.
  const deshimmer = deshimmerStrengthFromShimmer(r.shimmer);
  params.deshimmer = deshimmer;
  const shimmer = r.shimmer || {};
  if (deshimmer > 0) {
    reasons.deshimmer = `Shimmer score ${Number(shimmer.score).toFixed(2)} (confidence ${Number(shimmer.confidence).toFixed(2)}) raised deshimmer to ${deshimmer}`;
  } else {
    reasons.deshimmer = 'Shimmer low or uncertain - deshimmer off';
  }

  // High sibilance enables the de-esser; the chain reads params.sibilance against the same constant.
  const sibilance = Number.isFinite(r.sibilance) ? r.sibilance : 0;
  params.sibilance = clamp(sibilance, 0, 1);
  params.deesser = sibilance > SIBILANCE_THRESHOLD ? 1 : 0;
  reasons.deesser = `Sibilance ${sibilance.toFixed(3)} (5-8 kHz energy share) ${params.deesser ? 'enabled' : 'left off'} the de-esser`;

  // Correlation below 0.3 enables M/S bass anchoring. Width is deliberately not a
  // trigger: a mono file has width 0 and correlation 1, and needs no anchoring.
  const correlation = Number.isFinite(r.correlation) ? r.correlation : 1;
  params.correlation = correlation;
  params.msBass = correlation < 0.3 ? 1 : 0;
  reasons.msBass = `Stereo correlation ${correlation.toFixed(2)} ${params.msBass ? 'enabled' : 'left off'} M/S bass anchoring`;

  // HF cutoff at 16000 Hz enables the air shelf (chain reads params.hfCutoff).
  const hfCutoff = Number.isFinite(r.hfCutoff) ? r.hfCutoff : 0;
  params.hfCutoff = hfCutoff;
  const airShelf = (hfCutoff > 0 && hfCutoff <= 16000);
  if (airShelf) {
    params.bandwidthHeal = clampParam('bandwidthHeal', Math.max(BASE.bandwidthHeal, 2));
  }
  reasons.airShelf = `HF cutoff ${hfCutoff ? Math.round(hfCutoff) + ' Hz' : 'n/a'} ${airShelf ? 'enabled' : 'left off'} the air shelf`;

  // Pass-throughs the shared chain (dsp.js buildMasterChain) reads.
  params.crestFactorDB = crest;
  params.integratedLUFS = Number.isFinite(lufs) ? lufs : null;

  // Preset selection: clean or low-confidence -> standardEvasion; severe -> deepClean.
  // No later override: a heavy track keeps deepClean (worktree bug: veto forced standardEvasion).
  const clean = maxCarrier <= 3 && echo < 0.3 && deshimmer === 0
    && clippingCount === 0 && (!Number.isFinite(lufs) || Math.abs(lufs - target) < 1)
    && (!Number.isFinite(tp) || tp <= TARGET_TP);
  const severe = deshimmer >= 50 || params.carrierErase >= 75 || params.stegoStrip >= 65
    || clippingCount > 100 || maxHarsh > 12;
  const presetKey = (!clean && severe) ? 'deepClean' : 'standardEvasion';
  reasons.presetKey = clean
    ? 'Track clean - standardEvasion preset'
    : `Preset ${presetKey} from carrier ${maxCarrier.toFixed(1)} dB, echo ${echo.toFixed(2)}, shimmer ${deshimmer}, clipping ${clippingCount}`;

  return { params, reasons, presetKey };
}
/**
 * AI-Maestro Real-Time DSP Processing Engine & Offline Lossless WAV Exporter
 * Implements a complete 14-node Web Audio processing cascade:
 *  1. Stride Remove (peaking cuts at 172.3 / 344.6 Hz)
 *  2. Stego Strip (peaking cut at 3800 Hz)
 *  3. Carrier Notches (15.5k, 17.5k, 19.5k biquad notch filters)
 *  4. Neural Scrub (high-shelf, corner slides 19 -> 11 kHz)
 *  5. Spectral Blend (peaking cuts at 4200 / 7600 Hz)
 *  6. Phase Scatter (3-stage all-pass network at 850 / 2400 / 6800 Hz)
 *  7. Stat Normalize (soft-knee waveshaper, unity-peak normalized)
 *  8. Hash Break (sine LFO modulating a 3 ms delay)
 *  9. Room Inject (two delay taps at 16 / 31 ms through a lowpass)
 * 10. Texture Inject (odd-symmetric tanh saturation waveshaper)
 * 11. Bandwidth Heal (12 kHz high-shelf air EQ)
 * 12. Dynamics Naturalizer (feed-forward compressor)
 * 13. Quality Gate (20:1 safety limiter)
 * 14. Master Gain Staging & A/B Dry/Wet click-free bypass
 */

import { BASE, SIBILANCE_THRESHOLD } from './auto.js';
import { SpectralAnalyzer } from './analyzer.js';

export class MaestroDSP {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.destination = null;
    this.isBypassed = false;

    // 1. Stride Remove (peaking cuts at 172.3 Hz & 344.6 Hz)
    this.stride1 = null;
    this.stride2 = null;

    // 2. Stego Strip (peaking cut at 3800 Hz)
    this.stegoComb = null;

    // 3. Carrier Notches (15.5k, 17.5k, 19.5k)
    this.notch1 = null;
    this.notch2 = null;
    this.notch3 = null;

    // 4. Neural Scrub (high-shelf, corner slides 19 -> 11 kHz)
    this.neuralFilter = null;

    // Deshimmer (HF shelf at 10 kHz)
    this.deshimmerShelf = null;

    // AUTO mastering stages (built by buildMasterChain)
    this.deesser = null;
    this.airShelf = null;
    this.monoLows = null;
    this.loudnessGain = null;
    this.truePeakLimiter = null;
    this.chain = null;

    // 5. Spectral Blend (peaking cuts at 4200 Hz & 7600 Hz)
    this.blendFilter1 = null;
    this.blendFilter2 = null;

    // 6. Phase Scatter (3-stage all-pass phase dispersion network)
    this.allpass1 = null;
    this.allpass2 = null;
    this.allpass3 = null;

    // 7. Stat Normalize (soft-knee waveshaper)
    this.statShaper = null;

    // 8. Hash Break (3 ms delay modulated by a sine LFO)
    this.hashDelay = null;
    this.hashLfo = null;
    this.hashLfoGain = null;

    // 9. Room Inject (two delay taps at 16 ms & 31 ms)
    this.roomSend = null;
    this.roomDelay1 = null;
    this.roomDelay2 = null;
    this.roomFilter = null;
    this.roomReturn = null;
    this.roomMixBus = null;

    // 10. Texture Inject (analog harmonic saturator)
    this.textureShaper = null;

    // 11. Bandwidth Heal (air-band high shelf)
    this.shelf = null;

    // 12. Dynamics Naturalizer (studio compressor)
    this.dynamicsComp = null;

    // 13. Quality Gate (brickwall safety limiter)
    this.qualityLimiter = null;

    // 14. Output Gain, Bypass routing & Dual Analysers (Raw vs Processed)
    this.outGain = null;
    this.wetGain = null;
    this.dryGain = null;
    this.rawAnalyser = null; // Pre-DSP raw audio analyser (faded ghost trace)
    this.analyser = null;    // Post-DSP processed analyser (ochre trace)

    // Cache of active parameters (defaults shared with the AUTO mapper)
    this.params = { ...BASE };
  }

  /**
   * Generate static soft-knee waveshaper curve for peak normalization.
   * Includes peak unity normalization factor to eliminate gain-staging drop and limiter pumping.
   */
  static makeStatCurve(amount = 0.4, n = 2048) {
    const curve = new Float32Array(n);
    const k = Math.max(0, Math.min(1, amount));
    const normFactor = 1 + 0.25 * k;
    for (let i = 0; i < n; i++) {
      // A WaveShaperNode reads index i at 2i/(n-1)-1: the /n grid put every curve
      // half a step off its own axis, which injected DC and lost the unity peak.
      const x = (i * 2) / (n - 1) - 1;
      // Soft saturation that squashes high statistical outliers with unity peak normalization
      curve[i] = (x / (1 + 0.25 * k * Math.abs(x))) * normFactor;
    }
    return curve;
  }

  /**
   * Generate harmonic saturation curve (analog tape/tube exciter).
   * Odd-symmetric: tanh is odd and the squared factor is even, so the product is
   * odd and produces odd harmonics only. No even-harmonic term.
   */
  static makeTextureCurve(amount = 0.35, n = 2048) {
    const curve = new Float32Array(n);
    const drive = 1.0 + amount * 1.5;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      const driven = x * drive;
      curve[i] = Math.tanh(driven) * (1.0 - 0.05 * amount * (x * x));
    }
    return curve;
  }

  /** Hard-clip curve at -1 dB (0.891): nothing after the limiter exceeds it. */
  static makeCeilingCurve(n = 2048) {
    const curve = new Float32Array(n);
    const ceil = Math.pow(10, -1 / 20);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.max(-ceil, Math.min(ceil, x));
    }
    return curve;
  }

  /** Glue compressor threshold (dB): crest-aware, shared by live and export paths. */
  static glueThreshold(crestFactorDB, dynamicsNatural) {
    const crest = Number.isFinite(crestFactorDB) ? crestFactorDB : 12;
    const crestThresh = -13.2 - Math.max(0, (crest - 14) * 0.5);
    return Math.min(crestThresh, -6 - 18 * (dynamicsNatural / 100));
  }

  /**
   * Closed-loop correction (dB, reduction only) from a measured render:
   * bring LUFS to target, but never above the -1 dBTP headroom.
   */
  static correctionGainDb(measuredLUFS, measuredTP, targetLUFS = -14) {
    const target = Number.isFinite(targetLUFS) ? targetLUFS : -14;
    let gain = 0;
    if (Number.isFinite(measuredLUFS)) gain = Math.min(gain, target - measuredLUFS);
    if (Number.isFinite(measuredTP)) gain = Math.min(gain, -1 - measuredTP);
    return gain;
  }

  /**
   * Loudness-matched A/B monitor gains (linear). The dry path is lifted by the
   * LUFS difference so switching to BYPASS changes timbre, not level; both paths
   * then drop by whatever headroom the louder of the two needs under -1 dBTP.
   * Reduction only — a monitor never boosts above unity. Unmeasured input => 1.
   * trimDb is the chain's calibrated autoTrimDb: the live wet path runs through
   * it, so the master's measured values must be shifted by it before matching.
   * @returns {{dry: number, wet: number}}
   */
  static auditionGains(original = {}, master = {}, trimDb = 0) {
    const unity = { dry: 1, wet: 1 };
    const oLUFS = original.integratedLUFS, mLUFS = master.integratedLUFS;
    const oTP = original.truePeakDBTP, mTP = master.truePeakDBTP;
    if (!Number.isFinite(oLUFS) || !Number.isFinite(mLUFS) || !Number.isFinite(oTP) || !Number.isFinite(mTP)) return unity;
    const trim = Number.isFinite(trimDb) ? Math.min(0, trimDb) : 0;
    const matchDb = (mLUFS + trim) - oLUFS;
    const peakDb = Math.max(mTP + trim, oTP + matchDb);
    // Headroom is shared by both paths: clamping either one on its own would
    // reintroduce the level difference the match exists to remove.
    const monitorDb = Math.min(0, -1 - peakDb, -matchDb);
    return {
      dry: Math.pow(10, (matchDb + monitorDb) / 20),
      wet: Math.pow(10, monitorDb / 20),
    };
  }

  /**
   * Hold a rendered buffer under -1 dBTP. Clamping (the ceiling waveshaper, the
   * correction, encodeWAV) flattens wave tops and creates inter-sample overs the
   * sample peak cannot see, so the peak is measured, not assumed, and a constant
   * trim restores the ceiling without reshaping the waveform.
   * @returns {number} the trim applied in dB (0 when already under the ceiling)
   */
  static enforceTruePeakCeiling(buffer) {
    let tp = -Infinity;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      tp = Math.max(tp, SpectralAnalyzer.measureTruePeak(buffer.getChannelData(c), buffer.sampleRate));
    }
    if (!Number.isFinite(tp) || tp <= -1) return 0;
    // 0.05 dB margin: Float32 quantization can leave the re-measured peak a
    // hair above a bare -1 target, which is still an over on a real DAC.
    const db = -1.05 - tp;
    const trim = Math.pow(10, db / 20);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= trim;
    }
    return db;
  }

  /** Apply a reduction-only gain + hard -1 dB clamp in place to a rendered buffer. */
  static applyCorrectionDb(buffer, db) {
    if (!db || db >= 0) return buffer;
    const linear = Math.pow(10, db / 20);
    const ceil = Math.pow(10, -1 / 20);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const v = data[i] * linear;
        data[i] = v > ceil ? ceil : v < -ceil ? -ceil : v;
      }
    }
    this.enforceTruePeakCeiling(buffer);
    return buffer;
  }

  /**
   * Build the shared cleanup + mastering chain used by live playback and export.
   * Nodes are created on (or reused from) `nodes`; for the live instance pass `this`.
   * @param {AudioContext} ctx
   * @param {Object} params - composite knobs plus AUTO pass-throughs (sibilance, hfCutoff, correlation, msBass, crestFactorDB, integratedLUFS, targetLUFS)
   * @param {Object} nodes - node cache (live instance or {})
   * @returns {{input: AudioNode, output: AudioNode, nodes: Object}}
   */
  static buildMasterChain(ctx, params = {}, nodes = {}) {
    const now = ctx.currentTime || 0;
    const set = (param, v) => { if (param.setValueAtTime) param.setValueAtTime(v, now); else param.value = v; };
    const makeFilter = (key, type, freq, q = 0.7, gain = 0) => {
      const n = nodes[key] || ctx.createBiquadFilter();
      n.type = type;
      set(n.frequency, freq); set(n.Q, q); set(n.gain, gain);
      nodes[key] = n;
      return n;
    };
    const defaults = BASE;
    const p = { ...defaults, ...params };
    const sNorm = p.strideRemove / 100, cNorm = p.carrierErase / 100;
    const stride1 = makeFilter('stride1', 'peaking', 172.3, 6, -10 * sNorm);
    const stride2 = makeFilter('stride2', 'peaking', 344.6, 7, -7 * sNorm);
    const stegoComb = makeFilter('stegoComb', 'peaking', 3800, 3, -8 * (p.stegoStrip / 100));
    const notch1 = makeFilter('notch1', 'notch', 15500, 28 - 25.5 * cNorm);
    const notch2 = makeFilter('notch2', 'notch', 17500, 24 - 21.5 * cNorm);
    const notch3 = makeFilter('notch3', 'notch', 19500, 20 - 18 * cNorm);
    const effN = Math.min(100, p.neuralScrub + 0.20 * p.deshimmer);
    const effB = Math.min(100, p.spectralBlend + 0.15 * p.deshimmer);
    const neuralFilter = makeFilter('neuralFilter', 'highshelf', 19000 - 8000 * (effN / 100), 0.7, -12 * (effN / 100));
    const deshimmerShelf = makeFilter('deshimmerShelf', 'highshelf', 10000, 0.7, -0.06 * p.deshimmer);
    const deesser = makeFilter('deesser', 'peaking', 6500, 2, p.sibilance > SIBILANCE_THRESHOLD ? -6 : 0);
    const airShelfNode = makeFilter('airShelf', 'highshelf', 16000, 0.7, p.hfCutoff > 0 && p.hfCutoff <= 16000 ? 2 : 0);
    const blendFilter1 = makeFilter('blendFilter1', 'peaking', 4200, 2, -6 * (effB / 100));
    const blendFilter2 = makeFilter('blendFilter2', 'peaking', 7600, 2.5, -7 * (effB / 100));
    const monoLows = makeFilter('monoLows', 'lowshelf', 120, 0.7, p.correlation < 0.3 || p.msBass === 1 ? -3 : 0);
    const allpass1 = makeFilter('allpass1', 'allpass', 850, 0.5 + 7.5 * (p.phaseScatter / 100));
    const allpass2 = makeFilter('allpass2', 'allpass', 2400, 0.8 + 8 * (p.phaseScatter / 100));
    const allpass3 = makeFilter('allpass3', 'allpass', 6800, 1 + 8.5 * (p.phaseScatter / 100));
    const statShaper = nodes.statShaper || ctx.createWaveShaper(); nodes.statShaper = statShaper;
    statShaper.curve = MaestroDSP.makeStatCurve(p.statNormalize / 100); statShaper.oversample = '2x';
    const hashDelay = nodes.hashDelay || ctx.createDelay(0.05); nodes.hashDelay = hashDelay;
    set(hashDelay.delayTime, 0.003);
    const hashLfo = nodes.hashLfo || ctx.createOscillator(); nodes.hashLfo = hashLfo;
    hashLfo.type = 'sine'; set(hashLfo.frequency, 0.25 + 0.55 * (p.hashBreak / 100));
    const hashLfoGain = nodes.hashLfoGain || ctx.createGain(); nodes.hashLfoGain = hashLfoGain;
    set(hashLfoGain.gain, 0.0001 + 0.0017 * (p.hashBreak / 100));
    hashLfo.connect(hashLfoGain); hashLfoGain.connect(hashDelay.delayTime);
    try { hashLfo.start(now); } catch (_) {}
    const roomSend = nodes.roomSend || ctx.createGain(); nodes.roomSend = roomSend; set(roomSend.gain, 1.0);
    const roomDelay1 = nodes.roomDelay1 || ctx.createDelay(0.1); nodes.roomDelay1 = roomDelay1; set(roomDelay1.delayTime, 0.016);
    const roomDelay2 = nodes.roomDelay2 || ctx.createDelay(0.1); nodes.roomDelay2 = roomDelay2; set(roomDelay2.delayTime, 0.031);
    const roomFilter = makeFilter('roomFilter', 'lowpass', 4200);
    const roomReturn = nodes.roomReturn || ctx.createGain(); nodes.roomReturn = roomReturn; set(roomReturn.gain, 0.25 * (p.roomInject / 100));
    const roomMixBus = nodes.roomMixBus || ctx.createGain(); nodes.roomMixBus = roomMixBus; set(roomMixBus.gain, 1.0);
    const textureShaper = nodes.textureShaper || ctx.createWaveShaper(); nodes.textureShaper = textureShaper;
    textureShaper.curve = MaestroDSP.makeTextureCurve(p.textureInject / 100); textureShaper.oversample = '2x';
    const shelf = makeFilter('shelf', 'highshelf', 12000, 0.7, p.bandwidthHeal);
    const glueComp = nodes.dynamicsComp || ctx.createDynamicsCompressor(); nodes.dynamicsComp = glueComp;
    const dynThresh = MaestroDSP.glueThreshold(p.crestFactorDB, p.dynamicsNatural);
    set(glueComp.threshold, dynThresh); set(glueComp.knee, 10); set(glueComp.ratio, 1.5 + 2.5 * (p.dynamicsNatural / 100)); set(glueComp.attack, 0.025); set(glueComp.release, 0.14);
    const qualityLimiter = nodes.qualityLimiter || ctx.createDynamicsCompressor(); nodes.qualityLimiter = qualityLimiter;
    set(qualityLimiter.threshold, -0.2 - 0.45 * Math.max(1, Math.min(6, p.qualityGate))); set(qualityLimiter.knee, 0); set(qualityLimiter.ratio, 20); set(qualityLimiter.attack, 0.003); set(qualityLimiter.release, 0.05);
    const loudnessGain = nodes.loudnessGain || ctx.createGain(); nodes.loudnessGain = loudnessGain;
    const targetLUFS = Number.isFinite(p.targetLUFS) ? p.targetLUFS : -14;
    // All gain before the limiters: loudness gain already is target minus input.
    const loudnessDb = Number.isFinite(p.integratedLUFS) ? Math.max(-12, Math.min(12, targetLUFS - p.integratedLUFS)) : 0;
    set(loudnessGain.gain, Math.pow(10, loudnessDb / 20));
    const tpLimiter = nodes.truePeakLimiter || ctx.createDynamicsCompressor(); nodes.truePeakLimiter = tpLimiter;
    set(tpLimiter.threshold, -1); set(tpLimiter.knee, 0); set(tpLimiter.ratio, 20); set(tpLimiter.attack, 0.001); set(tpLimiter.release, 0.05);
    const ceiling = nodes.ceiling || ctx.createWaveShaper(); nodes.ceiling = ceiling;
    ceiling.curve = MaestroDSP.makeCeilingCurve(); ceiling.oversample = '4x';
    // AUTO trim: calibrated from a measured render so live matches export.
    const trimGain = nodes.trimGain || ctx.createGain(); nodes.trimGain = trimGain;
    const trimDb = Number.isFinite(p.autoTrimDb) ? Math.min(0, p.autoTrimDb) : 0;
    set(trimGain.gain, Math.pow(10, trimDb / 20));
    const outGain = nodes.outGain || ctx.createGain(); nodes.outGain = outGain; set(outGain.gain, Number.isFinite(p.integratedLUFS) ? 1 : Math.pow(10, (p.outputGain || 0) / 20));
    const chain = [stride1, stride2, stegoComb, notch1, notch2, notch3, neuralFilter, deshimmerShelf, deesser, airShelfNode, blendFilter1, blendFilter2, allpass1, allpass2, allpass3, statShaper, hashDelay];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    hashDelay.connect(roomMixBus); hashDelay.connect(roomSend); roomSend.connect(roomDelay1); roomSend.connect(roomDelay2); roomDelay1.connect(roomFilter); roomDelay2.connect(roomFilter); roomFilter.connect(roomReturn); roomReturn.connect(roomMixBus);
    roomMixBus.connect(textureShaper); textureShaper.connect(shelf); shelf.connect(monoLows); monoLows.connect(glueComp); glueComp.connect(loudnessGain); loudnessGain.connect(outGain); outGain.connect(qualityLimiter); qualityLimiter.connect(tpLimiter); tpLimiter.connect(trimGain); trimGain.connect(ceiling);
    // OUTPUT drives the limiters, and the ceiling is genuinely last. After the
    // ceiling it reached the speakers at +5 dBFS; between limiter and ceiling a
    // +6 dB boost hit the hard clipper instead of the 20:1 limiter.
    return { input: stride1, output: ceiling, nodes };
  }
  // MASTER_CHAIN_END

  /**
   * Initialize bypass routing, dual analysers, and the shared chain
   * (every processing node is created by buildMasterChain).
   * @param {AudioContext} ctx
   */
  init(ctx) {
    this.ctx = ctx;
    const now = ctx.currentTime;

    // Stages 1-13 are created and parameterised by buildMasterChain below.

    // 14. Output Gain & Bypass routing
    this.outGain = ctx.createGain();
    this.outGain.gain.setValueAtTime(1.0, now); // 0 dB

    this.wetGain = ctx.createGain();
    this.wetGain.gain.setValueAtTime(1.0, now);

    this.dryGain = ctx.createGain();
    this.dryGain.gain.setValueAtTime(0.0, now);

    // Dual Spectrum Analysers (Raw Input Ghost Trace & Processed Active Trace)
    this.rawAnalyser = ctx.createAnalyser();
    this.rawAnalyser.fftSize = 2048;
    this.rawAnalyser.smoothingTimeConstant = 0.8;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    // Build the shared mastering chain on the live nodes (connect() rebuilds it with current params).
    this.chain = MaestroDSP.buildMasterChain(ctx, this.params, this);
  }

  /**
   * Connect an audio source to the complete DSP cascade and destination.
   * @param {AudioNode} sourceNode
   * @param {AudioNode} destinationNode
   */
  connect(sourceNode, destinationNode) {
    this.source = sourceNode;
    this.destination = destinationNode;
    this.chain = MaestroDSP.buildMasterChain(this.ctx, this.params, this);
    sourceNode.connect(this.rawAnalyser);
    sourceNode.connect(this.chain.input);
    // outGain is the chain's final node, so the OUTPUT knob reaches live and
    // export equally; the wet/dry crossfade feeds the analyser directly, and
    // BYPASS (RAW) now crosses around the output knob too, as its label claims.
    this.chain.output.connect(this.wetGain);
    sourceNode.connect(this.dryGain);
    this.wetGain.connect(this.analyser);
    this.dryGain.connect(this.analyser);
    this.analyser.connect(destinationNode);
  }

  /**
   * Update real-time DSP parameters smoothly from a specific composite knob.
   * Zero delay: applies immediately with 25ms smoothing to prevent clicks.
   * @param {string} knobId
   * @param {number} val
   */
  updateFromKnob(knobId, val) {
    if (!this.ctx) return;
    this.params[knobId] = val;
    const now = this.ctx.currentTime;
    const ramp = 0.025; // 25ms click-free audio automation

    switch (knobId) {
      case 'carrierErase': {
        const norm = val / 100;
        // Wide delta: Q widens down to 2.2 at 100% (broad notch sweep), 28.0 at 0% (surgical)
        const q1 = 28.0 - 25.5 * norm;
        const q2 = 24.0 - 21.5 * norm;
        const q3 = 20.0 - 18.0 * norm;
        if (this.notch1) this.notch1.Q.setTargetAtTime(q1, now, ramp);
        if (this.notch2) this.notch2.Q.setTargetAtTime(q2, now, ramp);
        if (this.notch3) this.notch3.Q.setTargetAtTime(q3, now, ramp);
        break;
      }
      case 'strideRemove': {
        const norm = val / 100;
        // Calibrated cuts from 0 dB down to -10 dB on 172.3 Hz & -7 dB on 344.6 Hz (preserves bass body)
        const cut1 = 0.0 - 10.0 * norm;
        const cut2 = 0.0 - 7.0 * norm;
        if (this.stride1) this.stride1.gain.setTargetAtTime(cut1, now, ramp);
        if (this.stride2) this.stride2.gain.setTargetAtTime(cut2, now, ramp);
        break;
      }
      case 'stegoStrip': {
        const norm = val / 100;
        // Peaking cut calibrated from 0 dB down to -8 dB (preserves presence)
        const cut = 0.0 - 8.0 * norm;
        if (this.stegoComb) this.stegoComb.gain.setTargetAtTime(cut, now, ramp);
        break;
      }
      case 'neuralScrub': {
        const eff = Math.min(100, val + 0.20 * (this.params.deshimmer || 0));
        const norm = eff / 100;
        // High-shelf cutoff sweeps 19 kHz down to 11 kHz, and cut from 0 dB down to -12 dB (preserves air & cymbals)
        const freq = 19000 - 8000 * norm;
        const cut = 0.0 - 12.0 * norm;
        if (this.neuralFilter) {
          this.neuralFilter.frequency.setTargetAtTime(freq, now, ramp);
          this.neuralFilter.gain.setTargetAtTime(cut, now, ramp);
        }
        break;
      }
      case 'spectralBlend': {
        const eff = Math.min(100, val + 0.15 * (this.params.deshimmer || 0));
        const norm = eff / 100;
        // Resonant peak cuts from 0 dB down to -6 dB and -7 dB (tames harsh peaks without scooping)
        const cut1 = 0.0 - 6.0 * norm;
        const cut2 = 0.0 - 7.0 * norm;
        if (this.blendFilter1) this.blendFilter1.gain.setTargetAtTime(cut1, now, ramp);
        if (this.blendFilter2) this.blendFilter2.gain.setTargetAtTime(cut2, now, ramp);
        break;
      }
      case 'deshimmer': {
        if (this.deshimmerShelf) this.deshimmerShelf.gain.setTargetAtTime(-0.06 * val, now, ramp);
        this.updateFromKnob('neuralScrub', this.params.neuralScrub);
        this.updateFromKnob('spectralBlend', this.params.spectralBlend);
        break;
      }
      case 'phaseScatter': {
        const norm = val / 100;
        // Allpass Q scales from 0.5 up to 8.5 for intense spatial phase dispersion
        const q1 = 0.5 + 7.5 * norm;
        const q2 = 0.8 + 8.0 * norm;
        const q3 = 1.0 + 8.5 * norm;
        if (this.allpass1) this.allpass1.Q.setTargetAtTime(q1, now, ramp);
        if (this.allpass2) this.allpass2.Q.setTargetAtTime(q2, now, ramp);
        if (this.allpass3) this.allpass3.Q.setTargetAtTime(q3, now, ramp);
        break;
      }
      case 'statNormalize': {
        const norm = val / 100;
        if (this.statShaper) {
          // Soft-knee saturation amount with unity peak normalization
          this.statShaper.curve = MaestroDSP.makeStatCurve(norm);
        }
        break;
      }
      case 'hashBreak': {
        const norm = val / 100;
        // Delay modulation depth from 0.0001s up to 0.0018s (~1.8ms) & LFO speed 0.25 to 0.8 Hz (avoids flutter/wow)
        const depth = 0.0001 + 0.0017 * norm;
        const rate = 0.25 + 0.55 * norm;
        if (this.hashLfoGain) this.hashLfoGain.gain.setTargetAtTime(depth, now, ramp);
        if (this.hashLfo) this.hashLfo.frequency.setTargetAtTime(rate, now, ramp);
        break;
      }
      case 'roomInject': {
        const norm = val / 100;
        // Wet reflection mix from 0.0 (dry) up to 0.25 (subtle room ambiance without slap echo)
        const wet = 0.0 + 0.25 * norm;
        if (this.roomReturn) this.roomReturn.gain.setTargetAtTime(wet, now, ramp);
        break;
      }
      case 'textureInject': {
        const norm = val / 100;
        if (this.textureShaper) {
          // Drive scales for warm analog saturation
          this.textureShaper.curve = MaestroDSP.makeTextureCurve(norm);
        }
        break;
      }
      case 'bandwidthHeal': {
        // Air band shelf gain from -6 dB up to +6 dB at 12 kHz
        const gain = val;
        if (this.shelf) this.shelf.gain.setTargetAtTime(gain, now, ramp);
        break;
      }
      case 'dynamicsNatural': {
        const norm = val / 100;
        const thresh = MaestroDSP.glueThreshold(this.params.crestFactorDB, val);
        const ratio = 1.5 + 2.5 * norm;
        if (this.dynamicsComp) {
          this.dynamicsComp.threshold.setTargetAtTime(thresh, now, ramp);
          this.dynamicsComp.ratio.setTargetAtTime(ratio, now, ramp);
        }
        break;
      }
      case 'qualityGate': {
        const lvl = Math.max(1, Math.min(6, val));
        const thresh = -0.2 - 0.45 * lvl; // -0.65 dB down to -2.90 dB brickwall ceiling
        if (this.qualityLimiter) this.qualityLimiter.threshold.setTargetAtTime(thresh, now, ramp);
        break;
      }
      case 'outputGain': {
        // AUTO holds output at unity (calibrated trim does the loudness work),
        // so the knob must stay inert live exactly as buildMasterChain does.
        if (Number.isFinite(this.params.integratedLUFS)) break;
        const gainLinear = Math.pow(10, val / 20); // clean output staging
        if (this.outGain) this.outGain.gain.setTargetAtTime(gainLinear, now, ramp);
        break;
      }
    }
  }

  /**
   * Bulk-update all 14 DSP nodes from the full state dictionary.
   * @param {Object} compositeValues
   */
  updateAllFromState(compositeValues = {}) {
    for (const [knobId, val] of Object.entries(compositeValues)) {
      this.updateFromKnob(knobId, val);
    }
  }

  /**
   * Set the loudness-matched A/B monitor gains, or null for a plain unity A/B.
   * Applies immediately if a path is already open, so AUTO can retune the
   * monitor mid-playback without waiting for the next toggle.
   * @param {{dry: number, wet: number}|null} gains
   */
  setAudition(gains) {
    const valid = gains && Number.isFinite(gains.dry) && Number.isFinite(gains.wet)
      && gains.dry > 0 && gains.wet > 0 && gains.dry <= 1 && gains.wet <= 1;
    this.audition = valid ? { dry: gains.dry, wet: gains.wet } : null;
    this.applyBypassGains();
  }

  /** Route the wet/dry crossfade through the audition gains when one is set. */
  applyBypassGains() {
    if (!this.ctx || !this.wetGain || !this.dryGain) return;
    const now = this.ctx.currentTime;
    const rampTime = 0.03;
    const a = this.audition || { dry: 1, wet: 1 };
    this.wetGain.gain.setTargetAtTime(this.isBypassed ? 0 : a.wet, now, rampTime);
    this.dryGain.gain.setTargetAtTime(this.isBypassed ? a.dry : 0, now, rampTime);
  }

  /**
   * Toggle A/B Bypass cleanly with 30ms ramp.
   * @param {boolean} bypass
   */
  setBypass(bypass) {
    this.isBypassed = !!bypass;
    this.applyBypassGains();
  }

  /**
   * Export processed AudioBuffer to 16-bit PCM WAV using OfflineAudioContext.
   * Runs the complete 14-node processing cascade offline with current settings,
   * or exports pristine unadulterated PCM directly if in bypass mode.
   * @param {AudioBuffer} audioBuffer
   * @param {Object} params - composite knob settings
   * @param {boolean} isBypassed - if true, skips wet cascade and encodes raw PCM
   * @returns {Promise<Blob>}
   */
  /** Render one buffer through the shared chain offline (export + AUTO calibration). */
  static async renderChain(audioBuffer, params = {}) {
    // The chain has a 3 ms hash delay, a 47 ms room path and 50-140 ms compressor
    // releases: rendering exactly buffer.length would cut the chain's own decay
    // off the end of the track. Render 100 ms past the input, then trim.
    const tail = Math.round(0.1 * audioBuffer.sampleRate);
    const offlineCtx = new OfflineAudioContext(audioBuffer.numberOfChannels, audioBuffer.length + tail, audioBuffer.sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    const chain = MaestroDSP.buildMasterChain(offlineCtx, params);
    source.connect(chain.input);
    chain.output.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();
    return rendered.length === audioBuffer.length ? rendered : this.trimToLength(rendered, audioBuffer.length);
  }

  /** Copy the first `length` frames of a rendered buffer into a new buffer. */
  static trimToLength(buffer, length) {
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c).slice(0, length));
    if (typeof AudioBuffer === 'function') {
      const trimmed = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      for (let c = 0; c < chans.length; c++) trimmed.copyToChannel(chans[c], c);
      return trimmed;
    }
    // Node test env: no AudioBuffer constructor; a shaped plain object is enough.
    return { length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, getChannelData: (c) => chans[c] };
  }

  /** Measure a rendered buffer with the same BS.1770 meter the report uses. */
  static measureRender(buffer) {
    // Mono is one channel, matching analyzeFullTrack: dual mono reads 3 dB high.
    return SpectralAnalyzer.measureLoudness(buffer.getChannelData(0), buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null, buffer.sampleRate);
  }

  static async exportWAV(audioBuffer, params = {}, isBypassed = false) {
    if (isBypassed) {
      // BYPASS promises pristine PCM: no trim, no reshaping.
      return this.encodeWAV(audioBuffer);
    }
    const renderedBuffer = await this.renderChain(audioBuffer, params);
    // AUTO already calibrated autoTrimDb inside the chain; the JS correction
    // stays as a safety net for AUTO-style renders without a trim. Manual
    // renders (no integratedLUFS) are never loudness-corrected.
    if (!Number.isFinite(params.autoTrimDb) && Number.isFinite(params.integratedLUFS)) {
      try {
        const measured = this.measureRender(renderedBuffer);
        const correction = MaestroDSP.correctionGainDb(measured.integratedLUFS, measured.truePeakDBTP, Number.isFinite(params.targetLUFS) ? params.targetLUFS : -14);
        if (correction < 0) MaestroDSP.applyCorrectionDb(renderedBuffer, correction);
      } catch (_) {}
    }
    // The ceiling belongs to every processed export, not just the branch above:
    // AUTO always carries autoTrimDb, and a manual OUTPUT boost lands after the
    // chain's ceiling stage. encodeWAV's clamp would otherwise hide the overs.
    try { MaestroDSP.enforceTruePeakCeiling(renderedBuffer); } catch (_) {}
    return this.encodeWAV(renderedBuffer);
  }

  /**
   * Encode AudioBuffer into 16-bit PCM WAV Blob.
   * @param {AudioBuffer} buffer
   * @returns {Blob}
   */
  static encodeWAV(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numSamples = buffer.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');

    // "fmt " sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16-bit

    // "data" sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write interleaved 16-bit PCM samples
    const channels = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(buffer.getChannelData(c));
    }

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numChannels; c++) {
        let sample = channels[c][i];
        sample = Math.max(-1, Math.min(1, sample));
        // One scale for both signs: positives scaled by 0x7FFF lost exactly 1 LSB
        // against a 32768 decode, so BYPASS was not bit-identical. Clamp, do not wrap.
        const intSample = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  static writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }
}

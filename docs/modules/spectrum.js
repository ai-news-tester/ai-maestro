/**
 * Real-Time Logarithmic Spectrum Canvas Renderer
 * High-precision 20 Hz - 22.05 kHz logarithmic FFT visualizer with carrier watermark zones.
 * Pure real data from Web Audio AnalyserNodes — zero synthetic sine simulations.
 * Dual-Trace Overlay:
 *   - Faded Ghost Trace (Amber/Orange): Raw, unprocessed pre-DSP audio
 *   - Live Evasion Trace (Cyan/Blue): Active real-time DSP processed audio
 */

import { SIBILANCE_THRESHOLD } from './auto.js';

const AUTO_RANGES = { carrierErase: [0, 100, 1], stegoStrip: [0, 100, 1], spectralBlend: [0, 100, 1], deshimmer: [0, 100, 1], bandwidthHeal: [-6, 6, 0.25], dynamicsNatural: [0, 100, 1], qualityGate: [1, 6, 0.1], outputGain: [-12, 6, 0.5] };
function clamp01(v) { return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }

/**
 * Per-issue marker/bar/slider model from an analyzeFullTrack report plus mapAutoReport
 * params and reasons. Only issues over target are emitted. Non-EQ issues carry
 * freqLo/freqHi null (bars only, no spectrum band). sliderDefault is the AUTO-computed
 * knob value, so AUTO sets the slider and a manual move can diverge from it.
 */
export function buildAutoIssues(report = {}, params = {}, reasons = {}, targetLUFS) {
  const r = report || {};
  const p = params || {};
  const why = reasons || {};
  const target = Number.isFinite(targetLUFS) ? targetLUFS : (Number.isFinite(p.targetLUFS) ? p.targetLUFS : -14);
  const duration = Number.isFinite(r.duration) ? r.duration : 0;
  const whole = duration > 0 ? [{ start: 0, end: duration }] : [];
  const issues = [];
  const add = (o) => {
    const range = AUTO_RANGES[o.knobId] || [0, 100, 1];
    issues.push({
      id: o.id || o.knobId, name: o.name,
      freqLo: o.freqLo !== undefined ? o.freqLo : null,
      freqHi: o.freqHi !== undefined ? o.freqHi : null,
      timeStart: whole[0] ? whole[0].start : 0, timeEnd: whole[0] ? whole[0].end : duration,
      measured: o.measured, target: o.target, unit: o.unit || '', severity: clamp01(o.severity),
      knobId: o.knobId || null,
      sliderDefault: o.knobId ? (p[o.knobId] !== undefined && p[o.knobId] !== null ? p[o.knobId] : 0) : (o.sliderDefault !== undefined ? o.sliderDefault : 0),
      sliderMin: range[0], sliderMax: range[1], sliderStep: range[2],
      reason: o.reason || why[o.knobId] || '',
    });
  };
  const carriers = Array.isArray(r.carriers) ? r.carriers : [];
  const cands = carriers.map((c) => (typeof c === 'number' ? { freqHz: 0, prominenceDB: c } : c)).filter((c) => c && Number.isFinite(c.prominenceDB));
  if (cands.length) {
    const top = cands.reduce((a, b) => (b.prominenceDB > a.prominenceDB ? b : a));
    if (top.prominenceDB > 3) {
      const f = Number.isFinite(top.freqHz) && top.freqHz > 0 ? top.freqHz : 15500;
      add({ id: 'carrier', knobId: 'carrierErase', name: 'Carrier ' + (f / 1000).toFixed(1) + ' kHz', freqLo: Math.max(20, f - 500), freqHi: f + 500, measured: top.prominenceDB, target: 3, unit: 'dB', severity: (top.prominenceDB - 3) / 10 });
    }
  }
  const lufs = r.integratedLUFS;
  if (Number.isFinite(lufs) && Math.abs(lufs - target) >= 0.5) add({ id: 'loudness', knobId: 'outputGain', name: 'Integrated loudness', measured: lufs, target, unit: 'LUFS', severity: Math.abs(lufs - target) / 12 });
  const tp = r.truePeakDBTP;
  if (Number.isFinite(tp) && tp > -1) add({ id: 'truePeak', knobId: 'outputGain', name: 'True peak', measured: tp, target: -1, unit: 'dBTP', severity: (tp + 1) / 4 });
  const clips = Number.isFinite(r.clippingCount) ? r.clippingCount : 0;
  if (clips > 0) add({ id: 'clipping', knobId: 'qualityGate', name: 'Clipping', measured: clips, target: 0, unit: 'samples', severity: clips / 200, reason: why.qualityGate || ('Clipping count ' + clips + ' samples raised qualityGate to ' + (p.qualityGate !== undefined ? p.qualityGate : 3)) });
  const echo = Number.isFinite(r.echoConfidence) ? r.echoConfidence : 0;
  if (echo > 0) add({ id: 'echo', knobId: 'stegoStrip', name: 'Stego echo', measured: echo, target: 0, unit: '', severity: echo });
  const harsh = Array.isArray(r.harshPeaks) ? r.harshPeaks.filter((pk) => pk && Number.isFinite(pk.prominenceDB) && Number.isFinite(pk.freqHz)) : [];
  if (harsh.length) {
    const top = harsh.reduce((a, b) => (b.prominenceDB > a.prominenceDB ? b : a));
    if (top.prominenceDB > 6) add({ id: 'harsh', knobId: 'spectralBlend', name: 'Harsh resonance', freqLo: top.freqHz * 0.9, freqHi: top.freqHz * 1.1, measured: top.prominenceDB, target: 6, unit: 'dB', severity: (top.prominenceDB - 6) / 12 });
  }
  const sib = Number.isFinite(r.sibilance) ? r.sibilance : 0;
  if (sib > SIBILANCE_THRESHOLD) add({ id: 'sibilance', knobId: null, name: 'Sibilance / de-esser 6.5 kHz', freqLo: 5000, freqHi: 8000, measured: +sib.toFixed(3), target: SIBILANCE_THRESHOLD, unit: '', severity: (sib - SIBILANCE_THRESHOLD) / 0.35, sliderDefault: p.deesser || 0, reason: why.deesser || '' });
  if (Number.isFinite(p.deshimmer) && p.deshimmer > 0) {
    const sc = r.shimmer && Number.isFinite(r.shimmer.score) ? r.shimmer.score : 0;
    add({ id: 'deshimmer', knobId: 'deshimmer', name: 'Shimmer / dehaze 8-16 kHz', freqLo: 8000, freqHi: 16000, measured: sc, target: 0.2, unit: '', severity: sc });
  }
  const hf = r.hfCutoff;
  if (Number.isFinite(hf) && hf > 0 && hf <= 16000) add({ id: 'hfCutoff', knobId: 'bandwidthHeal', name: 'HF cutoff / air', freqLo: hf, freqHi: Math.min(22050, hf + 1000), measured: hf, target: 20000, unit: 'Hz', severity: (18000 - hf) / 4000, reason: why.airShelf || '' });
  const dc = Math.max(Math.abs(r.dcOffsetL || 0), Math.abs(r.dcOffsetR || 0));
  if (dc > 0.005) add({ id: 'rumbleDC', knobId: null, name: 'Rumble / DC below 30 Hz', freqLo: 20, freqHi: 30, measured: dc, target: 0, unit: '', severity: dc / 0.05, sliderDefault: 0, reason: 'DC offset ' + dc.toFixed(3) + ' - information only, no direct correction knob' });
  // Mud issue not emitted: no mudExcessDB measurement or chain parameter yet.
  const crest = Number.isFinite(r.crestFactorDB) ? r.crestFactorDB : 12;
  if (crest < 12) add({ id: 'crest', knobId: 'dynamicsNatural', name: 'Low crest / dynamics', measured: crest, target: 12, unit: 'dB', severity: (12 - crest) / 12 });
  const lra = r.loudnessRange;
  if (Number.isFinite(lra) && (lra < 4 || lra > 20)) add({ id: 'loudnessRange', knobId: 'dynamicsNatural', name: 'Loudness range', measured: lra, target: 8, unit: 'LU', severity: Math.abs(lra - 8) / 12 });
  if (p.msBass) add({ id: 'stereo', knobId: null, name: 'Stereo width / correlation', measured: Number.isFinite(r.correlation) ? +r.correlation.toFixed(2) : 0, target: 0.3, unit: '', severity: 0.5, sliderDefault: p.msBass, reason: why.msBass || '' });
  return issues;
}

export class SpectrumRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getAudioCtx = options.getAudioCtx || (() => null);
    this.getDSP = options.getDSP || (() => null);
    this.getIsPlaying = options.getIsPlaying || (() => false);

    this.minFreq = 20;
    this.maxFreq = 22050;
    this.minDB = -100;
    this.maxDB = 0;

    this.rawFreqData = null;
    this.procFreqData = null;
    this.animId = null;
    this.isRunning = false;
    this.autoIssues = [];

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.displayWidth = rect.width;
    this.displayHeight = rect.height;
  }

  freqToX(freq, width) {
    const minLog = Math.log10(this.minFreq);
    const maxLog = Math.log10(this.maxFreq);
    const fLog = Math.log10(Math.max(this.minFreq, Math.min(this.maxFreq, freq)));
    return ((fLog - minLog) / (maxLog - minLog)) * width;
  }

  xToFreq(x, width) {
    const minLog = Math.log10(this.minFreq);
    const maxLog = Math.log10(this.maxFreq);
    return Math.pow(10, minLog + (x / width) * (maxLog - minLog));
  }

  dbToY(db, height) {
    const clamped = Math.max(this.minDB, Math.min(this.maxDB, db));
    return (1 - (clamped - this.minDB) / (this.maxDB - this.minDB)) * height;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    const render = () => {
      if (!this.isRunning) return;
      this.draw();
      this.animId = requestAnimationFrame(render);
    };
    this.animId = requestAnimationFrame(render);
  }

  setAutoIssues(issues) {
    this.autoIssues = Array.isArray(issues) ? issues : [];
    this.draw();
  }

  drawAutoIssues(ctx, width, height) {
    if (!this.autoIssues || !this.autoIssues.length) return;
    ctx.save();
    ctx.font = '700 8.5px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    let row = 0;
    for (const issue of this.autoIssues) {
      if (!Number.isFinite(issue.freqLo) || !Number.isFinite(issue.freqHi)) continue;
      const sev = clamp01(issue.severity);
      const base = sev >= 0.66 ? '255, 60, 60' : sev >= 0.33 ? '255, 122, 0' : '255, 200, 0';
      const xLo = this.freqToX(Math.max(this.minFreq, issue.freqLo), width);
      const xHi = this.freqToX(Math.min(this.maxFreq, issue.freqHi), width);
      ctx.fillStyle = 'rgba(' + base + ', ' + (0.1 + 0.15 * sev).toFixed(3) + ')';
      ctx.fillRect(xLo, 0, Math.max(2, xHi - xLo), height);
      ctx.strokeStyle = 'rgba(' + base + ', 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xLo, 0, Math.max(2, xHi - xLo), height);
      const over = Number.isFinite(issue.measured) && Number.isFinite(issue.target) && (issue.unit === 'dB' || issue.unit === 'dBTP') ? ' +' + (issue.measured - issue.target).toFixed(1) + ' dB' : ' ' + issue.measured + (issue.unit ? ' ' + issue.unit : '');
      const label = issue.name + over;
      const labelW = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(' + base + ', 1)';
      ctx.fillText(label, Math.max(3, Math.min(xLo + 3, width - labelW - 3)), Math.min(40 + row * 11, height - 8));
      row++;
    }
    ctx.restore();
  }

  calculatePoints(freqData, binCount, sr, width, height) {
    const binHz = sr / (binCount * 2);
    const points = [];
    const step = 2; // Sample every 2 display pixels for 60fps high precision
    for (let x = 0; x <= width; x += step) {
      const f = this.xToFreq(x, width);
      const k = f / binHz;
      const kLo = Math.floor(k);
      const kHi = Math.min(binCount - 1, Math.ceil(k));
      const frac = k - kLo;

      let dbVal = -100;
      if (kLo < binCount) {
        const valLo = freqData[kLo];
        const valHi = freqData[kHi];
        dbVal = valLo * (1 - frac) + valHi * frac;
      }

      const y = this.dbToY(dbVal, height);
      points.push({ x, y });
    }
    return points;
  }

  draw() {
    const ctx = this.ctx;
    const width = this.displayWidth;
    const height = this.displayHeight;
    const dsp = this.getDSP();
    const audioCtx = this.getAudioCtx();
    const isPlaying = this.getIsPlaying();

    // 1. Clear background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Horizontal dB grid lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#e2dfd9';
    ctx.fillStyle = '#6f6b64';
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';

    const dbTicks = [0, -20, -40, -60, -80];
    for (const db of dbTicks) {
      const y = this.dbToY(db, height);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(`${db} dB`, 8, y - 3);
    }

    // 3. Vertical frequency grid lines
    const freqTicks = [
      { f: 50, label: '50' },
      { f: 100, label: '100' },
      { f: 250, label: '250' },
      { f: 500, label: '500' },
      { f: 1000, label: '1k' },
      { f: 2500, label: '2.5k' },
      { f: 5000, label: '5k' },
      { f: 10000, label: '10k' },
      { f: 15000, label: '15k' },
      { f: 20000, label: '20k' },
    ];

    ctx.textAlign = 'center';
    for (const tick of freqTicks) {
      const x = this.freqToX(tick.f, width);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillText(tick.label, x, height - 6);
    }

    // 4. Highlight AI carrier watermark zones (15.5k, 17.5k, 19.5k)
    const carrierBands = [
      { lo: 15000, hi: 16000, label: '15.5k' },
      { lo: 17000, hi: 18000, label: '17.5k' },
      { lo: 19000, hi: 20000, label: '19.5k' },
    ];
    for (const b of carrierBands) {
      const xLo = this.freqToX(b.lo, width);
      const xHi = this.freqToX(b.hi, width);
      ctx.fillStyle = 'rgba(138, 90, 43, 0.06)';
      ctx.fillRect(xLo, 0, xHi - xLo, height);

      ctx.strokeStyle = 'rgba(138, 90, 43, 0.25)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo((xLo + xHi) / 2, 0);
      ctx.lineTo((xLo + xHi) / 2, height - 16);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 5. Dual Spectrum Curves (Ghost Original vs Live Processed)
    if (isPlaying && dsp && audioCtx) {
      const sr = audioCtx.sampleRate;

      // Allocate buffers if needed
      const binCount = dsp.analyser ? dsp.analyser.frequencyBinCount : 1024;
      if (!this.procFreqData || this.procFreqData.length !== binCount) {
        this.procFreqData = new Float32Array(binCount);
      }
      if (!this.rawFreqData || this.rawFreqData.length !== binCount) {
        this.rawFreqData = new Float32Array(binCount);
      }

      // --- TRACE A: FADED SLATE ORIGINAL SPECTRUM (RAW PRE-DSP) ---
      if (dsp.rawAnalyser) {
        dsp.rawAnalyser.getFloatFrequencyData(this.rawFreqData);
        const rawPoints = this.calculatePoints(this.rawFreqData, binCount, sr, width, height);

        // Faint Cyan Underglow (AI)
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let i = 0; i < rawPoints.length; i++) {
          ctx.lineTo(rawPoints[i].x, rawPoints[i].y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        const rawGrad = ctx.createLinearGradient(0, 0, 0, height);
        rawGrad.addColorStop(0, 'rgba(47, 72, 88, 0.15)');
        rawGrad.addColorStop(0.5, 'rgba(47, 72, 88, 0.04)');
        rawGrad.addColorStop(1, 'rgba(47, 72, 88, 0.0)');
        ctx.fillStyle = rawGrad;
        ctx.fill();

        // Faded Cyan Dashed Reference Stroke (AI Raw)
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = 'rgba(47, 72, 88, 0.65)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (let i = 0; i < rawPoints.length; i++) {
          if (i === 0) ctx.moveTo(rawPoints[i].x, rawPoints[i].y);
          else ctx.lineTo(rawPoints[i].x, rawPoints[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- TRACE B: OCHRE PROCESSED SPECTRUM (POST-DSP) ---
      if (dsp.analyser) {
        dsp.analyser.getFloatFrequencyData(this.procFreqData);
        const procPoints = this.calculatePoints(this.procFreqData, binCount, sr, width, height);

        // Vivid Orange Gradient Underglow (Humanized)
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let i = 0; i < procPoints.length; i++) {
          ctx.lineTo(procPoints[i].x, procPoints[i].y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        const procGrad = ctx.createLinearGradient(0, 0, 0, height);
        procGrad.addColorStop(0, 'rgba(138, 90, 43, 0.35)');
        procGrad.addColorStop(0.5, 'rgba(138, 90, 43, 0.10)');
        procGrad.addColorStop(1, 'rgba(138, 90, 43, 0.0)');
        ctx.fillStyle = procGrad;
        ctx.fill();

        // Solid Vivid Orange High-Resolution Hairline Curve (Humanized)
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = '#8a5a2b';
        ctx.beginPath();
        for (let i = 0; i < procPoints.length; i++) {
          if (i === 0) ctx.moveTo(procPoints[i].x, procPoints[i].y);
          else ctx.lineTo(procPoints[i].x, procPoints[i].y);
        }
        ctx.stroke();
      }

      // --- HUD DUAL-TRACE OVERLAY LEGEND ---
      const legX = width - 12;
      ctx.textAlign = 'right';
      ctx.font = '700 8.5px ui-monospace, Menlo, Consolas, monospace';

      // AI Raw Legend (Blue)
      ctx.fillStyle = 'rgba(47, 72, 88, 0.75)';
      ctx.fillText('┄┄ Original', legX, 16);

      // Humanized Output Legend (Orange)
      ctx.fillStyle = '#8a5a2b';
      ctx.fillText('── Processed', legX, 28);

    } else {
      // Idle state: dual clean baselines
      const rawBaselineY = this.dbToY(-96, height);
      const procBaselineY = this.dbToY(-95, height);

      // Faded cyan AI ghost baseline
      ctx.strokeStyle = 'rgba(47, 72, 88, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(0, rawBaselineY);
      ctx.lineTo(width, rawBaselineY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Orange Humanized baseline
      ctx.strokeStyle = 'rgba(138, 90, 43, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, procBaselineY);
      ctx.lineTo(width, procBaselineY);
      ctx.stroke();

      // Idle HUD Legend
      const legX = width - 12;
      ctx.textAlign = 'right';
      ctx.font = '700 8.5px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = 'rgba(47, 72, 88, 0.5)';
      ctx.fillText('┄┄ Original', legX, 16);
      ctx.fillStyle = 'rgba(138, 90, 43, 0.6)';
      ctx.fillText('── Processed', legX, 28);
    }

    // Persistent AUTO issue bands (visible even when not playing)
    this.drawAutoIssues(ctx, width, height);
  }
}

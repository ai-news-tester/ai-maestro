/**
 * AI-Maestro Audio Analyzer — Pure JavaScript DSP Engine
 *
 * All math is real: STFT with Hann window, carrier SNR prominence,
 * cepstral echo detection, spectral flatness (Wiener entropy),
 * and peak/RMS metering. Zero simulation, zero fake data.
 */

// ============================================================================
// AudioMath — Low-level DSP primitives
// ============================================================================
export class AudioMath {
  /**
   * Generate a Hann window of length N.
   * w[n] = 0.5 * (1 - cos(2πn / (N-1)))
   */
  static hannWindow(N) {
    const w = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      w[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (N - 1)));
    }
    return w;
  }

  /**
   * In-place Cooley-Tukey radix-2 FFT.
   * @param {Float64Array} re – real part (length must be power of 2)
   * @param {Float64Array} im – imaginary part
   */
  static fft(re, im) {
    const N = re.length;
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    // Butterfly passes
    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >> 1;
      const angle = (-2 * Math.PI) / len;
      const wRe = Math.cos(angle);
      const wIm = Math.sin(angle);
      for (let i = 0; i < N; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < halfLen; j++) {
          const tRe = curRe * re[i + j + halfLen] - curIm * im[i + j + halfLen];
          const tIm = curRe * im[i + j + halfLen] + curIm * re[i + j + halfLen];
          re[i + j + halfLen] = re[i + j] - tRe;
          im[i + j + halfLen] = im[i + j] - tIm;
          re[i + j] += tRe;
          im[i + j] += tIm;
          const nextRe = curRe * wRe - curIm * wIm;
          const nextIm = curRe * wIm + curIm * wRe;
          curRe = nextRe;
          curIm = nextIm;
        }
      }
    }
  }

  /**
   * Compute magnitude spectrum |X[k]| from a windowed segment.
   * Returns only the positive-frequency half (N/2 + 1 bins).
   */
  static magnitudeSpectrum(segment, window) {
    const N = segment.length;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      re[i] = segment[i] * window[i];
      im[i] = 0;
    }
    this.fft(re, im);
    const halfN = (N >> 1) + 1;
    const mag = new Float64Array(halfN);
    for (let k = 0; k < halfN; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
    return mag;
  }

  /**
   * Streaming STFT: frames are handed to a callback one at a time and dropped.
   * Retaining every Float64 frame cost ~800 MB on a 10-minute track (the backing
   * stores live outside the JS heap), enough to kill a browser tab.
   * @param {Float32Array} samples – mono PCM
   * @param {number} nfft – FFT size (must be power of 2)
   * @param {number} hop – hop length
   * @returns {{ numFrames: number, forEachFrame: (cb: (mag: Float64Array, f: number) => void) => void }}
   */
  static stft(samples, nfft = 4096, hop = 1024) {
    const win = this.hannWindow(nfft);
    const numFrames = Math.max(0, Math.floor((samples.length - nfft) / hop) + 1);
    return {
      numFrames,
      forEachFrame: (cb) => {
        for (let f = 0; f < numFrames; f++) {
          const offset = f * hop;
          cb(this.magnitudeSpectrum(samples.slice(offset, offset + nfft), win), f);
        }
      },
    };
  }

  /**
   * Compute sample peak in dBFS.
   */
  static peakDBFS(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }

  /**
   * Compute RMS in dBFS.
   */
  static rmsDBFS(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  /**
   * Spectral Flatness Measure (Wiener entropy):
   * SFM = exp(mean(ln(|X|²))) / mean(|X|²)
   */
  static spectralFlatness(magnitudeFrame) {
    const N = magnitudeFrame.length;
    let logSum = 0;
    let linSum = 0;
    for (let k = 0; k < N; k++) {
      const power = magnitudeFrame[k] * magnitudeFrame[k] + 1e-20;
      logSum += Math.log(power);
      linSum += power;
    }
    const geometricMean = Math.exp(logSum / N);
    const arithmeticMean = linSum / N;
    return geometricMean / (arithmeticMean + 1e-20);
  }

  /**
   * Moving median over an array with window radius k.
   */
  static movingMedian(arr, k) {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const lo = Math.max(0, i - k);
      const hi = Math.min(arr.length - 1, i + k);
      const slice = [];
      for (let j = lo; j <= hi; j++) slice.push(arr[j]);
      slice.sort((a, b) => a - b);
      out[i] = slice[Math.floor(slice.length / 2)];
    }
    return out;
  }
}

// ============================================================================
// CarrierDetector — Carrier prominence + stability analysis
// ============================================================================
export class CarrierDetector {
  /**
   * Carrier frequency bands (Hz) scanned for stationary tonal peaks.
   */
  static CARRIER_BANDS = [
    { lo: 15000, hi: 16000, label: '15.5 kHz Carrier' },
    { lo: 17000, hi: 18000, label: '17.5 kHz Carrier' },
    { lo: 19000, hi: 20000, label: '19.5 kHz Carrier' },
  ];

  /**
   * Analyze PCM buffer for carrier peaks.
   * @param {Float32Array} samples – mono PCM (−1…+1)
   * @param {number} sr – sample rate (e.g. 44100)
   * @returns {Object} – measured carrier results
   */
  static analyze(samples, sr) {
    const nfft = 4096;
    const hop = nfft >> 2;
    const binHz = sr / nfft;
    const stft = AudioMath.stft(samples, nfft, hop);
    if (stft.numFrames === 0) {
      return { carriers: [], overallConfidence: 0, peakDBFS: -Infinity, rmsDBFS: -Infinity };
    }

    // Average magnitude across all frames, streamed: only per-bin accumulators
    // are kept, never the frames. Per-bin mean/variance use Welford so the
    // stability index needs no second pass over the audio.
    const halfN = (nfft >> 1) + 1;
    const avgMag = new Float64Array(halfN);
    const wMean = new Float64Array(halfN);
    const wM2 = new Float64Array(halfN);
    stft.forEachFrame((mag, f) => {
      const n = f + 1;
      for (let k = 0; k < halfN; k++) {
        const v = mag[k];
        avgMag[k] += v;
        const delta = v - wMean[k];
        wMean[k] += delta / n;
        wM2[k] += delta * (v - wMean[k]);
      }
    });
    for (let k = 0; k < halfN; k++) avgMag[k] /= stft.numFrames;

    // Compute spectral floor via moving median (±50 bins)
    const floor = AudioMath.movingMedian(avgMag, 50);

    const carriers = [];

    for (const band of this.CARRIER_BANDS) {
      if (band.hi > sr / 2) continue;

      const kLo = Math.floor(band.lo / binHz);
      const kHi = Math.ceil(band.hi / binHz);

      let peakK = kLo;
      let peakMag = 0;
      for (let k = kLo; k <= kHi && k < halfN; k++) {
        if (avgMag[k] > peakMag) {
          peakMag = avgMag[k];
          peakK = k;
        }
      }

      const floorVal = floor[peakK] || 1e-20;
      const prominenceDB = 20 * Math.log10(peakMag / floorVal + 1e-20);

      // Population std (divide by N), matching the original two-pass formula.
      const mean = wMean[peakK];
      const std = Math.sqrt(wM2[peakK] / stft.numFrames);
      const stabilityIndex = mean > 0 ? std / mean : 1;

      let confidence = 0;
      if (prominenceDB > 3.5 && stabilityIndex < 0.85) {
        confidence = Math.min(1, ((prominenceDB - 3.0) / 12) * (1 - stabilityIndex));
      }

      carriers.push({
        band: band.label,
        freqHz: peakK * binHz,
        prominenceDB: +prominenceDB.toFixed(2),
        stabilityIndex: +stabilityIndex.toFixed(4),
        confidence: +confidence.toFixed(3),
      });
    }

    const overallConfidence = carriers.length > 0
      ? Math.max(...carriers.map(c => c.confidence))
      : 0;

    return {
      carriers,
      overallConfidence: +overallConfidence.toFixed(3),
      peakDBFS: +AudioMath.peakDBFS(samples).toFixed(1),
      rmsDBFS: +AudioMath.rmsDBFS(samples).toFixed(1),
    };
  }
}

// ============================================================================
// StegoDetector — Cepstral echo detection (Multi-frame robust persistence)
// ============================================================================
export class StegoDetector {
  /**
   * Compute real cepstrum of a windowed frame.
   * c[n] = IFFT(ln(|FFT(x)|))
   */
  static computeRealCepstrum(segment, win) {
    const N = segment.length;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      re[i] = segment[i] * win[i];
      im[i] = 0;
    }
    AudioMath.fft(re, im);
    for (let k = 0; k < N; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) + 1e-20;
      re[k] = Math.log(mag);
      im[k] = 0;
    }
    for (let k = 0; k < N; k++) im[k] = -im[k];
    AudioMath.fft(re, im);
    for (let k = 0; k < N; k++) {
      re[k] /= N;
      im[k] /= -N;
    }
    const cep = new Float64Array(N);
    for (let k = 0; k < N; k++) cep[k] = Math.abs(re[k]);
    return cep;
  }

  /**
   * Detect artificial steganographic echoes via multi-frame cepstral analysis.
   * Differentiates artificial stationary echo watermarks from natural musical pitch.
   * @param {Float32Array} samples
   * @param {number} sr
   * @returns {Object}
   */
  static analyze(samples, sr) {
    const frameSize = 8192;
    const hop = 4096;
    const win = AudioMath.hannWindow(frameSize);
    const numFrames = Math.min(8, Math.floor((samples.length - frameSize) / hop) + 1);
    if (numFrames < 1) return { echoes: [], confidence: 0 };

    const qLo = Math.max(2, Math.floor(sr * 0.0004)); // >0.4ms
    const qHi = Math.min(frameSize / 2, Math.ceil(sr * 0.010)); // <10ms

    // Spread the frames across the WHOLE track, the same pattern analyzeFullTrack
    // uses for its spectral average. Reading 8 consecutive frames from sample 0
    // analysed only the first ~0.77 s, so a silent intro hid an echo that ran
    // through the rest of the song.
    const cepFrames = [];
    for (let f = 0; f < numFrames; f++) {
      const off = numFrames > 1 ? Math.floor((f * (samples.length - frameSize)) / (numFrames - 1)) : 0;
      cepFrames.push(this.computeRealCepstrum(samples.slice(off, off + frameSize), win));
    }

    // Average cepstrum across time
    const avgCep = new Float64Array(frameSize);
    for (let f = 0; f < numFrames; f++) {
      for (let q = 0; q < frameSize; q++) {
        avgCep[q] += cepFrames[f][q];
      }
    }
    for (let q = 0; q < frameSize; q++) avgCep[q] /= numFrames;

    // Local baseline (moving median ±50 bins, as CarrierDetector floors its spectrum):
    // the low-quefrency cepstrum is lifted by the spectral envelope, so a global
    // median reads the envelope shoulder as a strong echo on tonal tracks.
    const localBase = (arr, q, radius = 50) => {
      const lo = Math.max(0, q - radius), hi = Math.min(arr.length - 1, q + radius);
      const w = []; for (let k = lo; k <= hi; k++) w.push(arr[k]);
      w.sort((a, b) => a - b);
      const med = w[Math.floor(w.length / 2)];
      const dev = w.map(v => Math.abs(v - med)).sort((a, b) => a - b);
      return { med, mad: dev[Math.floor(dev.length / 2)] || 1e-20 };
    };

    // Find candidate echo peaks that survive inter-frame variance and pitch harmonic rejection
    const candidatePeaks = [];
    for (let q = qLo + 1; q < qHi - 1; q++) {
      if (avgCep[q] > avgCep[q - 1] && avgCep[q] > avgCep[q + 1]) {
        const lb = localBase(avgCep, q);
        const score = (avgCep[q] - lb.med) / lb.mad;
        // Significant watermark echo requires prominent score > 8.0
        if (score > 8.0) {
          // Check frame persistence across time (same local rule)
          let framePresence = 0;
          for (let f = 0; f < numFrames; f++) {
            const fb = localBase(cepFrames[f], q);
            if ((cepFrames[f][q] - fb.med) / fb.mad > 5.0) framePresence++;
          }
          const consistency = framePresence / numFrames;

          // Reject musical pitch harmonic ladders (e.g. 2x, 3x, 4x octaves of an earlier note)
          const isHarmonic = candidatePeaks.some(prev => {
            const ratio = q / prev.quefrency;
            const nearestInt = Math.round(ratio);
            return Math.abs(ratio - nearestInt) < 0.05 && nearestInt >= 2 && nearestInt <= 5;
          });

          // Pitch-vs-echo: score the 2x/3x multiples (peak-aligned +-2 bins, a
          // rahmonic can fall between integer bins when sr/f0 is not an integer).
          const multScore = (m) => {
            const qm = q * m;
            if (qm >= frameSize / 2) return 0;
            let best = -Infinity;
            for (let k = Math.max(2, qm - 2); k <= Math.min(frameSize / 2 - 1, qm + 2); k++) {
              const mb = localBase(avgCep, k);
              best = Math.max(best, (avgCep[k] - mb.med) / mb.mad);
            }
            return best;
          };
          const m2 = multScore(2), m3 = multScore(3);
          // A pitched tone's period rides strong integer multiples (measured
          // >= 0.51x of the fundamental's score); echo rahmonics decay as
          // alpha^m (<= 0.46x even for a blatant 90% echo).
          const isPitchLadder = m2 >= 0.5 * score;
          // A real echo leaves rahmonics at 2q/3q that clear the same 8.0
          // significance bar as a primary peak (weakest echo measured: 13.8).
          // A lone spike whose multiples sit at noise level is not an echo.
          const hasRahmonics = m2 >= 8 || m3 >= 8;

          if (!isHarmonic && !isPitchLadder && hasRahmonics && consistency >= 0.6) {
            candidatePeaks.push({
              quefrency: q,
              delayMs: +((q / sr) * 1000).toFixed(3),
              score: +score.toFixed(2),
              consistency: +consistency.toFixed(2),
            });
          }
        }
      }
    }

    candidatePeaks.sort((a, b) => b.score - a.score);

    // Confidence: requires prominent artificial echo spike AND high inter-frame persistence
    let confidence = 0;
    if (candidatePeaks.length > 0) {
      const top = candidatePeaks[0];
      if (top.score > 12.0 && top.consistency >= 0.75) {
        confidence = Math.min(1.0, ((top.score - 10) / 25) * top.consistency);
      } else if (top.score > 8.0 && top.consistency >= 0.85) {
        confidence = Math.min(0.65, ((top.score - 7) / 20) * top.consistency);
      }
    }

    return {
      echoes: candidatePeaks,
      confidence: +confidence.toFixed(3),
    };
  }
}

// ============================================================================
// SpectralAnalyzer — Flatness + dynamic range
// ============================================================================
export class SpectralAnalyzer {
  /**
   * Compute average spectral flatness and dynamic range metrics.
   * @param {Float32Array} samples
   * @param {number} sr
   * @returns {Object}
   */
  static analyze(samples, sr) {
    const nfft = 2048;
    const hop = nfft >> 1;
    const stft = AudioMath.stft(samples, nfft, hop);

    let sfmSum = 0;
    stft.forEachFrame((frame) => {
      sfmSum += AudioMath.spectralFlatness(frame);
    });
    const avgSFM = stft.numFrames > 0 ? sfmSum / stft.numFrames : 0;

    const peak = AudioMath.peakDBFS(samples);
    const rms = AudioMath.rmsDBFS(samples);
    const crest = Number.isFinite(peak) && Number.isFinite(rms) ? peak - rms : 0;

    return {
      spectralFlatness: +avgSFM.toFixed(4),
      peakDBFS: +peak.toFixed(1),
      rmsDBFS: +rms.toFixed(1),
      crestFactorDB: +crest.toFixed(1),
    };
  }

  /**
   * BS.1770 K-weighting coefficients for any sample rate:
   * stage 1 high shelf (+4 dB above ~1.68 kHz), stage 2 high-pass (~38 Hz).
   * @returns {{shelf: number[], hp: number[]}} each [b0,b1,b2,a1,a2] (a0 normalized to 1)
   */
  static kWeightCoeffs(sr) {
    // Stage 1: shelving filter
    const f0 = 1681.974450955533, G = 3.99984385397334, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sr);
    const Vh = Math.pow(10, G / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    const shelf = [
      (Vh + (Vb * K) / Q + K * K) / a0,
      (2 * (K * K - Vh)) / a0,
      (Vh - (Vb * K) / Q + K * K) / a0,
      (2 * (K * K - 1)) / a0,
      (1 - K / Q + K * K) / a0,
    ];
    // Stage 2: high-pass
    const f1 = 38.13547087602444, Q1 = 0.5003270373238773;
    const K1 = Math.tan((Math.PI * f1) / sr);
    const a0h = 1 + K1 / Q1 + K1 * K1;
    const hp = [1 / a0h, -2 / a0h, 1 / a0h, (2 * (K1 * K1 - 1)) / a0h, (1 - K1 / Q1 + K1 * K1) / a0h];
    return { shelf, hp };
  }

  /** Apply one biquad (Direct Form I) to samples, returning Float64Array. */
  static biquad(samples, c) {
    const out = new Float64Array(samples.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const x0 = samples[i];
      const y0 = c[0] * x0 + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      out[i] = y0;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    }
    return out;
  }

  /**
   * BS.1770-5 gated integrated loudness, LRA, and true peak for a stereo pair.
   * Silence returns -Infinity (never NaN). right=null measures mono.
   * @returns {{integratedLUFS: number, loudnessRange: number, truePeakDBTP: number}}
   */
  static measureLoudness(left, right, sr) {
    const n = left.length;
    if (n === 0) return { integratedLUFS: -Infinity, loudnessRange: 0, truePeakDBTP: -Infinity };
    const { shelf, hp } = this.kWeightCoeffs(sr);
    const chans = right ? [left, right] : [left];

    // Prefix sums of K-weighted squares per channel => O(1) block energies
    const prefix = chans.map((ch) => {
      const kw = this.biquad(this.biquad(ch, shelf), hp);
      const p = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) p[i + 1] = p[i] + kw[i] * kw[i];
      return p;
    });
    const blockEnergy = (start, end) => {
      let z = 0;
      for (const p of prefix) z += (p[end] - p[start]) / (end - start);
      return z; // channel weights 1.0 for L/R per BS.1770
    };
    const loud = (z) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity);

    // Integrated: 400ms blocks, 100ms step, absolute -70 LUFS + relative -10 LU gates
    const blockLen = Math.min(Math.round(0.4 * sr), n);
    const step = Math.max(1, Math.round(0.1 * sr));
    const blocks = [];
    for (let s = 0; s + blockLen <= n; s += step) blocks.push(blockEnergy(s, s + blockLen));
    // BS.1770-5 anchors the final block at n - blockLen, so audio only in the
    // tail is measured instead of falling out of the 100 ms grid.
    const anchor = n - blockLen;
    if (anchor > 0 && anchor % step !== 0) blocks.push(blockEnergy(anchor, n));
    const absGated = blocks.filter((z) => loud(z) > -70);
    let integrated = -Infinity;
    if (absGated.length > 0) {
      const meanZ = absGated.reduce((a, b) => a + b, 0) / absGated.length;
      const relGate = loud(meanZ) - 10;
      const gated = absGated.filter((z) => loud(z) > relGate);
      if (gated.length > 0) integrated = loud(gated.reduce((a, b) => a + b, 0) / gated.length);
    }

    // LRA (EBU Tech 3342): 3s short-term, -70 abs / -20 rel gates, 10th..95th percentile
    // shortcut: 1s step instead of 100ms, upgrade if LRA needs spec-exact overlap
    const stLen = Math.min(Math.round(3 * sr), n);
    const stStep = Math.max(1, Math.round(1 * sr));
    const st = [];
    for (let s = 0; s + stLen <= n; s += stStep) st.push(loud(blockEnergy(s, s + stLen)));
    // Same tail anchor as the integrated pass: the last short-term window must
    // cover the end of the track.
    const stAnchor = n - stLen;
    if (stAnchor > 0 && stAnchor % stStep !== 0) st.push(loud(blockEnergy(stAnchor, n)));
    let lra = 0;
    const stAbs = st.filter((l) => l > -70);
    if (stAbs.length > 1) {
      const meanZ = stAbs.reduce((a, l) => a + Math.pow(10, (l + 0.691) / 10), 0) / stAbs.length;
      const relGate = -0.691 + 10 * Math.log10(meanZ) - 20;
      const gated = stAbs.filter((l) => l > relGate).sort((a, b) => a - b);
      if (gated.length > 1) {
        const pct = (p) => gated[Math.min(gated.length - 1, Math.floor((p / 100) * gated.length))];
        lra = pct(95) - pct(10);
      }
    }

    let tp = -Infinity;
    for (const ch of chans) tp = Math.max(tp, this.measureTruePeak(ch, sr));

    return {
      integratedLUFS: Number.isFinite(integrated) ? +integrated.toFixed(2) : -Infinity,
      loudnessRange: +lra.toFixed(2),
      truePeakDBTP: Number.isFinite(tp) ? +tp.toFixed(2) : -Infinity,
    };
  }

  /**
   * True peak in dBTP via 4x polyphase windowed-sinc interpolation (49-tap prototype).
   * Catches inter-sample overs that sample peak misses. Silence => -Infinity.
   */
  static measureTruePeak(samples, sr) {
    const n = samples.length;
    if (n === 0) return -Infinity;
    // Prototype lowpass h[k] = sinc((k-24)/4) * hamming, phases k%4==p; phase 0 is identity (delay 6)
    const phases = [[], [], [], []];
    for (let p = 0; p < 4; p++) {
      for (let k = p; k < 49; k += 4) {
        const u = (k - 24) / 4;
        const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
        const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / 48);
        phases[p].push(sinc * win);
      }
      const sum = phases[p].reduce((a, b) => a + b, 0);
      for (let t = 0; t < phases[p].length; t++) phases[p][t] /= sum; // DC-preserving
    }
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > peak) peak = abs;
      for (let p = 1; p < 4; p++) {
        const taps = phases[p];
        let y = 0;
        for (let m = 0; m < taps.length; m++) {
          const idx = i - m;
          if (idx >= 0 && idx < n) y += taps[m] * samples[idx];
        }
        const ay = Math.abs(y);
        if (ay > peak) peak = ay;
      }
    }
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  }

  static measureShimmer(samples, sr) {
    if (!samples || samples.length < 2048) return { score: 0, confidence: 0, hfFlatness: 0, hfVariance: 0, resonanceProminence: 0 };
    const stft = AudioMath.stft(samples, 2048, 1024);
    if (!stft.numFrames) return { score: 0, confidence: 0, hfFlatness: 0, hfVariance: 0, resonanceProminence: 0 };
    const hfLo = Math.floor(8000 / (sr / 2048));
    let flatSum = 0, hfTotal = 0, allTotal = 0;
    // Streamed Welford over per-frame HF energy: no frame array retained.
    let hfMean = 0, hfM2 = 0;
    stft.forEachFrame((frame, f) => {
      flatSum += AudioMath.spectralFlatness(frame.slice(hfLo));
      let e = 0, ae = 0;
      for (let k = hfLo; k < frame.length; k++) e += frame[k] * frame[k];
      for (const v of frame) ae += v * v;
      hfTotal += e; allTotal += ae;
      const n = f + 1;
      const delta = e - hfMean;
      hfMean += delta / n;
      hfM2 += delta * (e - hfMean);
    });
    const hfFlatness = flatSum / stft.numFrames;
    const mean = hfMean || 0;
    const variance = mean > 0 ? Math.sqrt(hfM2 / stft.numFrames) / mean : 0;
    const hfRatio = allTotal > 0 ? hfTotal / allTotal : 0;
    if (hfRatio < 0.01) return { score: 0, confidence: 0.5, hfFlatness: +hfFlatness.toFixed(4), hfVariance: +variance.toFixed(4), resonanceProminence: 0 };
    const score = Math.max(0, Math.min(1, 0.5 * hfFlatness + 0.5 * Math.min(1, variance)));
    return { score: +score.toFixed(4), confidence: +Math.min(1, stft.numFrames / 20).toFixed(3), hfFlatness: +hfFlatness.toFixed(4), hfVariance: +variance.toFixed(4), resonanceProminence: 0 };
  }

  static analyzeFullTrack(buffer) {
    const sr = buffer.sampleRate, len = buffer.length;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const duration = buffer.duration || len / sr;
    if (len < 2048) {
      // Too short for STFT/loudness gating, but the samples are still real:
      // measure peak/RMS/clipping directly and only call it silence when the
      // RMS genuinely is, instead of reporting a full-scale click as silence.
      const peak = AudioMath.peakDBFS(left);
      const rms = AudioMath.rmsDBFS(left);
      let clips = 0, sumL = 0, sumR = 0;
      for (let i = 0; i < len; i++) { if (Math.abs(left[i]) >= 0.999) clips++; sumL += left[i]; sumR += right[i]; }
      const silent = !Number.isFinite(rms) || rms < -60;
      return { integratedLUFS: -Infinity, loudnessRange: 0, truePeakDBTP: Number.isFinite(peak) ? peak : -Infinity, peakDBFS: peak, rmsDBFS: rms, crestFactorDB: Number.isFinite(peak) && Number.isFinite(rms) ? +(peak - rms).toFixed(1) : 0, clippingCount: clips, dcOffsetL: +(sumL / len).toFixed(6), dcOffsetR: +(sumR / len).toFixed(6), silenceRanges: silent ? [{ start: 0, end: +duration.toFixed(3) }] : [], fadeIn: 0, fadeOut: 0, stereoWidth: 0, correlation: 0, monoLowsDB: -Infinity, spectralTilt: 0, harshPeaks: [], sibilance: 0, hfCutoff: sr / 2, carriers: [], echoConfidence: 0, shimmer: { score: 0, confidence: 0 }, sampleRate: sr, duration };
    }
    let clippingCount = 0, sumL = 0, sumR = 0;
    for (let i = 0; i < len; i++) { if (Math.abs(left[i]) >= 0.999) clippingCount++; if (right !== left && Math.abs(right[i]) >= 0.999) clippingCount++; sumL += left[i]; sumR += right[i]; }
    let cov = 0, vl = 0, vr = 0, side = 0, mid = 0;
    const ml = sumL / len, mr = sumR / len;
    for (let i = 0; i < len; i++) { const dl = left[i] - ml, dr = right[i] - mr; cov += dl * dr; vl += dl * dl; vr += dr * dr; const m = (left[i] + right[i]) / 2, s = (left[i] - right[i]) / 2; mid += m * m; side += s * s; }
    const correlation = vl > 0 && vr > 0 ? cov / Math.sqrt(vl * vr) : 0;
    const stereoWidth = mid > 0 ? Math.sqrt(side / mid) : 0;
    const win = Math.max(1, Math.round(sr * 0.05)), ranges = [];
    let start = -1;
    for (let o = 0; o < len; o += win) { let e = 0; const ee = Math.min(len, o + win); for (let i = o; i < ee; i++) e += left[i] * left[i] + right[i] * right[i]; const rms = Math.sqrt(e / Math.max(1, (ee - o) * 2)); if (rms < 0.001) { if (start < 0) start = o; } else { if (start >= 0 && o - start >= sr * 0.2) ranges.push({ start: +(start / sr).toFixed(3), end: +(o / sr).toFixed(3) }); start = -1; } }
    if (start >= 0 && len - start >= sr * 0.2) ranges.push({ start: +(start / sr).toFixed(3), end: +(len / sr).toFixed(3) });
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) mono[i] = (left[i] + right[i]) * 0.5;
    const base = this.analyze(mono, sr);
    const loud = this.measureLoudness(left, right, sr);
    // Band energies come from windows strided across the WHOLE track, not 8 fixed
    // ones: a 2 s defect between them used to be invisible. Accumulate mean POWER
    // per bin (not mean magnitude, then squared) so a localised burst is not
    // diluted away by quiet surroundings.
    // shortcut: at most MAX_BAND_WINDOWS windows, so a 10 min track is sampled
    // every ~1.5 s; raise the cap if band metrics need finer localisation.
    const MAX_BAND_WINDOWS = 400;
    const nfft = 2048, half = (nfft >> 1) + 1, avg = new Float64Array(half), winFn = AudioMath.hannWindow(nfft);
    const bandStep = Math.max(nfft, Math.floor((len - nfft) / (MAX_BAND_WINDOWS - 1)));
    const nw = Math.max(1, Math.floor((len - nfft) / bandStep) + 1);
    for (let w = 0; w < nw; w++) { const off = w * bandStep; const mag = AudioMath.magnitudeSpectrum(mono.slice(off, off + nfft), winFn); for (let k = 0; k < half; k++) avg[k] += (mag[k] * mag[k]) / nw; }
    const bandE = (lo, hi) => { const a = Math.max(0, Math.floor(lo / (sr / nfft))), b = Math.min(half - 1, Math.ceil(hi / (sr / nfft))); let e = 0; for (let k = a; k <= b; k++) e += avg[k]; return e; };
    const totalE = bandE(20, 20000) || 1e-20;
    let hfCutoff = sr / 2, peakE = 0;
    for (const v of avg) if (v > peakE) peakE = v;
    for (let k = half - 1; k >= 0; k--) { if (avg[k] > peakE * 1e-4) { hfCutoff = Math.round(k * (sr / nfft)); break; } } // 1% of peak magnitude == 1e-4 of peak power (avg holds power)
    // Harsh resonances: narrow local maxima in the 2-10 kHz presence band standing
    // above the local floor (moving median, as CarrierDetector floors its spectrum).
    // The AUTO mapper raises spectralBlend when prominence exceeds 6 dB.
    const harshFloor = AudioMath.movingMedian(avg, 50);
    const harshPeaks = [];
    const hLo = Math.max(2, Math.floor(2000 / (sr / nfft))), hHi = Math.min(half - 2, Math.ceil(10000 / (sr / nfft)));
    for (let k = hLo; k <= hHi; k++) {
      if (avg[k] > avg[k - 1] && avg[k] > avg[k + 1]) {
        const prom = 10 * Math.log10((avg[k] + 1e-20) / (harshFloor[k] + 1e-20));
        if (prom > 6) harshPeaks.push({ freqHz: Math.round(k * (sr / nfft)), prominenceDB: +prom.toFixed(2) });
      }
    }
    harshPeaks.sort((a, b) => b.prominenceDB - a.prominenceDB);
    if (harshPeaks.length > 4) harshPeaks.length = 4;
    let carrier = { carriers: [] }, stego = { confidence: 0 };
    try { carrier = CarrierDetector.analyze(mono, sr); } catch {}
    try { stego = StegoDetector.analyze(mono, sr); } catch {}
    const lastR = ranges[ranges.length - 1];
    return { integratedLUFS: loud.integratedLUFS, loudnessRange: loud.loudnessRange, truePeakDBTP: loud.truePeakDBTP, peakDBFS: base.peakDBFS, rmsDBFS: base.rmsDBFS, crestFactorDB: base.crestFactorDB, spectralFlatness: base.spectralFlatness, clippingCount, dcOffsetL: +(sumL / len).toFixed(6), dcOffsetR: +(sumR / len).toFixed(6), silenceRanges: ranges, fadeIn: ranges.length && ranges[0].start === 0 ? ranges[0].end : 0, fadeOut: lastR && Math.abs(lastR.end - duration) < 0.1 ? +(duration - lastR.start).toFixed(3) : 0, stereoWidth: +stereoWidth.toFixed(4), correlation: +correlation.toFixed(4), monoLowsDB: +(10 * Math.log10(bandE(20, 120) / totalE + 1e-12)).toFixed(2), spectralTilt: +(10 * Math.log10((bandE(8000, 16000) + 1e-12) / (bandE(100, 1000) + 1e-12))).toFixed(2), harshPeaks, sibilance: +(bandE(5000, 8000) / totalE).toFixed(4), hfCutoff, carriers: carrier.carriers || [], echoConfidence: stego.confidence || 0, shimmer: this.measureShimmer(mono, sr), sampleRate: sr, duration };
  }
}

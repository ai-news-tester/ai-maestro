/**
 * NaSuno Web Application v3.0 Entry Point
 * Coordinates Real Web Audio DSP, Pure Math Forensic Analyzer,
 * and the 14-knob Evasion engine.
 */

import { SunoDetector, StegoDetector, SpectralAnalyzer } from './modules/analyzer.js';
import { NaSunoDSP } from './modules/dsp.js?v=8'; // shortcut: manual ?v= cache-bust, bump when dsp.js changes
import { mapAutoReport } from './modules/auto.js';
import { SpectrumRenderer, buildAutoIssues } from './modules/spectrum.js';
import { UIController } from './modules/ui.js';
import { RegistryDOM } from './modules/registry.js';
import { PersistenceManager } from './modules/storage.js';

// ============================================================================
// Application State
// ============================================================================
let registry = null;
let registryDom = null;
let ui = null;
let dsp = null;
let spectrum = null;
let audioCtx = null;

let currentBuffer = null;
let uploadedBuffer = null;
let uploadedFileName = '';
let currentSource = null;
let isPlaying = false;
let currentTrackType = 'cleaned'; // 'cleaned' | 'raw' | 'custom_processed' | 'custom_raw'
let currentPresetKey = 'standardEvasion';

let playbackStartTime = 0;
let playbackOffset = 0;
let isUserScrubbing = false;
let seekerAnimFrame = null;

// ============================================================================
// Audio Context & Playback Management
// ============================================================================
function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    dsp = new NaSunoDSP();
    dsp.init(audioCtx);

    // Push initial DSP parameters from composite knobs
    if (registryDom) {
      applyCompositeKnobDSP();
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function applyCompositeKnobDSP() {
  if (!dsp || !registryDom) return;
  const currentKnobValues = {};
  for (const [id, knob] of Object.entries(registryDom.knobsMap)) {
    currentKnobValues[id] = knob.val;
  }
  dsp.updateAllFromState(currentKnobValues);
}

async function loadAudioFile(url) {
  ensureAudioContext();
  const statusEl = document.getElementById('forensicStatus');
  if (statusEl) statusEl.textContent = 'Loading audio buffer...';

  try {
    let response = await fetch(url);
    if (!response.ok && url.endsWith('.wav')) {
      const oggUrl = url.replace(/\.wav$/, '.ogg');
      const oggResp = await fetch(oggUrl);
      if (oggResp.ok) {
        response = oggResp;
      }
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} (${response.statusText || 'Not Found'})`);
    }

    const arrayBuffer = await response.arrayBuffer();
    currentBuffer = await new Promise((resolve, reject) => {
      audioCtx.decodeAudioData(arrayBuffer, resolve, reject);
    });

    runForensicAnalysis(currentBuffer);

    playbackOffset = 0;
    updateSeekerUI();

    if (isPlaying) {
      stopPlayback(false);
      startPlayback(0);
    }
  } catch (err) {
    console.error('Audio load error:', err);
    if (statusEl) {
      statusEl.textContent = `Audio load failed: ${err.message || 'File not found'}`;
    }
  }
}

function runForensicAnalysis(buffer) {
  const statusEl = document.getElementById('forensicStatus');
  if (statusEl) statusEl.textContent = 'Executing real FFT & cepstral analysis...';

  setTimeout(() => {
    const sr = buffer.sampleRate;
    const len = Math.min(buffer.length, sr * 12); // Up to 12s of PCM

    let samples;
    if (buffer.numberOfChannels > 1) {
      const ch0 = buffer.getChannelData(0);
      const ch1 = buffer.getChannelData(1);
      samples = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        samples[i] = (ch0[i] + ch1[i]) * 0.5;
      }
    } else {
      samples = buffer.getChannelData(0).slice(0, len);
    }

    // Run real math algorithms
    const suno = SunoDetector.analyze(samples, sr);
    const stego = StegoDetector.analyze(samples, sr);
    const spec = SpectralAnalyzer.analyze(samples, sr);

    updateTelemetryUI(suno, stego, spec, buffer);
  }, 15);
}

function updateTelemetryUI(suno, stego, spec, buffer) {
  const statusEl = document.getElementById('forensicStatus');
  if (statusEl) {
    statusEl.textContent = `Analyzed ${buffer.duration.toFixed(1)}s PCM @ ${buffer.sampleRate} Hz (${buffer.numberOfChannels} ch)`;
  }

  // Carrier 1 (15.5k)
  const c1 = suno.carriers[0];
  const c1Freq = document.getElementById('carrier1Freq');
  const c1Prom = document.getElementById('carrier1Prom');
  const c1Bar = document.getElementById('carrier1Bar');
  if (c1) {
    if (c1Freq) c1Freq.textContent = `${(c1.freqHz / 1000).toFixed(2)} kHz`;
    if (c1Prom) {
      c1Prom.textContent = `+${c1.prominenceDB.toFixed(2)} dB`;
      c1Prom.style.color = c1.prominenceDB > 3.0 ? 'var(--fl-red)' : 'var(--text-dim)';
    }
    if (c1Bar) {
      c1Bar.style.width = `${Math.min(100, Math.round(c1.confidence * 100))}%`;
      c1Bar.className = c1.confidence > 0.4 ? 'meter-fill alert' : 'meter-fill';
    }
  }

  // Carrier 2 (17.5k)
  const c2 = suno.carriers[1];
  const c2Freq = document.getElementById('carrier2Freq');
  const c2Prom = document.getElementById('carrier2Prom');
  const c2Bar = document.getElementById('carrier2Bar');
  if (c2) {
    if (c2Freq) c2Freq.textContent = `${(c2.freqHz / 1000).toFixed(2)} kHz`;
    if (c2Prom) {
      c2Prom.textContent = `+${c2.prominenceDB.toFixed(2)} dB`;
      c2Prom.style.color = c2.prominenceDB > 3.0 ? 'var(--fl-red)' : 'var(--text-dim)';
    }
    if (c2Bar) {
      c2Bar.style.width = `${Math.min(100, Math.round(c2.confidence * 100))}%`;
      c2Bar.className = c2.confidence > 0.4 ? 'meter-fill alert' : 'meter-fill';
    }
  }

  // Carrier 3 (19.5k)
  const c3 = suno.carriers[2];
  const c3Freq = document.getElementById('carrier3Freq');
  const c3Prom = document.getElementById('carrier3Prom');
  const c3Bar = document.getElementById('carrier3Bar');
  if (c3) {
    if (c3Freq) c3Freq.textContent = `${(c3.freqHz / 1000).toFixed(2)} kHz`;
    if (c3Prom) {
      c3Prom.textContent = `+${c3.prominenceDB.toFixed(2)} dB`;
      c3Prom.style.color = c3.prominenceDB > 3.0 ? 'var(--fl-red)' : 'var(--text-dim)';
    }
    if (c3Bar) {
      c3Bar.style.width = `${Math.min(100, Math.round(c3.confidence * 100))}%`;
      c3Bar.className = c3.confidence > 0.4 ? 'meter-fill alert' : 'meter-fill';
    }
  }

  // Stego Echo
  const echoDelay = document.getElementById('echoDelay');
  const echoScore = document.getElementById('echoScore');
  const echoBar = document.getElementById('echoBar');
  if (stego.echoes && stego.echoes.length > 0) {
    const topEcho = stego.echoes[0];
    if (echoDelay) echoDelay.textContent = `${topEcho.delayMs.toFixed(2)} ms`;
    if (echoScore) {
      echoScore.textContent = `MAD ${topEcho.score.toFixed(2)}`;
      echoScore.style.color = topEcho.score > 3.5 ? 'var(--fl-red)' : 'var(--text-dim)';
    }
    if (echoBar) {
      echoBar.style.width = `${Math.min(100, Math.round(stego.confidence * 100))}%`;
      echoBar.className = stego.confidence > 0.4 ? 'meter-fill alert' : 'meter-fill';
    }
  } else {
    if (echoDelay) echoDelay.textContent = 'None';
    if (echoScore) {
      echoScore.textContent = 'MAD 0.00';
      echoScore.style.color = 'var(--text-dim)';
    }
    if (echoBar) {
      echoBar.style.width = '0%';
      echoBar.className = 'meter-fill';
    }
  }

  // Flatness & Dynamics
  const valFlatness = document.getElementById('valFlatness');
  const valCrest = document.getElementById('valCrest');
  const valPeak = document.getElementById('valPeak');
  const valRms = document.getElementById('valRms');
  const fmtDb = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-∞'); // silence is -Infinity, not "-Infinity"
  if (valFlatness) valFlatness.textContent = spec.spectralFlatness.toFixed(4);
  if (valCrest) valCrest.textContent = `Crest ${spec.crestFactorDB.toFixed(1)} dB`;
  if (valPeak) valPeak.textContent = `Peak ${fmtDb(spec.peakDBFS)} dBFS`;
  if (valRms) valRms.textContent = `RMS ${fmtDb(spec.rmsDBFS)} dBFS`;
}

function formatPlaybackTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getCurrentPlaybackTime() {
  if (!currentBuffer) return 0;
  const duration = currentBuffer.duration;
  if (duration <= 0) return 0;
  if (!isPlaying) return playbackOffset % duration;
  const elapsed = audioCtx ? (audioCtx.currentTime - playbackStartTime) : 0;
  return (playbackOffset + elapsed) % duration;
}

function updateSeekerUI() {
  if (!currentBuffer) return;
  const timeCurrentEl = document.getElementById('playbackTimeCurrent');
  const timeTotalEl = document.getElementById('playbackTimeTotal');
  const seekerSlider = document.getElementById('audioSeeker');
  const progressFill = document.getElementById('seekerProgressFill');

  const duration = currentBuffer.duration;
  if (timeTotalEl) timeTotalEl.textContent = formatPlaybackTime(duration);

  if (!isUserScrubbing) {
    const curTime = getCurrentPlaybackTime();
    const pct = duration > 0 ? (curTime / duration) * 100 : 0;
    if (timeCurrentEl) timeCurrentEl.textContent = formatPlaybackTime(curTime);
    if (seekerSlider) seekerSlider.value = pct;
    if (progressFill) progressFill.style.width = `${pct}%`;
  }
}

function startSeekerLoop() {
  stopSeekerLoop();
  const tick = () => {
    if (isPlaying) {
      updateSeekerUI();
      seekerAnimFrame = requestAnimationFrame(tick);
    }
  };
  seekerAnimFrame = requestAnimationFrame(tick);
}

function stopSeekerLoop() {
  if (seekerAnimFrame) {
    cancelAnimationFrame(seekerAnimFrame);
    seekerAnimFrame = null;
  }
}

function startPlayback(seekOffset = null) {
  if (!currentBuffer) return;
  ensureAudioContext();

  if (seekOffset !== null) {
    playbackOffset = seekOffset;
  }
  const duration = currentBuffer.duration;
  if (duration > 0 && playbackOffset >= duration) {
    playbackOffset = 0;
  }

  if (currentSource) {
    try {
      currentSource.stop();
      currentSource.disconnect();
    } catch (_) {}
    currentSource = null;
  }

  currentSource = audioCtx.createBufferSource();
  currentSource.buffer = currentBuffer;
  currentSource.loop = true;
  currentSource.loopStart = 0;
  currentSource.loopEnd = duration;

  dsp.connect(currentSource, audioCtx.destination);
  currentSource.start(0, playbackOffset);
  playbackStartTime = audioCtx.currentTime;
  isPlaying = true;

  updatePlayButtonUI(true);
  startSeekerLoop();
}

function stopPlayback(keepOffset = true) {
  if (keepOffset && isPlaying) {
    playbackOffset = getCurrentPlaybackTime();
  }
  if (currentSource) {
    try {
      currentSource.stop();
      currentSource.disconnect();
    } catch (_) {}
    currentSource = null;
  }
  isPlaying = false;
  updatePlayButtonUI(false);
  stopSeekerLoop();
  updateSeekerUI();
}

function seekPlaybackTo(targetSeconds) {
  if (!currentBuffer) return;
  const duration = currentBuffer.duration;
  if (duration <= 0) return;
  targetSeconds = Math.max(0, Math.min(duration, targetSeconds));
  playbackOffset = targetSeconds;

  if (isPlaying) {
    startPlayback(targetSeconds);
  } else {
    updateSeekerUI();
  }
}

function setupSeekerControls() {
  const seekerSlider = document.getElementById('audioSeeker');
  const timeCurrentEl = document.getElementById('playbackTimeCurrent');
  const progressFill = document.getElementById('seekerProgressFill');
  if (!seekerSlider) return;

  seekerSlider.addEventListener('input', () => {
    if (!currentBuffer) return;
    isUserScrubbing = true;
    const pct = parseFloat(seekerSlider.value);
    const targetSeconds = (pct / 100) * currentBuffer.duration;
    if (timeCurrentEl) timeCurrentEl.textContent = formatPlaybackTime(targetSeconds);
    if (progressFill) progressFill.style.width = `${pct}%`;
  });

  seekerSlider.addEventListener('change', () => {
    if (!currentBuffer) return;
    const pct = parseFloat(seekerSlider.value);
    const targetSeconds = (pct / 100) * currentBuffer.duration;
    isUserScrubbing = false;
    seekPlaybackTo(targetSeconds);
  });
}

function updatePlayButtonUI(playing) {
  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const playLabel = document.getElementById('playLabel');
  if (!playBtn) return;

  const audioType = uploadedBuffer ? 'AUDIO' : 'DEMO';

  if (playing) {
    playBtn.classList.add('playing');
    if (playIcon) {
      playIcon.innerHTML = `<svg class="svg-pause" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    }
    if (playLabel) playLabel.textContent = `PAUSE ${audioType}`;
  } else {
    playBtn.classList.remove('playing');
    if (playIcon) {
      playIcon.innerHTML = `<svg class="svg-play" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;
    }
    if (playLabel) playLabel.textContent = `PLAY ${audioType}`;
  }
}

// ============================================================================
// Bidirectional Sync Engine
// ============================================================================

let persistTimeout = null;

/**
 * Persist current composite knob values, preset, and bypass flag to LocalStorage.
 */
function persistCurrentSettings() {
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    if (!registryDom) return;
    const compositeValues = {};
    for (const [id, knob] of Object.entries(registryDom.knobsMap)) {
      compositeValues[id] = knob.val;
    }
    PersistenceManager.saveSettings({
      presetKey: currentPresetKey,
      compositeValues,
      isBypassed: dsp ? dsp.isBypassed : false,
      timestamp: Date.now(),
    });
  }, 120);
}

/** Composite knob turned -> update DSP with zero delay. */
function handleCompositeKnobChange(knobId, knobVal) {
  if (!registry || !registryDom) return;

  // If currently bypassed, automatically re-engage DSP so moving knobs reveals the live effect!
  if (dsp && dsp.isBypassed) {
    if (ui) ui.setBypassState(false);
    dsp.setBypass(false);
    const trackCleanBtn = document.getElementById('trackCleanBtn');
    const trackRawBtn = document.getElementById('trackRawBtn');
    if (trackCleanBtn) trackCleanBtn.classList.add('active');
    if (trackRawBtn) trackRawBtn.classList.remove('active');
  }

  // When manually tweaking knobs away from a preset, mark the profile as Custom
  if (currentPresetKey !== 'custom') {
    currentPresetKey = 'custom';
    if (ui) ui.setPresetDisplay('custom');
  }

  // Update live DSP node immediately with zero delay!
  if (dsp) {
    dsp.updateFromKnob(knobId, knobVal);
  }

  // Persist progress to browser storage
  persistCurrentSettings();
}

// ============================================================================
// AUTO Mode: detect -> map -> apply -> report
// ============================================================================
let autoReport = null;
let autoParams = null;
let autoIssues = [];
let lastManualPreset = 'standardEvasion';

function autoTargetLUFS() {
  const sel = document.getElementById('autoTargetLUFS');
  const v = sel ? parseFloat(sel.value) : -14;
  return Number.isFinite(v) ? v : -14;
}

function setAutoProgress(text) {
  const el = document.getElementById('autoProgress');
  if (el) el.textContent = text;
}

function renderAutoIssues(issues) {
  const host = document.getElementById('autoIssues');
  if (!host) return;
  host.innerHTML = '';
  for (const issue of issues) {
    const row = document.createElement('div');
    row.className = 'auto-issue-row';

    const name = document.createElement('div');
    name.className = 'auto-issue-name';
    name.textContent = issue.name;

    const where = document.createElement('div');
    where.className = 'auto-issue-where';
    const band = Number.isFinite(issue.freqLo) && Number.isFinite(issue.freqHi)
      ? `${Math.round(issue.freqLo)}-${Math.round(issue.freqHi)} Hz`
      : 'full track';
    where.textContent = `${band} / ${issue.timeStart.toFixed(1)}-${issue.timeEnd.toFixed(1)} s`;

    const bar = document.createElement('div');
    bar.className = 'auto-issue-bar';
    const fill = document.createElement('div');
    fill.className = 'auto-issue-bar-fill';
    fill.style.width = `${Math.round(issue.severity * 100)}%`;
    bar.appendChild(fill);

    const value = document.createElement('div');
    value.className = 'auto-issue-val';
    value.textContent = `${issue.measured}${issue.unit ? ' ' + issue.unit : ''} / target ${issue.target}${issue.unit ? ' ' + issue.unit : ''}`;

    const knob = issue.knobId && registryDom ? registryDom.knobsMap[issue.knobId] : null;
    row.append(name, where, bar, value);
    if (knob) {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'auto-issue-slider';
      slider.min = issue.sliderMin;
      slider.max = issue.sliderMax;
      slider.step = issue.sliderStep;
      slider.value = issue.sliderDefault;
      slider.title = issue.reason || issue.name;
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        knob.setValue(v, true);
        if (dsp) dsp.updateFromKnob(issue.knobId, knob.val);
        currentPresetKey = 'custom';
        if (ui) ui.setPresetDisplay('custom');
        persistCurrentSettings();
      });
      row.appendChild(slider);
    } else {
      const note = document.createElement('div');
      note.className = 'auto-issue-manual';
      note.textContent = issue.sliderDefault ? 'on' : 'info';
      row.appendChild(note);
    }
    host.appendChild(row);
  }
}

/** Apply an AUTO result: push every param through the same path export uses, then re-report. */
function applyAutoReport(report, auto) {
  autoReport = report;
  autoParams = auto.params;

  if (dsp) {
    // AUTO-only chain inputs (not registry knobs)
    Object.assign(dsp.params, {
      sibilance: auto.params.sibilance,
      hfCutoff: auto.params.hfCutoff,
      correlation: auto.params.correlation,
      msBass: auto.params.msBass,
      crestFactorDB: auto.params.crestFactorDB,
      integratedLUFS: auto.params.integratedLUFS,
      targetLUFS: auto.params.targetLUFS,
      limiterEngaged: auto.params.limiterEngaged,
      autoTrimDb: auto.params.autoTrimDb || 0,
    });
  }

  for (const [id, val] of Object.entries(auto.params)) {
    const knob = registryDom && registryDom.knobsMap[id];
    if (!knob) continue;
    knob.setValue(val, false, knob.fineStep());
    if (dsp) dsp.updateFromKnob(id, knob.val);
  }

  currentPresetKey = auto.presetKey;
  if (ui) ui.setPresetDisplay(auto.presetKey);

  // AUTO must engage the chain, not leave BYPASS (RAW) on.
  if (dsp) dsp.setBypass(false);
  if (ui) ui.setBypassState(false);

  // Rebuild the live chain so it matches export exactly.
  if (dsp && isPlaying) startPlayback();

  autoIssues = buildAutoIssues(report, auto.params, auto.reasons, auto.params.targetLUFS);
  if (spectrum) spectrum.setAutoIssues(autoIssues);
  renderAutoIssues(autoIssues);

  const statusEl = document.getElementById('forensicStatus');
  if (statusEl) {
    const lufs = Number.isFinite(report.integratedLUFS) ? report.integratedLUFS.toFixed(1) : 'n/a';
    const tp = Number.isFinite(report.truePeakDBTP) ? report.truePeakDBTP.toFixed(1) : 'n/a';
    statusEl.textContent = `AUTO ${auto.presetKey}: ${lufs} LUFS -> target ${auto.params.targetLUFS}, true peak ${tp} dBTP, ${autoIssues.length} issue(s)`;
  }
  persistCurrentSettings();
}

async function runAutoMaster() {
  const statusEl = document.getElementById('forensicStatus');
  if (!currentBuffer) {
    if (statusEl) statusEl.textContent = 'Load or upload an audio file first.';
    return;
  }
  const btn = document.getElementById('autoBtn');
  if (btn) btn.disabled = true;
  try {
    setAutoProgress('Detect: analysing full track...');
    await new Promise((r) => setTimeout(r, 0));
    const report = SpectralAnalyzer.analyzeFullTrack(currentBuffer);

    setAutoProgress('Clean: mapping cleanup stages...');
    await new Promise((r) => setTimeout(r, 0));
    const auto = mapAutoReport(report, autoTargetLUFS());

    setAutoProgress('Master: calibrating loudness (full-track render)...');
    await new Promise((r) => setTimeout(r, 0));
    // Calibrate the trim from a real render so live playback matches export.
    const rendered = await NaSunoDSP.renderChain(currentBuffer, auto.params);
    const measured = NaSunoDSP.measureRender(rendered);
    auto.params.autoTrimDb = NaSunoDSP.correctionGainDb(measured.integratedLUFS, measured.truePeakDBTP, auto.params.targetLUFS);

    setAutoProgress('Master: applying chain...');
    applyAutoReport(report, auto);
    await new Promise((r) => setTimeout(r, 0));

    setAutoProgress('Export: ready - use EXPORT CLEANED WAV');
  } catch (err) {
    console.error('AUTO error:', err);
    if (statusEl) statusEl.textContent = `AUTO failed: ${err.message}`;
    setAutoProgress('Failed');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============================================================================
// Preset Profile Management
// ============================================================================
function applyPreset(presetKey) {
  if (!registry || !registry.presets[presetKey]) return;
  currentPresetKey = presetKey;
  lastManualPreset = presetKey;
  const p = registry.presets[presetKey];

  // Apply composite knob values from preset
  for (const [knobId, val] of Object.entries(p.compositeValues)) {
    const k = registryDom.knobsMap[knobId];
    if (k) k.setValue(val, false);
  }

  applyCompositeKnobDSP();

  // If Off profile is selected, activate bypass so pure unadulterated original audio plays
  const trackRawBtn = document.getElementById('trackRawBtn');
  const trackCleanBtn = document.getElementById('trackCleanBtn');

  if (presetKey === 'off') {
    if (ui) ui.setBypassState(true);
    if (dsp) dsp.setBypass(true);
    if (trackRawBtn) trackRawBtn.classList.add('active');
    if (trackCleanBtn) trackCleanBtn.classList.remove('active');
  } else {
    // If switching from Off to an active evasion preset, re-engage DSP active
    if (ui && ui.isBypassed) {
      ui.setBypassState(false);
      if (dsp) dsp.setBypass(false);
      if (trackCleanBtn) trackCleanBtn.classList.add('active');
      if (trackRawBtn) trackRawBtn.classList.remove('active');
    }
  }

  // Persist active preset & knob state to browser storage
  persistCurrentSettings();
}

// ============================================================================
// AUTO Controls Wiring
// ============================================================================
function setupAutoControls() {
  const autoBtn = document.getElementById('autoBtn');
  if (autoBtn) autoBtn.addEventListener('click', () => runAutoMaster());
  const targetSel = document.getElementById('autoTargetLUFS');
  if (targetSel) targetSel.addEventListener('change', () => { if (autoReport) runAutoMaster(); });
  const origBtn = document.getElementById('playOriginalBtn');
  if (origBtn) origBtn.addEventListener('click', () => { if (dsp) dsp.setBypass(true); if (ui) ui.setBypassState(true); if (!isPlaying) startPlayback(); });
  const autoPlayBtn = document.getElementById('playAutoBtn');
  if (autoPlayBtn) autoPlayBtn.addEventListener('click', () => { if (dsp) dsp.setBypass(false); if (ui) ui.setBypassState(false); if (isPlaying) startPlayback(); else startPlayback(); });
  const revertBtn = document.getElementById('revertManualBtn');
  if (revertBtn) revertBtn.addEventListener('click', () => { autoParams = null; autoReport = null; autoIssues = []; if (dsp) Object.assign(dsp.params, { autoTrimDb: 0, integratedLUFS: null, sibilance: 0, hfCutoff: 0, correlation: 1, msBass: 0, crestFactorDB: 12 }); if (spectrum) spectrum.setAutoIssues([]); renderAutoIssues([]); applyPreset(lastManualPreset || 'standardEvasion'); if (isPlaying) startPlayback(); setAutoProgress('Reverted to manual preset'); });
}

// ============================================================================
// Export WAV Offline Handler
// ============================================================================
function setupExportWAV() {
  const exportBtn = document.getElementById('exportWavBtn');
  const statusEl = document.getElementById('exportStatus');
  if (!exportBtn) return;

  exportBtn.addEventListener('click', async () => {
    if (!currentBuffer) {
      if (statusEl) statusEl.textContent = 'Load or upload an audio file first.';
      return;
    }

    exportBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Rendering 16-bit PCM cascade offline...';

    try {
      const currentKnobValues = {};
      if (registryDom) {
        for (const [id, knob] of Object.entries(registryDom.knobsMap)) {
          currentKnobValues[id] = knob.val;
        }
      }
      if (autoParams) Object.assign(currentKnobValues, autoParams);

      const isBypassed = !!(dsp?.isBypassed || currentTrackType === 'raw' || currentTrackType === 'custom_raw');
      const wavBlob = await NaSunoDSP.exportWAV(currentBuffer, currentKnobValues, isBypassed);
      const downloadUrl = URL.createObjectURL(wavBlob);

      const a = document.createElement('a');
      a.href = downloadUrl;
      const baseName = uploadedBuffer
        ? (currentTrackType === 'custom_raw' ? `${uploadedFileName}_original` : `${uploadedFileName}_processed`)
        : (currentTrackType === 'raw' ? 'cleaned_demo_original' : 'cleaned_audio');
      a.download = autoParams ? `${uploadedFileName || baseName}.auto-master.wav` : `${baseName}_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      if (statusEl) {
        statusEl.textContent = 'Export complete!';
      }
    } catch (err) {
      console.error('Export error:', err);
      if (statusEl) statusEl.textContent = 'Export failed during offline rendering.';
    } finally {
      exportBtn.disabled = false;
    }
  });
}

// ============================================================================
// Application Boot
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Load registry JSON
    registry = await RegistryDOM.load('knob-registry.json');

    // 2. Instantiate and render DOM
    registryDom = new RegistryDOM(registry);
    registryDom.renderAll({
      onKnobInfoClick: (knobId, btn) => ui.showCompositeInfo(knobId, btn),
    });

    // 3. Connect composite knob change listeners
    for (const [knobId, knob] of Object.entries(registryDom.knobsMap)) {
      knob.onChange((val) => {
        handleCompositeKnobChange(knobId, val);
      });
    }

    const trackCleanBtn = document.getElementById('trackCleanBtn');
    const trackRawBtn = document.getElementById('trackRawBtn');
    const resetDemoBtn = document.getElementById('resetDemoBtn');
    const scopeModeLabel = document.getElementById('scopeModeLabel');

    function syncPillsWithAudioState(isRawOriginal) {
      if (isRawOriginal) {
        if (trackRawBtn) trackRawBtn.classList.add('active');
        if (trackCleanBtn) trackCleanBtn.classList.remove('active');
      } else {
        if (trackCleanBtn) trackCleanBtn.classList.add('active');
        if (trackRawBtn) trackRawBtn.classList.remove('active');
      }
    }

    // 4. Initialize UI Controller
    ui = new UIController(registry, {
      onPresetSelect: (presetKey) => applyPreset(presetKey),
      onBypassToggle: (isBypassed) => {
        if (dsp) dsp.setBypass(isBypassed);
        syncPillsWithAudioState(isBypassed);
        persistCurrentSettings();
      },
    });

    // 5. Initialize Spectrum Visualizer
    const canvas = document.getElementById('scopeCanvas');
    if (canvas) {
      spectrum = new SpectrumRenderer(canvas, {
        getAudioCtx: () => audioCtx,
        getDSP: () => dsp,
        getIsPlaying: () => isPlaying,
      });
      spectrum.start();
    }

    // 6. Audio controls
    const playBtn = document.getElementById('playBtn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (isPlaying) stopPlayback();
        else startPlayback();
      });
    }

    if (trackCleanBtn) {
      trackCleanBtn.addEventListener('click', () => {
        syncPillsWithAudioState(false);
        if (uploadedBuffer) {
          // Stay on user's uploaded audio with live DSP evasion processing
          currentTrackType = 'custom_processed';
          currentBuffer = uploadedBuffer;
          if (dsp) dsp.setBypass(false);
          if (ui) ui.setBypassState(false);
          if (!isPlaying) startPlayback();
        } else {
          // In demo mode: load processed demo
          currentTrackType = 'cleaned';
          if (dsp) dsp.setBypass(false);
          if (ui) ui.setBypassState(false);
          loadAudioFile('audio/demo_original.wav');
        }
      });
    }

    if (trackRawBtn) {
      trackRawBtn.addEventListener('click', () => {
        syncPillsWithAudioState(true);
        if (uploadedBuffer) {
          // Stay on user's uploaded audio with raw direct bypass (dry original)
          currentTrackType = 'custom_raw';
          currentBuffer = uploadedBuffer;
          if (dsp) dsp.setBypass(true);
          if (ui) ui.setBypassState(true);
          if (!isPlaying) startPlayback();
        } else {
          // In demo mode: load original demo
          currentTrackType = 'raw';
          if (dsp) dsp.setBypass(true);
          if (ui) ui.setBypassState(true);
          loadAudioFile('audio/demo_original.wav');
        }
      });
    }

    if (resetDemoBtn) {
      resetDemoBtn.addEventListener('click', async () => {
        uploadedBuffer = null;
        uploadedFileName = '';
        await PersistenceManager.clearUploadedAudio();
        if (trackCleanBtn) trackCleanBtn.textContent = 'PROCESSED DEMO';
        if (trackRawBtn) trackRawBtn.textContent = 'ORIGINAL DEMO';
        resetDemoBtn.style.display = 'none';
        syncPillsWithAudioState(false);
        if (dsp) dsp.setBypass(false);
        if (ui) ui.setBypassState(false);
        persistCurrentSettings();
        updatePlayButtonUI(isPlaying);
        if (scopeModeLabel) {
          scopeModeLabel.textContent = '2048-POINT FFT • DUAL-TRACE OVERLAY (ORANGE GHOST: ORIGINAL • CYAN: LIVE EVASION)';
        }
        currentTrackType = 'cleaned';
        loadAudioFile('audio/demo_original.wav');
      });
    }

    const uploadInput = document.getElementById('userAudioUpload');
    if (uploadInput) {
      uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        ensureAudioContext();

        const statusEl = document.getElementById('forensicStatus');
        if (statusEl) statusEl.textContent = `Decoding & caching ${file.name}...`;

        try {
          const arrayBuffer = await file.arrayBuffer();

          // Persist uploaded audio to IndexedDB so browser refresh never loses progress!
          await PersistenceManager.saveUploadedAudio(arrayBuffer, file.name);

          // Decode a clone of the arrayBuffer (decodeAudioData detaches original)
          const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

          uploadedBuffer = decoded;
          currentBuffer = decoded;
          uploadedFileName = file.name.replace(/\.[^/.]+$/, '');
          currentTrackType = 'custom_processed';

          // When a file is uploaded, the demo is no more: switch pills to PROCESSED AUDIO & ORIGINAL AUDIO
          if (trackCleanBtn) trackCleanBtn.textContent = 'PROCESSED AUDIO';
          if (trackRawBtn) trackRawBtn.textContent = 'ORIGINAL AUDIO';
          if (resetDemoBtn) resetDemoBtn.style.display = 'inline-flex';
          syncPillsWithAudioState(false);

          if (dsp) dsp.setBypass(false);
          if (ui) ui.setBypassState(false);
          persistCurrentSettings();

          if (scopeModeLabel) {
            scopeModeLabel.textContent = '2048-POINT FFT • DUAL-TRACE OVERLAY (ORANGE GHOST: ORIGINAL AUDIO • CYAN: PROCESSED AUDIO)';
          }

          runForensicAnalysis(currentBuffer);

          playbackOffset = 0;
          updateSeekerUI();

          // Immediately start playback of user's uploaded music with live evasion
          stopPlayback(false);
          startPlayback(0);
          updatePlayButtonUI(true);

          if (statusEl) statusEl.textContent = `Playing uploaded file: ${file.name} (persisted in browser storage)`;
        } catch (err) {
          console.error('File decode error:', err);
          if (statusEl) statusEl.textContent = `Could not decode audio: ${err.message}`;
        }
      });
    }

    // 7. WAV Export setup
    setupExportWAV();
    setupAutoControls();

    // 8. Playback Seeker / Scrubber setup
    setupSeekerControls();

    // 9. Restore persisted knob/preset settings or apply default Preset
    const savedSettings = PersistenceManager.loadSettings();
    if (savedSettings && savedSettings.compositeValues) {
      if (savedSettings.presetKey) {
        currentPresetKey = savedSettings.presetKey;
        if (ui) ui.setPresetDisplay(savedSettings.presetKey);
      }
      for (const [knobId, val] of Object.entries(savedSettings.compositeValues)) {
        const k = registryDom.knobsMap[knobId];
        if (k) k.setValue(val, false, k.fineStep()); // fine grid keeps saved Shift-tuned values
      }
      applyCompositeKnobDSP();
      if (savedSettings.isBypassed) {
        if (ui) ui.setBypassState(true);
        if (dsp) dsp.setBypass(true);
        syncPillsWithAudioState(true);
      }
    } else {
      applyPreset('standardEvasion');
    }

    // 10. Restore persisted uploaded audio from IndexedDB or load default demo
    const savedAudio = await PersistenceManager.loadUploadedAudio();
    if (savedAudio && savedAudio.data) {
      try {
        ensureAudioContext();
        let arrayBuffer = savedAudio.data;
        if (savedAudio.data instanceof Blob) {
          arrayBuffer = await savedAudio.data.arrayBuffer();
        }
        const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));

        uploadedBuffer = decoded;
        currentBuffer = decoded;
        uploadedFileName = savedAudio.fileName.replace(/\.[^/.]+$/, '');
        const isBypassed = savedSettings ? !!savedSettings.isBypassed : false;
        currentTrackType = isBypassed ? 'custom_raw' : 'custom_processed';

        if (trackCleanBtn) trackCleanBtn.textContent = 'PROCESSED AUDIO';
        if (trackRawBtn) trackRawBtn.textContent = 'ORIGINAL AUDIO';
        if (resetDemoBtn) resetDemoBtn.style.display = 'inline-flex';
        syncPillsWithAudioState(isBypassed);

        if (scopeModeLabel) {
          scopeModeLabel.textContent = '2048-POINT FFT • DUAL-TRACE OVERLAY (ORANGE GHOST: ORIGINAL AUDIO • CYAN: PROCESSED AUDIO)';
        }

        runForensicAnalysis(currentBuffer);
        playbackOffset = 0;
        updateSeekerUI();
        updatePlayButtonUI(false);

        const statusEl = document.getElementById('forensicStatus');
        if (statusEl) statusEl.textContent = `Restored session audio: ${savedAudio.fileName}`;
      } catch (err) {
        console.warn('Failed to restore uploaded audio from IndexedDB:', err);
        loadAudioFile('audio/demo_original.wav');
      }
    } else {
      // Load default demo track
      loadAudioFile('audio/demo_original.wav');
    }

  } catch (err) {
    console.error('App initialization error:', err);
  }
});

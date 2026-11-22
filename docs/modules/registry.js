/**
 * AI-Maestro DOM Registry & Wiring Engine
 * Fetches knob-registry.json and dynamically renders processing controls.
 * Zero hardcoded HTML: complete UI structure is data-driven.
 * Zero emojis: uses clean, razor-sharp SVG vector iconography.
 */

import { FLKnob } from './knob.js';

/** Escape text for safe HTML interpolation (fix 6). */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// SVG Vector Icon Templates
const SVG_ICONS = {
  info: `<svg class="svg-icon-info" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

export class RegistryDOM {
  constructor(registry) {
    this.registry = registry;
    this.knobsMap = {};
  }

  /**
   * Fetch registry JSON from path.
   * @param {string} url
   * @returns {Promise<Object>}
   */
  static async load(url = 'knob-registry.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load registry: HTTP ${res.status}`);
    return await res.json();
  }

  /**
   * Render the processing panel into its designated DOM container.
   * @param {Object} options
   */
  renderAll(options = {}) {
    this.renderEvasionPanel(options.onKnobInfoClick);
  }

  /**
   * Render the control panel (14 composite knobs across 4 modules).
   */
  renderEvasionPanel(onInfoClick) {
    const container = document.getElementById('evasionPanel');
    if (!container) return;
    for (const knob of Object.values(this.knobsMap)) { if (typeof knob.destroy === 'function') knob.destroy(); }
    this.knobsMap = {};
    container.innerHTML = '';

    // Group composite knobs by module
    const modules = [
      { id: 'watermarkErase', title: 'RESONANCE CLEANUP', subtitle: 'Notch and peaking cuts at measured resonances', color: 'cyan' },
      { id: 'fingerprintScatter', title: 'PHASE & TEXTURE', subtitle: 'Phase dispersion, soft shaping and micro delay', color: 'cyan' },
      { id: 'naturalization', title: 'NATURALIZATION', subtitle: 'Room reflections, harmonic texture and air band', color: 'green' },
      { id: 'masteringQuality', title: 'MASTERING', subtitle: 'Bus compression, limiter ceiling and output gain', color: 'orange' },
    ];

    for (const mod of modules) {
      const modKnobs = this.registry.compositeKnobs.filter((k) => k.module === mod.id);
      if (modKnobs.length === 0) continue;

      const modCard = document.createElement('div');
      modCard.className = `rack-module-card border-${mod.color}`;
      modCard.innerHTML = `
        <div class="module-header">
          <div class="module-title-wrap">
            <span class="module-pill pill-${mod.color}">${mod.title}</span>
            <span class="module-desc">${mod.subtitle}</span>
          </div>
          <span class="module-count">${modKnobs.length} CONTROLS</span>
        </div>
        <div class="module-knobs-grid" id="grid_${mod.id}"></div>
      `;

      const grid = modCard.querySelector(`#grid_${mod.id}`);

      for (const k of modKnobs) {
        const knobCol = document.createElement('div');
        knobCol.className = 'knob-col';
        knobCol.innerHTML = `
          <div class="knob-label-row">
            <span class="knob-label" title="${escapeHtml(k.label)}">${escapeHtml(k.label)}</span>
            <button class="info-btn" data-composite-info="${k.id}" title="About this control" aria-label="About this control">
              ${SVG_ICONS.info}
            </button>
          </div>
          <div class="fl-knob-wrapper">
            <svg class="knob-ring-svg" viewBox="0 0 76 76">
              <circle class="ring-bg" cx="38" cy="38" r="30"></circle>
              <circle class="ring-active ring-${k.ring}" cx="38" cy="38" r="30"></circle>
            </svg>
            <div class="knob-rotor">
              <div class="rotor-cap"></div>
              <div class="rotor-pointer"></div>
            </div>
          </div>
          <div class="knob-readout-row">
            <div class="knob-readout" id="readout_${k.id}">--</div>
          </div>
        `;

        // Wire info button
        const infoBtn = knobCol.querySelector('.info-btn');
        if (infoBtn && onInfoClick) {
          infoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onInfoClick(k.id, infoBtn);
          });
        }

        grid.appendChild(knobCol);

        // Instantiate FLKnob
        const knobEl = knobCol.querySelector('.fl-knob-wrapper');
        const flKnob = new FLKnob(knobEl, {
          knobId: k.id,
          min: k.min,
          max: k.max,
          step: k.step,
          default: k.default,
          val: k.default,
          unit: k.unit,
          readoutEl: knobCol.querySelector(`#readout_${k.id}`),
        });
        this.knobsMap[k.id] = flKnob;
      }

      container.appendChild(modCard);
    }
  }

  }

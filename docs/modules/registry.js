/**
 * NaSuno DOM Registry & Wiring Engine
 * Fetches knob-registry.json and dynamically renders Evasion Mode knobs.
 * Zero hardcoded HTML: complete UI structure is data-driven.
 * Zero emojis: uses clean, razor-sharp SVG vector iconography.
 */

import { FLKnob } from './knob.js';

// SVG Vector Icon Templates
const SVG_ICONS = {
  info: `<svg class="svg-icon-info" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  reset: `<svg class="svg-icon-reset" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  chevron: `<svg class="svg-chevron-arrow" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  slider: `<svg class="svg-icon-slider" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>`,
  download: `<svg class="svg-icon-btn" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  upload: `<svg class="svg-icon-upload" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  apply: `<svg class="svg-icon-btn" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  save: `<svg class="svg-icon-btn" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
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
   * Render the evasion panel into its designated DOM container.
   * @param {Object} options
   */
  renderAll(options = {}) {
    this.renderEvasionPanel(options.onKnobInfoClick);
  }

  /**
   * Render Evasion Mode (14 composite knobs across 4 modules).
   */
  renderEvasionPanel(onInfoClick) {
    const container = document.getElementById('evasionPanel');
    if (!container) return;
    container.innerHTML = '';

    // Group composite knobs by module
    const modules = [
      { id: 'watermarkErase', title: 'WATERMARK ERASE', subtitle: 'Direct removal of embedded AI marks', color: 'cyan' },
      { id: 'fingerprintScatter', title: 'FINGERPRINT SCATTER', subtitle: 'Spectral shape & phase coherence disruption', color: 'cyan' },
      { id: 'naturalization', title: 'NATURALIZATION', subtitle: 'Acoustic realism & room signature restoration', color: 'green' },
      { id: 'masteringQuality', title: 'MASTERING & QUALITY', subtitle: 'Dynamic density & perceptual firewall gates', color: 'orange' },
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
          <span class="module-count">${modKnobs.length} VECTORS</span>
        </div>
        <div class="module-knobs-grid" id="grid_${mod.id}"></div>
      `;

      const grid = modCard.querySelector(`#grid_${mod.id}`);

      for (const k of modKnobs) {
        const knobCol = document.createElement('div');
        knobCol.className = 'knob-col';
        knobCol.innerHTML = `
          <div class="knob-label-row">
            <span class="knob-label" title="${k.label}">${k.label}</span>
            <button class="info-btn" data-composite-info="${k.id}" title="Vector information" aria-label="Vector Info">
              ${SVG_ICONS.info}
            </button>
          </div>
          <div class="fl-knob-wrapper"
               data-knob="${k.id}"
               data-min="${k.min}"
               data-max="${k.max}"
               data-step="${k.step}"
               data-val="${k.default}"
               data-unit="${k.unit}">
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

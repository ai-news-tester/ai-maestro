/**
 * FLKnob — Generic Rotary Controller for AI-Maestro
 * Encapsulates rotor rotation, SVG arc ring, drag physics, wheel, and double-click reset.
 * Completely agnostic of DSP or backend logic.
 */

export class FLKnob {
  /**
   * @param {HTMLElement} element - Knob DOM container
   * @param {Object} options - knob id, range, step, default, value, unit, readout element
   */
  constructor(element, options = {}) {
    this.el = element;
    this.knobId = options.knobId;
    this.min = options.min;
    this.max = options.max;
    this.step = options.step;
    this.defaultVal = options.default;
    this.val = options.val;
    this.unit = options.unit;

    this.rotor = element.querySelector('.knob-rotor');
    this.ring = element.querySelector('.ring-active');
    this.readout = options.readoutEl;

    this.startY = 0;
    this.startVal = 0;
    this.isDragging = false;
    this.listeners = [];

    this.init();
  }

  init() {
    this.updateVisuals();

    // Mouse drag
    this.el.addEventListener('mousedown', (e) => {
      // Don't drag if clicking the info button
      if (e.target.closest('.info-btn')) return;
      this.onStart(e.clientY);
    });

    // Shared window drag handlers, installed once for all knobs (fix 7).
    if (!FLKnob._sharedDrag) {
      FLKnob._sharedDrag = true;
      window.addEventListener('mousemove', (e) => { const k = FLKnob._active; if (k && k.isDragging) k.onMove(e.clientY, e.shiftKey); });
      window.addEventListener('mouseup', () => { const k = FLKnob._active; if (k) k.onEnd(); });
      window.addEventListener('touchend', () => { const k = FLKnob._active; if (k) k.onEnd(); });
    }

    // Touch drag: touchmove on the element itself, non-passive so dragging
    // a knob does not also scroll the page (fix 8).
    this.el.addEventListener('touchstart', (e) => {
      if (e.target.closest('.info-btn')) return;
      if (e.touches.length === 1) this.onStart(e.touches[0].clientY);
    }, { passive: true });
    this.el.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) { e.preventDefault(); this.onMove(e.touches[0].clientY, false); }
    }, { passive: false });

    // Mouse wheel (fine tune with Shift)
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const mult = e.shiftKey ? 0.2 : 1.0;
      const delta = (e.deltaY < 0 ? this.step : -this.step) * mult;
      this.setValue(this.val + delta, true, e.shiftKey ? this.fineStep() : null);
    }, { passive: false });

    // Double-click reset to default
    this.el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.info-btn')) return;
      this.setValue(this.defaultVal, true);
    });

    // Keyboard: Arrow keys step exactly like the wheel, Shift for fine steps,
    // Home/End jump to the range bounds, PageUp/PageDown a 10x step.
    if (typeof this.el.setAttribute === 'function') {
      this.el.setAttribute('role', 'slider');
      this.el.tabIndex = 0;
      this.el.setAttribute('aria-label', `${this.knobId} control`);
      this.updateAria();
    }
    this.el.addEventListener('keydown', (e) => {
      const fine = e.shiftKey ? this.fineStep() : null;
      const stepSize = e.shiftKey ? this.step * 0.2 : this.step;
      let handled = true;
      switch (e.key) {
        case 'ArrowUp': case 'ArrowRight': this.setValue(this.val + stepSize, true, fine); break;
        case 'ArrowDown': case 'ArrowLeft': this.setValue(this.val - stepSize, true, fine); break;
        case 'PageUp': this.setValue(this.val + this.step * 10, true); break;
        case 'PageDown': this.setValue(this.val - this.step * 10, true); break;
        case 'Home': this.setValue(this.min, true); break;
        case 'End': this.setValue(this.max, true); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });
  }

  /** Publish the current value/range to assistive tech; called after every change. */
  updateAria() {
    if (!this.el.setAttribute) return;
    this.el.setAttribute('aria-valuemin', String(this.min));
    this.el.setAttribute('aria-valuemax', String(this.max));
    this.el.setAttribute('aria-valuenow', String(this.val));
    this.el.setAttribute('aria-valuetext', `${this.val}${this.unit ? ' ' + this.unit : ''}`);
  }

  onStart(clientY) {
    this.isDragging = true;
    FLKnob._active = this;
    this.startY = clientY;
    this.startVal = this.val;
    document.body.style.cursor = 'ns-resize';
  }

  onMove(clientY, isShift) {
    if (!this.isDragging) return;
    const dy = this.startY - clientY;
    const range = this.max - this.min;
    const baseSensitivity = range / 200; // 200px travel = full range
    const sensitivity = isShift ? baseSensitivity * 0.2 : baseSensitivity;
    const newVal = this.startVal + dy * sensitivity;
    this.setValue(newVal, true, isShift ? this.fineStep() : null);
  }

  onEnd() {
    if (this.isDragging) {
      this.isDragging = false;
      document.body.style.cursor = '';
    }
    if (FLKnob._active === this) FLKnob._active = null;
  }

  destroy() {
    if (FLKnob._active === this) FLKnob._active = null;
  }

  onChange(cb) {
    if (typeof cb === 'function') this.listeners.push(cb);
  }

  /** Fine grid = 1/5 of step, rounded to one extra decimal so 0.1*0.2 stays 0.02, not 0.020000000000000004. */
  fineStep() {
    const s = String(this.step);
    const dec = s.includes('.') ? s.split('.')[1].length : 0;
    return +(this.step * 0.2).toFixed(dec + 1);
  }

  /**
   * Set knob value, clamp, round to step, and update visuals.
   * @param {number} newVal
   * @param {boolean} triggerUpdate
   */
  setValue(newVal, triggerUpdate = true, stepOverride = null) {
    const clamped = Math.max(this.min, Math.min(this.max, newVal));
    const step = stepOverride || this.step;
    const stepsCount = Math.round((clamped - this.min) / step);
    // precision from step decimals, so 0.25 stays 0.25 (was rounded to 0.3)
    const stepStr = String(step);
    const precision = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
    this.val = +(this.min + stepsCount * step).toFixed(precision);

    this.updateVisuals();
    this.updateAria();

    if (triggerUpdate) {
      for (const cb of this.listeners) {
        cb(this.val, this.knobId);
      }
    }
  }

  /**
   * Update visual rotor angle, SVG arc stroke, readout text, and custom state.
   */
  updateVisuals() {
    const norm = Math.max(0, Math.min(1, (this.val - this.min) / (this.max - this.min)));
    const angle = -135 + norm * 270;

    if (this.rotor) {
      this.rotor.style.transform = `rotate(${angle}deg)`;
    }

    if (this.ring) {
      const arcLength = norm * 141.4; // 270° arc of r=30 circle: 2*pi*30*(270/360) = 141.4
      this.ring.style.strokeDasharray = `${arcLength} 300`;
    }

    if (this.readout) {
      let displayStr = '';
      if (this.unit === 'Hz') {
        displayStr = `${Math.round(this.val)} Hz`;
      } else if (this.unit === 'dB') {
        const sign = this.val > 0 ? '+' : '';
        const stepStr = String(this.step);
        const stepDec = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
        const dec = this.val % 1 === 0 ? 0 : stepDec;
        displayStr = `${sign}${this.val.toFixed(dec)} dB`;
      } else if (this.unit === '%') {
        displayStr = `${Number.isInteger(this.val) ? Math.round(this.val) : this.val.toFixed(1)}%`;
      } else {
        const stepStr = String(this.step);
        const stepDec = stepStr.includes('.') ? stepStr.split('.')[1].length : 0;
        const valDec = String(this.val).includes('.') ? String(this.val).split('.')[1].length : 0;
        const dec = Math.max(stepDec, valDec); // fine-tuned value may carry more decimals than step
        displayStr = `${this.val.toFixed(dec)}${this.unit ? ' ' + this.unit : ''}`;
      }
      this.readout.textContent = displayStr;
    }
  }
}

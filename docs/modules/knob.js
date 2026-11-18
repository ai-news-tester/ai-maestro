/**
 * FLKnob — Generic Rotary Controller for FL Studio Plugin Aesthetic
 * Encapsulates rotor rotation, SVG arc ring, drag physics, wheel, and double-click reset.
 * Completely agnostic of DSP or backend logic.
 */

export class FLKnob {
  /**
   * @param {HTMLElement} element - Knob DOM container
   * @param {Object} options - Optional configuration overrides
   */
  constructor(element, options = {}) {
    this.el = element;
    this.knobId = options.knobId || element.dataset.knob;
    this.min = options.min !== undefined ? options.min : parseFloat(element.dataset.min ?? 0);
    this.max = options.max !== undefined ? options.max : parseFloat(element.dataset.max ?? 100);
    this.step = options.step !== undefined ? options.step : parseFloat(element.dataset.step ?? 1);
    this.defaultVal = options.default !== undefined ? options.default : parseFloat(element.dataset.default ?? element.dataset.val ?? this.min);
    this.val = options.val !== undefined ? options.val : parseFloat(element.dataset.val ?? this.defaultVal);
    this.unit = options.unit !== undefined ? options.unit : (element.dataset.unit || '');

    this.rotor = element.querySelector('.knob-rotor');
    this.ring = element.querySelector('.ring-active');
    this.readout = options.readoutEl || document.getElementById(`readout_${this.knobId}`);

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
      // Don't drag if clicking an info button or badge
      if (e.target.closest('.info-btn') || e.target.closest('.badge-custom')) return;
      this.onStart(e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) this.onMove(e.clientY, e.shiftKey);
    });

    window.addEventListener('mouseup', () => this.onEnd());

    // Touch drag
    this.el.addEventListener('touchstart', (e) => {
      if (e.target.closest('.info-btn') || e.target.closest('.badge-custom')) return;
      if (e.touches.length === 1) this.onStart(e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (this.isDragging && e.touches.length === 1) this.onMove(e.touches[0].clientY, false);
    }, { passive: true });

    window.addEventListener('touchend', () => this.onEnd());

    // Mouse wheel (fine tune with Shift)
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const mult = e.shiftKey ? 0.2 : 1.0;
      const delta = (e.deltaY < 0 ? this.step : -this.step) * mult;
      this.setValue(this.val + delta, true, e.shiftKey ? this.fineStep() : null);
    }, { passive: false });

    // Double-click reset to default
    this.el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.info-btn') || e.target.closest('.badge-custom')) return;
      this.setValue(this.defaultVal, true);
    });
  }

  onStart(clientY) {
    this.isDragging = true;
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

    if (triggerUpdate) {
      for (const cb of this.listeners) {
        cb(this.val, this.knobId);
      }
      this.el.dispatchEvent(new CustomEvent('knob:change', {
        bubbles: true,
        detail: { knobId: this.knobId, val: this.val }
      }));
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
      {
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
}

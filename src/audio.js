// AI-assisted (Anthropic Claude).
// Sound engine. One rule everywhere: higher value -> higher note, brighter tone, more voices.
// Notes come from a two-octave pentatonic scale so any sequence of values sounds musical.

export const NOTE_NAMES = ['C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5'];
const FREQ = [130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
const clamp01 = v => Math.max(0, Math.min(1, v));
export const noteIndex = t => Math.round(clamp01(t) * (FREQ.length - 1));
export const noteName = t => NOTE_NAMES[noteIndex(t)];

export class Sound {
  constructor() { this.ctx = null; this.refOn = false; }

  async start() {
    if (!this.ctx) {
      // iOS: "playback" keeps sound on even when the ring/silent switch is set to silent.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.out = this.ctx.createDynamicsCompressor();
      this.out.threshold.value = -14; this.out.ratio.value = 4;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.8;
      this.master.connect(this.out).connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx.state === 'running';
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  setVolume(v) { if (this.master) this.master.gain.value = v; }

  // Play the note for a normalised value t (0 = coldest on the legend, 1 = hottest).
  note(t, { pan = 0, dur = 0.32, gain = 0.5, when = 0, layers = true } = {}) {
    if (!this.ctx) return;
    const at = Math.max(this.now, when || this.now);
    const i = noteIndex(t);
    this.#voice(FREQ[i], { at, dur, gain, pan, bright: t });
    if (layers && t >= 0.75) this.#voice(FREQ[Math.min(FREQ.length - 1, i + 2)] , { at: at + 0.02, dur, gain: gain * 0.35, pan: -pan * 0.5, bright: t });
    if (layers && t >= 0.9) this.#voice(FREQ[i] * 2, { at: at + 0.04, dur: dur * 0.8, gain: gain * 0.22, pan: pan * 0.5, bright: 1 });
  }

  // A soft, pitchless tick: "there is no data here".
  noData({ pan = 0, when = 0 } = {}) {
    if (!this.ctx) return;
    const at = Math.max(this.now, when || this.now), len = 0.06;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * len), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length / 6));
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = 0.25;
    src.connect(f).connect(g).connect(this.#panner(pan)); src.start(at);
  }

  // Short click used to mark decades during playback.
  tick({ when = 0, gain = 0.12 } = {}) {
    if (!this.ctx) return;
    const at = Math.max(this.now, when || this.now);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = 1760; g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g).connect(this.master); o.start(at); o.stop(at + 0.06);
  }

  // A quiet steady hum on the note that means "average" (0 on the legend), to compare against.
  reference(on, t = 0.5) {
    if (!this.ctx) return;
    if (on && !this.refNodes) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      o.type = 'sine'; o.frequency.value = FREQ[noteIndex(t)]; f.type = 'lowpass'; f.frequency.value = 900;
      g.gain.value = 0; g.gain.linearRampToValueAtTime(0.05, this.now + 0.4);
      o.connect(f).connect(g).connect(this.master); o.start();
      this.refNodes = { o, g };
    } else if (!on && this.refNodes) {
      const { o, g } = this.refNodes; this.refNodes = null;
      g.gain.cancelScheduledValues(this.now); g.gain.setValueAtTime(g.gain.value, this.now);
      g.gain.linearRampToValueAtTime(0, this.now + 0.3); o.stop(this.now + 0.35);
    }
  }

  #panner(pan) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (!p) return this.master;
    p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(this.master); return p;
  }

  #voice(freq, { at, dur, gain, pan, bright }) {
    const c = this.ctx;
    const o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o1.type = 'triangle'; o1.frequency.value = freq;
    o2.type = 'sine'; o2.frequency.value = freq / 2;
    const o2g = c.createGain(); o2g.gain.value = 0.35;
    f.type = 'lowpass'; f.frequency.value = 700 + 3800 * clamp01(bright); f.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.25);
    o1.connect(f); o2.connect(o2g).connect(f); f.connect(g).connect(this.#panner(pan));
    o1.start(at); o2.start(at); o1.stop(at + dur + 0.3); o2.stop(at + dur + 0.3);
  }
}

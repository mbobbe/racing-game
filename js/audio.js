// Synthesized WebAudio audio — no files.
// Engine (saw+square detuned pair through lowpass), wind (filtered noise),
// drift (bandpass noise), boost whoosh (sweeping noise), wall thud, and beeps.

import { clamp } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.started = false;
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.windGain = null;
    this.windFilter = null;
    this.driftGain = null;
    this.driftFilter = null;
    this.boostGain = null;
    this.noiseBuffer = null;
  }

  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // noise buffer (2s white noise)
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // engine
    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 55;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = 27;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 1.2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc1.start();
    this.engineOsc2.start();

    // wind
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();

    // drift
    const driftSrc = ctx.createBufferSource();
    driftSrc.buffer = this.noiseBuffer;
    driftSrc.loop = true;
    driftSrc.playbackRate.value = 0.85;
    this.driftFilter = ctx.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 1050;
    this.driftFilter.Q.value = 1.1;
    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0;
    driftSrc.connect(this.driftFilter);
    this.driftFilter.connect(this.driftGain);
    this.driftGain.connect(this.master);
    driftSrc.start();

    this.started = true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.85;
  }

  update(speedRatio, throttle, driftAmount, boosting, offRoad) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // engine pitch follows speed; slight randomness keeps it alive
    const rpm = 44 + speedRatio * 105;
    this.engineOsc1.frequency.setTargetAtTime(rpm, t, 0.03);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 0.5, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(380 + speedRatio * 2000 + (boosting ? 1400 : 0), t, 0.06);
    const targetGain = 0.10 + speedRatio * 0.10 + (throttle > 0 ? 0.06 : 0) + (boosting ? 0.05 : 0);
    this.engineGain.gain.setTargetAtTime(clamp(targetGain, 0, 0.30), t, 0.06);

    // wind
    this.windFilter.frequency.setTargetAtTime(520 + speedRatio * 1100, t, 0.08);
    this.windGain.gain.setTargetAtTime(speedRatio * speedRatio * 0.20, t, 0.08);

    // drift hiss
    this.driftFilter.frequency.setTargetAtTime(820 + speedRatio * 700, t, 0.05);
    this.driftGain.gain.setTargetAtTime(clamp(driftAmount, 0, 1) * 0.30, t, 0.05);
  }

  playBoost() {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(3400, t + 0.45);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.85);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.32, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + 0.9);
  }

  playThud(strength) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    const gain = ctx.createGain();
    const amp = 0.10 + strength * 0.30;
    gain.gain.setValueAtTime(amp, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + 0.2);

    // low thunk
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(82, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.22 * strength, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playBeep(freq = 440, duration = 0.14, type = 'square', amp = 0.18) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(amp, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  playCountdownTick(final) {
    this.playBeep(final ? 880 : 440, final ? 0.34 : 0.13, 'square', 0.22);
  }

  resumeIfSuspended() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }
}

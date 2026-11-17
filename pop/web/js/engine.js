// Pop Pads engine: plays the pads through a small effects chain, runs the
// 16-step sequencer (patterns, chains, swing, live recording), and does the
// performance tricks: hold a pad to repeat, stutter and jumble. The same
// graph renders offline for export, so a saved loop sounds like the app.

import { renderKit } from './kits.js';

export const STEPS = 16;
export const PATTERNS = 8;
export const LFO_RATES = [['1/4', 1], ['1/2', 2], ['1 bar', 4], ['2 bars', 8], ['4 bars', 16]];   // beats per cycle
export const LFO_TARGETS = ['filter', 'volume', 'pitch'];
// a little stereo spread, by pad slot: hats and cymbals right, percussion around
const PANS = [0, 0, 0.04, -0.04, 0.22, 0.22, -0.12, -0.25, 0.3, 0, -0.3, 0.28, -0.2, 0.32, -0.15, 0.15];
const CHH = 4, OHH = 5;   // the closed hat cuts off the open one, as on real machines

export function newSong() {
  return {
    v: 1, kit: 'cola', bpm: 92, swing: 0,
    fx: { filter: 0, drive: 0.15, crush: 0, lfo: 0, lfoRate: 2, lfoTo: 'filter' },
    tweaks: {},
    patterns: Array.from({ length: PATTERNS }, () => new Array(16).fill(0)),
    chain: [0], cur: 0,
  };
}
export const tweakOf = (song, i) => {
  const t = (song.tweaks[song.kit] || [])[i];
  return { pitch: 0, len: 1, tone: 1, vol: 0.85, ...(t || {}) };
};
const stepDur = (bpm) => 60 / bpm / 4;
const swingAt = (song, s) => (s % 2 ? song.swing * stepDur(song.bpm) * 0.66 : 0);

// ---------- the sound path (works the same live and offline) ----------

const CRUSH = `registerProcessor('pop-crush', class extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1 }]; }
  constructor() { super(); this.n = 0; this.h = [0, 0]; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], a = p.amount[0];
    if (!inp || !inp.length) return true;
    const hold = 1 + Math.floor(a * a * 14), steps = Math.pow(2, 15 - a * 11);
    for (let i = 0; i < out[0].length; i++) {
      const take = this.n++ % hold === 0;
      for (let c = 0; c < out.length; c++) {
        const x = (inp[c] || inp[0])[i];
        if (a <= 0.001) { out[c][i] = x; continue; }
        if (take) this.h[c] = Math.round(x * steps) / steps;
        out[c][i] = this.h[c];
      }
    }
    return true;
  }
});`;
const crushUrl = URL.createObjectURL(new Blob([CRUSH], { type: 'text/javascript' }));

export class Graph {
  static async create(ctx, dest = ctx.destination) {
    const g = new Graph(ctx, dest);
    try { await ctx.audioWorklet.addModule(crushUrl); g.crush = new AudioWorkletNode(ctx, 'pop-crush', { outputChannelCount: [2] }); } catch (e) { g.crush = null; }
    g.wire();
    return g;
  }
  constructor(ctx, dest) {
    this.ctx = ctx; this.dest = dest;
    const G = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.input = G();
    // drive: a fixed soft curve, pushed by a gain in front, evened out after
    this.pre = G(0.5); this.makeup = G(1);
    this.shape = ctx.createWaveShaper(); this.shape.oversample = '2x';
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(2.5 * x) / Math.tanh(2.5); }
    this.shape.curve = c;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.Q.value = 0.9;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 1.1;
    this.trem = G(1); this.master = G(0.8);
    this.limit = ctx.createDynamicsCompressor();
    this.limit.threshold.value = -6; this.limit.ratio.value = 12; this.limit.attack.value = 0.002; this.limit.release.value = 0.15;
    // the LFO: one sine wave, routed to the filter or the volume
    this.lfoOsc = null; this.lfoToFilter = G(0); this.lfoToVol = G(0);
    this.lfoToFilter.connect(this.lp.detune); this.lfoToVol.connect(this.trem.gain);
    this.openHat = null;
    this.fx = null; this.bpm = 120; this.lfoStart = 0;
  }
  wire() {
    let n = this.input.connect(this.pre).connect(this.shape).connect(this.makeup);
    if (this.crush) n = n.connect(this.crush);
    n.connect(this.hp).connect(this.lp).connect(this.trem).connect(this.master).connect(this.limit).connect(this.dest);
  }
  // the LFO starts its cycle at `at` (the top of the pattern when playing)
  restartLfo(at = this.ctx.currentTime) {
    if (this.lfoOsc) try { this.lfoOsc.stop(at); } catch (e) { /* stopped */ }
    this.lfoOsc = this.ctx.createOscillator();
    this.lfoOsc.frequency.value = this.bpm / 60 / LFO_RATES[this.fx ? this.fx.lfoRate : 2][1];
    this.lfoOsc.connect(this.lfoToFilter); this.lfoOsc.connect(this.lfoToVol);
    this.lfoOsc.start(at); this.lfoStart = at;
  }
  setFx(fx, bpm, at = this.ctx.currentTime) {
    const T = (p, v, tc = 0.03) => p.setTargetAtTime(v, at, tc);
    this.fx = fx; this.bpm = bpm;
    if (!this.lfoOsc) this.restartLfo(at);
    this.lfoOsc.frequency.setTargetAtTime(bpm / 60 / LFO_RATES[fx.lfoRate][1], at, 0.02);
    const push = 0.5 + 2.5 * fx.drive;
    T(this.pre.gain, push); T(this.makeup.gain, Math.tanh(2.5) / (2.5 * push) * (1 + fx.drive * 0.6));
    if (this.crush) T(this.crush.parameters.get('amount'), fx.crush);
    // one knob, two filters: left of centre closes the low-pass, right opens a high-pass
    const f = fx.filter;
    let lp = f < 0 ? 20000 * Math.pow(180 / 20000, -f) : 20000;
    const hp = f > 0 ? 20 * Math.pow(3000 / 20, f) : 20;
    const lfo = fx.lfo;
    if (fx.lfoTo === 'filter' && lfo > 0) lp = Math.min(lp, 3500);          // something for the LFO to sweep
    T(this.lp.frequency, lp); T(this.hp.frequency, hp);
    T(this.lfoToFilter.gain, fx.lfoTo === 'filter' ? lfo * 2400 : 0);
    T(this.lfoToVol.gain, fx.lfoTo === 'volume' ? lfo * 0.5 : 0);
    T(this.trem.gain, fx.lfoTo === 'volume' ? 1 - lfo * 0.5 : 1);
  }
  lfoPitch(t) {
    if (!this.fx || this.fx.lfoTo !== 'pitch' || !this.fx.lfo) return 0;
    const f = this.bpm / 60 / LFO_RATES[this.fx.lfoRate][1];
    return this.fx.lfo * 2 * Math.sin(2 * Math.PI * f * (t - this.lfoStart));
  }
  // one hit of pad `i` from buffer `buf` at time t
  play(i, buf, t, tw, vel = 1) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (tw.pitch + this.lfoPitch(t)) / 12);
    const dur = buf.duration / src.playbackRate.value, end = dur * Math.max(0.04, tw.len), v = tw.vol * vel;
    g.gain.setValueAtTime(v, t);
    if (tw.len < 1) { g.gain.setValueAtTime(v, t + end * 0.6); g.gain.linearRampToValueAtTime(0, t + end); }
    let node = src;
    if (tw.tone < 1) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300 * Math.pow(60, tw.tone); node = node.connect(lp); }
    const pan = ctx.createStereoPanner(); pan.pan.value = PANS[i];
    node.connect(g).connect(pan).connect(this.input);
    src.start(t); src.stop(t + end + 0.02);
    if (i === CHH && this.openHat && this.openHat.until > t) {
      const o = this.openHat.g.gain; o.cancelScheduledValues(t); o.setValueAtTime(o.value, t); o.setTargetAtTime(0, t, 0.008);
    }
    if (i === OHH) this.openHat = { g, until: t + end };
  }
}

// ---------- the live machine ----------

export class PopEngine {
  static async create() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const e = new PopEngine(ctx);
    e.graph = await Graph.create(ctx);
    return e;
  }
  constructor(ctx) {
    this.ctx = ctx; this.song = newSong(); this.bufs = null;
    this.playing = false; this.rec = false;
    this.held = new Set();                 // pads held down for repeats
    this.perf = { mode: null, size: 4, amount: 0, start: 0 };   // stutter / jumble while a pad is held
    this.onStep = null;                    // (step, pattern) for the playhead
    this.onHit = null;                     // (pad) for the faces
    this.clock = null; this.skip = new Set(); this.bars = new Map();
  }
  async setKit(id) {
    this.song.kit = id;
    this.bufs = await renderKit(id, this.ctx.sampleRate);
  }
  setSong(song) { this.song = song; this.updateFx(); }
  updateFx() { this.graph.setFx(this.song.fx, this.song.bpm); }

  // ----- the clock: runs while playing, or while a pad is held for repeats -----
  ensureClock(fresh) {
    const now = this.ctx.currentTime;
    if (fresh || !this.clock) {
      this.t0 = now + 0.06; this.n = 0; this.bars.clear(); this.skip.clear();
      if (this.playing) this.graph.restartLfo(this.t0);
    }
    if (!this.clock) this.clock = setInterval(() => this.pump(), 20);
    this.pump();
  }
  timeOf(n) { return this.t0 + n * stepDur(this.song.bpm) + swingAt(this.song, n % STEPS); }
  pump() {
    if (!this.playing && !this.held.size) { clearInterval(this.clock); this.clock = null; return; }
    const until = this.ctx.currentTime + 0.12;
    while (this.timeOf(this.n) < until) { this.step(this.n, this.timeOf(this.n)); this.n++; }
  }
  // which pattern plays in bar b: the chain in order, or the current pattern
  patternForBar(b) {
    if (!this.bars.has(b)) {
      const c = this.song.chain;
      this.bars.set(b, c.length > 1 ? c[b % c.length] : this.song.cur);
      if (this.bars.size > 8) this.bars.delete(Math.min(...this.bars.keys()));
    }
    return this.bars.get(b);
  }
  step(n, t) {
    const s = n % STEPS, bar = Math.floor(n / STEPS);
    if (this.playing) {
      const pi = this.patternForBar(bar), pat = this.song.patterns[pi];
      // the step to read: itself, a looped window (stutter) or a random one (jumble)
      let src = s;
      if (this.perf.mode === 'stutter') { const w = this.perf.size, a = this.perf.start; src = a + (((s - a) % w) + w) % w; }
      else if (this.perf.mode === 'jumble' && Math.random() < this.perf.amount) src = Math.floor(Math.random() * STEPS);
      for (let i = 0; i < 16; i++) {
        if (!((pat[i] >> src) & 1)) continue;
        if (this.skip.delete(`${i}:${n}`)) continue;
        this.hit(i, t, true);
      }
      if (this.onStep) { const d = Math.max(0, (t - this.ctx.currentTime) * 1000); setTimeout(() => this.onStep(s, pi, src !== s ? this.perf.mode : null), d); }
    }
    // held pads repeat on every step (and are written in while recording)
    for (const i of this.held) {
      if (this.perf.mode && this.playing) continue;     // the pad's own repeat gives way to stutter/jumble
      this.hit(i, t, true);
      if (this.rec && this.playing) this.write(i, n);
    }
  }
  hit(i, t = this.ctx.currentTime, quiet = false) {
    if (!this.bufs) return;
    this.graph.play(i, this.bufs[i], t, tweakOf(this.song, i));
    if (this.onHit) { const d = Math.max(0, (t - this.ctx.currentTime) * 1000); setTimeout(() => this.onHit(i, quiet), d); }
  }
  write(i, n) {
    const pi = this.patternForBar(Math.floor(n / STEPS));
    this.song.patterns[pi][i] |= 1 << (n % STEPS);
    if (this.onWrite) this.onWrite(pi);
  }

  // ----- what the player does -----
  tap(i) {
    if (this.ctx.state !== 'running') this.ctx.resume();
    const now = this.ctx.currentTime;
    this.hit(i, now);
    if (this.rec && this.playing) {
      // snap to the nearest step; if that step is still to come, don't play it twice
      const sd = stepDur(this.song.bpm), lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
      const k = Math.max(0, Math.round((now + lat * 0.5 - this.t0) / sd));
      this.write(i, k);
      if (k >= this.n) this.skip.add(`${i}:${k}`);
    }
  }
  hold(i) { this.held.add(i); this.ensureClock(false); }
  release(i) { this.held.delete(i); if (!this.held.size) this.setPerf(null); }
  // slide up: stutter (bigger slide, smaller loop); slide down: jumble (bigger slide, more mixed up)
  setPerf(mode, amount = 0) {
    const s = this.playing ? (this.n % STEPS) : 0;
    if (mode === 'stutter') {
      const size = amount > 0.66 ? 1 : amount > 0.33 ? 2 : 4;
      if (this.perf.mode !== 'stutter' || this.perf.size !== size) this.perf = { mode, size, amount, start: Math.floor(s / size) * size };
    } else if (mode === 'jumble') this.perf = { mode, size: 0, amount: 0.3 + 0.7 * amount, start: 0 };
    else this.perf = { mode: null, size: 4, amount: 0, start: 0 };
  }
  play() {
    if (this.ctx.state !== 'running') this.ctx.resume();
    this.playing = true; this.ensureClock(true);
  }
  stop() { this.playing = false; this.rec = false; this.perf.mode = null; }
}

// ---------- offline: the chain (or a pattern) as audio ----------

// song: the song; opts: { loops, solo (a pad index, or null), sr }
export async function renderSong(song, { loops = 1, solo = null, sr = 44100, tail = 2 } = {}) {
  const bars = song.chain.length > 1 ? song.chain : [song.cur];
  const sd = stepDur(song.bpm), total = bars.length * loops * STEPS * sd;
  const ctx = new OfflineAudioContext(2, Math.ceil((total + tail) * sr), sr);
  const graph = await Graph.create(ctx), bufs = await renderKit(song.kit, sr);
  graph.setFx(song.fx, song.bpm, 0);
  graph.restartLfo(0);
  for (let b = 0; b < bars.length * loops; b++) {
    const pat = song.patterns[bars[b % bars.length]];
    for (let s = 0; s < STEPS; s++) {
      const t = (b * STEPS + s) * sd + swingAt(song, s);
      for (let i = 0; i < 16; i++) if ((pat[i] >> s) & 1 && (solo == null || solo === i)) graph.play(i, bufs[i], t, tweakOf(song, i));
    }
  }
  return { buffer: await ctx.startRendering(), seconds: total };
}

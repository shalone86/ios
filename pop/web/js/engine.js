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
const CHH = 4, OHH = 5;
// how much of each pad reaches the reverb: snares, claps and toms most,
// kicks and the sub hardly at all, so it sounds like a room, not a wash
const SENDS = [0.06, 0.03, 0.9, 1, 0.35, 0.45, 0.7, 0.6, 0.75, 0.75, 0.75, 0.6, 0.4, 0.4, 0.7, 0.7];
// a small, bright drum room: 1.1 s of decaying noise, darker as it fades
function room(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 1.1), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let s = 7 + c * 977, lp = 0, e = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const x = i / sr, w = s / 1073741823.5 - 1;
      lp += (0.35 + 0.6 * Math.exp(-x * 5)) * (w - lp);
      d[i] = lp * Math.exp(-x * 6.2) * Math.min(1, x / 0.004);
      e += d[i] * d[i];
    }
    const k = 1 / Math.sqrt(e); for (let i = 0; i < n; i++) d[i] *= k;
  }
  return b;
}   // the closed hat cuts off the open one, as on real machines

export function newSong() {
  return {
    v: 1, kit: 'cola', bpm: 92, swing: 0, metro: false,
    fx: { filter: 0, drive: 0.15, crush: 0, verb: 0, lfo: 0, lfoRate: 2, lfoTo: 'filter' },
    tweaks: {},
    patterns: Array.from({ length: PATTERNS }, () => new Array(16).fill(0)),
    motion: Array.from({ length: PATTERNS }, () => ({ mix: {}, pads: {} })),
    chain: [0], cur: 0,
  };
}
// a drum's own settings: pitch (semitones), length, filter (-1 dark … 1 thin),
// volume, crush, and its own LFO (amount, and what it moves)
export const PAD_KEYS = ['pitch', 'len', 'filt', 'vol', 'crush', 'lfo', 'nudge', 'rep'];
export const MIX_KEYS = ['filter', 'drive', 'crush', 'verb', 'lfo'];
export const tweakOf = (song, i) => {
  const t = { ...((song.tweaks[song.kit] || [])[i] || {}) };
  if (t.tone != null && t.filt == null) t.filt = t.tone < 1 ? t.tone - 1 : 0;      // the old one-way Tone knob
  return { pitch: 0, len: 1, filt: 0, vol: 0.85, crush: 0, lfo: 0, lfoTo: 'pitch', nudge: 0, rep: 1, ...t };
};
// Motion: per pattern, a lane of 16 values per knob (null = the knob's own
// setting). Recorded by moving a knob while recording, or set step by step.
export function motionOf(song, pi) {
  song.motion = song.motion || [];
  return (song.motion[pi] = song.motion[pi] || { mix: {}, pads: {} });
}
export function laneOf(song, pi, scope, key, make = false) {
  const m = motionOf(song, pi), home = scope === 'mix' ? m.mix : (m.pads[scope] = m.pads[scope] || {});
  if (!home[key] && make) home[key] = new Array(16).fill(null);
  return home[key] || null;
}
// the settings a hit of pad i on step s of pattern pi plays with
export function padAt(song, pi, i, s) {
  const tw = tweakOf(song, i), lanes = ((song.motion || [])[pi] || { pads: {} }).pads[i];
  if (lanes) for (const k of PAD_KEYS) if (lanes[k] && lanes[k][s] != null) tw[k] = lanes[k][s];
  return tw;
}
// the mix knobs on step s of pattern pi
export function mixAt(song, pi, s) {
  const fx = { ...song.fx }, lanes = ((song.motion || [])[pi] || { mix: {} }).mix;
  for (const k of MIX_KEYS) if (lanes[k] && lanes[k][s] != null) fx[k] = lanes[k][s];
  return fx;
}
export const hasMotion = (song, pi) => { const m = (song.motion || [])[pi]; return !!m && (Object.values(m.mix).some((l) => l && l.some((v) => v != null)) || Object.values(m.pads).some((p) => Object.values(p).some((l) => l && l.some((v) => v != null)))); };
const stepDur = (bpm) => 60 / bpm / 4;
const swingAt = (song, s) => (s % 2 ? song.swing * stepDur(song.bpm) * 0.66 : 0);
const mod16 = (n) => ((n % STEPS) + STEPS) % STEPS;

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
    // the reverb: a send per pad into one room, returned before the filter (so sweeps move it too)
    this.verbIn = G(1); this.verbAmt = G(0);
    this.verb = ctx.createConvolver(); this.verb.normalize = false; this.verb.buffer = room(ctx);
    const vhp = ctx.createBiquadFilter(); vhp.type = 'highpass'; vhp.frequency.value = 250;
    this.verbIn.connect(vhp).connect(this.verbAmt).connect(this.verb);
    this.lfoOsc = null; this.lfoToFilter = G(0); this.lfoToVol = G(0);
    this.lfoToFilter.connect(this.lp.detune); this.lfoToVol.connect(this.trem.gain);
    this.openHat = null;
    this.fx = null; this.bpm = 120; this.lfoStart = 0;
  }
  wire() {
    let n = this.input.connect(this.pre).connect(this.shape).connect(this.makeup);
    if (this.crush) n = n.connect(this.crush);
    n.connect(this.hp).connect(this.lp).connect(this.trem).connect(this.master).connect(this.limit).connect(this.dest);
    this.verb.connect(this.hp);
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
    T(this.verbAmt.gain, (fx.verb || 0) * 0.9);
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
  // the metronome: a short blip, higher on the first beat of the bar, straight to the speakers
  click(t, accent) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.002); g.gain.setTargetAtTime(0, t + 0.004, 0.012);
    o.connect(g).connect(this.dest); o.start(t); o.stop(t + 0.1);
  }
  // the LFO's position (-1..1) at time t
  lfoAt(t) {
    const f = this.bpm / 60 / LFO_RATES[this.fx ? this.fx.lfoRate : 2][1];
    return Math.sin(2 * Math.PI * f * (t - this.lfoStart));
  }
  lfoPitch(t) {
    if (!this.fx || this.fx.lfoTo !== 'pitch' || !this.fx.lfo) return 0;
    return this.fx.lfo * 2 * this.lfoAt(t);
  }
  // a bit-crush curve for one drum, kept per amount
  crushCurve(a) {
    const k = Math.round(a * 20);
    this.curves = this.curves || {};
    if (!this.curves[k]) {
      const steps = Math.pow(2, 12 - (k / 20) * 9), c = new Float32Array(4096);
      for (let i = 0; i < c.length; i++) { const x = i / (c.length - 1) * 2 - 1; c[i] = Math.round(x * steps) / steps; }
      this.curves[k] = c;
    }
    return this.curves[k];
  }
  // one hit of pad `i` from buffer `buf` at time t
  play(i, buf, t, tw, vel = 1, out = this.input) {
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    // the drum's own LFO moves its pitch, filter or volume, in time with the mix LFO
    const wob = tw.lfo ? tw.lfo * this.lfoAt(t) : 0;
    src.playbackRate.value = Math.pow(2, (tw.pitch + this.lfoPitch(t) + (tw.lfoTo === 'pitch' ? wob * 2 : 0)) / 12);
    const dur = buf.duration / src.playbackRate.value, end = dur * Math.max(0.04, tw.len);
    const v = tw.vol * vel * (tw.lfoTo === 'volume' ? 1 - Math.abs(tw.lfo) * 0.5 * (1 - wob / (tw.lfo || 1)) : 1);
    g.gain.setValueAtTime(v, t);
    if (tw.len < 1) { g.gain.setValueAtTime(v, t + end * 0.6); g.gain.linearRampToValueAtTime(0, t + end); }
    let node = src;
    if (tw.crush > 0.02) { const w = ctx.createWaveShaper(); w.curve = this.crushCurve(tw.crush); node = node.connect(w); }
    // its own filter: left of centre darker (low-pass), right thinner (high-pass)
    const f = Math.max(-1, Math.min(1, (tw.filt || 0) + (tw.lfoTo === 'filter' ? wob * 0.6 : 0)));
    if (f < -0.02) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1; lp.frequency.value = 20000 * Math.pow(180 / 20000, -f); node = node.connect(lp); }
    else if (f > 0.02) { const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.9; hp.frequency.value = 20 * Math.pow(3000 / 20, f); node = node.connect(hp); }
    const pan = ctx.createStereoPanner(); pan.pan.value = PANS[i];
    node.connect(g).connect(pan).connect(out);
    if (out === this.input && SENDS[i]) { const sg = ctx.createGain(); sg.gain.value = SENDS[i]; pan.connect(sg).connect(this.verbIn); }
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
    // pads held down: each repeats in time, and its own slide makes it
    // stutter (faster rolls) or jumble (skips, jumps, off-beat hits)
    this.held = new Map();                 // pad -> { mode: null | 'stutter' | 'jumble', amount }
    this.onStep = null;                    // (step, pattern) for the playhead
    this.onHit = null;                     // (pad) for the faces
    this.clock = null; this.skip = new Set(); this.bars = new Map();
    this.touching = new Map();             // knobs being held while recording: key -> { scope, key, value }
    this.lastFx = '';
  }
  async setKit(id) {
    this.song.kit = id;
    this.bufs = await renderKit(id, this.ctx.sampleRate);
  }
  setSong(song) { this.song = song; this.updateFx(); }
  updateFx() { this.lastFx = ''; this.graph.setFx(this.song.fx, this.song.bpm); }
  // a knob held while recording: heard at once, written onto each step it passes
  touch(scope, key, value) {
    this.touching.set(`${scope}:${key}`, { scope, key, value });
    if (scope === 'mix') { this.lastFx = ''; this.graph.setFx({ ...this.song.fx, [key]: value }, this.song.bpm); }
  }
  untouch() { this.touching.clear(); this.lastFx = ''; }

  // ----- the clock: runs while playing, or while a pad is held for repeats -----
  // countIn: a bar of clicks before the pattern starts (steps -16 to -1)
  ensureClock(fresh, countIn = false) {
    const now = this.ctx.currentTime;
    if (fresh || !this.clock) {
      const lead = countIn ? STEPS : 0;
      this.t0 = now + 0.08 + lead * stepDur(this.song.bpm); this.n = -lead; this.bars.clear(); this.skip.clear();
      if (this.playing) this.graph.restartLfo(this.t0);
    }
    if (!this.clock) this.clock = setInterval(() => this.pump(), 20);
    this.pump();
  }
  timeOf(n) { return this.t0 + n * stepDur(this.song.bpm) + swingAt(this.song, mod16(n)); }
  pump() {
    if (!this.playing && !this.held.size) { clearInterval(this.clock); this.clock = null; return; }
    const until = this.ctx.currentTime + 0.12;
    // half a step early, so a hit nudged early is still on time
    const early = stepDur(this.song.bpm) * 0.5;
    while (this.timeOf(this.n) - early < until) { this.step(this.n, this.timeOf(this.n)); this.n++; }
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
    const s = mod16(n), bar = Math.floor(n / STEPS);
    const later = (fn) => setTimeout(fn, Math.max(0, (t - this.ctx.currentTime) * 1000));
    if (n < 0) {
      // the count-in: clicks only, and the beat number for the screen
      if (s % 4 === 0) { this.graph.click(t, s === 0); if (this.onCount) { const beat = s / 4 + 1; later(() => this.onCount(beat)); } }
      return;
    }
    if (n === 0 && this.onCount) later(() => this.onCount(0));
    if (this.playing && this.song.metro && s % 4 === 0) this.graph.click(t, s === 0);
    if (this.playing) {
      const pi = this.patternForBar(bar), pat = this.song.patterns[pi];
      if (!pat) return;
      // the step to read: itself, a looped window (stutter) or a random one (jumble)
      let src = s;
      // recording: knobs being held are written onto this step
      if (this.rec) for (const m of this.touching.values()) laneOf(this.song, pi, m.scope, m.key, true)[s] = m.value;
      // the mix knobs for this step (their motion, or their own setting)
      const fx = mixAt(this.song, pi, src);
      for (const m of this.touching.values()) if (m.scope === 'mix') fx[m.key] = m.value;
      const key = JSON.stringify(fx);
      if (key !== this.lastFx) { this.lastFx = key; this.graph.setFx(fx, this.song.bpm, t); }
      const sd = stepDur(this.song.bpm);
      for (let i = 0; i < 16; i++) {
        if (!((pat[i] >> src) & 1)) continue;
        if (this.skip.delete(`${i}:${n}`)) continue;
        const tw = padAt(this.song, pi, i, src);
        for (const m of this.touching.values()) if (m.scope === i) tw[m.key] = m.value;
        // a repeat (ratchet): 2, 3 or 4 hits spread over the step, each a little softer
        const k = Math.max(1, Math.min(4, Math.round(tw.rep || 1))), at = Math.max(this.ctx.currentTime, t + (tw.nudge || 0) * sd);
        for (let j = 0; j < k; j++) this.hit(i, at + (j * sd) / k, true, j ? { ...tw, vol: tw.vol * Math.pow(0.85, j) } : tw);
      }
      if (this.onStep) { const d = Math.max(0, (t - this.ctx.currentTime) * 1000); setTimeout(() => this.onStep(s, pi), d); }
    }
    // held pads repeat on every step (and are written in while recording)
    const sd = stepDur(this.song.bpm);
    for (const [i, h] of this.held) {
      const tw = tweakOf(this.song, i);
      if (this.rec && this.playing && n >= 0) this.write(i, n);
      if (h.mode === 'stutter') {
        // a roll: 2, 3 or 4 hits in the 16th, further up = faster
        const k = h.amount > 0.66 ? 4 : h.amount > 0.33 ? 3 : 2;
        for (let j = 0; j < k; j++) this.hit(i, t + (j * sd) / k, true, { ...tw, vol: tw.vol * (j ? 0.82 : 1) });
      } else if (h.mode === 'jumble') {
        // mischief on this drum only: sometimes it skips, jumps in pitch, or lands off the beat
        const a = h.amount, r = Math.random();
        if (r < 0.15 + 0.2 * a) continue;
        const jumps = [0, 0, 12, -12, 7, -5, 5, 3];
        const pitch = tw.pitch + (Math.random() < 0.3 + 0.5 * a ? jumps[Math.floor(Math.random() * jumps.length)] : 0);
        const off = Math.random() < 0.35 * a ? sd * 0.5 : 0;
        this.hit(i, t + off, true, { ...tw, pitch });
        if (Math.random() < 0.25 * a) this.hit(i, t + off + sd * 0.25, true, { ...tw, pitch, vol: tw.vol * 0.7 });
      } else this.hit(i, t, true, tw);
    }
  }
  hit(i, t = this.ctx.currentTime, quiet = false, tw = tweakOf(this.song, i)) {
    if (!this.bufs) return;
    this.graph.play(i, this.bufs[i], t, tw);
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
      const k = Math.round((now + lat * 0.5 - this.t0) / sd);
      if (k < 0) return;                    // still counting in
      this.write(i, k);
      if (k >= this.n) this.skip.add(`${i}:${k}`);
    }
  }
  hold(i) { this.held.set(i, { mode: null, amount: 0 }); this.ensureClock(false); }
  release(i) { this.held.delete(i); }
  // a held pad's slide: up = stutter (further = faster), down = jumble (further = wilder)
  setPerf(i, mode, amount = 0) { const h = this.held.get(i); if (h) { h.mode = mode; h.amount = amount; } }
  play(countIn = false) {
    if (this.ctx.state !== 'running') this.ctx.resume();
    this.playing = true; this.ensureClock(true, countIn);
  }
  stop() { this.playing = false; this.rec = false; }
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
  let last = '';
  for (let b = 0; b < bars.length * loops; b++) {
    const pi = bars[b % bars.length], pat = song.patterns[pi];
    for (let s = 0; s < STEPS; s++) {
      const t = (b * STEPS + s) * sd + swingAt(song, s);
      const fx = mixAt(song, pi, s), key = JSON.stringify(fx);
      if (key !== last) { last = key; graph.setFx(fx, song.bpm, t); }
      for (let i = 0; i < 16; i++) {
        if (!((pat[i] >> s) & 1) || (solo != null && solo !== i)) continue;
        const tw = padAt(song, pi, i, s), k = Math.max(1, Math.min(4, Math.round(tw.rep || 1))), at = Math.max(0, t + (tw.nudge || 0) * sd);
        for (let j = 0; j < k; j++) graph.play(i, bufs[i], at + (j * sd) / k, j ? { ...tw, vol: tw.vol * Math.pow(0.85, j) } : tw);
      }
    }
  }
  return { buffer: await ctx.startRendering(), seconds: total };
}

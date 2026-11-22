// Cozy Chords engine: plays chords, strings and the backing beat live, and
// records a take (what was played, and when) that renders offline to the
// same sound, for listening back and exporting.

import { playChord, playString, playBass, DRUMS, makeMix } from './sound.js';
import { chordNotes, bassNote, stringNotes, chordsOf, SHAPES } from './theory.js';

// How a mug plays its chord while it is held. 'chord' is the chord itself;
// the rest play it for you, in time: arpeggios, a strumming pattern, a fast
// tremolo roll, or short block stabs.
export const STYLES = [
  { id: 'chord', name: 'Chord', short: '', hint: 'the chord itself, as the sound plays it' },
  { id: 'up', name: 'Arpeggio up', short: '↑', hint: 'the notes one at a time, rising' },
  { id: 'down', name: 'Arpeggio down', short: '↓', hint: 'the notes one at a time, falling' },
  { id: 'updown', name: 'Arpeggio up & down', short: '↕', hint: 'rising, then falling, and round again' },
  { id: 'random', name: 'Arpeggio random', short: '✶', hint: 'the notes of the chord in a wandering order' },
  { id: 'strum', name: 'Guitar strum', short: '≋', hint: 'down, down-up, up-down-up, like strumming a guitar' },
  { id: 'tremolo', name: 'Tremolo', short: '∿', hint: 'a fast shimmering roll, like a mandolin' },
  { id: 'stab', name: 'Stabs', short: '▮', hint: 'short block chords on every beat' },
];
// the notes an arpeggio walks: the chord over two octaves
const arpNotes = (ch) => { const n = chordNotes(ch); return [...n, ...n.map((m) => m + 12), n[0] + 24]; };
// a strumming pattern over a bar of 16ths: D = down (low to high), U = up (high to low, lighter)
const STRUM = { 0: 'D', 4: 'D', 6: 'U', 10: 'U', 12: 'D', 14: 'U' };
// one step k of an auto-style (pos: where it falls in the bar), as notes to play: [delay, midi, vel, len]
function autoStep(style, ch, k, pos, prev) {
  const A = arpNotes(ch), n = A.length;
  switch (style) {
    case 'up': return [[0, A[k % n], 0.8]];
    case 'down': return [[0, A[n - 1 - (k % n)], 0.8]];
    case 'updown': { const c = 2 * n - 2, i = k % c; return [[0, A[i < n ? i : c - i], 0.8]]; }
    case 'random': { let i; do { i = Math.floor(Math.random() * n); } while (n > 1 && A[i] === prev); return [[0, A[i], 0.8]]; }
    case 'tremolo': { const c = chordNotes(ch); return [[0, c[k % c.length] + 12, k % c.length ? 0.55 : 0.7]]; }
    case 'stab': return pos % 4 === 0 ? chordNotes(ch).map((m) => [0, m + 12, pos === 0 ? 0.75 : 0.6, 0.11]) : [];
    case 'strum': {
      const d = STRUM[pos], S = stringNotes(ch).slice(0, 6);
      if (d === 'D') return S.map((m, j) => [j * 0.009, m, 0.75]);
      if (d === 'U') return S.slice(2).reverse().map((m, j) => [j * 0.008, m, 0.45]);
      return [];
    }
    default: return [];
  }
}

// The backing beats, like an Omnichord's rhythm section: soft drums, and a
// bass that follows whichever chord is on. steps per bar; bass: step → 'r'
// (root), '5' (fifth) or '8' (octave). Swing delays every other 16th.
export const BEATS = [
  { id: 'none', name: 'No beat', hint: 'just you and the chords' },
  { id: 'cozy', name: 'Cozy', hint: 'a lazy, swung lo-fi groove', steps: 16, swing: 0.2,
    kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], shaker: [], bass: { 0: 'r', 7: '5', 8: 'r', 14: '8' } },
  { id: 'folk', name: 'Folk', hint: 'a steady walk with a shaker', steps: 16, swing: 0,
    kick: [0, 8], snare: [4, 12], hat: [], shaker: [0, 2, 4, 6, 8, 10, 12, 14], bass: { 0: 'r', 8: '5' } },
  { id: 'waltz', name: 'Waltz', hint: 'three to a bar: oom-pah-pah', steps: 12, swing: 0,
    kick: [0], snare: [], rim: [4, 8], hat: [2, 6, 10], shaker: [], bass: { 0: 'r', 4: '5', 8: '5' } },
  { id: 'bossa', name: 'Bossa', hint: 'a gentle Brazilian sway', steps: 16, swing: 0,
    kick: [0, 6, 8, 14], snare: [], rim: [0, 3, 6, 10, 12], hat: [], shaker: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], bass: { 0: 'r', 6: '5', 8: '5', 14: 'r' } },
  { id: 'ballad', name: 'Ballad', hint: 'slow and wide', steps: 16, swing: 0,
    kick: [0], snare: [8], hat: [0, 4, 8, 12], shaker: [], bass: { 0: 'r', 12: '5' } },
];
// ---------- grooves brought over from Pop Pads ----------
// A groove is a beat like the others: its drums are Pop Pads' own sounds (as
// one-shots), its hits where they fell in the pattern, and its bass line is
// the kit's bass pad, at every note it may need, following the chords.
export const GROOVES = new Map();       // 'pop:<id>' -> beat
const GROOVE_DRUMS = 0.55, GROOVE_BASS = 0.6;
function toBuffer(x) {
  const bin = atob(x.pcm), n = bin.length >> 1, d = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 32768) v -= 65536; d[i] = v / 32768; }
  const b = new AudioBuffer({ length: Math.max(1, n), sampleRate: x.sr, numberOfChannels: 1 }); b.copyToChannel(d, 0);
  return b;
}
export function addGroove(id, g) {
  const cyc = g.bars * 16, at = (list) => { const m = Array.from({ length: cyc }, () => []); for (const h of list) m[h.b * 16 + h.s].push(h); return m; };
  const notes = Object.keys(g.bass.notes).map(Number).sort((a, b) => a - b);
  const beat = {
    id, name: g.name, hint: `from Pop Pads · ${g.bars} bar${g.bars > 1 ? 's' : ''}, its ${g.bass.pad} on bass`, steps: 16, swing: g.swing || 0,
    groove: { cyc, drums: g.drums.map(toBuffer), gm: g.drums.map((d) => d.gm), names: g.drums.map((d) => d.name), hits: at(g.hits), bassHits: at(g.bass.hits), noBass: !g.bass.hits.length,
      bassBufs: new Map(notes.map((m) => [m, toBuffer(g.bass.notes[m])])), notes },
  };
  GROOVES.set(id, beat);
  return beat;
}
export const beatOf = (id) => BEATS.find((b) => b.id === id) || GROOVES.get(id) || BEATS[0];
const stepDur = (bpm) => 60 / bpm / 4;

// What one step n of a beat plays, given the chord that is on:
//   drums: [{ dt, kind, vel, d? }]   bass: [{ dt, m, len, vel, g? }]   (dt: seconds after the step)
// The live beat, the looping take and the saved files all use this, so they agree.
function stepSounds(beat, n, bpm, chord) {
  const sd = stepDur(bpm), out = { drums: [], bass: [] };
  if (beat.groove) {
    const G = beat.groove, gs = ((n % G.cyc) + G.cyc) % G.cyc;
    for (const h of G.hits[gs]) for (let j = 0; j < h.rep; j++) out.drums.push({ dt: (h.nudge || 0) * sd + (j * sd) / h.rep, kind: 'g', d: h.d, vel: Math.pow(0.85, j) });
    if (chord) {
      const list = G.noBass ? ((gs % 8 === 0) ? [{ st: 0, len: 1, vel: 1, rep: 1, nudge: 0 }] : []) : G.bassHits[gs];
      for (const h of list) {
        // until the next bass hit (or the next bar, if it is the only one)
        let gap = 1; while (gap < G.cyc && !(G.noBass ? (gs + gap) % 8 === 0 : G.bassHits[(gs + gap) % G.cyc].length)) gap++;
        for (let j = 0; j < (h.rep || 1); j++) out.bass.push({ dt: (h.nudge || 0) * sd + (j * sd) / (h.rep || 1), m: bassNote(chord) + h.st, len: Math.max(0.1, (gap * sd) / (h.rep || 1) * 0.95), vel: (h.vel || 1) * Math.pow(0.85, j), g: true });
      }
    }
    return out;
  }
  const s = n % beat.steps, v = (list) => list && list.includes(s);
  for (const kind of ['kick', 'snare', 'rim', 'hat', 'shaker']) if (v(beat[kind])) out.drums.push({ dt: 0, kind, vel: kind === 'hat' ? (s % 4 === 0 ? 1 : 0.7) : kind === 'shaker' ? (s % 2 ? 0.6 : 1) : 1 });
  const b = beat.bass[s];
  if (b && chord) {
    // the note lasts until the next bass step
    const keys = Object.keys(beat.bass).map(Number), next = keys.find((k) => k > s) ?? beat.steps + keys[0];
    out.bass.push({ dt: 0, m: bassNote(chord, b), len: Math.max(0.12, (next - s) * sd * 0.9) });
  }
  return out;
}
// play a sample (a groove's drum or bass note), cut after len seconds if given
function playSample(ctx, out, buf, t, vel, len = 0) {
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; g.gain.setValueAtTime(vel, t);
  if (len) g.gain.setTargetAtTime(0, t + len, 0.02);
  src.connect(g).connect(out); src.start(t); src.stop(t + Math.min(buf.duration, len ? len + 0.12 : buf.duration) + 0.01);
}
// a drum hit or a bass note from stepSounds, on its way to the speakers
export function playDrum(ctx, out, x, t, beat) {
  if (x.kind === 'g') { if (beat.groove) playSample(ctx, out, beat.groove.drums[x.d], t, GROOVE_DRUMS * x.vel); }
  else DRUMS[x.kind](ctx, out, t, x.vel);
}
export function playBassNote(ctx, out, x, t, beat) {
  if (x.g && beat.groove) {
    const G = beat.groove, m = G.notes.reduce((a, b) => (Math.abs(b - x.m) < Math.abs(a - x.m) ? b : a), G.notes[0]);
    const buf = G.bassBufs.get(m), src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = Math.pow(2, (x.m - m) / 12);   // exact, unless a note was missing
    g.gain.setValueAtTime(GROOVE_BASS * (x.vel || 1), t); g.gain.setTargetAtTime(0, t + x.len, 0.025);
    src.connect(g).connect(out); src.start(t); src.stop(t + Math.min(buf.duration, x.len + 0.15));
  } else playBass(ctx, out, t, x.m, x.len, x.vel || 1);
}
// one step of a beat, live
function beatStep(ctx, mix, beat, n, t, bpm, chord) {
  const S = stepSounds(beat, n, bpm, chord);
  for (const x of S.drums) playDrum(ctx, mix.drums, x, t + x.dt, beat);
  for (const x of S.bass) playBassNote(ctx, mix.bass, x, t + x.dt, beat);
}
// (a beat with no swing of its own, like "No beat", has none)
const timeOfStep = (beat, bpm, n) => n * stepDur(bpm) + (n % 2 ? (beat.swing || 0) * stepDur(bpm) * 0.66 : 0);

export class Cozy {
  static async create() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    return new Cozy(ctx);
  }
  constructor(ctx) {
    this.ctx = ctx; this.mix = makeMix(ctx);
    this.voice = 'omni'; this.beat = 'none'; this.bpm = 84; this.style = 'chord'; this.auto = null;
    this.tapDelay = 0;       // how late taps land behind the sound (Bluetooth): moved back when recording
    this.chord = null; this.held = null; this.idx = -1;
    this.playing = false; this.rec = null; this.clock = null;
    this.loop = null;        // the take, playing live as a loop
    this.pending = [];       // a play style's notes scheduled but not yet heard
    this.onStep = null; this.onCount = null; this.onLoopChord = null;
  }
  // the grid a play style keeps time with: the beat's when it runs, else the
  // looping take's, else none (the style counts from the press)
  gridOf() {
    if (this.playing && this.t0 != null) return { t0: this.t0, bpm: this.bpm, steps: beatOf(this.beat).steps || 16 };
    if (this.loop) { const tk = this.loop.take; return { t0: this.loop.t0, bpm: tk.bpm, steps: beatOf(tk.beat).steps || 16 }; }
    return null;
  }
  now() { return this.ctx.currentTime + 0.005; }
  wake() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  // ----- what the player does -----
  press(i, ch) {
    this.wake();
    const t = this.now();
    if (this.held) this.held.release(t);
    this.chord = ch; this.idx = i;
    const notes = chordNotes(ch);
    const info = { k: 'c', i, ch: { root: ch.root, shape: ch.shape, label: ch.label }, n: notes, v: this.voice };
    if (this.style !== 'chord') {
      // an auto-style plays the chord for you; the take still knows which chord is on (for the bass)
      this.held = null;
      this.log({ ...info, q: 1 }, t - this.tapDelay);
      this.startAuto(i, ch, t);
    } else {
      this.stopAuto();
      this.held = playChord(this.ctx, this.mix.voices, t, this.voice, notes);
      this.log(info, t - this.tapDelay);
    }
    // with no beat running, the bass plays with the chord (when dubbing over a
    // take with a beat, its own bass follows the chords once they are merged)
    const loopBass = (this.loop && this.loop.take.beat !== 'none') || (this.rec && this.rec.dub && this.rec.dub.beat !== 'none');
    if ((!this.playing || this.beat === 'none') && !loopBass) playBass(this.ctx, this.mix.bass, t, bassNote(ch), 1.2);
  }
  // letting go of a mug: the take notes when the chord stopped (so it can be
  // played back in another style later, for exactly as long)
  release() {
    const t = this.now();
    if (this.auto) { this.stopAuto(); this.log({ k: 'u' }, t - this.tapDelay); return; }
    if (!this.held) return;
    this.held.release(t);
    this.log({ k: 'u' }, t - this.tapDelay);
    this.held = null;
  }
  // delay: for a fast swipe, strings crossed together are spread out a little, as a real strum is
  string(midi, vel = 1, delay = 0) {
    this.wake();
    const t = this.now() + delay;
    playString(this.ctx, this.mix.voices, t, this.voice, midi, vel);
    this.log({ k: 's', m: midi, vel: +vel.toFixed(2), v: this.voice }, t - this.tapDelay);
  }

  // ----- auto-styles: a little clock of its own, in time with the tempo -----
  // The first note sounds at once; the rest fall on the 16th-note grid (the
  // beat's, if it is running). Every note goes into the take as a string.
  // Each new chord starts its pattern from the top (an arpeggio from its root,
  // a strum with a down-stroke), sounding at once, then keeps the grid. Notes
  // of the old chord that were scheduled but not yet heard are cancelled.
  startAuto(i, ch, t) {
    this.cancelPending();
    const fine = this.style === 'tremolo' ? 2 : 1, g = this.gridOf(), sd = stepDur(g ? g.bpm : this.bpm) / fine;
    const after = g ? g.t0 + Math.ceil((t - g.t0 + 0.001) / sd) * sd : t + sd;
    this.auto = { i, ch, style: this.style, k: 0, fine, sd, next: t, after, prev: null };
    this.ensureClock();
    this.autoPump();
  }
  stopAuto() { this.cancelPending(); this.auto = null; }
  // silence (and take back out of the take) every styled note not yet heard
  cancelPending() {
    const now = this.ctx.currentTime;
    for (const p of this.pending) {
      if (p.at <= now + 0.001) continue;            // already sounding: let it ring
      p.h.g.gain.cancelScheduledValues(0);          // its level goes back to 0: it never sounds
      if (this.rec && p.entry) { const k = this.rec.ev.indexOf(p.entry); if (k >= 0) this.rec.ev.splice(k, 1); }
    }
    this.pending = [];
  }
  autoPump() {
    const a = this.auto; if (!a) return;
    const now = this.ctx.currentTime, until = now + 0.08, g = this.gridOf();
    this.pending = this.pending.filter((p) => p.at > now);
    while (a.next < until) {
      const t = a.next;
      // where this step falls in the bar (the first step always counts as the top)
      const pos = a.k === 0 ? 0 : g ? ((Math.round((t - g.t0) / (a.sd * a.fine)) % g.steps) + g.steps) % g.steps : a.k % 16;
      for (const [dt, m, vel, len] of autoStep(a.style, a.ch, a.k, pos, a.prev)) {
        const h = playString(this.ctx, this.mix.voices, t + dt, this.voice, m, vel, len || 0);
        const entry = this.log({ k: 's', m, vel, v: this.voice, a: 1, ...(len ? { len } : {}) }, t + dt);   // a: made by the style
        this.pending.push({ at: t + dt, h, entry });
        a.prev = m;
      }
      a.k++;
      a.next = a.k === 1 ? a.after : a.next + a.sd;
      if (a.next <= t) a.next = t + a.sd;
    }
  }

  // ----- the beat: a clock that schedules a little ahead -----
  play(countIn = false) {
    this.wake();
    const beat = beatOf(this.beat);
    this.playing = true;
    const lead = countIn ? (beat.steps || 16) : 0;
    this.t0 = this.ctx.currentTime + 0.1 + lead * stepDur(this.bpm);
    this.n = -lead;
    this.ensureClock();
    this.pump();
    return this.t0;
  }
  stop() { this.playing = false; if (this.rec) this.stopRec(); }
  // one clock (a little ahead of the sound) for the beat, the play styles and the looping take
  ensureClock() { if (!this.clock) this.clock = setInterval(() => this.tick(), 20); }
  tick() {
    this.pump(); this.autoPump(); this.loopPump();
    if (!this.playing && !this.auto && !this.loop) { clearInterval(this.clock); this.clock = null; }
  }
  pump() {
    if (!this.playing) return;
    const beat = beatOf(this.beat), steps = beat.steps || 16, until = this.ctx.currentTime + 0.12;
    while (this.t0 + timeOfStep(beat, this.bpm, this.n) < until) {
      const n = this.n, s = ((n % steps) + steps) % steps, t = this.t0 + timeOfStep(beat, this.bpm, n);
      const later = (fn) => setTimeout(fn, Math.max(0, (t - this.ctx.currentTime) * 1000));
      if (n < 0) {
        if (s % 4 === 0) { DRUMS.click(this.ctx, this.mix.master, t, s === 0); const beatNo = s / 4 + 1; if (this.onCount) later(() => this.onCount(beatNo)); }
      } else {
        if (n === 0 && this.onCount) later(() => this.onCount(0));
        const dub = this.rec && this.rec.dub;
        // a recording ends by itself at the end of its last bar
        if (this.rec && !this.rec.ending && t >= this.rec.end - 0.001) { this.rec.ending = true; if (this.onRecEnd) later(() => this.onRecEnd()); }
        // from the end of a recording on, the take's own loop takes over (no double beat)
        const handing = this.rec && t >= this.rec.end - 0.001;
        if (dub || handing) { /* the take itself is playing, beat and all */ }
        else if (beat.id !== 'none') beatStep(this.ctx, this.mix, beat, n, t, this.bpm, this.chord);
        else if (s % 4 === 0 && this.rec) DRUMS.click(this.ctx, this.mix.master, t, s === 0);   // no beat: a quiet click while recording
        if (this.onStep) { const bar = Math.floor(n / steps) + 1; later(() => this.onStep(s, steps, bar)); }
      }
      this.n++;
    }
  }

  // ----- the take, played live as a loop (like Pop Pads' patterns) -----
  // Its notes are scheduled a little ahead, pass after pass, so it starts at
  // once, loops without a seam (each pass's last notes ring into the next),
  // and an edit (sound, style, key) is heard from the next note on.
  playTake(take, at = null) {
    this.wake();
    this.stopTake();
    const t0 = at != null ? at : this.ctx.currentTime + 0.03;
    const G = (dest) => { const g = this.ctx.createGain(); g.connect(dest); return g; };
    this.loop = { take, P: performance(take), t0, upto: t0, bus: { voices: G(this.mix.voices), bass: G(this.mix.bass), drums: G(this.mix.drums) } };
    this.ensureClock(); this.loopPump();
    return t0;
  }
  setTake(take) { if (this.loop) { this.loop.take = take; this.loop.P = performance(take); } }
  stopTake() {
    const L = this.loop; if (!L) return;
    this.loop = null;
    const t = this.ctx.currentTime;
    for (const g of Object.values(L.bus)) { g.gain.setTargetAtTime(0, t, 0.02); setTimeout(() => g.disconnect(), 300); }
  }
  loopPump() {
    const L = this.loop; if (!L) return;
    const until = this.ctx.currentTime + 0.12, dur = L.take.dur, a = L.upto, ctx = this.ctx;
    if (until <= a) return;
    for (let p = Math.max(0, Math.floor((a - L.t0) / dur)); L.t0 + p * dur < until; p++) {
      const base = L.t0 + p * dur, lo = Math.max(a, base) - base, hi = Math.min(until, base + dur) - base;
      if (hi <= lo) continue;
      const inW = (x) => x.t >= lo && x.t < hi, P = L.P;
      for (const c of P.chords) if (inW(c)) {
        if (!c.q) playChord(ctx, L.bus.voices, base + c.t, c.v, c.notes).release(base + Math.min(c.end, dur));
        if (this.onLoopChord && c.i >= 0) { const at = base + c.t; setTimeout(() => { if (this.loop === L) this.onLoopChord(c.i); }, Math.max(0, (at - ctx.currentTime) * 1000)); }
      }
      for (const x of P.strings) if (inW(x)) playString(ctx, L.bus.voices, base + x.t, x.v, x.m, x.vel, x.len || 0);
      const beat = beatOf(L.take.beat);
      for (const x of P.bass) if (inW(x)) playBassNote(ctx, L.bus.bass, x, base + x.t, beat);
      for (const x of P.drums) if (inW(x)) playDrum(ctx, L.bus.drums, x, base + x.t, beat);
    }
    L.upto = until;
  }

  // ----- recording a take -----
  // A take is a set number of bars, counted in by a bar of clicks (or, with a
  // beat already going, starting at its next bar). Dubbing plays an earlier
  // take (its tempo and beat) and adds what is played on top of it.
  //   bars: 4, 8 or 16;  dub: the take to play on top of (or null)
  record({ bars = 4, dub = null } = {}) {
    this.wake();
    if (dub) { this.stop(); this.bpm = dub.bpm; this.beat = dub.beat; bars = dub.bars; }
    const steps = beatOf(this.beat).steps || 16, bar = stepDur(this.bpm) * steps;
    let start;
    if (!this.playing) start = this.play(true);
    else start = this.t0 + Math.ceil((this.ctx.currentTime - this.t0) / bar) * bar;
    this.rec = { start, end: start + bars * bar, bars, dub, ev: [] };
    // the chord already on is part of the take from its first moment (not when dubbing)
    if (this.chord && !dub) this.rec.ev.push({ t: 0, k: 'c', i: this.idx, ch: { root: this.chord.root, shape: this.chord.shape, label: this.chord.label }, n: chordNotes(this.chord), v: this.voice, carried: true });
    return start;
  }
  log(e, t) {
    if (!(this.rec && t >= this.rec.start - 0.05 && t < this.rec.end)) return null;
    const entry = { ...e, t: +Math.max(0, t - this.rec.start).toFixed(4) };
    this.rec.ev.push(entry);
    return entry;
  }
  stopRec() {
    const r = this.rec; this.rec = null;
    if (!r) return null;
    this.lastEnd = r.end;
    if (this.ctx.currentTime - r.start < 0.3 || !r.ev.some((e) => !e.carried)) return null;
    // the chord carried in from before is only kept if nothing new was played at once
    if (r.ev.some((e) => e.k === 'c' && !e.carried && e.t < 0.25)) r.ev = r.ev.filter((e) => !e.carried);
    if (r.dub) return { ...r.dub, ev: [...r.dub.ev, ...r.ev].sort((a, b) => a.t - b.t) };
    const bar = stepDur(this.bpm) * (beatOf(this.beat).steps || 16);
    return { v: 1, bpm: this.bpm, beat: this.beat, dur: +(r.bars * bar).toFixed(4), bars: r.bars, ev: r.ev };
  }
}

// ---------- a take, as plain lists of what sounds when (seconds) ----------
// The same lists make the audio, the MIDI and the Boba song, so all three agree.
//   chords: { t, end, notes, label, v }   strings: { t, m, vel, v }
//   bass: { t, m, len }                    drums: { t, kind, vel }
export function performance(take) {
  const beat = beatOf(take.beat), ev = [...take.ev].sort((a, b) => a.t - b.t);
  const out = { chords: [], strings: [], bass: [], drums: [] };
  for (const e of ev) {
    if (e.k === 'c') {
      const last = out.chords[out.chords.length - 1];
      if (last && last.end > e.t) last.end = e.t;
      out.chords.push({ t: e.t, end: take.dur, notes: e.n, label: e.ch.label, v: e.v, ch: e.ch, i: e.i, ...(e.q ? { q: true } : {}) });
      if (beat.id === 'none') out.bass.push({ t: e.t, m: bassNote(e.ch), len: 1.2 });
    } else if (e.k === 'u') { const last = out.chords[out.chords.length - 1]; if (last && last.end > e.t) last.end = e.t; }
    else if (e.k === 's') out.strings.push({ t: e.t, m: e.m, vel: e.vel || 1, v: e.v, ...(e.len ? { len: e.len } : {}) });
  }
  if (beat.id !== 'none') {
    for (let n = 0; ; n++) {
      const t = timeOfStep(beat, take.bpm, n);
      if (t >= take.dur - 0.001) break;
      // the chord on at this step: the last one pressed by then (a hair early still counts)
      let ch = null; for (const e of ev) { if (e.t > t + 0.04) break; if (e.k === 'c') ch = e.ch; }
      const S = stepSounds(beat, n, take.bpm, ch);
      for (const x of S.drums) if (t + x.dt < take.dur) out.drums.push({ ...x, t: Math.max(0, t + x.dt) });
      for (const x of S.bass) if (t + x.dt < take.dur) out.bass.push({ ...x, t: Math.max(0, t + x.dt) });
    }
  }
  return out;
}

// ---------- a take, rendered offline (for the saved files) ----------
// opts: { sr, tail (seconds of ring-out), only: 'chords' | 'strings' | 'bass' | 'drums' (a stem) }
// Notes are made just ahead of where the render has got to (it pauses every
// half second to add the next second's), not all at the start: a note the
// render has not reached yet would still cost it work all the way through.
export async function renderTake(take, { sr = 44100, tail = 3, only = null } = {}) {
  const len = take.dur + tail, ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const mix = makeMix(ctx), P = performance(take), jobs = [];
  const on = (name) => !only || only === name;
  if (on('chords')) for (const c of P.chords) if (!c.q) jobs.push([c.t, () => playChord(ctx, mix.voices, c.t, c.v, c.notes).release(Math.min(c.end, take.dur + 0.4))]);
  if (on('strings')) for (const s of P.strings) jobs.push([s.t, () => playString(ctx, mix.voices, s.t, s.v, s.m, s.vel, s.len || 0)]);
  const beat = beatOf(take.beat);
  if (on('bass')) for (const b of P.bass) jobs.push([b.t, () => playBassNote(ctx, mix.bass, b, b.t, beat)]);
  if (on('drums')) for (const d of P.drums) jobs.push([d.t, () => playDrum(ctx, mix.drums, d, d.t, beat)]);
  jobs.sort((x, y) => x[0] - y[0]);
  let k = 0;
  const add = (until) => { while (k < jobs.length && jobs[k][0] < until) jobs[k++][1](); };
  add(1);
  for (let t = 0.5; t < len - 0.01 && t < take.dur + 1; t += 0.5) {
    const at = Math.round(t * sr / 128) * 128 / sr;
    ctx.suspend(at).then(() => { add(at + 1); ctx.resume(); });
  }
  return { buffer: await ctx.startRendering(), seconds: take.dur };
}

// ---------- a take in a new key (or scale, or with changed chords) ----------
// Every chord follows its mug: the take keeps which mug was played when, and
// each mug's chord is now whatever that mug holds. Each single note (strums,
// arpeggios) keeps its place in its chord (the third, an octave up, …), so a
// melody of chord tones moves with the harmony.
export function retune(take, key, mode, custom = {}) {
  const now = chordsOf(key, mode, custom), ev = [...take.ev].sort((a, b) => a.t - b.t);
  let from = null, to = null;
  const out = ev.map((e) => {
    if (e.k === 'c') {
      from = e.ch; to = e.i >= 0 && now[e.i] ? now[e.i] : from;
      const ch = { root: to.root, shape: to.shape, label: to.label };
      return { ...e, ch, n: chordNotes(ch) };
    }
    if (e.k === 's' && from && to) return { ...e, m: moveNote(e.m, from, to) };
    return e;
  });
  return { ...take, key, mode, ev: out };
}
function moveNote(m, from, to) {
  const a = SHAPES[from.shape].iv, b = SHAPES[to.shape].iv;
  // the root moves to the nearest place (never more than a tritone)
  let shift = ((to.root - from.root) % 12 + 12) % 12; if (shift > 6) shift -= 12;
  for (let j = 0; j < a.length; j++) {
    const off = m - from.root - a[j];
    if (((off % 12) + 12) % 12 !== 0) continue;
    // chord tone j of the old chord → tone j of the new one (a 7th in a triad becomes its octave root)
    const tone = j < b.length ? b[j] : 12 + b[j % b.length];
    return from.root + off + shift + tone;
  }
  return m + shift;   // not a chord tone: moves with the root
}

// ---------- a take in another sound, or another play style ----------
// Everything takes the new sound. The notes a play style made (arpeggios,
// strums, rolls, stabs) are made again in the new style, over the same
// chords for the same time; notes strummed by hand on the strip stay.
export function restyle(take, voice, style) {
  const ev = [...take.ev].sort((a, b) => a.t - b.t), beat = beatOf(take.beat), steps = beat.steps || 16;
  const flagged = ev.some((e) => e.a);
  // each chord's time: until it was let go (when it sounded only while held:
  // an organ or a pad, or a style), else until the next chord, or the end
  const spans = [];
  const heldOnly = (e) => e.q || e.v === 'omni' || e.v === 'glass';
  ev.forEach((e, k) => {
    if (e.k !== 'c') return;
    let end = take.dur;
    for (let j = k + 1; j < ev.length; j++) if (ev[j].k === 'c' || (ev[j].k === 'u' && heldOnly(e))) { end = ev[j].t; break; }
    spans.push({ e, from: e.t, to: Math.min(end, take.dur) });
  });
  // takes from before notes were marked: a styled chord's own notes are the ones under it
  const madeByStyle = (e) => e.a || (!flagged && spans.some((s) => s.e.q && e.t >= s.from - 0.001 && e.t < s.to + 0.15));
  const out = ev.filter((e) => !(e.k === 's' && madeByStyle(e))).map((e) => {
    const x = { ...e, v: voice };
    if (x.k === 'c') { if (style === 'chord') delete x.q; else x.q = 1; }
    return x;
  });
  if (style !== 'chord') {
    const fine = style === 'tremolo' ? 2 : 1, sd = stepDur(take.bpm) / fine;
    for (const { e, from, to } of spans) {
      let prev = null, k = 0;
      // the first note at the press, the rest on the take's grid
      for (let t = from; t < to - 0.001; k++) {
        const pos = ((Math.round(t / (sd * fine)) % steps) + steps) % steps;
        for (const [dt, m, vel, len] of autoStep(style, e.ch, k, pos, prev)) {
          if (t + dt < take.dur) out.push({ t: +(t + dt).toFixed(4), k: 's', m, vel, v: voice, a: 1, ...(len ? { len } : {}) });
          prev = m;
        }
        t = Math.max(t + 0.001, Math.ceil((t + 0.0005) / sd) * sd);
        if (t <= from) t = from + sd;
      }
    }
  }
  return { ...take, ev: out.sort((a, b) => a.t - b.t) };
}

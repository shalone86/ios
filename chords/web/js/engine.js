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
export const beatOf = (id) => BEATS.find((b) => b.id === id) || BEATS[0];
const stepDur = (bpm) => 60 / bpm / 4;

// one step of a beat: drums, and the bass on the chord that is on
function beatStep(ctx, mix, beat, s, t, bpm, chord) {
  const v = (list) => list && list.includes(s);
  if (v(beat.kick)) DRUMS.kick(ctx, mix.drums, t);
  if (v(beat.snare)) DRUMS.snare(ctx, mix.drums, t);
  if (v(beat.rim)) DRUMS.rim(ctx, mix.drums, t);
  if (v(beat.hat)) DRUMS.hat(ctx, mix.drums, t, s % 4 === 0 ? 1 : 0.7);
  if (v(beat.shaker)) DRUMS.shaker(ctx, mix.drums, t, s % 2 ? 0.6 : 1);
  const b = beat.bass[s];
  if (b && chord) {
    // the note lasts until the next bass step
    const keys = Object.keys(beat.bass).map(Number), next = keys.find((k) => k > s) ?? beat.steps + keys[0];
    playBass(ctx, mix.bass, t, bassNote(chord, b), Math.max(0.12, (next - s) * stepDur(bpm) * 0.9));
  }
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
    this.chord = null; this.held = null; this.idx = -1;
    this.playing = false; this.rec = null; this.clock = null;
    this.onStep = null; this.onCount = null;
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
      this.log({ ...info, q: 1 }, t);
      this.startAuto(i, ch, t);
    } else {
      this.stopAuto();
      this.held = playChord(this.ctx, this.mix.voices, t, this.voice, notes);
      this.log(info, t);
    }
    // with no beat running, the bass plays with the chord (when dubbing over a
    // take with a beat, its own bass follows the chords once they are merged)
    if ((!this.playing || this.beat === 'none') && !(this.rec && this.rec.dub && this.rec.dub.beat !== 'none')) playBass(this.ctx, this.mix.bass, t, bassNote(ch), 1.2);
  }
  // letting go of a mug: the take notes when the chord stopped (so it can be
  // played back in another style later, for exactly as long)
  release() {
    const t = this.now();
    if (this.auto) { this.stopAuto(); this.log({ k: 'u' }, t); return; }
    if (!this.held) return;
    this.held.release(t);
    this.log({ k: 'u' }, t);
    this.held = null;
  }
  string(midi, vel = 1) {
    this.wake();
    const t = this.now();
    playString(this.ctx, this.mix.voices, t, this.voice, midi, vel);
    this.log({ k: 's', m: midi, vel: +vel.toFixed(2), v: this.voice }, t);
  }

  // ----- auto-styles: a little clock of its own, in time with the tempo -----
  // The first note sounds at once; the rest fall on the 16th-note grid (the
  // beat's, if it is running). Every note goes into the take as a string.
  startAuto(i, ch, t) {
    const sd = stepDur(this.bpm), fine = this.style === 'tremolo' ? 2 : 1;
    const keep = this.auto && this.auto.style === this.style;   // a new chord carries on the pattern
    const k = keep ? this.auto.k : 0;
    let nextGrid = t + sd / fine;
    if (this.playing && this.t0 != null) nextGrid = this.t0 + Math.ceil((t - this.t0 + 0.001) / (sd / fine)) * (sd / fine);
    this.auto = { i, ch, style: this.style, k, at: t, fine, next: t, after: nextGrid, prev: null };
    if (!this.autoClock) this.autoClock = setInterval(() => this.autoPump(), 15);
    this.autoPump();
  }
  stopAuto() { this.auto = null; if (this.autoClock) { clearInterval(this.autoClock); this.autoClock = null; } }
  autoPump() {
    const a = this.auto; if (!a) return;
    const sd = stepDur(this.bpm) / a.fine, until = this.ctx.currentTime + 0.1, steps = beatOf(this.beat).steps || 16;
    while (a.next < until) {
      const t = a.next;
      // where this step falls in the bar: on the beat's grid when it runs, else counted from the press
      const pos = this.playing && this.t0 != null ? ((Math.round((t - this.t0) / (sd * a.fine)) % steps) + steps) % steps : a.k % 16;
      for (const [dt, m, vel, len] of autoStep(a.style, a.ch, a.k, pos, a.prev)) {
        playString(this.ctx, this.mix.voices, t + dt, this.voice, m, vel, len || 0);
        this.log({ k: 's', m, vel, v: this.voice, a: 1, ...(len ? { len } : {}) }, t + dt);   // a: made by the style
        a.prev = m;
      }
      a.k++;
      a.next = a.k === 1 || a.next < a.after ? a.after : a.next + sd;
      if (a.next <= t) a.next = t + sd;
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
    if (!this.clock) this.clock = setInterval(() => this.pump(), 20);
    this.pump();
    return this.t0;
  }
  stop() { this.playing = false; if (this.clock) { clearInterval(this.clock); this.clock = null; } if (this.rec) this.stopRec(); }
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
        if (dub) { /* dubbing: the take itself is playing, beat and all */ }
        else if (beat.id !== 'none') beatStep(this.ctx, this.mix, beat, s, t, this.bpm, this.chord);
        else if (s % 4 === 0 && this.rec) DRUMS.click(this.ctx, this.mix.master, t, s === 0);   // no beat: a quiet click while recording
        if (this.onStep) { const bar = Math.floor(n / steps) + 1; later(() => this.onStep(s, steps, bar)); }
      }
      this.n++;
    }
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
  log(e, t) { if (this.rec && t >= this.rec.start - 0.05 && t < this.rec.end) this.rec.ev.push({ ...e, t: +Math.max(0, t - this.rec.start).toFixed(4) }); }
  stopRec() {
    const r = this.rec; this.rec = null;
    if (!r) return null;
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
      out.chords.push({ t: e.t, end: take.dur, notes: e.n, label: e.ch.label, v: e.v, ch: e.ch, ...(e.q ? { q: true } : {}) });
      if (beat.id === 'none') out.bass.push({ t: e.t, m: bassNote(e.ch), len: 1.2 });
    } else if (e.k === 'u') { const last = out.chords[out.chords.length - 1]; if (last && last.end > e.t) last.end = e.t; }
    else if (e.k === 's') out.strings.push({ t: e.t, m: e.m, vel: e.vel || 1, v: e.v, ...(e.len ? { len: e.len } : {}) });
  }
  if (beat.id !== 'none') {
    const steps = beat.steps, keys = Object.keys(beat.bass).map(Number);
    for (let n = 0; ; n++) {
      const t = timeOfStep(beat, take.bpm, n);
      if (t >= take.dur - 0.001) break;
      const s = n % steps, has = (l) => l && l.includes(s);
      for (const kind of ['kick', 'snare', 'rim', 'hat', 'shaker']) if (has(beat[kind])) out.drums.push({ t, kind, vel: kind === 'hat' ? (s % 4 === 0 ? 1 : 0.7) : kind === 'shaker' ? (s % 2 ? 0.6 : 1) : 1 });
      // the chord on at this step: the last one pressed by then (a hair early still counts)
      let ch = null; for (const e of ev) { if (e.t > t + 0.04) break; if (e.k === 'c') ch = e.ch; }
      const b = beat.bass[s];
      if (b && ch) {
        const next = keys.find((k) => k > s) ?? steps + keys[0];
        out.bass.push({ t, m: bassNote(ch, b), len: Math.max(0.12, (next - s) * stepDur(take.bpm) * 0.9) });
      }
    }
  }
  return out;
}

// ---------- a take, rendered offline (for listening back and exporting) ----------
// opts: { sr, tail (seconds of ring-out), only: 'chords' | 'strings' | 'bass' | 'drums' (a stem) }
export async function renderTake(take, { sr = 44100, tail = 3, only = null } = {}) {
  const len = take.dur + tail, ctx = new OfflineAudioContext(2, Math.ceil(len * sr), sr);
  const mix = makeMix(ctx), P = performance(take);
  const on = (name) => !only || only === name;
  if (on('chords')) for (const c of P.chords) {
    if (c.q) continue;                       // an auto-style's chord: its notes are in the strings
    const h = playChord(ctx, mix.voices, c.t, c.v, c.notes);
    h.release(Math.min(c.end, take.dur + 0.4));
  }
  if (on('strings')) for (const s of P.strings) playString(ctx, mix.voices, s.t, s.v, s.m, s.vel, s.len || 0);
  if (on('bass')) for (const b of P.bass) playBass(ctx, mix.bass, b.t, b.m, b.len);
  if (on('drums')) for (const d of P.drums) DRUMS[d.kind](ctx, mix.drums, d.t, d.vel);
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

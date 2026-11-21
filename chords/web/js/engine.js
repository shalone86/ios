// Cozy Chords engine: plays chords, strings and the backing beat live, and
// records a take (what was played, and when) that renders offline to the
// same sound, for listening back and exporting.

import { playChord, playString, playBass, DRUMS, makeMix } from './sound.js';
import { chordNotes, bassNote } from './theory.js';

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
    this.voice = 'omni'; this.beat = 'none'; this.bpm = 84;
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
    this.held = playChord(this.ctx, this.mix.voices, t, this.voice, notes);
    // with no beat running, the bass plays with the chord
    if (!this.playing || this.beat === 'none') playBass(this.ctx, this.mix.bass, t, bassNote(ch), 1.2);
    this.log({ k: 'c', i, ch: { root: ch.root, shape: ch.shape, label: ch.label }, n: notes, v: this.voice }, t);
  }
  release() {
    if (!this.held) return;
    const t = this.now();
    this.held.release(t);
    if (this.held.held) this.log({ k: 'u' }, t);
    this.held = null;
  }
  string(midi, vel = 1) {
    this.wake();
    const t = this.now();
    playString(this.ctx, this.mix.voices, t, this.voice, midi, vel);
    this.log({ k: 's', m: midi, vel: +vel.toFixed(2), v: this.voice }, t);
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
        if (beat.id !== 'none') beatStep(this.ctx, this.mix, beat, s, t, this.bpm, this.chord);
        else if (s % 4 === 0 && this.rec) DRUMS.click(this.ctx, this.mix.master, t, s === 0);   // no beat: a quiet click while recording
        if (this.onStep) later(() => this.onStep(s, steps));
      }
      this.n++;
    }
  }

  // ----- recording a take -----
  // starts at the top of the beat (after a bar of clicks), or at once with no beat
  record() {
    this.wake();
    let start;
    if (!this.playing) start = this.play(true);
    else start = this.t0 + Math.ceil((this.ctx.currentTime - this.t0) / (stepDur(this.bpm) * (beatOf(this.beat).steps || 16))) * stepDur(this.bpm) * (beatOf(this.beat).steps || 16);
    this.rec = { start, ev: [] };
    // the chord already on is part of the take from its first moment
    if (this.chord) this.rec.ev.push({ t: 0, k: 'c', i: this.idx, ch: { root: this.chord.root, shape: this.chord.shape, label: this.chord.label }, n: chordNotes(this.chord), v: this.voice, carried: true });
    return start;
  }
  log(e, t) { if (this.rec && t >= this.rec.start - 0.05) this.rec.ev.push({ ...e, t: +Math.max(0, t - this.rec.start).toFixed(4) }); }
  stopRec() {
    const r = this.rec; this.rec = null;
    if (!r) return null;
    const dur = Math.max(0, this.ctx.currentTime - r.start);
    if (dur < 0.5 || !r.ev.some((e) => !e.carried)) return null;
    // the chord carried in from before is only kept if nothing new was played at once
    if (r.ev.some((e) => e.k === 'c' && !e.carried && e.t < 0.25)) r.ev = r.ev.filter((e) => !e.carried);
    // the take ends at the end of its last bar, so it loops and lines up
    const bar = stepDur(this.bpm) * (beatOf(this.beat).steps || 16), bars = Math.max(1, Math.ceil(dur / bar - 0.02));
    return { v: 1, bpm: this.bpm, beat: this.beat, dur: +(bars * bar).toFixed(4), bars, ev: r.ev };
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
      out.chords.push({ t: e.t, end: take.dur, notes: e.n, label: e.ch.label, v: e.v, ch: e.ch });
      if (beat.id === 'none') out.bass.push({ t: e.t, m: bassNote(e.ch), len: 1.2 });
    } else if (e.k === 'u') { const last = out.chords[out.chords.length - 1]; if (last && last.end > e.t) last.end = e.t; }
    else if (e.k === 's') out.strings.push({ t: e.t, m: e.m, vel: e.vel || 1, v: e.v });
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
    const h = playChord(ctx, mix.voices, c.t, c.v, c.notes);
    h.release(Math.min(c.end, take.dur + 0.4));
  }
  if (on('strings')) for (const s of P.strings) playString(ctx, mix.voices, s.t, s.v, s.m, s.vel);
  if (on('bass')) for (const b of P.bass) playBass(ctx, mix.bass, b.t, b.m, b.len);
  if (on('drums')) for (const d of P.drums) DRUMS[d.kind](ctx, mix.drums, d.t, d.vel);
  return { buffer: await ctx.startRendering(), seconds: take.dur };
}

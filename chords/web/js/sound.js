// Cozy Chords' sounds, all synthesized (no samples): five voices, each with
// a chord sound (the bubbles) and a string sound (the strum strip), a bass,
// a soft drum kit, and a warm room. Every function schedules at time t on
// any audio context, so the live app and an export sound the same.

import { midiToFreq } from './theory.js';

export const VOICES = [
  { id: 'omni', name: 'Omni', hint: 'a reedy organ chord, a bell-bright strum' },
  { id: 'harp', name: 'Harp', hint: 'plucked strings, both ways' },
  { id: 'keys', name: 'Keys', hint: 'a soft electric piano' },
  { id: 'glass', name: 'Glass', hint: 'a slow glassy pad, chiming strings' },
  { id: 'guitar', name: 'Guitar', hint: 'a nylon-string strum' },
];

const osc = (ctx, type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
const gain = (ctx, v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
const filt = (ctx, type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

// ---------- the guitar: a plucked string (Karplus-Strong), made once per note ----------
const strings = new Map();
function guitarBuffer(midi) {
  const key = String(midi);
  if (strings.has(key)) return strings.get(key);
  // A string is a short loop of noise, averaged a little each time round. The
  // averaging takes half a sample off the delay, so the loop is L samples and
  // the buffer's own sample rate is f × (L − ½): played back, it is exactly in tune.
  const f = midiToFreq(midi), L = Math.max(16, Math.round(44100 / f)), sr = f * (L - 0.5);
  const n = Math.round(sr * 2.6), d = new Float32Array(n), line = new Float32Array(L);
  let seed = midi * 7919 + 13;
  for (let i = 0; i < L; i++) { seed = (seed * 16807) % 2147483647; line[i] = seed / 1073741823.5 - 1; }
  for (let i = 1; i < L; i++) line[i] = line[i] * 0.5 + line[i - 1] * 0.5;      // a soft (nylon) pick
  const decay = 0.9975 - Math.min(0.004, f / 300000);
  for (let i = 0, k = 0; i < n; i++, k = (k + 1) % L) {
    d[i] = line[k];
    line[k] = decay * 0.5 * (line[k] + line[(k + 1) % L]);
  }
  let pk = 0; for (const x of d) pk = Math.max(pk, Math.abs(x));
  for (let i = 0; i < n; i++) d[i] /= pk || 1;
  const buf = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 1 });
  buf.copyToChannel(d, 0);
  strings.set(key, buf);
  return buf;
}

// ---------- the building blocks: one note, in a voice's style ----------
// pluck: a note that rings and fades by itself
function pluck(ctx, out, t, midi, vel, style) {
  const f = midiToFreq(midi), g = gain(ctx);
  g.connect(out);
  if (style === 'guitar') {
    const src = ctx.createBufferSource(); src.buffer = guitarBuffer(midi);
    const lp = filt(ctx, 'lowpass', 3200);
    g.gain.setValueAtTime(0.5 * vel, t);
    src.connect(lp).connect(g); src.start(t); src.stop(t + 2.6);
    return { g, end: t + 2.6 };
  }
  const P = {
    harp: { parts: [['triangle', 1, 1], ['sine', 2, 0.35], ['sine', 3, 0.12]], d: 1.1, lp: [5200, 1400, 0.35] },
    bell: { parts: [['sine', 1, 1], ['sine', 2.01, 0.4], ['sine', 3.98, 0.18], ['sine', 5.43, 0.08]], d: 0.9, lp: [9000, 4000, 0.5] },
    keys: { parts: [['sine', 1, 1], ['sine', 2, 0.25]], d: 0.9, lp: [4200, 1600, 0.4], fm: [1, 1.4, 0.25], lvl: 0.7 },
    glass: { parts: [['sine', 1, 1], ['sine', 2.76, 0.3], ['sine', 5.4, 0.12]], d: 1.6, lp: [8000, 3000, 0.8] },
  }[style];
  const lp = filt(ctx, 'lowpass', P.lp[0]);
  lp.frequency.setValueAtTime(P.lp[0], t); lp.frequency.setTargetAtTime(P.lp[1], t + 0.01, P.lp[2]);
  lp.connect(g);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * (P.lvl || 1) * vel, t + 0.004); g.gain.setTargetAtTime(0, t + 0.006, P.d / 3);
  const end = t + P.d * 2.2;
  for (const [type, m, lvl] of P.parts) {
    const o = osc(ctx, type, f * m), og = gain(ctx, lvl / P.parts.length ** 0.4);
    if (P.fm && m === 1) {
      const mod = osc(ctx, 'sine', f * P.fm[0]), mg = gain(ctx);
      mg.gain.setValueAtTime(f * P.fm[1], t); mg.gain.setTargetAtTime(f * 0.1, t + 0.003, P.fm[2]);
      mod.connect(mg).connect(o.frequency); mod.start(t); mod.stop(end);
    }
    o.connect(og).connect(lp); o.start(t); o.stop(end);
  }
  return { g, end };
}
// hold: a note that sounds as long as it is held, then lets go
function hold(ctx, out, t, midi, vel, style) {
  const f = midiToFreq(midi), g = gain(ctx), stops = [];
  g.connect(out);
  const P = {
    organ: { parts: [['square', 0, 0.5], ['sawtooth', 7, 0.4], ['sawtooth', -7, 0.4]], a: 0.012, lvl: 0.16, lp: 2400, vib: 4 },
    pad: { parts: [['sawtooth', -9, 0.4], ['sawtooth', 9, 0.4], ['sine', 0, 0.6]], a: 0.35, lvl: 0.17, lp: 1700, vib: 6 },
  }[style];
  const lp = filt(ctx, 'lowpass', P.lp, 0.8); lp.connect(g);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(P.lvl * vel, t + P.a);
  const lfo = osc(ctx, 'sine', 5.2), depth = gain(ctx, P.vib);
  lfo.connect(depth); lfo.start(t); stops.push(lfo);
  for (const [type, cents, lvl] of P.parts) {
    const o = osc(ctx, type, f); o.detune.value = cents; depth.connect(o.detune);
    o.connect(gain(ctx, lvl)).connect(lp); o.start(t); stops.push(o);
  }
  return {
    g, end: Infinity,
    release(at, fade = P.a > 0.1 ? 0.6 : 0.18) {
      g.gain.cancelScheduledValues(at); g.gain.setTargetAtTime(0, at, fade / 3);
      for (const o of stops) o.stop(at + fade * 2 + 0.05);
      this.end = at + fade * 2;
    },
  };
}

// ---------- a voice: its chord sound and its string sound ----------
const CHORD_STYLE = { omni: 'organ', harp: 'harp', keys: 'keys', glass: 'pad', guitar: 'guitar' };
const STRING_STYLE = { omni: 'bell', harp: 'harp', keys: 'keys', glass: 'glass', guitar: 'guitar' };
const HELD = new Set(['organ', 'pad']);

// a chord on a bubble: notes strummed quickly upwards (held voices sound together)
export function playChord(ctx, out, t, voice, notes, vel = 1) {
  const style = CHORD_STYLE[voice], held = HELD.has(style);
  const gap = held ? 0 : style === 'guitar' ? 0.022 : 0.012;
  const v = vel * (held ? 1 : 1.25 / Math.sqrt(notes.length / 3));
  const hs = notes.map((m, k) => (held ? hold : pluck)(ctx, out, t + k * gap, m, v, style));
  return { held, release(at) { if (held) for (const h of hs) h.release(at); } };
}
// one string of the strip
export function playString(ctx, out, t, voice, midi, vel = 1) {
  return pluck(ctx, out, t, midi, vel * 1.4, STRING_STYLE[voice]);   // a string sounds alone, so a little louder than one note of a chord
}

// ---------- the bass: round and short, a soft pluck ----------
export function playBass(ctx, out, t, midi, len = 0.6, vel = 1) {
  const f = midiToFreq(midi), g = gain(ctx), lp = filt(ctx, 'lowpass', 900, 0.9);
  lp.frequency.setValueAtTime(1100, t); lp.frequency.setTargetAtTime(380, t + 0.01, 0.08);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.28 * vel, t + 0.006);
  g.gain.setTargetAtTime(0.15 * vel, t + 0.02, 0.12); g.gain.setTargetAtTime(0, t + len, 0.05);
  const a = osc(ctx, 'triangle', f), b = osc(ctx, 'sine', f), c = osc(ctx, 'sawtooth', f);
  const cg = gain(ctx, 0.12);
  a.connect(lp); b.connect(lp); c.connect(cg).connect(lp); lp.connect(g).connect(out);
  for (const o of [a, b, c]) { o.start(t); o.stop(t + len + 0.4); }
}

// ---------- a soft kit: brushes and a felt kick ----------
let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf) {
    noiseBuf = new AudioBuffer({ length: 48000, sampleRate: 48000, numberOfChannels: 1 });
    const d = noiseBuf.getChannelData(0); let s = 99991;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
  }
  const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true; return n;
}
function hiss(ctx, out, t, type, f, q, lvl, d, a = 0.002) {
  const n = noise(ctx), b = filt(ctx, type, f, q), g = gain(ctx);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + a); g.gain.setTargetAtTime(0, t + a, d);
  n.connect(b).connect(g).connect(out); n.start(t, Math.random() * 0.5); n.stop(t + d * 6 + a);
}
export const DRUMS = {
  kick(ctx, out, t, v = 1) {
    const o = osc(ctx, 'sine', 110), g = gain(ctx);
    o.frequency.setValueAtTime(115, t); o.frequency.setTargetAtTime(48, t, 0.035);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.75 * v, t + 0.003); g.gain.setTargetAtTime(0, t + 0.01, 0.09);
    o.connect(filt(ctx, 'lowpass', 600)).connect(g).connect(out); o.start(t); o.stop(t + 0.6);
  },
  snare(ctx, out, t, v = 1) {                       // a brush slap
    hiss(ctx, out, t, 'bandpass', 2200, 0.7, 0.45 * v, 0.07, 0.004);
    const o = osc(ctx, 'triangle', 190), g = gain(ctx);
    g.gain.setValueAtTime(0.2 * v, t); g.gain.setTargetAtTime(0, t, 0.03);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.2);
  },
  rim(ctx, out, t, v = 1) {
    const o = osc(ctx, 'sine', 1700), g = gain(ctx);
    g.gain.setValueAtTime(0.25 * v, t); g.gain.setTargetAtTime(0, t, 0.012);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.1);
    hiss(ctx, out, t, 'bandpass', 3500, 1.5, 0.12 * v, 0.008);
  },
  hat(ctx, out, t, v = 1) { hiss(ctx, out, t, 'highpass', 8000, 0.7, 0.16 * v, 0.025); },
  shaker(ctx, out, t, v = 1) { hiss(ctx, out, t, 'bandpass', 6500, 1.1, 0.13 * v, 0.03, 0.012); },
  click(ctx, out, t, accent) {                      // the count-in
    const o = osc(ctx, 'sine', accent ? 1760 : 1175), g = gain(ctx);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? 0.3 : 0.2, t + 0.002); g.gain.setTargetAtTime(0, t + 0.004, 0.012);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.1);
  },
};

// ---------- the room and the master ----------
function roomIR(ctx, secs = 1.8) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let s = 7 + c * 977, lp = 0, e = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const x = i / sr, w = s / 1073741823.5 - 1;
      lp += (0.25 + 0.5 * Math.exp(-x * 3)) * (w - lp);
      d[i] = lp * Math.exp(-x * 3.4) * Math.min(1, x / 0.01);
      e += d[i] * d[i];
    }
    const k = 1 / Math.sqrt(e); for (let i = 0; i < n; i++) d[i] *= k;
  }
  return b;
}
// The mix: voices (with a good share of room), bass and drums (a little),
// gently squeezed and kept from clipping.
export function makeMix(ctx, dest = ctx.destination) {
  const G = (v) => gain(ctx, v);
  const voices = G(0.8), bass = G(0.9), drums = G(0.75), master = G(0.9);
  const room = ctx.createConvolver(); room.normalize = false; room.buffer = roomIR(ctx);
  const send = G(0.35), back = G(0.6), dsend = G(0.12);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2; comp.knee.value = 8;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -3; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1; limit.knee.value = 0;
  voices.connect(master); bass.connect(master); drums.connect(master);
  voices.connect(send).connect(room); drums.connect(dsend).connect(room); room.connect(back).connect(master);
  master.connect(comp).connect(limit).connect(dest);
  return { voices, bass, drums, master, limit };
}

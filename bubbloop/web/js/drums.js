// The drum kit: 25 finger-drumming pads, all synthesised. Each pad is
// rendered once into a stereo buffer so that hitting it live costs almost
// nothing and stays tight under fast playing.

import { midiToFreq } from './theory.js';
import { makeShared } from './instruments.js';

// Laid out bottom row first, the way the grid is drawn: kicks and snares
// under the thumbs, hats above, toms across the middle, cymbals and
// shakers next, sparkly toys on top.
export const DRUM_PADS = [
  { id: 'kick1',  name: 'Boom',    kind: 'kick',  gm: 36, peak: 0.88, len: 1.1, pan: 0 },
  { id: 'kick2',  name: 'Thump',   kind: 'kick',  gm: 35, peak: 0.88, len: 0.6, pan: 0 },
  { id: 'snare1', name: 'Crack',   kind: 'snare', gm: 38, peak: 0.8,  len: 0.6, pan: 0.05 },
  { id: 'snare2', name: 'Snap',    kind: 'snare', gm: 40, peak: 0.8,  len: 0.5, pan: -0.05 },
  { id: 'snare3', name: 'Brush',   kind: 'snare', gm: 38, peak: 0.6,  len: 0.6, pan: 0.05 },

  { id: 'hat1',   name: 'Tick',    kind: 'hat',   gm: 42, peak: 0.5,  len: 0.25, pan: 0.25, choke: 'hat' },
  { id: 'hat2',   name: 'Tsk',     kind: 'hat',   gm: 42, peak: 0.44, len: 0.3,  pan: 0.25, choke: 'hat' },
  { id: 'hat3',   name: 'Chick',   kind: 'hat',   gm: 44, peak: 0.4,  len: 0.2,  pan: 0.25, choke: 'hat' },
  { id: 'ohat',   name: 'Tsss',    kind: 'hat',   gm: 46, peak: 0.48, len: 1.2,  pan: 0.25, group: 'hat' },
  { id: 'clap',   name: 'Clap',    kind: 'snare', gm: 39, peak: 0.7,  len: 0.7,  pan: -0.1 },

  { id: 'tom1',   name: 'Tom 1',   kind: 'tom',   gm: 41, peak: 0.8,  len: 0.9, pan: 0.4 },
  { id: 'tom2',   name: 'Tom 2',   kind: 'tom',   gm: 45, peak: 0.8,  len: 0.8, pan: 0.2 },
  { id: 'tom3',   name: 'Tom 3',   kind: 'tom',   gm: 47, peak: 0.8,  len: 0.7, pan: 0 },
  { id: 'tom4',   name: 'Tom 4',   kind: 'tom',   gm: 48, peak: 0.8,  len: 0.6, pan: -0.2 },
  { id: 'tom5',   name: 'Tom 5',   kind: 'tom',   gm: 50, peak: 0.8,  len: 0.5, pan: -0.4 },

  { id: 'ride',   name: 'Ride',    kind: 'cym',   gm: 51, peak: 0.42, len: 2.2, pan: -0.3 },
  { id: 'crash',  name: 'Crash',   kind: 'cym',   gm: 49, peak: 0.6,  len: 2.8, pan: 0.3 },
  { id: 'shake1', name: 'Shaka',   kind: 'perc',  gm: 70, peak: 0.4, len: 0.3, pan: -0.35 },
  { id: 'shake2', name: 'Shiki',   kind: 'perc',  gm: 82, peak: 0.4, len: 0.4, pan: 0.35 },
  { id: 'tamb',   name: 'Jingle',  kind: 'perc',  gm: 54, peak: 0.46, len: 0.7, pan: 0.2 },

  { id: 'rain',   name: 'Rain',    kind: 'toy',   gm: 67, peak: 0.6,  len: 2.4, pan: 0, tuned: true },
  { id: 'rim',    name: 'Rim',     kind: 'toy',   gm: 37, peak: 0.6,  len: 0.2, pan: -0.15 },
  { id: 'bell',   name: 'Moo',     kind: 'toy',   gm: 56, peak: 0.5,  len: 0.6, pan: 0.15 },
  { id: 'pop',    name: 'Pop',     kind: 'toy',   gm: 76, peak: 0.6,  len: 0.3, pan: -0.2 },
  { id: 'chime',  name: 'Sparkle', kind: 'toy',   gm: 81, peak: 0.42, len: 2.4, pan: 0, tuned: true },
];

export const PAD_INDEX = Object.fromEntries(DRUM_PADS.map((p, i) => [p.id, i]));

// ---------- synthesis building blocks ----------

function tone(ctx, dest, t, { type = 'sine', f0, f1 = f0, sweep = 0.03, level = 1, decay = 0.2, attack = 0.001 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.setTargetAtTime(f1, t, sweep);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + decay * 8);
  return g;
}

function noise(ctx, sh, dest, t, { type = 'highpass', freq = 1000, q = 0.7, level = 1, decay = 0.1, attack = 0.001, offset = 0, type2, freq2 }) {
  const s = ctx.createBufferSource();
  s.buffer = sh.noise;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay);
  let node = s.connect(f);
  if (type2) {
    const f2 = ctx.createBiquadFilter();
    f2.type = type2;
    f2.frequency.value = freq2;
    node = node.connect(f2);
  }
  node.connect(g).connect(dest);
  s.start(t, offset);
  s.stop(t + attack + decay * 8);
  return g;
}

// Six detuned square waves: the classic recipe for cymbal-ish shimmer.
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(ctx, dest, t, { ratio = 1, band = 9000, q = 0.8, high = 6500, level = 1, decay = 0.05, attack = 0.001 }) {
  const mix = ctx.createGain();
  mix.gain.value = 0.3;
  for (const f of METAL) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f * ratio;
    o.connect(mix);
    o.start(t);
    o.stop(t + attack + decay * 8);
  }
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = band;
  bp.Q.value = q;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = high;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.setTargetAtTime(0, t + attack, decay);
  mix.connect(bp).connect(hp).connect(g).connect(dest);
  return g;
}

const RECIPES = {
  // Both kicks carry a mid-range knock and a click as well as the low thump,
  // so they still read on a phone speaker that cannot reproduce 50 Hz.
  kick1(ctx, sh, d, t) {
    tone(ctx, d, t, { f0: 170, f1: 50, sweep: 0.035, level: 1, decay: 0.22 });
    tone(ctx, d, t, { type: 'triangle', f0: 260, f1: 110, sweep: 0.02, level: 0.5, decay: 0.05 });
    tone(ctx, d, t, { type: 'triangle', f0: 900, f1: 150, sweep: 0.006, level: 0.4, decay: 0.012 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 2200, level: 0.3, decay: 0.006 });
  },
  kick2(ctx, sh, d, t) {
    tone(ctx, d, t, { f0: 250, f1: 62, sweep: 0.02, level: 1, decay: 0.1 });
    tone(ctx, d, t, { type: 'triangle', f0: 320, f1: 130, sweep: 0.025, level: 0.55, decay: 0.06 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 3000, level: 0.4, decay: 0.005 });
  },
  snare1(ctx, sh, d, t) {
    tone(ctx, d, t, { f0: 250, f1: 185, sweep: 0.02, level: 0.7, decay: 0.05 });
    tone(ctx, d, t, { f0: 420, f1: 330, sweep: 0.02, level: 0.35, decay: 0.035 });
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 4500, q: 0.6, level: 0.9, decay: 0.085, type2: 'highpass', freq2: 1200 });
  },
  snare2(ctx, sh, d, t) {
    tone(ctx, d, t, { type: 'triangle', f0: 330, f1: 180, sweep: 0.012, level: 0.8, decay: 0.045 });
    tone(ctx, d, t, { f0: 476, f1: 238, sweep: 0.012, level: 0.4, decay: 0.03 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 2200, level: 0.8, decay: 0.06, offset: 0.4 });
  },
  snare3(ctx, sh, d, t) {
    tone(ctx, d, t, { f0: 200, f1: 160, sweep: 0.03, level: 0.5, decay: 0.06 });
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 2400, q: 0.5, level: 0.9, decay: 0.11, attack: 0.006, offset: 0.9, type2: 'lowpass', freq2: 5200 });
  },
  hat1(ctx, sh, d, t) {
    metal(ctx, d, t, { band: 10000, high: 7500, level: 1, decay: 0.022 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 9000, level: 0.5, decay: 0.015, offset: 0.2 });
  },
  hat2(ctx, sh, d, t) {
    metal(ctx, d, t, { band: 8200, high: 6000, level: 1, decay: 0.04, attack: 0.002 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 7000, level: 0.5, decay: 0.03, offset: 0.6 });
  },
  hat3(ctx, sh, d, t) {
    metal(ctx, d, t, { ratio: 0.82, band: 6500, q: 1.2, high: 4500, level: 1, decay: 0.016 });
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 5000, q: 1, level: 0.5, decay: 0.012, offset: 1.1 });
  },
  ohat(ctx, sh, d, t) {
    metal(ctx, d, t, { band: 9500, high: 7000, level: 1, decay: 0.2 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 8000, level: 0.45, decay: 0.16, offset: 0.3 });
  },
  clap(ctx, sh, d, t) {
    [0, 0.011, 0.023].forEach((dt, i) => {
      noise(ctx, sh, d, t + dt, { type: 'bandpass', freq: 1300, q: 1.4, level: 0.8, decay: 0.006, offset: 0.2 * i });
    });
    noise(ctx, sh, d, t + 0.033, { type: 'bandpass', freq: 1200, q: 1.1, level: 1, decay: 0.09, offset: 0.7, type2: 'highpass', freq2: 600 });
  },
  ride(ctx, sh, d, t) {
    metal(ctx, d, t, { ratio: 1.35, band: 6500, q: 0.6, high: 4000, level: 0.8, decay: 0.5 });
    tone(ctx, d, t, { f0: 5200, level: 0.12, decay: 0.25 });
    tone(ctx, d, t, { f0: 3520, level: 0.1, decay: 0.35 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 9000, level: 0.2, decay: 0.03 });
  },
  crash(ctx, sh, d, t) {
    metal(ctx, d, t, { ratio: 1.1, band: 7000, q: 0.4, high: 3500, level: 0.8, decay: 0.5 });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 4500, level: 0.8, decay: 0.55, attack: 0.002, offset: 0.5 });
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 3000, q: 0.5, level: 0.5, decay: 0.12, offset: 1.2 });
  },
  shake1(ctx, sh, d, t) {
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 6500, q: 1.2, level: 1, decay: 0.03, attack: 0.012, offset: 0.1 });
  },
  shake2(ctx, sh, d, t) {
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 9000, q: 1.5, level: 0.7, decay: 0.018, attack: 0.008, offset: 0.8 });
    noise(ctx, sh, d, t + 0.055, { type: 'bandpass', freq: 8000, q: 1.5, level: 1, decay: 0.035, attack: 0.01, offset: 1.3 });
  },
  tamb(ctx, sh, d, t) {
    [0, 0.02, 0.045].forEach((dt, i) => {
      metal(ctx, d, t + dt, { ratio: 2.3, band: 11000, q: 1, high: 8000, level: 0.6 + 0.2 * i, decay: 0.03 + 0.03 * i });
    });
    noise(ctx, sh, d, t, { type: 'highpass', freq: 9500, level: 0.4, decay: 0.09, attack: 0.004, offset: 0.25 });
  },
  rim(ctx, sh, d, t) {
    tone(ctx, d, t, { type: 'triangle', f0: 1750, level: 0.6, decay: 0.008 });
    tone(ctx, d, t, { f0: 480, level: 0.7, decay: 0.015 });
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 2600, q: 2, level: 0.5, decay: 0.006 });
  },
  bell(ctx, sh, d, t) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 880;
    bp.Q.value = 1.5;
    bp.connect(d);
    tone(ctx, bp, t, { type: 'square', f0: 562, level: 0.5, decay: 0.09 });
    tone(ctx, bp, t, { type: 'square', f0: 845, level: 0.5, decay: 0.07 });
  },
  pop(ctx, sh, d, t) {
    // a rising chirp, like a bubble letting go
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.045, 0.012);
    o.connect(g).connect(d);
    o.start(t);
    o.stop(t + 0.2);
  },
};

function tomRecipe(freq, decay) {
  return (ctx, sh, d, t) => {
    tone(ctx, d, t, { f0: freq * 1.9, f1: freq, sweep: 0.04, level: 1, decay });
    tone(ctx, d, t, { type: 'triangle', f0: freq * 2.6, f1: freq * 1.5, sweep: 0.03, level: 0.25, decay: decay * 0.4 });
    noise(ctx, sh, d, t, { type: 'bandpass', freq: freq * 6, q: 1, level: 0.25, decay: 0.012 });
  };
}
[['tom1', 78, 0.2], ['tom2', 104, 0.18], ['tom3', 138, 0.16], ['tom4', 184, 0.14], ['tom5', 245, 0.12]]
  .forEach(([id, f, dec]) => { RECIPES[id] = tomRecipe(f, dec); });

// Tuned toys follow the song's key so they never clash.
function rainRecipe(key) {
  // steel tongue drum, rooted on the key note nearest middle C
  const f = midiToFreq(55 + ((key - 55) % 12 + 12) % 12);
  return (ctx, sh, d, t) => {
    tone(ctx, d, t, { f0: f, level: 1, decay: 0.55, attack: 0.003 });
    tone(ctx, d, t, { f0: f * 2.0, level: 0.3, decay: 0.3, attack: 0.003 });
    tone(ctx, d, t, { f0: f * 2.76, level: 0.22, decay: 0.12, attack: 0.002 });
    tone(ctx, d, t, { f0: f * 5.4, level: 0.1, decay: 0.05, attack: 0.002 });
    noise(ctx, sh, d, t, { type: 'bandpass', freq: 1500, q: 1, level: 0.12, decay: 0.008 });
  };
}
function chimeRecipe(key) {
  const root = 84 + key;
  return (ctx, sh, d, t) => {
    [0, 7, 12, 16, 19, 24].forEach((semi, i) => {
      tone(ctx, d, t + i * 0.045, { f0: midiToFreq(root + semi), level: 0.6 - i * 0.05, decay: 0.3, attack: 0.002 });
      tone(ctx, d, t + i * 0.045, { f0: midiToFreq(root + semi) * 2.76, level: 0.12, decay: 0.08, attack: 0.002 });
    });
  };
}

// ---------- rendering the kit ----------

async function renderPad(pad, recipe, sampleRate) {
  const ctx = new OfflineAudioContext(2, Math.ceil(pad.len * sampleRate), sampleRate);
  const sh = makeShared(ctx);
  const pan = ctx.createStereoPanner();
  pan.pan.value = pad.pan || 0;
  pan.connect(ctx.destination);
  recipe(ctx, sh, pan, 0.001);
  const buf = await ctx.startRendering();
  // normalise to the pad's intended peak and fade the last few ms
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  const k = peak > 0 ? pad.peak / peak : 1;
  const fade = Math.floor(sampleRate * 0.01);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const tail = d.length - i;
      d[i] *= k * (tail < fade ? tail / fade : 1);
    }
  }
  return buf;
}

const cache = new Map();

// Promises are cached, not results, so two callers asking at the same moment
// share one render instead of one of them seeing a half-built kit.
function once(key, make) {
  if (!cache.has(key)) {
    const p = make();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

// Returns { sampleRate, key, buffers: AudioBuffer[25] }.
export async function getKit(sampleRate, key) {
  const base = once(`${sampleRate}`, async () => {
    const out = {};
    for (const pad of DRUM_PADS) {
      if (!pad.tuned) out[pad.id] = await renderPad(pad, RECIPES[pad.id], sampleRate);
    }
    return out;
  });
  const tuned = once(`${sampleRate}:${key}`, async () => {
    const byId = Object.fromEntries(DRUM_PADS.map((p) => [p.id, p]));
    return {
      rain: await renderPad(byId.rain, rainRecipe(key), sampleRate),
      chime: await renderPad(byId.chime, chimeRecipe(key), sampleRate),
    };
  });
  const [b, t] = await Promise.all([base, tuned]);
  return { sampleRate, key, buffers: DRUM_PADS.map((p) => b[p.id] || t[p.id]) };
}

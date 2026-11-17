// The drum kits: seven soda flavours, sixteen pads each, all synthesised
// from scratch in the style of classic drum machines (no samples). Each
// pad is rendered once into a buffer, so playing it costs almost nothing.
//
// Pads are listed bottom row first, the way the grid is drawn: kicks and
// snares under the thumbs, hats and percussion above, cymbals and toys on top.

// ---------- building blocks (all draw into `out` starting at time 0) ----------

const noiseCache = new WeakMap();
function noise(ctx) {
  if (!noiseCache.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    let s = 1234567;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
    noiseCache.set(ctx, b);
  }
  const src = ctx.createBufferSource(); src.buffer = noiseCache.get(ctx); src.loop = true;
  return src;
}
const filt = (ctx, type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
// a gain that jumps up, then decays with time constant `tau`
function envGain(ctx, peak, tau, attack = 0.001, delay = 0) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, delay);
  g.gain.linearRampToValueAtTime(peak, delay + attack);
  g.gain.setTargetAtTime(0, delay + attack, tau);
  return g;
}
function shaper(ctx, k) {
  const w = ctx.createWaveShaper(), n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  w.curve = c; w.oversample = '2x';
  return w;
}
const osc = (ctx, type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
const END = 4;  // every source stops by then; buffers are trimmed afterwards

// a pitched body that falls from f0 to f1 (kicks, toms, 808 subs)
function body(ctx, out, { f0, f1, pd = 0.04, d = 0.3, lvl = 1, type = 'sine', attack = 0.0015 }) {
  const o = osc(ctx, type, f0);
  o.frequency.setValueAtTime(f0, 0);
  o.frequency.setTargetAtTime(f1, 0.001, pd);
  const g = envGain(ctx, lvl, d, attack);
  o.connect(g).connect(out); o.start(0); o.stop(END);
}
// a burst of filtered noise
function hiss(ctx, out, { type = 'highpass', f = 6000, q = 0.7, d = 0.05, lvl = 1, attack = 0.001, delay = 0, f2 }) {
  const n = noise(ctx), b = filt(ctx, type, f, q), g = envGain(ctx, lvl, d, attack, delay);
  let node = n.connect(b);
  if (f2) node = node.connect(filt(ctx, 'lowpass', f2));
  node.connect(g).connect(out); n.start(delay); n.stop(END);
}
// six detuned squares: the classic metallic recipe for hats and cymbals
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(ctx, out, { ratio = 1, band = 9000, q = 0.8, high = 6500, d = 0.05, lvl = 1 }) {
  const mix = ctx.createGain(); mix.gain.value = 0.25;
  for (const f of METAL) { const o = osc(ctx, 'square', f * ratio); o.connect(mix); o.start(0); o.stop(END); }
  const g = envGain(ctx, lvl, d);
  mix.connect(filt(ctx, 'bandpass', band, q)).connect(filt(ctx, 'highpass', high)).connect(g).connect(out);
}
function click(ctx, out, lvl = 0.5, f = 3000) { hiss(ctx, out, { type: 'highpass', f, d: 0.004, lvl }); }

// ---------- instruments ----------

const I = {
  kick(ctx, out, p) {
    const { f0 = 160, f1 = 48, pd = 0.035, d = 0.35, clk = 0.35, knock = 0, drive = 0 } = p;
    let dest = out;
    if (drive) { const s = shaper(ctx, 1 + drive * 4), g = ctx.createGain(); g.gain.value = 1 / (1 + drive * 0.6); s.connect(g).connect(out); dest = s; }
    body(ctx, dest, { f0, f1, pd, d });
    if (knock) body(ctx, dest, { f0: f1 * 4, f1: f1 * 2.4, pd: 0.01, d: 0.025, lvl: knock, type: 'triangle' });
    if (clk) click(ctx, dest, clk, 2500);
  },
  // the long tuned 808 sub, with a little glide and drive
  sub(ctx, out, { f = 49, glide = 1.25, d = 0.7, drive = 0.6, pd = 0.06 }) {
    const s = shaper(ctx, 1 + drive * 3), g = ctx.createGain(); g.gain.value = 0.85;
    s.connect(g).connect(out);
    body(ctx, s, { f0: f * glide, f1: f, pd, d, attack: 0.003 });
    click(ctx, s, 0.15, 1500);
  },
  snare(ctx, out, p) {
    const { t1 = 185, t2 = 330, td = 0.06, nd = 0.09, band = 5000, nf = 'highpass', mix = 0.6, drive = 0 } = p;
    let dest = out;
    if (drive) { const s = shaper(ctx, 1 + drive * 4); s.connect(out); dest = s; }
    body(ctx, dest, { f0: t1 * 1.3, f1: t1, pd: 0.02, d: td, lvl: 1 - mix * 0.5, type: 'triangle' });
    if (t2) body(ctx, dest, { f0: t2 * 1.2, f1: t2, pd: 0.02, d: td * 0.7, lvl: (1 - mix) * 0.6, type: 'sine' });
    hiss(ctx, dest, { type: nf, f: band, d: nd, lvl: mix * 1.2, q: nf === 'bandpass' ? 0.8 : 0.7 });
  },
  clap(ctx, out, { bursts = 3, gap = 0.011, d = 0.16, band = 1200, q = 1.3, tail = 1 }) {
    for (let i = 0; i < bursts; i++) hiss(ctx, out, { type: 'bandpass', f: band, q, d: 0.008, lvl: 0.9, delay: i * gap });
    hiss(ctx, out, { type: 'bandpass', f: band, q, d: d * tail, lvl: 0.8, delay: bursts * gap });
  },
  hat(ctx, out, { d = 0.04, band = 9000, high = 7000, ratio = 1, hiss: nz = 0.35 }) {
    metal(ctx, out, { ratio, band, high, d, lvl: 1 });
    if (nz) hiss(ctx, out, { type: 'highpass', f: high + 1000, d: d * 0.9, lvl: nz });
  },
  cym(ctx, out, { d = 0.9, band = 7500, high = 5000, ratio = 1.1, hiss: nz = 0.5 }) {
    metal(ctx, out, { ratio, band, high, d, lvl: 0.9, q: 0.5 });
    hiss(ctx, out, { type: 'highpass', f: high, d: d * 0.8, lvl: nz });
  },
  tom(ctx, out, { f = 110, drop = 0.35, d = 0.22, nz = 0.12, type = 'sine' }) {
    body(ctx, out, { f0: f * (1 + drop), f1: f, pd: 0.06, d, type });
    if (nz) hiss(ctx, out, { type: 'bandpass', f: f * 6, q: 1, d: 0.03, lvl: nz });
  },
  bell(ctx, out, { f1 = 540, f2 = 800, d = 0.12 }) {
    const mix = ctx.createGain(); mix.gain.value = 0.4;
    for (const f of [f1, f2]) { const o = osc(ctx, 'square', f); o.connect(mix); o.start(0); o.stop(END); }
    const g = envGain(ctx, 1, d);
    mix.connect(filt(ctx, 'bandpass', 1800, 1.2)).connect(g).connect(out);
  },
  rim(ctx, out, { f = 1700, d = 0.012 }) {
    body(ctx, out, { f0: f, f1: f, d, type: 'sine' });
    body(ctx, out, { f0: f * 0.27, f1: f * 0.27, d: d * 1.5, lvl: 0.6, type: 'triangle' });
    click(ctx, out, 0.5, 4000);
  },
  clave(ctx, out, { f = 2500, d = 0.03 }) { body(ctx, out, { f0: f, f1: f, d, type: 'sine' }); },
  shaker(ctx, out, { d = 0.05, band = 7000, attack = 0.012 }) { hiss(ctx, out, { type: 'bandpass', f: band, q: 1, d, attack }); },
  tamb(ctx, out, { d = 0.12 }) {
    metal(ctx, out, { ratio: 2.3, band: 10000, high: 7500, d, lvl: 0.7 });
    for (let i = 0; i < 3; i++) hiss(ctx, out, { type: 'highpass', f: 8000, d: 0.02, lvl: 0.5, delay: i * 0.016 });
  },
  conga(ctx, out, { f = 330, d = 0.12 }) { body(ctx, out, { f0: f * 1.15, f1: f, pd: 0.015, d }); click(ctx, out, 0.2, 2000); },
  zap(ctx, out, { from = 2400, to = 90, pd = 0.04, d = 0.12, type = 'square' }) {
    const o = osc(ctx, type, from); o.frequency.setTargetAtTime(to, 0, pd);
    const g = envGain(ctx, 0.5, d);
    o.connect(filt(ctx, 'lowpass', 5000)).connect(g).connect(out); o.start(0); o.stop(END);
  },
  // the snare that sounds bigger than the room: a long noisy tail cut short
  gated(ctx, out, { t1 = 200, gate = 0.22 }) {
    body(ctx, out, { f0: t1 * 1.3, f1: t1, pd: 0.02, d: 0.06, lvl: 0.6, type: 'triangle' });
    const n = noise(ctx), g = ctx.createGain();
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.9, 0.002);
    g.gain.setTargetAtTime(0.45, 0.01, 0.05); g.gain.setValueAtTime(0.4, gate); g.gain.linearRampToValueAtTime(0, gate + 0.015);
    n.connect(filt(ctx, 'bandpass', 2500, 0.5)).connect(g).connect(out); n.start(0); n.stop(END);
  },
  // the 80s orchestra hit: a big stacked chord with a bright attack that darkens fast
  stab(ctx, out, { f = 262, d = 0.16 }) {
    const lp = filt(ctx, 'lowpass', 6000, 1.2);
    lp.frequency.setValueAtTime(7000, 0); lp.frequency.setTargetAtTime(1300, 0.01, 0.09);
    const g = envGain(ctx, 0.9, d, 0.004);
    for (const [m, lvl] of [[0.5, 0.5], [1, 0.6], [1.5, 0.45], [2, 0.4], [2.52, 0.3], [3, 0.2]]) {
      for (const det of [-6, 7]) { const o = osc(ctx, 'sawtooth', f * m); o.detune.value = det; const og = ctx.createGain(); og.gain.value = lvl * 0.18; o.connect(og).connect(lp); o.start(0); o.stop(END); }
    }
    lp.connect(g).connect(out);
    hiss(ctx, out, { type: 'bandpass', f: 2500, q: 0.8, d: 0.02, lvl: 0.5 });
  },
  vinyl(ctx, out, { d = 0.25 }) {
    // a crackle hit: a few random pops over a soft hiss
    for (let i = 0; i < 7; i++) hiss(ctx, out, { type: 'bandpass', f: 2000 + i * 900, q: 2, d: 0.003, lvl: 0.8, delay: i * 0.031 + (i % 3) * 0.007 });
    hiss(ctx, out, { type: 'bandpass', f: 1200, q: 0.5, d, lvl: 0.15 });
  },
  scratch(ctx, out, { d = 0.18 }) {
    // a "wicka": a band of noise swept down and back up
    const n = noise(ctx), b = filt(ctx, 'bandpass', 1800, 4), g = envGain(ctx, 0.9, d, 0.01);
    b.frequency.setValueAtTime(2600, 0); b.frequency.linearRampToValueAtTime(700, 0.08); b.frequency.linearRampToValueAtTime(2000, 0.16);
    n.connect(b).connect(g).connect(out); n.start(0); n.stop(END);
  },

  // ---------- soda sounds ----------
  crack(ctx, out) {                          // a can opening: tick, then pssht
    click(ctx, out, 0.9, 2500);
    hiss(ctx, out, { type: 'bandpass', f: 3500, q: 0.6, d: 0.16, lvl: 0.7, attack: 0.008, delay: 0.012 });
  },
  pop(ctx, out, { f = 900 }) {                // a bottle cap popping off
    body(ctx, out, { f0: f * 1.6, f1: f * 0.5, pd: 0.012, d: 0.03, type: 'sine' });
    click(ctx, out, 0.6, 1500);
  },
  fizz(ctx, out, { d = 0.08, density = 14 }) { // tiny bubbles bursting
    for (let i = 0; i < density; i++) {
      const t = (i / density) * d * 4 * ((i * 7919) % 13) / 13;
      hiss(ctx, out, { type: 'bandpass', f: 4000 + ((i * 3571) % 7) * 900, q: 3, d: 0.004, lvl: 0.7, delay: t });
    }
    hiss(ctx, out, { type: 'highpass', f: 6000, d, lvl: 0.25, attack: 0.01 });
  },
  clink(ctx, out, { f = 1900, d = 0.2 }) {    // a glass bottle tapped
    [[1, 1], [2.76, 0.5], [5.4, 0.25]].forEach(([m, l]) => body(ctx, out, { f0: f * m, f1: f * m, d: d / m ** 0.5, lvl: l * 0.5, type: 'sine' }));
  },
  blow(ctx, out, { f = 220, d = 0.35 }) {     // blowing across a bottle
    body(ctx, out, { f0: f * 0.97, f1: f, pd: 0.05, d, lvl: 0.8, attack: 0.03 });
    hiss(ctx, out, { type: 'bandpass', f: f * 3, q: 2, d: d * 0.6, lvl: 0.25, attack: 0.03 });
  },
  thunk(ctx, out) {                           // a full can set down
    body(ctx, out, { f0: 210, f1: 95, pd: 0.02, d: 0.09 });
    body(ctx, out, { f0: 900, f1: 620, pd: 0.01, d: 0.03, lvl: 0.35, type: 'triangle' });
  },
  ice(ctx, out) {                             // ice cubes rattling
    [0, 0.035, 0.06, 0.1].forEach((t, i) => {
      const f = [2400, 3100, 2700, 3500][i];
      const o = osc(ctx, 'sine', f), g = envGain(ctx, 0.4, 0.012, 0.001, t);
      o.connect(g).connect(out); o.start(t); o.stop(END);
    });
  },
  pour(ctx, out) {                            // a long fizzy pour, rising
    const n = noise(ctx), b = filt(ctx, 'bandpass', 900, 1.5), g = ctx.createGain();
    b.frequency.setValueAtTime(700, 0); b.frequency.exponentialRampToValueAtTime(2600, 1.2);
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.6, 0.15); g.gain.setTargetAtTime(0, 1.0, 0.25);
    n.connect(b).connect(g).connect(out); n.start(0); n.stop(END);
    I.fizz(ctx, out, { d: 0.35, density: 26 });
  },
  bloop(ctx, out) {                           // one big bubble rising
    const o = osc(ctx, 'sine', 300); o.frequency.setValueAtTime(300, 0); o.frequency.exponentialRampToValueAtTime(1100, 0.09);
    const g = envGain(ctx, 0.8, 0.04, 0.004); o.connect(g).connect(out); o.start(0); o.stop(END);
  },
};

// ---------- the flavours ----------
// pad: [name, instrument, params, gm note, peak, seconds]
// GM drum notes, so exported MIDI lands on the right drums in Logic.
const GM = { kick: 36, kick2: 35, snare: 38, clap: 39, chh: 42, ohh: 46, rim: 37, perc: 56, tomL: 45, tomM: 47, tomH: 50, perc2: 63, crash: 49, perc3: 70, fx1: 76, fx2: 77 };
const SLOTS = ['kick', 'kick2', 'snare', 'clap', 'chh', 'ohh', 'rim', 'perc', 'tomL', 'tomM', 'tomH', 'perc2', 'crash', 'perc3', 'fx1', 'fx2'];

export const KITS = {
  cola: {
    name: 'Cola', style: '808-style', hue: 18, color: ['#3a160c', '#8b3a1c', '#d9893f'],
    pads: [
      ['Boom', 'kick', { f0: 130, f1: 47, pd: 0.05, d: 0.55, clk: 0.15 }, 0.95, 2],
      ['Sub', 'sub', { f: 44, d: 0.8 }, 0.9, 2.6],
      ['Snap', 'snare', { t1: 180, t2: 330, td: 0.05, nd: 0.08, band: 6000, mix: 0.55 }, 0.8, 0.5],
      ['Clap', 'clap', { band: 1100, d: 0.18 }, 0.8, 0.6],
      ['Tick', 'hat', { d: 0.03 }, 0.55, 0.3],
      ['Tsss', 'hat', { d: 0.22 }, 0.5, 1.2],
      ['Rim', 'rim', {}, 0.6, 0.2],
      ['Cowbell', 'bell', { d: 0.14 }, 0.55, 0.6],
      ['Tom L', 'tom', { f: 85, d: 0.28 }, 0.8, 1.2],
      ['Tom M', 'tom', { f: 125, d: 0.24 }, 0.8, 1],
      ['Tom H', 'tom', { f: 175, d: 0.2 }, 0.8, 0.9],
      ['Conga', 'conga', { f: 330 }, 0.7, 0.6],
      ['Crash', 'cym', { d: 0.8 }, 0.55, 3],
      ['Maraca', 'shaker', { d: 0.03, band: 9000, attack: 0.004 }, 0.5, 0.3],
      ['Clave', 'clave', {}, 0.6, 0.3],
      ['Zap', 'zap', { from: 1800, to: 120 }, 0.6, 0.6],
    ],
  },
  lime: {
    name: 'Lime', style: '909-style', hue: 95, color: ['#123010', '#3f7a1d', '#b8e05a'],
    pads: [
      ['Punch', 'kick', { f0: 280, f1: 54, pd: 0.022, d: 0.28, clk: 0.6, knock: 0.25, drive: 0.4 }, 0.95, 1.2],
      ['Stomp', 'kick', { f0: 320, f1: 50, pd: 0.018, d: 0.2, clk: 0.8, knock: 0.4, drive: 1 }, 0.95, 1],
      ['Snare', 'snare', { t1: 190, t2: 280, td: 0.05, nd: 0.14, band: 4500, mix: 0.7 }, 0.85, 0.7],
      ['Clap', 'clap', { band: 1300, d: 0.25, bursts: 4, gap: 0.009 }, 0.8, 0.8],
      ['Tss', 'hat', { d: 0.035, band: 10500, high: 8000, hiss: 0.6 }, 0.55, 0.3],
      ['Tsshh', 'hat', { d: 0.26, band: 10500, high: 8000, hiss: 0.6 }, 0.5, 1.4],
      ['Rim', 'rim', { f: 1900 }, 0.6, 0.2],
      ['Ride', 'cym', { d: 0.5, band: 10000, high: 7000, ratio: 1.6, hiss: 0.2 }, 0.45, 2.2],
      ['Tom L', 'tom', { f: 95, drop: 0.6, d: 0.2 }, 0.8, 1],
      ['Tom M', 'tom', { f: 140, drop: 0.6, d: 0.18 }, 0.8, 0.9],
      ['Tom H', 'tom', { f: 200, drop: 0.6, d: 0.16 }, 0.8, 0.8],
      ['Shaker', 'shaker', { d: 0.05 }, 0.5, 0.4],
      ['Crash', 'cym', { d: 1.0, band: 8500 }, 0.55, 3.2],
      ['Tamb', 'tamb', {}, 0.5, 0.6],
      ['Rumble', 'kick', { f0: 70, f1: 40, pd: 0.2, d: 0.6, clk: 0, drive: 1.5 }, 0.7, 2],
      ['Laser', 'zap', { from: 3200, to: 200, pd: 0.03, type: 'sawtooth' }, 0.5, 0.5],
    ],
  },
  cherry: {
    name: 'Cherry', style: '80s machine', hue: 350, color: ['#3a0714', '#9b1b3b', '#ff7b9c'],
    // the big gated room of 80s records, on the snare, clap and toms
    gate: { pads: [2, 3, 8, 9, 10], mix: 0.7, close: 0.26 },
    pads: [
      ['Kick', 'kick', { f0: 190, f1: 60, pd: 0.025, d: 0.15, clk: 0.55, knock: 0.55 }, 0.95, 0.8],
      ['Thud', 'kick', { f0: 150, f1: 66, pd: 0.03, d: 0.12, clk: 0.3, knock: 0.35 }, 0.9, 0.7],
      ['Gated', 'gated', {}, 0.85, 0.6],
      ['Clap', 'clap', { band: 1500, d: 0.14, bursts: 4 }, 0.8, 0.6],
      ['Chick', 'hat', { d: 0.022, band: 10500, high: 8000, ratio: 1.3, hiss: 0.3 }, 0.55, 0.3],
      ['Shhh', 'hat', { d: 0.2, band: 10500, high: 8000, ratio: 1.3, hiss: 0.3 }, 0.5, 1.2],
      ['Stick', 'rim', { f: 1500 }, 0.6, 0.2],
      ['Cowbell', 'bell', { f1: 587, f2: 845, d: 0.1 }, 0.55, 0.5],
      ['Pew L', 'tom', { f: 90, drop: 1.4, d: 0.3, type: 'triangle' }, 0.8, 1.2],
      ['Pew M', 'tom', { f: 130, drop: 1.4, d: 0.26, type: 'triangle' }, 0.8, 1.1],
      ['Pew H', 'tom', { f: 180, drop: 1.4, d: 0.22, type: 'triangle' }, 0.8, 1],
      ['Cabasa', 'shaker', { d: 0.07, band: 6000 }, 0.5, 0.4],
      ['Crash', 'cym', { d: 0.9, band: 7000 }, 0.55, 3],
      ['Tamb', 'tamb', { d: 0.1 }, 0.5, 0.5],
      ['Conga', 'conga', { f: 280, d: 0.15 }, 0.7, 0.6],
      ['Stab', 'stab', { f: 262 }, 0.7, 0.8],
    ],
  },
  grape: {
    name: 'Grape', style: 'lo-fi', hue: 275, color: ['#1d0d33', '#4e2a7a', '#b993ea'], dust: { lp: 5200, bits: 10, drive: 0.5, crackle: 0.04 },
    pads: [
      ['Bump', 'kick', { f0: 120, f1: 50, pd: 0.03, d: 0.25, clk: 0.15, knock: 0.2 }, 0.95, 1],
      ['Thump', 'kick', { f0: 100, f1: 46, pd: 0.04, d: 0.3, clk: 0.05 }, 0.9, 1.2],
      ['Dust', 'snare', { t1: 200, t2: 0, td: 0.05, nd: 0.1, band: 2400, nf: 'bandpass', mix: 0.75 }, 0.8, 0.6],
      ['Snap', 'clap', { band: 1800, d: 0.08, bursts: 2 }, 0.7, 0.4],
      ['Tik', 'hat', { d: 0.025, band: 7000, high: 5000, hiss: 0.3 }, 0.45, 0.3],
      ['Tss', 'hat', { d: 0.14, band: 7000, high: 5000, hiss: 0.3 }, 0.4, 0.9],
      ['Rim', 'rim', { f: 1300 }, 0.6, 0.2],
      ['Crackle', 'vinyl', {}, 0.5, 0.5],
      ['Tom L', 'tom', { f: 100, d: 0.18, nz: 0.05 }, 0.75, 0.8],
      ['Tom H', 'tom', { f: 150, d: 0.15, nz: 0.05 }, 0.75, 0.7],
      ['Knock', 'conga', { f: 240, d: 0.06 }, 0.7, 0.4],
      ['Shaker', 'shaker', { d: 0.06, band: 5000 }, 0.45, 0.4],
      ['Wash', 'cym', { d: 0.7, band: 6000, high: 4000 }, 0.4, 2.5],
      ['Brush', 'shaker', { d: 0.12, band: 3500, attack: 0.03 }, 0.45, 0.6],
      ['Bell', 'clink', { f: 1300, d: 0.3 }, 0.45, 1],
      ['Dream', 'blow', { f: 330, d: 0.4 }, 0.5, 1.4],
    ],
  },
  rootbeer: {
    // an old 12-bit sampler: a lower sample rate (its grit and alias), saturation, a little vinyl
    name: 'Root Beer', style: 'boom-bap', hue: 30, color: ['#2a1405', '#6b3a12', '#e0a35a'], dust: { lp: 11000, bits: 12, drive: 1, crackle: 0.03, hold: 2 },
    pads: [
      ['Boom', 'kick', { f0: 160, f1: 48, pd: 0.035, d: 0.24, clk: 0.4, knock: 0.8, drive: 1 }, 0.95, 0.9],
      ['Bap', 'kick', { f0: 130, f1: 55, pd: 0.025, d: 0.16, clk: 0.5, knock: 0.9, drive: 1.2 }, 0.9, 0.7],
      ['Crack', 'snare', { t1: 185, t2: 290, td: 0.08, nd: 0.17, band: 2600, nf: 'bandpass', mix: 0.78, drive: 1.1 }, 0.85, 0.8],
      ['Clap', 'clap', { band: 1300, d: 0.12 }, 0.75, 0.5],
      ['Tss', 'hat', { d: 0.03, band: 9000, hiss: 0.5 }, 0.55, 0.3],
      ['Tsss', 'hat', { d: 0.16, band: 9000, hiss: 0.5 }, 0.5, 1],
      ['Rim', 'rim', { f: 1500 }, 0.6, 0.2],
      ['Wicka', 'scratch', {}, 0.6, 0.4],
      ['Tom L', 'tom', { f: 95, d: 0.2 }, 0.75, 0.9],
      ['Tom H', 'tom', { f: 140, d: 0.17 }, 0.75, 0.8],
      ['Tamb', 'tamb', {}, 0.5, 0.6],
      ['Shaker', 'shaker', { d: 0.05 }, 0.45, 0.4],
      ['Crash', 'cym', { d: 0.8, band: 7000 }, 0.5, 2.8],
      ['Ride', 'cym', { d: 0.45, band: 9500, ratio: 1.6, hiss: 0.2 }, 0.4, 2],
      ['Snap', 'clap', { band: 2400, d: 0.05, bursts: 1 }, 0.6, 0.3],
      ['Horn', 'zap', { from: 420, to: 400, pd: 0.3, d: 0.25, type: 'sawtooth' }, 0.4, 0.8],
    ],
  },
  orange: {
    name: 'Orange', style: 'trap', hue: 28, color: ['#3a1500', '#b4520c', '#ffb052'],
    pads: [
      ['808', 'sub', { f: 46, glide: 2.2, pd: 0.14, d: 1.2, drive: 1.3 }, 0.95, 3.2],
      ['808 Hi', 'sub', { f: 69, glide: 1.9, pd: 0.12, d: 0.9, drive: 1.3 }, 0.9, 2.6],
      ['Snare', 'snare', { t1: 240, t2: 360, td: 0.03, nd: 0.07, band: 6500, mix: 0.75 }, 0.85, 0.4],
      ['Clap', 'clap', { band: 1400, d: 0.2, bursts: 4, gap: 0.008 }, 0.85, 0.7],
      ['Ts', 'hat', { d: 0.012, band: 12500, high: 9800, ratio: 1.15, hiss: 0.55 }, 0.5, 0.15],
      ['Tsh', 'hat', { d: 0.08, band: 12500, high: 9800, ratio: 1.15, hiss: 0.55 }, 0.45, 0.7],
      ['Rim', 'rim', { f: 2000 }, 0.6, 0.2],
      ['Pluck', 'clink', { f: 1046, d: 0.08 }, 0.5, 0.4],
      ['Tom L', 'tom', { f: 110, drop: 0.8, d: 0.2 }, 0.75, 0.9],
      ['Tom H', 'tom', { f: 165, drop: 0.8, d: 0.18 }, 0.75, 0.8],
      ['Perc', 'conga', { f: 420, d: 0.07 }, 0.6, 0.4],
      ['Snap', 'clap', { band: 2600, d: 0.04, bursts: 1 }, 0.6, 0.3],
      ['Crash', 'cym', { d: 0.9 }, 0.5, 3],
      ['Kick', 'kick', { f0: 220, f1: 55, pd: 0.02, d: 0.15, clk: 0.6, knock: 0.3, drive: 0.5 }, 0.9, 0.7],
      ['Riser', 'zap', { from: 200, to: 2400, pd: 0.35, d: 0.4, type: 'sawtooth' }, 0.35, 1.2],
      ['Laser', 'zap', { from: 3000, to: 150, pd: 0.03, type: 'square' }, 0.45, 0.5],
    ],
  },
  cream: {
    name: 'Cream Soda', style: 'soda toy kit', hue: 45, color: ['#3a2a10', '#a07a3a', '#ffe7a8'],
    pads: [
      ['Thunk', 'thunk', {}, 0.95, 0.6],
      ['Blow', 'blow', { f: 98, d: 0.4 }, 0.85, 1.4],
      ['Pssht', 'crack', {}, 0.85, 0.7],
      ['Fizz', 'fizz', { d: 0.06, density: 10 }, 0.75, 0.5],
      ['Tink', 'clink', { f: 2600, d: 0.06 }, 0.5, 0.3],
      ['Fizzz', 'fizz', { d: 0.25, density: 22 }, 0.6, 1.2],
      ['Cap', 'rim', { f: 2300, d: 0.008 }, 0.55, 0.15],
      ['Clink', 'clink', { f: 1900, d: 0.25 }, 0.55, 1],
      ['Bottle L', 'blow', { f: 196 }, 0.75, 1.2],
      ['Bottle M', 'blow', { f: 262 }, 0.75, 1.2],
      ['Bottle H', 'blow', { f: 330 }, 0.75, 1.2],
      ['Ice', 'ice', {}, 0.5, 0.4],
      ['Pour', 'pour', {}, 0.55, 2],
      ['Rattle', 'shaker', { d: 0.06, band: 4000 }, 0.45, 0.4],
      ['Pop', 'pop', {}, 0.7, 0.4],
      ['Bloop', 'bloop', {}, 0.7, 0.4],
    ],
  },
};
export const KIT_ORDER = ['cola', 'lime', 'cherry', 'grape', 'rootbeer', 'orange', 'cream'];
for (const k of Object.values(KITS)) k.pads = k.pads.map(([name, inst, params, peak, len], i) => ({ name, inst, params, peak, len, gm: GM[SLOTS[i]], slot: SLOTS[i] }));

// ---------- rendering ----------

// Render one pad into a stereo buffer at sample rate `sr`.
async function renderPad(kit, pad, sr, idx) {
  const n = Math.ceil(pad.len * sr), ctx = new OfflineAudioContext(1, n, sr);
  let dest = ctx.destination;
  // the dusty flavours go through a little tape-and-sampler colour
  if (kit.dust) {
    const { lp, bits, drive } = kit.dust;
    const crush = ctx.createWaveShaper(), steps = 2 ** (bits - 1), c = new Float32Array(4096);
    for (let i = 0; i < c.length; i++) { const x = i / (c.length - 1) * 2 - 1; c[i] = Math.round(x * steps) / steps; }
    crush.curve = c;
    const sh = shaper(ctx, 1 + drive * 2), low = filt(ctx, 'lowpass', lp, 0.5);
    sh.connect(crush).connect(low).connect(ctx.destination);
    dest = sh;
  }
  const out = ctx.createGain(); out.connect(dest);
  if (kit.gate && kit.gate.pads.includes(idx)) {
    // a bright room, slammed shut a moment later: the gated reverb
    const { mix, close } = kit.gate, ir = ctx.createBuffer(2, Math.floor(sr * 1.2), sr);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let seed = 11 + c * 31; for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 1073741823.5 - 1) * Math.exp(-i / sr * 2.2) * 0.06; } }
    const room = ctx.createConvolver(); room.normalize = false; room.buffer = ir;
    const gg = ctx.createGain(); gg.gain.setValueAtTime(mix, 0); gg.gain.setValueAtTime(mix, close); gg.gain.linearRampToValueAtTime(0, close + 0.025);
    out.connect(room).connect(gg).connect(dest);
  }
  I[pad.inst](ctx, out, pad.params || {});
  if (kit.dust && kit.dust.crackle) hiss(ctx, ctx.destination, { type: 'bandpass', f: 1500, q: 0.4, d: 0.15, lvl: kit.dust.crackle });
  const buf = await ctx.startRendering(), d = buf.getChannelData(0);
  // the old sampler's lower sample rate: hold each sample for a few (its alias is the grit)
  const hold = kit.dust && kit.dust.hold;
  if (hold > 1) for (let i = 0; i < d.length; i++) if (i % hold) d[i] = d[i - (i % hold)];
  // even out: every pad peaks at its set level, and fades cleanly to its end
  let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x));
  const g = peak > 0 ? pad.peak / peak : 0, fade = Math.min(d.length, Math.round(sr * 0.02));
  for (let i = 0; i < d.length; i++) d[i] *= g * (i > d.length - fade ? (d.length - i) / fade : 1);
  return buf;
}

const cache = new Map();
// all sixteen pads of a kit, rendered once per sample rate
export function renderKit(id, sr) {
  const key = `${id}@${sr}`;
  if (!cache.has(key)) cache.set(key, Promise.all(KITS[id].pads.map((p, i) => renderPad(KITS[id], p, sr, i))));
  return cache.get(key);
}

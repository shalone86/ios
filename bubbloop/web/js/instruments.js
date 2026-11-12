// Synthesised melodic instruments. Everything is built from Web Audio nodes
// against whichever context it is handed, so the same code plays live and
// renders offline for export.

import { midiToFreq } from './theory.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- shared, per-context resources ----------

function seededNoise(n, seed) {
  const d = new Float32Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 16807) % 2147483647;
    d[i] = s / 1073741823.5 - 1;
  }
  return d;
}

function wave(ctx, amps) {
  const real = new Float32Array(amps.length + 1);
  const imag = new Float32Array(amps.length + 1);
  for (let i = 0; i < amps.length; i++) imag[i + 1] = amps[i];
  return ctx.createPeriodicWave(real, imag);
}

export function makeShared(ctx) {
  const sr = ctx.sampleRate;
  const noise = ctx.createBuffer(1, sr * 2, sr);
  noise.copyToChannel(seededNoise(sr * 2, 20240607), 0);

  const piano = [];
  for (let n = 1; n <= 40; n++) {
    piano.push(Math.pow(n, -0.95) * (0.22 + 0.78 * Math.abs(Math.sin((Math.PI * n) / 7.6))) * Math.exp(-n / 26));
  }
  const organ = new Array(16).fill(0);
  // drawbars relative to an oscillator one octave below the played note
  [[1, 0.5], [2, 1], [3, 0.42], [4, 0.5], [6, 0.22], [8, 0.3], [10, 0.07], [12, 0.1], [16, 0.12]]
    .forEach(([h, a]) => { organ[h - 1] = a; });
  const bass = [1, 0.62, 0.36, 0.22, 0.13, 0.09, 0.06, 0.04, 0.03, 0.02];
  const pulse = [];
  for (let n = 1; n <= 48; n++) pulse.push((2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25));

  const soft = new Float32Array(2049);
  const hard = new Float32Array(2049);
  const crush = new Float32Array(2049);
  for (let i = 0; i < 2049; i++) {
    const x = (i / 1024) - 1;
    soft[i] = Math.tanh(1.4 * x) / Math.tanh(1.4);
    hard[i] = Math.tanh(7 * x) * 0.9 + 0.1 * Math.sign(x) * Math.pow(Math.abs(x), 0.4);
    crush[i] = Math.round(x * 6) / 6;
  }

  const vib = ctx.createOscillator();
  vib.frequency.value = 5.2;
  vib.start(0);

  return {
    offline: typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext,
    noise,
    waves: { piano: wave(ctx, piano), organ: wave(ctx, organ), bass: wave(ctx, bass), pulse: wave(ctx, pulse) },
    curves: { soft, hard, crush },
    vib,
  };
}

// ---------- small node helpers ----------

function kit(ctx) {
  const srcs = [];
  return {
    srcs,
    osc(type, freq, t, detune = 0) {
      const o = ctx.createOscillator();
      if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
      o.frequency.value = freq;
      o.detune.value = detune;
      o.baseDetune = detune;
      o.start(t);
      srcs.push(o);
      return o;
    },
    gain(v = 0) {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    },
    filter(type, freq, q = 0.7) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    },
    // short burst of noise that cleans itself up
    burst(sh, t, len, offset = 0) {
      const s = ctx.createBufferSource();
      s.buffer = sh.noise;
      s.start(t, offset % 1.5, len);
      return s;
    },
    noise(sh, t, offset = 0) {
      const s = ctx.createBufferSource();
      s.buffer = sh.noise;
      s.loop = true;
      s.start(t, offset % 1.5);
      srcs.push(s);
      return s;
    },
  };
}

const velGain = (v) => 0.3 + 0.7 * v;

// ---------- voices ----------
// Each returns { amp, rel, life, srcs, cleanup? }. `amp` is the gain node carrying the
// loudness envelope and is already connected to `dest`.

function epiano(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const ks = clamp(1.25 - (midi - 48) / 48, 0.25, 1.4);
  const car = k.osc('sine', f, t);
  const mod = k.osc('sine', f, t);
  const mg = k.gain();
  const idx = f * (0.45 + 1.7 * v) * ks;
  mg.gain.setValueAtTime(idx, t);
  mg.gain.setTargetAtTime(idx * 0.12, t, 0.3);
  mod.connect(mg).connect(car.frequency);
  if (f * 14 < 13000) {
    const tine = k.osc('sine', f * 14, t);
    const tg = k.gain();
    tg.gain.setValueAtTime(f * 1.1 * v, t);
    tg.gain.setTargetAtTime(0, t, 0.035);
    tine.connect(tg).connect(car.frequency);
  }
  const amp = k.gain();
  const peak = 0.34 * velGain(v);
  const tau = clamp(1.9 * Math.pow(2, -(midi - 60) / 30), 0.5, 3.2);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.004);
  amp.gain.setTargetAtTime(0, t + 0.004, tau);
  car.connect(amp).connect(dest);
  return { amp, rel: 0.22, life: tau * 5, srcs: k.srcs };
}

function piano(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const o1 = k.osc(sh.waves.piano, f, t, -1.8);
  const o2 = k.osc(sh.waves.piano, f, t, 1.8);
  const mix = k.gain(0.5);
  o1.connect(mix); o2.connect(mix);
  const lp = k.filter('lowpass', 1000, 0.6);
  lp.frequency.setValueAtTime(Math.min(16000, f * (3 + 13 * v) + 400), t);
  lp.frequency.setTargetAtTime(Math.min(12000, f * (1.6 + 2.4 * v) + 250), t, 0.45);
  const amp = k.gain();
  const peak = 0.5 * velGain(v);
  const tau = clamp(2.8 * Math.pow(2, -(midi - 48) / 20), 0.3, 4.5);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.003);
  amp.gain.setTargetAtTime(peak * 0.5, t + 0.003, 0.09);
  amp.gain.setTargetAtTime(0, t + 0.28, tau);
  mix.connect(lp).connect(amp).connect(dest);
  // felt hammer thunk
  const hn = k.burst(sh, t, 0.12, midi * 0.137);
  const hf = k.filter('bandpass', clamp(900 + f * 1.5, 900, 5000), 0.8);
  const hg = k.gain();
  hg.gain.setValueAtTime(0.5 * v, t);
  hg.gain.setTargetAtTime(0, t, 0.012);
  hn.connect(hf).connect(hg).connect(amp);
  return { amp, rel: 0.14, life: 0.3 + tau * 5, srcs: k.srcs };
}

function organ(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const o = k.osc(sh.waves.organ, f / 2, t);
  const amp = k.gain();
  const peak = 0.24 * (0.6 + 0.4 * v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.006);
  o.connect(amp).connect(dest);
  // percussion ping on the octave + key click
  const p = k.osc('sine', f * 2, t);
  const pg = k.gain();
  pg.gain.setValueAtTime(0.5 * v, t);
  pg.gain.setTargetAtTime(0, t, 0.09);
  p.connect(pg).connect(amp);
  const cn = k.burst(sh, t, 0.03, midi * 0.071);
  const cf = k.filter('highpass', 2500);
  const cg = k.gain();
  cg.gain.setValueAtTime(0.35, t);
  cg.gain.setTargetAtTime(0, t, 0.004);
  cn.connect(cf).connect(cg).connect(amp);
  return { amp, rel: 0.07, life: null, srcs: k.srcs };
}

function synth(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const a = k.osc('sawtooth', f, t, -8);
  const b = k.osc('sawtooth', f, t, 8);
  const sub = k.osc('square', f / 2, t);
  const mix = k.gain(0.4), sg = k.gain(0.16);
  a.connect(mix); b.connect(mix); sub.connect(sg);
  const lp = k.filter('lowpass', 2000, 3);
  lp.frequency.setValueAtTime(Math.min(15000, f * (3 + 9 * v) + 300), t);
  lp.frequency.setTargetAtTime(Math.min(9000, f * (1.5 + 2.5 * v) + 200), t, 0.18);
  const amp = k.gain();
  const peak = 0.42 * velGain(v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.004);
  amp.gain.setTargetAtTime(peak * 0.7, t + 0.004, 0.2);
  mix.connect(lp); sg.connect(lp);
  lp.connect(amp).connect(dest);
  return { amp, rel: 0.2, life: null, srcs: k.srcs };
}

function bassGuitar(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const o = k.osc(sh.waves.bass, f, t);
  const lp = k.filter('lowpass', 1000, 1.2);
  // the sustain keeps a few harmonics so the line survives small speakers
  lp.frequency.setValueAtTime(Math.min(7000, f * (6 + 10 * v)), t);
  lp.frequency.setTargetAtTime(f * 4 + 250, t, 0.16);
  const amp = k.gain();
  const peak = 0.54 * velGain(v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.003);
  amp.gain.setTargetAtTime(peak * 0.55, t + 0.003, 0.25);
  amp.gain.setTargetAtTime(0, t + 0.6, 2.2);
  o.connect(lp).connect(amp).connect(dest);
  const pn = k.burst(sh, t, 0.06, midi * 0.211);
  const pf = k.filter('lowpass', 1800);
  const pg = k.gain();
  pg.gain.setValueAtTime(0.5 * v, t);
  pg.gain.setTargetAtTime(0, t, 0.008);
  pn.connect(pf).connect(pg).connect(amp);
  return { amp, rel: 0.08, life: 12, srcs: k.srcs };
}

function bassSynth(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const a = k.osc('sawtooth', f, t, -4);
  const b = k.osc('square', f, t, 5);
  const mix = k.gain(0.5), bg = k.gain(0.3);
  a.connect(mix); b.connect(bg);
  const lp1 = k.filter('lowpass', 800, 5);
  const lp2 = k.filter('lowpass', 800, 0.7);
  const top = f * (3 + 10 * v) + 200, rest = f * 2.4 + 180;
  for (const lp of [lp1, lp2]) {
    lp.frequency.setValueAtTime(Math.min(12000, top), t);
    lp.frequency.setTargetAtTime(rest, t, 0.16);
  }
  const amp = k.gain();
  const peak = 0.5 * velGain(v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.002);
  amp.gain.setTargetAtTime(peak * 0.75, t + 0.002, 0.3);
  mix.connect(lp1); bg.connect(lp1);
  lp1.connect(lp2).connect(amp).connect(dest);
  return { amp, rel: 0.09, life: null, srcs: k.srcs };
}

function vibrato(ctx, sh, oscs, cents, t, delay = 0.25) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.setTargetAtTime(cents, t + delay, 0.25);
  sh.vib.connect(g);
  oscs.forEach((o) => g.connect(o.detune));
  // returned so the voice can unhook itself from the shared LFO when it ends
  return () => { try { sh.vib.disconnect(g); g.disconnect(); } catch (e) { /* gone */ } };
}

function choir(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const a = k.osc('sawtooth', f, t, -9);
  const b = k.osc('sawtooth', f, t, 9);
  const vg = vibrato(ctx, sh, [a, b], 9, t, 0.3);
  const mix = k.gain(0.5);
  a.connect(mix); b.connect(mix);
  const breath = k.noise(sh, t, midi * 0.091);
  const bg = k.gain(0.05);
  breath.connect(bg).connect(mix);
  const amp = k.gain();
  const peak = 0.9 * velGain(v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(peak, t, 0.07);
  mix.connect(amp).connect(dest);
  return { amp, rel: 0.4, life: null, srcs: k.srcs, cleanup: vg };
}

function strings(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const os = [-11, 2, 13].map((d) => k.osc('sawtooth', f, t, d));
  const vg = vibrato(ctx, sh, os, 5, t, 0.35);
  const mix = k.gain(0.33);
  os.forEach((o) => o.connect(mix));
  const lp = k.filter('lowpass', Math.min(9000, 900 + f * 3 + 3000 * v), 0.4);
  const amp = k.gain();
  const peak = 0.4 * velGain(v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(peak, t, 0.08);
  mix.connect(lp).connect(amp).connect(dest);
  return { amp, rel: 0.45, life: null, srcs: k.srcs, cleanup: vg };
}

function horns(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const a = k.osc('sawtooth', f, t);
  const b = k.osc('sawtooth', f, t, 6);
  for (const o of [a, b]) {
    o.detune.setValueAtTime(o.detune.value - 35, t);
    o.detune.setTargetAtTime(o === a ? 0 : 6, t, 0.025);
  }
  const mix = k.gain(0.5);
  a.connect(mix); b.connect(mix);
  const lp = k.filter('lowpass', 500, 1.5);
  lp.frequency.setValueAtTime(f * 1.2 + 100, t);
  lp.frequency.setTargetAtTime(Math.min(11000, f * (2.5 + 6 * v) + 300), t, 0.025);
  lp.frequency.setTargetAtTime(Math.min(9000, f * (2 + 3.5 * v) + 200), t + 0.12, 0.15);
  const amp = k.gain();
  const peak = 0.21 * velGain(v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(peak, t, 0.018);
  mix.connect(lp).connect(amp).connect(dest);
  return { amp, rel: 0.1, life: null, srcs: k.srcs };
}

function dreamPad(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const a = k.osc('triangle', f, t);
  const b = k.osc('sawtooth', f, t, -8);
  const c = k.osc('sawtooth', f * 2, t, 8);
  const mix = k.gain(1), bg = k.gain(0.3), cg = k.gain(0.12);
  a.connect(mix); b.connect(bg).connect(mix); c.connect(cg).connect(mix);
  const lp = k.filter('lowpass', 300, 0.8);
  lp.frequency.setValueAtTime(300 + f, t);
  lp.frequency.setTargetAtTime(Math.min(7000, 600 + f * 2 + 1500 * v), t, 0.5);
  const amp = k.gain();
  const peak = 0.3 * velGain(v);
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(peak, t, 0.22);
  mix.connect(lp).connect(amp).connect(dest);
  return { amp, rel: 0.9, life: null, srcs: k.srcs };
}

function musicBox(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi + 12);
  const car = k.osc('sine', f, t);
  const mod = k.osc('sine', f * 3.5, t);
  const mg = k.gain();
  mg.gain.setValueAtTime(f * 1.6 * v, t);
  mg.gain.setTargetAtTime(f * 0.05, t, 0.05);
  mod.connect(mg).connect(car.frequency);
  const amp = k.gain();
  const peak = 0.3 * velGain(v);
  const tau = clamp(0.9 * Math.pow(2, -(midi - 60) / 24), 0.25, 1.4);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.002);
  amp.gain.setTargetAtTime(0, t + 0.002, tau);
  car.connect(amp).connect(dest);
  return { amp, rel: 0.5, life: tau * 5, srcs: k.srcs };
}

function kalimba(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const car = k.osc('sine', f, t);
  const over = k.osc('sine', f * 5.4, t);
  const og = k.gain();
  og.gain.setValueAtTime(0.3 * v, t);
  og.gain.setTargetAtTime(0, t, 0.03);
  const amp = k.gain();
  const peak = 0.42 * velGain(v);
  const tau = clamp(0.55 * Math.pow(2, -(midi - 60) / 30), 0.2, 1.0);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.002);
  amp.gain.setTargetAtTime(0, t + 0.002, tau);
  car.connect(amp); over.connect(og).connect(amp);
  const tn = k.burst(sh, t, 0.05, midi * 0.3);
  const tf = k.filter('bandpass', 2200, 1.5);
  const tg = k.gain();
  tg.gain.setValueAtTime(0.35 * v, t);
  tg.gain.setTargetAtTime(0, t, 0.006);
  tn.connect(tf).connect(tg).connect(amp);
  amp.connect(dest);
  return { amp, rel: 0.3, life: tau * 5, srcs: k.srcs };
}

function chip(ctx, sh, dest, midi, v, t) {
  const k = kit(ctx), f = midiToFreq(midi);
  const o = k.osc(sh.waves.pulse, f, t);
  const vg = vibrato(ctx, sh, [o], 12, t, 0.3);
  const amp = k.gain();
  const peak = 0.5 * velGain(v);
  amp.gain.setValueAtTime(peak, t);
  amp.gain.setTargetAtTime(peak * 0.65, t, 0.08);
  o.connect(amp).connect(dest);
  return { amp, rel: 0.04, life: null, srcs: k.srcs, cleanup: vg };
}

// ---------- per-track insert effects ----------
// One shared chain per track gives each instrument its body and width far
// more cheaply than filtering every voice.

function chorus(ctx, { rate = 0.6, depth = 0.003, base = 0.014, mix = 0.5 } = {}) {
  const input = ctx.createGain(), output = ctx.createGain();
  const dry = ctx.createGain();
  dry.gain.value = 1 - mix * 0.5;
  input.connect(dry).connect(output);
  const merger = ctx.createChannelMerger(2);
  const wet = ctx.createGain();
  wet.gain.value = mix;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  lfo.start(0);
  [1, -1].forEach((sign, i) => {
    const d = ctx.createDelay(0.05);
    d.delayTime.value = base + i * 0.004;
    const g = ctx.createGain();
    g.gain.value = depth * sign;
    lfo.connect(g).connect(d.delayTime);
    input.connect(d).connect(merger, 0, i);
  });
  merger.connect(wet).connect(output);
  return { input, output, stop: () => lfo.stop() };
}

function tremolo(ctx, { rate = 4.2, depth = 0.22 } = {}) {
  const input = ctx.createGain(), output = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  lfo.start(0);
  [1, -1].forEach((sign, i) => {
    const g = ctx.createGain();
    g.gain.value = 1 - depth;
    const lg = ctx.createGain();
    lg.gain.value = depth * sign;
    lfo.connect(lg).connect(g.gain);
    input.connect(g).connect(merger, 0, i);
  });
  merger.connect(output);
  return { input, output, stop: () => lfo.stop() };
}

function chain(ctx, parts) {
  const input = ctx.createGain(), output = ctx.createGain();
  let node = input;
  const stops = [];
  for (const p of parts) {
    if (p.input) { node.connect(p.input); node = p.output; if (p.stop) stops.push(p.stop); }
    else { node.connect(p); node = p; }
  }
  node.connect(output);
  return { input, output, stop: () => stops.forEach((s) => s()) };
}

function eq(ctx, type, freq, gain, q = 1) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.gain.value = gain;
  f.Q.value = q;
  return f;
}

function formants(ctx) {
  const input = ctx.createGain(), output = ctx.createGain();
  // an open "aah"
  [[650, 5, 1], [1080, 6, 0.55], [2650, 8, 0.3], [3300, 9, 0.12]].forEach(([freq, q, g]) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const gg = ctx.createGain();
    gg.gain.value = g;
    input.connect(bp).connect(gg).connect(output);
  });
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 420;
  const bg = ctx.createGain();
  bg.gain.value = 0.35;
  input.connect(body).connect(bg).connect(output);
  return { input, output };
}

const INSERTS = {
  epiano: (ctx) => tremolo(ctx),
  piano: (ctx) => chain(ctx, [eq(ctx, 'peaking', 240, 2.5, 0.8), eq(ctx, 'highshelf', 6000, 2)]),
  organ: (ctx) => chain(ctx, [tremolo(ctx, { rate: 6.1, depth: 0.1 }), chorus(ctx, { rate: 6.1, depth: 0.0006, base: 0.006, mix: 0.6 })]),
  synth: (ctx) => chorus(ctx, { rate: 0.5, depth: 0.0025, mix: 0.4 }),
  bassSynth: (ctx, sh) => {
    const ws = ctx.createWaveShaper();
    ws.curve = sh.curves.soft;
    return chain(ctx, [ws]);
  },
  choir: (ctx) => chain(ctx, [formants(ctx), chorus(ctx, { rate: 0.35, depth: 0.004, mix: 0.6 })]),
  strings: (ctx) => chain(ctx, [eq(ctx, 'peaking', 280, 3, 1), eq(ctx, 'highshelf', 6000, -3), chorus(ctx, { rate: 0.45, depth: 0.0035, mix: 0.6 })]),
  horns: (ctx) => chain(ctx, [eq(ctx, 'peaking', 450, 3, 1), eq(ctx, 'peaking', 1300, 5, 1.2), chorus(ctx, { rate: 0.3, depth: 0.0012, mix: 0.3 })]),
  dreamPad: (ctx) => chorus(ctx, { rate: 0.25, depth: 0.005, mix: 0.7 }),
  musicBox: (ctx) => chorus(ctx, { rate: 0.8, depth: 0.0008, mix: 0.25 }),
};

// ---------- catalogue ----------

export const INSTRUMENTS = [
  { id: 'epiano',     name: 'E-Piano',     face: 'keys',  roles: ['pads', 'melody'],         voice: epiano,     poly: 10, strum: 0.006, gm: 4 },
  { id: 'piano',      name: 'Piano',       face: 'keys',  roles: ['melody', 'pads'],         voice: piano,      poly: 10, strum: 0.006, gm: 0 },
  { id: 'organ',      name: 'Organ',       face: 'pipes', roles: ['pads', 'melody'],         voice: organ,      poly: 8,  strum: 0,     gm: 16 },
  { id: 'synth',      name: 'Synth',       face: 'bolt',  roles: ['melody', 'pads'],         voice: synth,      poly: 8,  strum: 0,     gm: 81 },
  { id: 'bassGuitar', name: 'Bass Guitar', face: 'bass',  roles: ['bass'],                   voice: bassGuitar, poly: 4,  strum: 0.008, gm: 33 },
  { id: 'bassSynth',  name: 'Bass Synth',  face: 'wave',  roles: ['bass'],                   voice: bassSynth,  poly: 3,  strum: 0,     gm: 38 },
  { id: 'drums',      name: 'Drums',       face: 'drum',  roles: ['drums'],                  voice: null,       poly: 24, strum: 0,     gm: 0 },
  { id: 'choir',      name: 'Choir',       face: 'sing',  roles: ['pads', 'melody'],         voice: choir,      poly: 8,  strum: 0,     gm: 52 },
  { id: 'strings',    name: 'Strings',     face: 'bow',   roles: ['pads', 'melody'],         voice: strings,    poly: 8,  strum: 0,     gm: 48 },
  { id: 'horns',      name: 'Horns',       face: 'horn',  roles: ['melody', 'pads'],         voice: horns,      poly: 6,  strum: 0,     gm: 61 },
  { id: 'dreamPad',   name: 'Dream Pad',   face: 'cloud', roles: ['pads'],                   voice: dreamPad,   poly: 8,  strum: 0,     gm: 89 },
  { id: 'musicBox',   name: 'Music Box',   face: 'star',  roles: ['melody'],                 voice: musicBox,   poly: 10, strum: 0.01,  gm: 10 },
  { id: 'kalimba',    name: 'Kalimba',     face: 'leaf',  roles: ['melody'],                 voice: kalimba,    poly: 10, strum: 0.012, gm: 108 },
  { id: 'sampler',    name: 'Sampler',     face: 'mic',   roles: [],                         voice: null,       poly: 12, strum: 0,     gm: 0 },
  { id: 'chip',       name: 'Chiptune',    face: 'pixel', roles: ['melody', 'bass'],         voice: chip,       poly: 6,  strum: 0,     gm: 80 },
];

export function instrumentById(id) {
  return INSTRUMENTS.find((i) => i.id === id) || INSTRUMENTS[0];
}

export function makeInsert(ctx, sh, instId) {
  const f = INSERTS[instId];
  return f ? f(ctx, sh) : null;
}

// Start one note. `dur` (seconds) may be omitted for a held live note, in
// which case call release() later.
export function startVoice(ctx, sh, inst, dest, midi, vel, t, dur) {
  const v = inst.voice(ctx, sh, dest, midi, clamp(vel, 0.05, 1), t);
  let ended = false;
  const end = (at) => {
    for (const s of v.srcs) { try { s.stop(at); } catch (e) { /* already stopped */ } }
  };
  if (v.life) end(t + v.life);
  // Live, a finished voice unhooks itself so the graph stays small. During an
  // offline render that would happen at an unpredictable moment and make two
  // exports of the same song differ, and the whole graph is discarded anyway.
  if (!sh.offline) {
    v.srcs[0].onended = () => {
      ended = true;
      try { v.amp.disconnect(); } catch (e) { /* gone */ }
      if (v.cleanup) v.cleanup();
    };
  }
  const h = {
    t,
    until: v.life ? t + v.life : Infinity,
    get ended() { return ended; },
    // slide the pitch of a held note (cents)
    bend(cents, at) {
      for (const o of v.srcs) if (o.detune && o.baseDetune !== undefined) o.detune.setTargetAtTime(o.baseDetune + cents, at, 0.015);
    },
    release(tr) {
      tr = Math.max(tr, t + 0.03);
      v.amp.gain.cancelScheduledValues(tr);
      v.amp.gain.setTargetAtTime(0, tr, v.rel / 4);
      const stopAt = tr + v.rel * 1.6 + 0.03;
      end(stopAt);
      h.until = Math.min(h.until, stopAt);
    },
    // cut quickly: voice stealing, transport stop
    kill(tk) {
      const at = Math.max(tk, ctx.currentTime);
      v.amp.gain.cancelScheduledValues(at);
      if (t >= at) v.amp.gain.setValueAtTime(0, at);
      else v.amp.gain.setTargetAtTime(0, at, 0.006);
      end(at + 0.05);
      h.until = Math.min(h.until, at + 0.05);
    },
  };
  if (dur != null) h.release(t + Math.max(0.03, dur));
  return h;
}

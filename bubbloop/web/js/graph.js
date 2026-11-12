// The audio graph: track channels -> FX rack -> mastering chain.
// buildGraph() works on a live AudioContext and on an OfflineAudioContext,
// so what you hear while jamming is what gets exported.

import { makeShared, instrumentById, makeInsert, startVoice } from './instruments.js';
import { DRUM_PADS, padFor } from './drums.js';
import { cellNotes } from './theory.js';

export const FX = [
  { id: 'reverb',  name: 'Cloud',   sub: 'reverb', zones: ['mist', 'deep'] },
  { id: 'delay',   name: 'Echo',    sub: 'delay', zones: ['1/8', '3/16', '1/4'] },
  { id: 'squish',  name: 'Squish',  sub: 'compressor' },
  { id: 'crunch',  name: 'Crunch',  sub: 'distortion' },
  { id: 'stutter', name: 'Stutter', sub: 'beat repeat', zones: ['1/8', '1/16', '1/32'] },
  { id: 'glitch',  name: 'Glitch',  sub: 'chaos' },
  { id: 'filter',  name: 'Dive',    sub: 'filter', zones: ['deep', '', '', '', '', 'air'] },
  { id: 'tape',    name: 'Sleepy',  sub: 'tape stop' },
];
const STUTTER_STEPS = [2, 1, 0.5];
const FILTER_HZ = [180, 320, 560, 1000, 1800, 3200];

export const MASTERS = [
  { id: 'raw',    name: 'Raw',    hint: 'untouched',        low: 0,   mid: 0,    high: 0,    thr: 0,   ratio: 1,   drive: 0,   lufs: null },
  { id: 'sweet',  name: 'Sweet',  hint: 'balanced, shiny',  low: 0.5, mid: -1.5, high: 3,    thr: -18, ratio: 2.2, drive: 0.3, lufs: -14 },
  { id: 'punchy', name: 'Punchy', hint: 'big drums',        low: 3,   mid: -2,   high: 2,    thr: -22, ratio: 3.5, drive: 0.5, lufs: -12 },
  { id: 'cozy',   name: 'Cozy',   hint: 'warm tape hug',    low: 2.5, mid: 0.5,  high: -2.5, thr: -20, ratio: 2.5, drive: 0.8, lufs: -14 },
  { id: 'loud',   name: 'Loud',   hint: 'turned up to 11',  low: 2,   mid: -1,   high: 3,    thr: -26, ratio: 4.5, drive: 0.7, lufs: -10 },
];
export const masterById = (id) => MASTERS.find((m) => m.id === id) || MASTERS[1];

function rand01(n) {
  // deterministic hash so a glitch renders the same way it played
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Reverb and echo characters for the two send buses, chosen per song.
export const REVERBS = [
  { id: 'room',  name: 'Room',      hint: 'small and close',   secs: 0.8, dark: 3.5, gain: 1.3 },
  { id: 'hall',  name: 'Hall',      hint: 'the default glow',  secs: 2.6, dark: 2.4, gain: 1.6 },
  { id: 'plate', name: 'Plate',     hint: 'bright and smooth', secs: 1.7, dark: 0.6, gain: 1.4 },
  { id: 'sky',   name: 'Cathedral', hint: 'huge and slow',     secs: 5.0, dark: 1.6, gain: 1.7 },
];
export const ECHOES = [
  { id: 'ping', name: 'Ping-pong', hint: 'bounces side to side', fb: 0.42, tone: 3400, mult: 1,    wide: true },
  { id: 'tape', name: 'Tape',      hint: 'dark, long, centred',  fb: 0.55, tone: 1700, mult: 1,    wide: false },
  { id: 'slap', name: 'Slap',      hint: 'one quick bounce',     fb: 0.12, tone: 4500, mult: 0.34, wide: false },
  { id: 'dub',  name: 'Dub',       hint: 'keeps on going',       fb: 0.7,  tone: 2200, mult: 1,    wide: true },
];
const pick = (list, id, dflt) => list.find((x) => x.id === id) || list[dflt];

function makeImpulse(ctx, seconds, dark = 2.4) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 777 + ch * 1013, lp = 0, e = 0;
    for (let i = pre; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const w = seed / 1073741823.5 - 1;
      const x = (i - pre) / sr;
      const a = 0.12 + 0.75 * Math.exp(-x * dark);   // highs fade first
      lp += a * (w - lp);
      d[i] = lp * Math.exp((-6.9 * x) / seconds) * Math.min(1, x / 0.003);
      e += d[i] * d[i];
    }
    const k = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return buf;
}

function xfade(ctx, input, wetIn, wetOut) {
  const out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  wet.gain.value = 0;
  input.connect(dry).connect(out);
  input.connect(wetIn);
  wetOut.connect(wet).connect(out);
  return {
    out,
    set(on, t, tau = 0.004) {
      dry.gain.setTargetAtTime(on ? 0 : 1, t, tau);
      wet.gain.setTargetAtTime(on ? 1 : 0, t, tau);
    },
    params: [dry.gain, wet.gain],
  };
}

// ---------- quick-hit FX rack ----------

// lite: a per-track rack. It has no reverb or echo of its own; those hits
// are passed to lite.send() to open that track's sends instead.
function buildRack(ctx, sh, project, lite = null) {
  const sr = ctx.sampleRate;
  const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const pre = G(), mix = G();
  pre.connect(mix);

  // reverb bus (track sends + the Cloud hit)
  const revIn = G();
  let conv = null, revOut = null, echo = ECHOES[0];
  if (!lite) {
    conv = ctx.createConvolver();
    conv.normalize = false;
    revOut = G(1.6);
    revIn.connect(conv).connect(revOut).connect(mix);
  }
  const hitRev = G(0);
  pre.connect(hitRev).connect(revIn);

  // ping-pong delay bus (track sends + the Echo hit)
  const dlyIn = G();
  const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
  const fb = G(0.42);
  const dTone = ctx.createBiquadFilter();
  dTone.type = 'lowpass'; dTone.frequency.value = 3400;
  const dHp = ctx.createBiquadFilter();
  dHp.type = 'highpass'; dHp.frequency.value = 240;
  const merger = ctx.createChannelMerger(2);
  const dlyOut = G(0.85);
  if (!lite) {
    dlyIn.connect(dL); dL.connect(dR);
    dR.connect(dTone).connect(dHp).connect(fb).connect(dL);
    dL.connect(merger, 0, 0); dR.connect(merger, 0, 1);

    merger.connect(dlyOut).connect(mix);
  }
  const hitDly = G(0);
  pre.connect(hitDly).connect(dlyIn);

  // Crunch: distortion
  const cPre = G(7);
  const cShape = ctx.createWaveShaper();
  cShape.curve = sh.curves.hard; cShape.oversample = '2x';
  const cTone = ctx.createBiquadFilter();
  cTone.type = 'lowpass'; cTone.frequency.value = 5200;
  const cPost = G(0.25);
  cPre.connect(cShape).connect(cTone).connect(cPost);
  const crunch = xfade(ctx, mix, cPre, cPost);

  // bit-crush, used by Glitch
  const kShape = ctx.createWaveShaper();
  kShape.curve = sh.curves.crush;
  const crush = xfade(ctx, crunch.out, kShape, kShape);

  // Dive: low-pass filter
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass'; filt.frequency.value = 20000; filt.Q.value = 0.7;
  crush.out.connect(filt);

  // Stutter: grab the last slice of sound and spin it round a delay loop
  const hist = ctx.createDelay(1.5), loop = ctx.createDelay(1.5);
  const hGate = G(0), fbGate = G(0), sDry = G(1), sWet = G(0), loopIn = G(), sOut = G();
  filt.connect(sDry).connect(sOut);
  filt.connect(hist).connect(hGate).connect(loopIn);
  loopIn.connect(sWet).connect(sOut);
  loopIn.connect(loop).connect(fbGate).connect(loopIn);
  const stutParams = [hGate.gain, fbGate.gain, sDry.gain, sWet.gain];

  // Sleepy: tape stop, made by bending a delay line until time stands still
  const tapeD = ctx.createDelay(1.5), tapeG = G(1);
  sOut.connect(tapeD).connect(tapeG);

  // Squish: heavy compression + a pump on every beat
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -34; comp.knee.value = 8; comp.ratio.value = 14;
  comp.attack.value = 0.003; comp.release.value = 0.09;
  const makeup = G(1.8);
  comp.connect(makeup);
  const squish = xfade(ctx, tapeG, comp, makeup);
  const pump = G(1), gate = G(1), output = G(1);
  squish.out.connect(pump).connect(gate).connect(output);

  let spb = 60 / project.bpm;
  let echoBeats = 0.75;                  // dotted eighth unless an Echo hit picks another
  const windows = { glitch: [], squish: [] };
  let last = null;     // most recent 16th handed to tick()

  const live = (k, t) => windows[k].some((w) => t >= w.t0 - 1e-4 && t < w.t1);
  const open = (k, t0, t1) => {
    const list = windows[k];
    while (list.length && list[0].t1 < t0 - 8) list.shift();
    list.push({ t0, t1 });
  };
  const close = (k, t) => {
    for (const w of windows[k]) if (w.t1 === Infinity) w.t1 = t;
  };

  function stutOn(t, len, until) {
    const L = Math.max(256, Math.round(len * sr)) / sr;
    hist.delayTime.setValueAtTime(L, t);
    loop.delayTime.setValueAtTime(L, t);
    hGate.gain.setValueAtTime(1, t);
    fbGate.gain.setValueAtTime(0, t);
    if (until == null || t + L < until) {
      hGate.gain.setValueAtTime(0, t + L);
      fbGate.gain.setValueAtTime(1, t + L);
    }
    sDry.gain.setValueAtTime(0, t);
    sWet.gain.setValueAtTime(1, t);
  }
  function stutOff(t) {
    hGate.gain.setValueAtTime(0, t);
    fbGate.gain.setValueAtTime(0, t);
    sDry.gain.setValueAtTime(1, t);
    sWet.gain.setValueAtTime(0, t);
  }

  function tapeOn(t, dur, T) {
    const n = 48;
    const frac = dur != null && dur < T ? dur / T : 1;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * frac;
      curve[i] = (x * x / 2) * T;
    }
    try {
      tapeD.delayTime.setValueCurveAtTime(curve, t, T * frac);
    } catch (e) { return; }
    tapeG.gain.setValueAtTime(1, t);
    if (frac > 0.6) tapeG.gain.setTargetAtTime(0, t + T * 0.6, T * 0.1);
  }
  function tapeOff(t, sequenced) {
    if (!sequenced) {
      tapeD.delayTime.cancelScheduledValues(t);
      tapeG.gain.cancelScheduledValues(t);
    }
    try {
      tapeD.delayTime.setValueAtTime(0, t + 0.0002);
    } catch (e) {
      // a bend still in progress would refuse the reset; cut it short first
      if (tapeD.delayTime.cancelAndHoldAtTime) tapeD.delayTime.cancelAndHoldAtTime(t);
      tapeD.delayTime.setValueAtTime(0, t + 0.0002);
    }
    tapeG.gain.setValueAtTime(0, t);
    tapeG.gain.setTargetAtTime(1, t + 0.003, 0.004);
  }

  // One 16th of Glitch: pick a small mischief and schedule it start to end.
  function glitchStep(idx, t, dur) {
    const end = t + dur;
    const r = rand01(idx * 7919 + 13);
    if (r < 0.3) { stutOn(t, dur / 2, end); stutOff(end); }
    else if (r < 0.45) { stutOn(t, dur / 4, end); stutOff(end); }
    else if (r < 0.58) {
      gate.gain.setTargetAtTime(0, t + dur / 2, 0.001);
      gate.gain.setTargetAtTime(1, end, 0.001);
    } else if (r < 0.72) {
      crush.set(true, t, 0.001); crush.set(false, end, 0.001);
      stutOn(t, dur / 2, end); stutOff(end);
    } else if (r < 0.84) { tapeOn(t, dur, dur * 1.25); tapeOff(end, true); }
    else if (r < 0.93) { stutOn(t, dur / 3, end); stutOff(end); }
  }
  function glitchClear(t) {
    for (const p of [...stutParams, ...crush.params, gate.gain]) p.cancelScheduledValues(t);
    stutOff(t);
    crush.set(false, t, 0.001);
    gate.gain.setTargetAtTime(1, t, 0.001);
    tapeOff(t, false);
  }

  const rack = {
    input: pre, output, revIn, dlyIn,

    echoTime(p, t) {
      echoBeats = [0.5, 0.75, 1][p ?? 1] ?? 0.75;
      dL.delayTime.setTargetAtTime(spb * echoBeats * echo.mult, t, 0.02);
      dR.delayTime.setTargetAtTime(spb * echoBeats * echo.mult, t, 0.02);
    },

    // Choose the reverb and echo character (project.space).
    setSpace(space = {}) {
      if (lite) return;
      const r = pick(REVERBS, space.rev, 1);
      conv.buffer = makeImpulse(ctx, r.secs, r.dark);
      revOut.gain.value = r.gain;
      echo = pick(ECHOES, space.dly, 0);
      fb.gain.value = echo.fb;
      dTone.frequency.value = echo.tone;
      rack.echoTime(null, 0);
    },

    setTempo(bpm, t = 0) {
      spb = 60 / bpm;
      const d = spb * echoBeats * echo.mult;
      dL.delayTime.setTargetAtTime(d, t, 0.05);
      dR.delayTime.setTargetAtTime(d, t, 0.05);
    },

    // dur: known length in seconds for a sequenced hit; omit for a live hold
    on(k, p, t, dur) {
      const seq = dur != null;
      switch (k) {
        case 'reverb':
          if (lite) lite.send('rev', true, t, p === 0 ? 0.45 : 1); else hitRev.gain.setTargetAtTime(p === 0 ? 0.2 : 0.5, t, 0.012);
          break;
        case 'delay':
          if (lite) { lite.echo(p, t); lite.send('dly', true, t); break; }
          rack.echoTime(p, t);
          hitDly.gain.setTargetAtTime(1, t, 0.008);
          fb.gain.setTargetAtTime(Math.min(0.85, echo.fb + 0.2), t, 0.02);
          break;
        case 'crunch': crunch.set(true, t); break;
        case 'filter':
          filt.frequency.setTargetAtTime(FILTER_HZ[p ?? 2] ?? 560, t, 0.03);
          filt.Q.setTargetAtTime(5, t, 0.03);
          break;
        case 'stutter':
          if (!seq) for (const q of stutParams) q.cancelScheduledValues(t);
          stutOn(t, spb / 4 * (STUTTER_STEPS[p ?? 1] ?? 1), seq ? t + dur : null);
          break;
        case 'tape':
          if (!seq) { tapeD.delayTime.cancelScheduledValues(t); tapeG.gain.cancelScheduledValues(t); }
          tapeOn(t, dur, Math.min(1, Math.max(0.4, spb * 1.5)));
          break;
        case 'squish':
          squish.set(true, t);
          open('squish', t, seq ? t + dur : Infinity);
          break;
        case 'glitch':
          open('glitch', t, seq ? t + dur : Infinity);
          if (!seq && last) {
            // start at once rather than waiting for the next 16th
            const stepDur = last.dur;
            let b = last.t, i = last.idx;
            while (b - stepDur > t) { b -= stepDur; i--; }
            if (b > t) glitchStep(i - 1, t, b - t);
            for (; b <= last.t + 1e-6; b += stepDur, i++) glitchStep(i, b, stepDur);
          }
          break;
        default: return;
      }
      if (seq) rack.off(k, t + dur, true);
    },

    off(k, t, sequenced = false) {
      switch (k) {
        case 'reverb':
          if (lite) lite.send('rev', false, t); else hitRev.gain.setTargetAtTime(0, t, 0.03);
          break;
        case 'delay':
          if (lite) { lite.send('dly', false, t); break; }
          hitDly.gain.setTargetAtTime(0, t, 0.01);
          fb.gain.setTargetAtTime(echo.fb, t, 0.6);
          break;
        case 'crunch': crunch.set(false, t); break;
        case 'filter':
          filt.frequency.setTargetAtTime(20000, t, 0.03);
          filt.Q.setTargetAtTime(0.7, t, 0.03);
          break;
        case 'stutter':
          if (!sequenced) for (const q of stutParams) q.cancelScheduledValues(t);
          stutOff(t);
          break;
        case 'tape': tapeOff(t, sequenced); break;
        case 'squish':
          squish.set(false, t);
          if (!sequenced) close('squish', t);
          break;
        case 'glitch':
          if (!sequenced) { close('glitch', t); glitchClear(t); }
          break;
        default:
      }
    },

    // Called once for every 16th note by whatever is driving time.
    tick(idx, t, dur) {
      last = { idx, t, dur };
      if (live('glitch', t)) glitchStep(idx, t, dur);
      if (idx % 4 === 0 && live('squish', t)) {
        pump.gain.setTargetAtTime(0.28, t, 0.002);
        pump.gain.setTargetAtTime(1, t + 0.03, dur * 0.7);
      }
    },

    // everything back to neutral (transport stop)
    reset(t) {
      for (const f of FX) rack.off(f.id, t, false);
      windows.glitch.length = 0;
      windows.squish.length = 0;
    },
  };
  rack.setSpace(project.space);
  rack.setTempo(project.bpm);
  return rack;
}

// ---------- mastering chain ----------

function buildMaster(ctx, sh, presetId, offline) {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.7;
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf'; low.frequency.value = 100;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking'; mid.frequency.value = 320; mid.Q.value = 0.9;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf'; high.frequency.value = 8500;
  const glue = ctx.createDynamicsCompressor();
  glue.knee.value = 12; glue.attack.value = 0.02; glue.release.value = 0.18;
  const dPre = ctx.createGain(), dPost = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = sh.curves.soft; shaper.oversample = '2x';
  const output = ctx.createGain();
  input.connect(hp).connect(low).connect(mid).connect(high).connect(glue).connect(dPre).connect(shaper).connect(dPost);
  if (offline) {
    // export gets a proper look-ahead limiter afterwards (see master.js)
    dPost.connect(output);
  } else {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.002; lim.release.value = 0.12;
    dPost.connect(lim).connect(output);
  }
  const m = {
    input, output,
    set(id) {
      const p = masterById(id);
      low.gain.value = p.low; mid.gain.value = p.mid; high.gain.value = p.high;
      glue.threshold.value = p.thr; glue.ratio.value = p.ratio;
      // the soft curve has a small-signal gain of ~1.58; undo it
      dPre.gain.value = 0.35 + p.drive * 0.5;
      dPost.gain.value = 1 / (1.58 * (0.35 + p.drive * 0.5)) * (1 + p.drive * 0.25);
    },
  };
  m.set(presetId);
  return m;
}

// ---------- the whole graph ----------

export function buildGraph(ctx, project, kit, opts = {}) {
  const sh = makeShared(ctx);
  const rack = buildRack(ctx, sh, project);
  const master = buildMaster(ctx, sh, opts.master === false ? 'raw' : project.master, !!opts.offline);
  const bus = ctx.createGain();
  bus.gain.value = 0.8;
  rack.output.connect(bus).connect(master.input);
  master.output.connect(opts.dest || ctx.destination);

  const g = { ctx, sh, rack, master, kit, channels: new Map(), project };

  // FX can target one track. Its rack is built the first time it is needed
  // and spliced in between the track's fader and its pan.
  g.trackRack = (id) => {
    const ch = g.channels.get(id);
    if (!ch) return null;
    if (ch.rack) return ch.rack;
    const hit = { rev: ctx.createGain(), dly: ctx.createGain() };
    hit.rev.gain.value = 0; hit.dly.gain.value = 0;
    ch.pan.connect(hit.rev).connect(rack.revIn);
    ch.pan.connect(hit.dly).connect(rack.dlyIn);
    ch.rack = buildRack(ctx, sh, g.project, {
      echo(p, t) { rack.echoTime(p, t); },
      send(kind, on, t, amount = 1) { hit[kind].gain.setTargetAtTime(on ? (kind === 'rev' ? 0.9 : 1) * amount : 0, t, on ? 0.012 : 0.03); },
    });
    try { ch.mute.disconnect(ch.pan); } catch (e) { /* not yet wired */ }
    ch.mute.connect(ch.rack.input);
    ch.rack.output.connect(ch.pan);
    return ch.rack;
  };
  g.fxRack = (trackId) => (trackId ? g.trackRack(trackId) : rack);
  g.eachRack = (fn) => { fn(rack); for (const ch of g.channels.values()) if (ch.rack) fn(ch.rack); };

  function channel(track) {
    let ch = g.channels.get(track.id);
    if (ch) return ch;
    ch = { id: track.id, voices: [], open: {}, instId: null, insert: null, fresh: true };
    ch.bus = ctx.createGain();
    ch.post = ctx.createGain();
    ch.vol = ctx.createGain();
    ch.mute = ctx.createGain();
    ch.pan = ctx.createStereoPanner();
    ch.rev = ctx.createGain();
    ch.dly = ctx.createGain();
    ch.duck = ctx.createGain();          // dips when a kick lands, if the track asks for it
    ch.post.connect(ch.vol).connect(ch.duck).connect(ch.mute).connect(ch.pan).connect(rack.input);
    ch.pan.connect(ch.rev).connect(rack.revIn);
    ch.pan.connect(ch.dly).connect(rack.dlyIn);
    g.channels.set(track.id, ch);
    g.syncTrack(track);
    return ch;
  }

  // Apply a track's mixer settings (and swap its instrument insert).
  g.syncTrack = (track, t = ctx.currentTime) => {
    const ch = g.channels.get(track.id) || channel(track);
    if (ch.instId !== track.inst) {
      if (ch.insert) {
        try { ch.bus.disconnect(); ch.insert.output.disconnect(); } catch (e) { /* fresh */ }
        if (ch.insert.stop) ch.insert.stop();
      } else {
        try { ch.bus.disconnect(); } catch (e) { /* fresh */ }
      }
      ch.insert = makeInsert(ctx, sh, track.inst);
      if (ch.insert) { ch.bus.connect(ch.insert.input); ch.insert.output.connect(ch.post); }
      else ch.bus.connect(ch.post);
      ch.instId = track.inst;
    }
    const silent = opts.solo ? track.id !== opts.solo : track.mute;
    const set = (param, value, tau) => {
      // a brand-new channel takes its values at once; later changes glide
      if (ch.fresh) param.value = value; else param.setTargetAtTime(value, t, tau);
    };
    set(ch.vol.gain, track.vol * track.vol * 1.3, 0.015);
    set(ch.mute.gain, silent ? 0 : 1, 0.012);
    set(ch.pan.pan, track.pan || 0, 0.02);
    set(ch.rev.gain, (track.rev || 0) * 0.5, 0.02);
    set(ch.dly.gain, (track.dly || 0) * 0.5, 0.02);
    ch.fresh = false;
    return ch;
  };

  g.removeTrack = (id) => {
    const ch = g.channels.get(id);
    if (!ch) return;
    g.killTrack(id, ctx.currentTime);
    try { ch.pan.disconnect(); } catch (e) { /* gone */ }
    if (ch.insert && ch.insert.stop) ch.insert.stop();
    g.channels.delete(id);
  };

  // Play the notes of one bubble. Returns handles to release/kill.
  g.playCell = (track, row, col, chord, vel, t, dur, acc = 0) => {
    const ch = channel(track);
    const inst = instrumentById(track.inst);
    if (inst.id === 'drums') { const p = padFor(track, row, col); return [g.playDrum(track, p.idx, vel, t, p.rate)]; }
    const notes = cellNotes(g.project, track, row, col, chord, acc);
    // steal the oldest voices if this would exceed the instrument's polyphony
    ch.voices = ch.voices.filter((v) => !v.ended && v.until > t);
    while (ch.voices.length + notes.length > inst.poly && ch.voices.length) {
      ch.voices.shift().kill(t);
    }
    const scale = notes.length > 1 ? 1 / Math.sqrt(notes.length * 0.75) : 1;
    return notes.map((m, i) => {
      if (m < 12 || m > 120) return null;
      const h = startVoice(ctx, sh, inst, ch.bus, m, vel * scale, t + i * inst.strum, dur);
      ch.voices.push(h);
      return h;
    }).filter(Boolean);
  };

  g.playDrum = (track, padIdx, vel, t, rate = 1) => {
    const ch = channel(track);
    const pad = DRUM_PADS[padIdx];
    const buffer = g.kit && g.kit.buffers[padIdx];
    if (!pad || !buffer) return { release() {}, kill() {}, until: 0 };
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gn = ctx.createGain();
    gn.gain.value = 0.2 + 0.8 * vel * vel;
    if (rate !== 1) src.playbackRate.value = rate;
    src.connect(gn).connect(ch.bus);
    src.start(t);
    if (pad.kind === 'kick' && !track.mute) {
      // sidechain: every kick pushes the ducked tracks down for a moment
      for (const other of g.project.tracks) {
        if (!other.duck || other.id === track.id) continue;
        const oc = g.channels.get(other.id);
        if (!oc) continue;
        oc.duck.gain.setTargetAtTime(1 - 0.75 * other.duck, t, 0.004);
        oc.duck.gain.setTargetAtTime(1, t + 0.04, 0.07);
      }
    }
    const h = {
      t, until: t + buffer.duration / rate,
      release() {},
      kill(tk) {
        const at = Math.max(tk, ctx.currentTime);
        if (t >= at) { gn.gain.setValueAtTime(0, at); try { src.stop(at); } catch (e) { /* done */ } }
      },
      choke(tc) {
        gn.gain.setTargetAtTime(0, tc, 0.006);
        try { src.stop(tc + 0.05); } catch (e) { /* done */ }
      },
    };
    if (!sh.offline) src.onended = () => { try { gn.disconnect(); } catch (e) { /* gone */ } };
    if (pad.choke) {
      (ch.open[pad.choke] || []).forEach((o) => o.choke(t));
      ch.open[pad.choke] = [];
    }
    if (pad.group) (ch.open[pad.group] = ch.open[pad.group] || []).push(h);
    ch.voices = ch.voices.filter((v) => v.until > t);
    ch.voices.push(h);
    return h;
  };

  g.killTrack = (id, t) => {
    const ch = g.channels.get(id);
    if (!ch) return;
    ch.voices.forEach((v) => v.kill(t));
    ch.voices = [];
  };
  g.killAll = (t) => { for (const id of g.channels.keys()) g.killTrack(id, t); };

  // metronome: straight to the speakers, never part of an export
  g.click = (t, accent) => {
    if (opts.offline) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = accent ? 1760 : 1175;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(accent ? 0.3 : 0.2, t + 0.001);
    gn.gain.setTargetAtTime(0, t + 0.002, 0.012);
    o.connect(gn).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.1);
  };

  project.tracks.forEach(channel);
  return g;
}

// Deep Drift sound engine. Everything is synthesised with Web Audio.
//
//   voices -> echo loops -> tape (wobble, saturation, hiss, dropouts)
//          -> depth (darkening filter + long reverb) -> sleep fader -> out
//
// Notes ring for seconds. A tapped note comes back on its own loop, each
// orb at a different length, a little quieter and duller every time, until
// it fades: the music keeps moving without being played.

const PENTA = {
  deep:   { name: 'Deep',   steps: [0, 3, 5, 7, 10] },   // minor pentatonic
  moon:   { name: 'Moonlit', steps: [0, 2, 4, 7, 9] },   // major pentatonic
  mist:   { name: 'Mist',   steps: [0, 2, 3, 7, 9] },    // kumoi
};
export const MOODS = PENTA;
export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// the orbs: a scale over two and a half octaves from low A
export function orbNotes(mood, root = 45, count = 12) {
  const st = (PENTA[mood] || PENTA.deep).steps, out = [];
  for (let i = 0; i < count; i++) out.push(root + 12 * Math.floor(i / 5) + st[i % 5]);
  return out;
}

function noiseBuffer(ctx, seconds = 4) {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
  return b;
}

// a long, dark, slowly blooming reverb tail
function hall(ctx, seconds) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), b = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = 99 + c * 7919, lp = 0, e = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const w = s / 1073741823.5 - 1, x = i / sr;
      lp += (0.08 + 0.5 * Math.exp(-x * 1.4)) * (w - lp);           // darkens as it fades
      const swell = Math.min(1, x / 0.25);                           // soft bloom, no hard reflection
      d[i] = lp * swell * Math.exp(-6.9 * x / seconds);
      e += d[i] * d[i];
    }
    const k = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) d[i] *= k;
  }
  return b;
}

// ---------- voices: each returns { out, release(t), stopAt } ----------

function env(ctx, g, t, peak, attack, hold) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  if (hold != null) g.gain.setTargetAtTime(0, t + attack + hold, hold * 0.6 + 0.4);
}

const VOICES = {
  // warm, wide pad
  pad(ctx, f, t, v, hold) {
    const out = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(f * 1.5, t);
    lp.frequency.linearRampToValueAtTime(Math.min(5000, f * 5), t + 2.5);
    const oscs = [-9, 0, 8].map((d, i) => { const o = ctx.createOscillator(); o.type = i === 1 ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.start(t); return o; });
    const mix = ctx.createGain(); mix.gain.value = 0.18;
    oscs.forEach((o) => o.connect(mix));
    mix.connect(lp).connect(out);
    env(ctx, out, t, v, 1.6, hold);
    return { out, oscs, release: 3.5 };
  },
  // glassy bell that blooms then rings
  glass(ctx, f, t, v, hold) {
    const out = ctx.createGain(), car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
    car.frequency.value = f * 2; mod.frequency.value = f * 2 * 3.51;
    mg.gain.setValueAtTime(f * 3, t); mg.gain.setTargetAtTime(f * 0.2, t, 0.6);
    mod.connect(mg).connect(car.frequency);
    car.connect(out); car.start(t); mod.start(t);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(v * 0.55, t + 0.02);
    out.gain.setTargetAtTime(0, t + 0.02, hold != null ? Math.max(1.2, hold) : 2.5);
    return { out, oscs: [car, mod], release: 2, life: (hold != null ? Math.max(1.2, hold) : 2.5) * 6 };
  },
  // soft "ooh" choir
  choir(ctx, f, t, v, hold) {
    const out = ctx.createGain(), mix = ctx.createGain(); mix.gain.value = 0.22;
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 4.6; vg.gain.value = 7;
    vib.connect(vg); vib.start(t);
    const oscs = [-7, 6].map((d) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; vg.connect(o.detune); o.connect(mix); o.start(t); return o; });
    [[400, 6, 1], [800, 8, 0.4], [2600, 10, 0.12]].forEach(([fc, q, g]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = g * 3;
      mix.connect(bp).connect(gg).connect(out);
    });
    env(ctx, out, t, v, 1.2, hold);
    return { out, oscs: [...oscs, vib], release: 3 };
  },
  // low hum with slow beating
  drone(ctx, f, t, v, hold) {
    const out = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 4;
    const oscs = [[f / 2, 0, 'sine', 0.5], [f / 2, 4, 'triangle', 0.3], [f, -3, 'sine', 0.25], [f * 1.5, 2, 'sine', 0.08]].map(([fr, d, ty, g]) => {
      const o = ctx.createOscillator(), gg = ctx.createGain(); o.type = ty; o.frequency.value = fr; o.detune.value = d; gg.gain.value = g;
      o.connect(gg).connect(lp); o.start(t); return o;
    });
    lp.connect(out);
    env(ctx, out, t, v * 0.9, 2.5, hold);
    return { out, oscs, release: 5 };
  },
};
export const VOICE_NAMES = { pad: 'Pad', glass: 'Glass', choir: 'Choir', drone: 'Low' };

// ---------- the engine ----------

export class Drift {
  constructor(ctx, dest = ctx.destination) {
    this.ctx = ctx;
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.voiceName = 'pad';
    this.loops = [];               // echoes in flight: { at, note, level, n, period, orb }
    this.onNote = null;            // (orb, level) for the visuals
    this.input = G();
    this.bus = G(); this.bus.connect(this.input);   // replaced after a sleep fade, cutting off scheduled echoes

    // tape: wobble (a modulated delay), saturation, hiss, dropouts
    const wob = ctx.createDelay(0.1); wob.delayTime.value = 0.02;
    this.wowLfo = ctx.createOscillator(); this.wowLfo.frequency.value = 0.45;
    this.flutLfo = ctx.createOscillator(); this.flutLfo.frequency.value = 6.3;
    this.wowAmt = G(0); this.flutAmt = G(0);
    this.wowLfo.connect(this.wowAmt).connect(wob.delayTime);
    this.flutLfo.connect(this.flutAmt).connect(wob.delayTime);
    this.wowLfo.start(); this.flutLfo.start();
    this.sat = ctx.createWaveShaper();
    this.setDrive(0);
    this.drop = G(1);                // random dropouts dip this
    this.hiss = ctx.createBufferSource(); this.hiss.buffer = noiseBuffer(ctx); this.hiss.loop = true;
    const hissBp = ctx.createBiquadFilter(); hissBp.type = 'highpass'; hissBp.frequency.value = 3500;
    this.hissAmt = G(0);
    this.hiss.connect(hissBp).connect(this.hissAmt); this.hiss.start();
    this.input.connect(wob).connect(this.sat).connect(this.drop);

    // depth: everything darker and further away as it rises
    this.dark = ctx.createBiquadFilter(); this.dark.type = 'lowpass'; this.dark.frequency.value = 9000; this.dark.Q.value = 0.4;
    this.drop.connect(this.dark); this.hissAmt.connect(this.dark);
    this.verb = ctx.createConvolver(); this.verb.normalize = false; this.verb.buffer = hall(ctx, 9);
    this.dry = G(0.7); this.wet = G(1.4);
    // the hall only hears the mids: a 9 s tail on bass turns to mud and overloads
    const verbHp = ctx.createBiquadFilter(); verbHp.type = 'highpass'; verbHp.frequency.value = 180;
    this.dark.connect(this.dry); this.dark.connect(verbHp).connect(this.verb).connect(this.wet);
    // sleep fader and a gentle safety limiter
    this.sleep = G(1); this.master = G(0.45);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -12; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.4;
    this.dry.connect(this.master); this.wet.connect(this.master);
    // a soft clipper after the limiter catches anything it is too slow for
    const clip = ctx.createWaveShaper(), cv = new Float32Array(2049);
    for (let i = 0; i < cv.length; i++) { const x = (i / 1024 - 1) * 2; cv[i] = 0.95 * Math.tanh(x / 0.95); }
    clip.curve = cv;
    this.master.connect(this.sleep).connect(lim).connect(clip).connect(dest);
    this.out = clip;

    this.params = { depth: 0.5, tide: 0.5, tape: 0.3 };
    this.apply();
    this.bg = null;
  }

  setDrive(amount) {
    const n = 1024, c = new Float32Array(n), k = 1 + amount * 6;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    this.sat.curve = c;
  }

  // depth, tide, tape: 0..1
  set(name, v) { this.params[name] = Math.max(0, Math.min(1, v)); this.apply(); }
  apply(t = this.ctx.currentTime) {
    const { depth, tape } = this.params;
    this.dark.frequency.setTargetAtTime(9000 * Math.pow(0.08, depth), t, 0.3);   // 9 kHz down to ~700 Hz
    this.wet.gain.setTargetAtTime(0.12 + 0.3 * depth, t, 0.3);
    this.dry.gain.setTargetAtTime(0.9 - 0.5 * depth, t, 0.3);
    this.wowAmt.gain.setTargetAtTime(0.0035 * tape, t, 0.3);
    this.flutAmt.gain.setTargetAtTime(0.00025 * tape, t, 0.3);
    this.hissAmt.gain.setTargetAtTime(0.012 * tape * tape, t, 0.3);
    if (Math.abs((this._drive || 0) - tape) > 0.05) { this._drive = tape; this.setDrive(tape * 0.8); }
  }

  // play one note now (or at t); hold: seconds before it fades, or null to sustain until release()
  note(midi, level = 0.8, t = this.ctx.currentTime, hold = 2.5, voice = this.voiceName) {
    const v = VOICES[voice](this.ctx, midiToFreq(midi), t, level * 0.5, hold);
    const pan = this.ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 0.8;
    v.out.connect(pan).connect(this.bus);
    const end = (at) => v.oscs.forEach((o) => { try { o.stop(at); } catch (e) { /* stopped */ } });
    const life = v.life || (hold != null ? hold + 1.6 + v.release * 5 : null);
    if (life) end(t + life);
    v.oscs[0].onended = () => { try { pan.disconnect(); } catch (e) { /* gone */ } };
    return {
      release: (at = this.ctx.currentTime) => {
        v.out.gain.cancelScheduledValues(at);
        v.out.gain.setTargetAtTime(0, at, v.release / 3);
        end(at + v.release * 2.5);
      },
    };
  }

  // a tap: the note now, then its echoes on this orb's own loop length.
  // Every echo is put on the audio clock straight away, so the trail plays
  // out even when the page is hidden and its timers are slowed to a crawl.
  tap(orb, midi, level = 0.8) {
    const now = this.ctx.currentTime, voice = this.voiceName, period = 5.3 + (orb * 2.71) % 9.4;
    this.note(midi, level, now, 2.5, voice);
    if (this.onNote) this.onNote(orb, level);
    // the tide decides how many times it comes back
    const events = [];
    let lv = level;
    for (let k = 1, n = Math.round(2 + this.params.tide * 10); k <= n; k++) {
      lv *= 0.78;
      if (lv <= 0.04) break;
      // echoes drift: a little out of time, now and then up an octave
      const at = now + k * period + Math.random() * 0.05, up = Math.random() < 0.12 * this.params.tide ? 12 : 0;
      this.note(midi + up, lv, at, 2.5, voice);          // each loop keeps its own voice
      events.push({ at, level: lv });
    }
    this.loops.push({ orb, events });
  }

  hold(orb, midi, level = 0.8) {
    if (this.onNote) this.onNote(orb, level);
    return this.note(midi, level, this.ctx.currentTime, null);
  }

  // call often (e.g. every 50 ms): fires due echoes and drifts the tape
  tick() {
    const now = this.ctx.currentTime;
    // the echoes are already scheduled; this only lights up the orbs as they sound
    for (const l of this.loops) {
      while (l.events.length && now >= l.events[0].at) {
        const e = l.events.shift();
        if (this.onNote && now - e.at < 1) this.onNote(l.orb, e.level);
      }
    }
    this.loops = this.loops.filter((l) => l.events.length);
    // tape dropouts: brief dips, more often with more tape
    if (Math.random() < 0.004 * this.params.tape * this.params.tape) {
      const d = 0.15 + Math.random() * 0.4;
      this.drop.gain.setTargetAtTime(0.25, now, 0.03);
      this.drop.gain.setTargetAtTime(1, now + d, 0.08);
    }
    // wow speed wanders
    this.wowLfo.frequency.setTargetAtTime(0.3 + Math.random() * 0.4, now, 2);
  }

  // the background drone: root and fifth, slowly breathing
  background(on, rootMidi) {
    const t = this.ctx.currentTime;
    if (this.bg) { this.bg.forEach((h) => h.release(t)); this.bg = null; }
    if (!on) return;
    this.bg = [this.note(rootMidi - 12, 0.5, t, null, 'drone'), this.note(rootMidi - 5, 0.3, t + 1.5, null, 'drone')];
  }

  // fade everything out over `seconds`, starting `after` seconds from now, then
  // call done(). The fade is on the audio clock, so it happens on time even
  // with the screen off; done() may come late, but by then all is silent.
  fadeOut(seconds, done, after = 0) {
    const t = this.ctx.currentTime;
    this.sleep.gain.cancelScheduledValues(t);
    this.sleep.gain.setValueAtTime(this.sleep.gain.value, t);
    this.sleep.gain.setValueAtTime(1, t + after);
    this.sleep.gain.linearRampToValueAtTime(0, t + after + seconds);
    clearTimeout(this._fadeTimer);
    this._fadeTimer = setTimeout(() => {
      this.loops = []; this.background(false);
      // cut off any echoes still waiting on the clock
      const old = this.bus; this.bus = this.ctx.createGain(); this.bus.connect(this.input);
      old.gain.value = 0; setTimeout(() => old.disconnect(), 100);
      if (done) done();
    }, (after + seconds) * 1000 + 200);
  }
  wake() {
    clearTimeout(this._fadeTimer);
    const t = this.ctx.currentTime;
    this.sleep.gain.cancelScheduledValues(t);
    this.sleep.gain.setTargetAtTime(1, t, 0.3);
  }
}

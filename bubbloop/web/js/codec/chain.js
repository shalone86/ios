// Export mastering: the chain a mastering engineer would put on a pop mix,
// in the same order as a typical Ozone chain:
//
//   tape -> stabiliser -> dynamics -> imager -> glue compressor -> maximizer
//
//   Tape        warm saturation with a low "head bump" and soft top end
//   Stabiliser  slowly nudges the tonal balance toward a pop curve, one
//               third-octave band at a time, so no region pokes out
//   Dynamics    three-band compressor (lows, mids, highs) for density, then
//               a per-band peak limiter that shaves drum transients; every
//               threshold follows that band's own typical level
//   Imager      bass in mono, mids as they are, highs a little wider
//   Glue        slow, gentle bus compressor that makes it one performance
//   Maximizer   soft clipper then a look-ahead limiter, driven until the
//               song reaches its loudness target, held under a true-peak
//               ceiling (measured with 4x oversampling, like a streaming
//               service does)
//
// Everything works on Float32 stereo in place and runs in the export worker.

import { loudness, peakOf } from './master.js';

// ---------- presets (ids match MASTERS in graph.js) ----------

export const CHAINS = {
  sweet: {      // Pop: bright, polished, competitive
    lufs: -8, tape: 0.35, bump: 1, air: -0.5, stab: 0.5, tilt: -3.2,
    bands: [[-5, 2.2, 25, 160], [-4, 1.8, 12, 120], [-5, 2.2, 4, 80]],
    width: [0, 1.05, 1.25], glue: [2, 30, 180], clip: 2,
    peakRoom: [9, 7, 7], maxSquash: 4,
  },
  punchy: {     // big drums: lows held tighter, transients left to the clipper
    lufs: -8, tape: 0.45, bump: 1.5, air: 0, stab: 0.4, tilt: -3.5,
    bands: [[-6, 3, 30, 120], [-3, 1.6, 15, 120], [-4, 2, 3, 70]],
    width: [0, 1, 1.2], glue: [1.6, 30, 120], clip: 3, release: 60,
    peakRoom: [9, 8, 8], maxSquash: 4,
  },
  cozy: {       // warm lo-fi: more tape, darker top, less loud on purpose
    lufs: -10, tape: 0.8, bump: 2, air: -3, stab: 0.3, tilt: -4.2,
    bands: [[-5, 2, 30, 200], [-4, 1.6, 15, 160], [-6, 2.4, 5, 100]],
    width: [0, 1, 1.1], glue: [2.2, 40, 250], clip: 1.5, release: 120,
    peakRoom: [10, 8, 7], maxSquash: 2.5,
  },
  loud: {       // club and car: as loud as it gets without falling apart
    lufs: -6.5, tape: 0.55, bump: 1, air: 0.5, stab: 0.5, tilt: -3,
    bands: [[-7, 3, 20, 120], [-6, 2.4, 10, 100], [-7, 2.6, 3, 60]],
    width: [0, 1.05, 1.3], glue: [2.4, 25, 120], clip: 4, release: 50,
    peakRoom: [8, 6, 6], maxSquash: 6,
  },
  stream: {     // streaming services turn everything to -14 anyway
    lufs: -14, tape: 0.25, bump: 0.5, air: 0, stab: 0.35, tilt: -3.2,
    bands: [[-3, 1.6, 30, 200], [-3, 1.4, 15, 150], [-3, 1.6, 5, 100]],
    width: [0, 1, 1.15], glue: [1.5, 30, 200], clip: 0,
    peakRoom: [null, null, null], maxSquash: 3,
  },
};

const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (g) => 20 * Math.log10(Math.max(1e-12, g));

// ---------- filters ----------

// RBJ cookbook biquad coefficients, normalised so a0 = 1.
function design(type, f, sr, q = Math.SQRT1_2, db = 0) {
  const w = 2 * Math.PI * f / sr, cw = Math.cos(w), sw = Math.sin(w);
  const A = Math.pow(10, db / 40), al = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'low') {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
    a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
  } else if (type === 'high') {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function run(x, c, out = new Float32Array(x.length)) {
  const [b0, b1, b2, a1, a2] = c;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

// Linkwitz-Riley 4th order: two Butterworth sections. Its low and high
// halves add back to an all-pass, so a band split leaves the sum flat.
const lr4 = (x, type, f, sr) => { const c = design(type, f, sr); return run(run(x, c), c); };
const allpass = (x, f, sr) => { const lo = lr4(x, 'lp', f, sr), hi = lr4(x, 'hp', f, sr); for (let i = 0; i < x.length; i++) lo[i] += hi[i]; return lo; };

// low / mid / high, each phase-matched so they add back up cleanly
function split3(x, sr, f1 = 120, f2 = 3000) {
  const low = allpass(lr4(x, 'lp', f1, sr), f2, sr);
  const rest = lr4(x, 'hp', f1, sr);
  return [low, lr4(rest, 'lp', f2, sr), lr4(rest, 'hp', f2, sr)];
}

// ---------- 1. tape ----------

function tape(chs, sr, p) {
  if (!p.tape) return;
  const bump = design('low', 90, sr, 0.8, p.bump), air = design('high', 11000, sr, 0.7, p.air);
  const k = 1 + 3 * p.tape;                     // drive
  const bias = 0.08 * p.tape;                   // asymmetry: a little even-harmonic warmth
  const norm = 1 / (Math.tanh(k + bias) - Math.tanh(bias));
  const dc = Math.tanh(bias);
  chs.forEach((c, i) => {
    const y = run(run(c, bump), air);
    let hp = 0, prev = 0;                       // remove the DC the bias adds
    for (let n = 0; n < y.length; n++) {
      const v = y[n];
      // blend: clean below about -12 dBFS, rounder as it gets louder
      const s = (Math.tanh(k * v + bias) - dc) * norm;
      const w = Math.min(1, Math.abs(v) * 2.5);
      const out = v * (1 - w * p.tape) + s * w * p.tape;
      hp = 0.9995 * (hp + out - prev); prev = out;
      y[n] = hp;
    }
    chs[i].set(y);
  });
}

// ---------- 2. stabiliser ----------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Third-octave bands from 63 Hz to 12.5 kHz. For each, the level is
// followed slowly (about a second) and compared with a straight pop slope
// through the song's own average; the band is then turned up or down by part
// of the difference, at most a few dB. Gains are applied with a 2048-point
// short-time transform, the same gains on both channels so the image holds.
function stabilise(chs, sr, p) {
  if (!p.stab) return;
  const N = 2048, HOP = N / 4, HALF = N / 2, len = chs[0].length;
  const centres = [];
  for (let f = 63; f <= 12600; f *= Math.pow(2, 1 / 3)) centres.push(f);
  const binF = (k) => k * sr / N;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const frames = Math.ceil((len + N) / HOP);

  // pass 1: band levels per frame, from the mid signal
  const lv = centres.map(() => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - N;
    // left and right in one transform (L as real, R as imaginary part)
    for (let i = 0; i < N; i++) {
      const j = start + i, inside = j >= 0 && j < len;
      re[i] = inside ? chs[0][j] * win[i] : 0;
      im[i] = inside ? chs[1][j] * win[i] : 0;
    }
    fft(re, im);
    centres.forEach((c, b) => {
      const lo = c / Math.pow(2, 1 / 6), hi = c * Math.pow(2, 1 / 6);
      let e = 0, n = 0;
      for (let k = Math.max(1, Math.floor(lo * N / sr)); k <= Math.min(HALF, Math.ceil(hi * N / sr)); k++) {
        // mid = (L + R) / 2, unpacked from the shared transform
        const k2 = (N - k) % N;
        const lr = (re[k] + re[k2]) / 2, li = (im[k] - im[k2]) / 2;      // L(k)
        const rr = (im[k] + im[k2]) / 2, ri = (re[k2] - re[k]) / 2;      // R(k)
        const mr = (lr + rr) / 2, mi = (li + ri) / 2;
        e += mr * mr + mi * mi; n++;
      }
      lv[b][f] = 10 * Math.log10(e / Math.max(1, n) + 1e-20);
    });
  }
  // slow follower (about 1 s), then the gain each band should get
  const tc = Math.exp(-1 / (sr / HOP));
  const gainDb = centres.map(() => new Float32Array(frames));
  const smooth = centres.map(() => -200);
  for (let f = 0; f < frames; f++) {
    const cur = centres.map((c, b) => {
      smooth[b] = smooth[b] < -150 ? lv[b][f] : tc * smooth[b] + (1 - tc) * lv[b][f];
      return smooth[b];
    });
    // the pop slope through this moment's average level
    const oct = centres.map((c) => Math.log2(c / 1000));
    const mean = cur.reduce((a, v) => a + v, 0) / cur.length;
    const target = oct.map((o) => mean + p.tilt * o);
    const loud = mean > -110;
    centres.forEach((c, b) => {
      // cut what pokes out freely; lift dips only gently, and never the sub,
      // which would cost headroom for almost no loudness
      const maxUp = c < 100 ? 0 : 1.5;
      const want = loud ? Math.max(-4, Math.min(maxUp, (target[b] - cur[b]) * p.stab)) : 0;
      gainDb[b][f] = want;
    });
  }
  // apply: per-bin gain interpolated across bands (in octaves); the mapping
  // from bin to band is worked out once
  const bandOct = centres.map((c) => Math.log2(c));
  const bb = new Int32Array(HALF + 1), bt = new Float64Array(HALF + 1), edge = new Float64Array(HALF + 1);
  for (let k = 0; k <= HALF; k++) {
    const fr = binF(k);
    if (fr < 40 || fr > 16000) { bb[k] = -1; continue; }
    const o = Math.log2(Math.max(fr, centres[0]));
    let b = 0;
    while (b < centres.length - 2 && bandOct[b + 1] < o) b++;
    bb[k] = b;
    bt[k] = Math.max(0, Math.min(1, (o - bandOct[b]) / (bandOct[b + 1] - bandOct[b])));
    edge[k] = fr < 63 ? (fr - 40) / 23 : fr > 12600 ? (16000 - fr) / 3400 : 1;     // fade back to unity at the ends
  }
  const binGain = new Float64Array(HALF + 1);
  const outs = chs.map(() => new Float64Array(len + 2 * N));
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k <= HALF; k++) {
      const b = bb[k];
      binGain[k] = b < 0 ? 1 : dbToGain((gainDb[b][f] * (1 - bt[k]) + gainDb[b + 1][f] * bt[k]) * edge[k]);
    }
    const start = f * HOP - N;
    // one transform carries both channels; a gain that is the same for bin k
    // and bin N-k scales each channel's spectrum without mixing them
    for (let i = 0; i < N; i++) {
      const j = start + i, inside = j >= 0 && j < len;
      re[i] = inside ? chs[0][j] * win[i] : 0;
      im[i] = inside ? chs[1][j] * win[i] : 0;
    }
    fft(re, im);
    for (let k = 0; k <= HALF; k++) {
      re[k] *= binGain[k]; im[k] *= binGain[k];
      if (k > 0 && k < HALF) { re[N - k] *= binGain[k]; im[N - k] *= binGain[k]; }
    }
    for (let i = 0; i < N; i++) im[i] = -im[i];        // inverse via the conjugate trick
    fft(re, im);
    for (let i = 0; i < N; i++) {
      const w = win[i] / (1.5 * N);
      outs[0][start + N + i] += re[i] * w;
      outs[1][start + N + i] -= im[i] * w;
    }
  }
  chs.forEach((ch, c) => { for (let i = 0; i < len; i++) ch[i] = outs[c][i + N]; });
}

// ---------- compressor core ----------

// Stereo-linked feed-forward compressor on a pair of signals, in place.
// thr dBFS, ratio, attack/release in ms, soft knee 6 dB. Returns average
// gain reduction in dB (for the report).
function compress(L, R, sr, thr, ratio, attMs, relMs, rmsMs = 5) {
  const at = Math.exp(-1 / (sr * attMs / 1000)), rt = Math.exp(-1 / (sr * relMs / 1000));
  const rc = Math.exp(-1 / (sr * rmsMs / 1000));
  const knee = 6;
  let env = 0, gr = 0, sum = 0, n = 0;
  for (let i = 0; i < L.length; i++) {
    const p = Math.max(L[i] * L[i], R[i] * R[i]);
    env = rc * env + (1 - rc) * p;
    const lvl = 10 * Math.log10(env + 1e-20);
    const over = lvl - thr;
    let want = 0;
    if (over > knee / 2) want = over * (1 - 1 / ratio);
    else if (over > -knee / 2) want = (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee);
    gr = want > gr ? at * gr + (1 - at) * want : rt * gr + (1 - rt) * want;
    const g = dbToGain(-gr);
    L[i] *= g; R[i] *= g;
    if (lvl > -60) { sum += gr; n++; }
  }
  return n ? sum / n : 0;
}

// The level a signal sits at most of the time: 70th percentile of 400 ms
// blocks, in dBFS (max of the two channels).
function typical(L, R, sr) {
  const blk = Math.floor(sr * 0.4), lv = [];
  for (let s = 0; s + blk <= L.length; s += blk) {
    let e = 0;
    for (let i = s; i < s + blk; i++) e += Math.max(L[i] * L[i], R[i] * R[i]);
    if (e > 0) lv.push(10 * Math.log10(e / blk));
  }
  lv.sort((a, b) => a - b);
  return lv.length ? lv[Math.floor(lv.length * 0.7)] : -20;
}

// ---------- 3. dynamics, 4. imager ----------

function dynamicsAndImage(chs, sr, p, report) {
  const [L, R] = chs;
  const bl = split3(L, sr), br = split3(R, sr);
  report.bands = p.bands.map(([under, ratio, att, rel], b) => {
    const t = typical(bl[b], br[b], sr);
    const gr = compress(bl[b], br[b], sr, t + under, ratio, att, rel);
    // then shave the band's transients: peaks more than `peakRoom` dB over
    // its typical level are limited within the band, so a snare hit never
    // ducks the bass and a kick never ducks the vocal range
    const room = p.peakRoom[b];
    if (room != null) limiter([bl[b], br[b]], sr, dbToGain(typical(bl[b], br[b], sr) + room), 1.5, [60, 40, 25][b]);
    return +gr.toFixed(2);
  });
  for (let i = 0; i < L.length; i++) {
    let l = 0, r = 0;
    for (let b = 0; b < 3; b++) {
      const m = (bl[b][i] + br[b][i]) * 0.5, s = (bl[b][i] - br[b][i]) * 0.5 * p.width[b];
      l += m + s; r += m - s;
    }
    L[i] = l; R[i] = r;
  }
}

// ---------- 5. glue ----------

function glue(chs, sr, p, report) {
  // threshold ~4 dB under the song's typical level, so the needle moves 1-2 dB
  const [ratio, att, rel] = p.glue;
  const [L, R] = chs;
  report.glue = +compress(L, R, sr, typical(L, R, sr) - 4, ratio, att, rel, 25).toFixed(2);
}

// ---------- 6. maximizer ----------

// 4x oversampled peak (true peak, as streaming meters read it), via a
// windowed-sinc interpolator.
const TP_TAPS = 32;
const tpKernel = (() => {
  const k = [];
  for (let ph = 1; ph < 4; ph++) {
    const row = [];
    for (let t = -TP_TAPS / 2 + 1; t <= TP_TAPS / 2; t++) {
      const x = t - ph / 4;
      const sinc = Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos(Math.PI * x / (TP_TAPS / 2));
      row.push(sinc * w);
    }
    k.push(row);
  }
  return k;
})();
export function truePeak(chs) {
  let peak = 0;
  for (const c of chs) {
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
      for (const row of tpKernel) {
        let s = 0;
        for (let t = 0; t < TP_TAPS; t++) { const j = i - TP_TAPS / 2 + 1 + t; if (j >= 0 && j < c.length) s += c[j] * row[t]; }
        if (Math.abs(s) > peak) peak = Math.abs(s);
      }
    }
  }
  return peak;
}

// Soft clipper for the very tops of transients. It only rounds off the top
// `dbAbove` dB of the loudest peaks (everything under that passes
// untouched); the limiter after it handles the rest smoothly.
function softClip(chs, ceiling, dbAbove) {
  if (!dbAbove) return 0;
  const top = peakOf(chs);
  if (top <= ceiling) return 0;
  const cut = Math.min(dbAbove, gainToDb(top / ceiling));
  const knee = top * dbToGain(-cut * 1.6);       // start rounding a little below where it bites
  const out = top * dbToGain(-cut);              // the loudest peak ends up here
  const span = out - knee;
  if (span <= 0) return 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) {
    const v = c[i], a = Math.abs(v);
    if (a > knee) c[i] = Math.sign(v) * (knee + span * Math.tanh((a - knee) / span));
  }
  return cut;
}

// Look-ahead brickwall limiter, linked across channels. Gain falls smoothly
// across the look-ahead window before a peak arrives and recovers over
// `relMs`; it never lets a sample past `ceiling`.
function limiter(chs, sr, ceiling, lookMs = 3, relMs = 80) {
  const n = chs[0].length, la = Math.max(1, Math.round(sr * lookMs / 1000));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (const c of chs) { const v = Math.abs(c[i]); if (v > a) a = v; }
    need[i] = a > ceiling ? ceiling / a : 1;
  }
  // the lowest gain any sample in the next `la` needs (sliding minimum)
  const g = new Float32Array(n), q = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = 0, j = 0; i < n; i++) {
    for (const end = Math.min(n - 1, i + la); j <= end; j++) { while (t > h && need[q[t - 1]] >= need[j]) t--; q[t++] = j; }
    while (q[h] < i) h++;
    g[i] = need[q[h]];
  }
  // release: recover exponentially, never above what is needed
  const k = Math.exp(-1 / (sr * relMs / 1000));
  let cur = 1;
  for (let i = 0; i < n; i++) { cur = Math.min(g[i], 1 - (1 - cur) * k); g[i] = cur; }
  // attack: average over the look-ahead. Every value averaged already covers
  // sample i, so the average still holds the ceiling, with no steps.
  let sum = 0, maxGr = 0;
  for (let i = 0; i < n; i++) {
    sum += g[i];
    if (i >= la) sum -= g[i - la];
    const v = sum / Math.min(i + 1, la);
    for (const c of chs) c[i] *= v;
    if (1 - v > maxGr) maxGr = 1 - v;
  }
  return gainToDb(1 - maxGr);
}

function scale(chs, g) { for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= g; }

// Raise the song to its target loudness under the true-peak ceiling. If the
// target would need more than `maxSquash` dB of average limiting, it stops
// there instead: a slightly quieter master beats a crushed one. Squash is
// measured as perceived loudness lost to the peak stages (LU), not raw energy,
// so trimming sub-bass peaks (which add little loudness) is not held against it.
function maximize(chs, sr, p, ceilingDb, report) {
  const ceil = dbToGain(ceilingDb);
  const sampleCeil = ceil * dbToGain(-0.2);
  const maxSquash = p.maxSquash || 3;
  const dry = chs.map((c) => Float32Array.from(c));
  const attempt = (push) => {
    chs.forEach((c, i) => c.set(dry[i]));
    scale(chs, dbToGain(push));
    const preLufs = loudness(chs, sr);
    const clip = softClip(chs, sampleCeil, p.clip);
    const lim = limiter(chs, sr, sampleCeil, 3, p.release || 80);
    const tp = truePeak(chs);
    if (tp > ceil) scale(chs, ceil / tp);
    const lufs = loudness(chs, sr);
    return { push, lufs, squash: preLufs - lufs, clip, lim };
  };
  let push = p.lufs - loudness(chs, sr), r = attempt(push);
  for (let k = 0; k < 6 && Math.abs(p.lufs - r.lufs) > 0.2; k++) {
    if (r.squash > maxSquash && r.lufs < p.lufs) break;           // stop short rather than crush it
    push += (p.lufs - r.lufs) * 0.9;
    r = attempt(push);
  }
  if (r.squash > maxSquash + 0.5) {
    // back off until the squash is acceptable
    for (let k = 0; k < 6 && r.squash > maxSquash; k++) { push -= (r.squash - maxSquash) * 0.8; r = attempt(push); }
  }
  Object.assign(report, { lufs: +r.lufs.toFixed(2), push: +r.push.toFixed(2), squashDb: +r.squash.toFixed(2),
    clipDb: +r.clip.toFixed(2), limitDb: +r.lim.toFixed(2), truePeak: +gainToDb(truePeak(chs)).toFixed(2) });
}

// ---------- the chain ----------

// id: a key of CHAINS. ceilingDb: true-peak ceiling. Returns a report of what
// each stage did (handy for tests and for showing the result).
// seamless: the audio is one pass of a loop that must join to itself. It is
// mastered as three copies end to end and the middle one kept, so every
// compressor and limiter is already in its looping state at both ends.
export function masterChain(chs, sr, id, { ceilingDb = -1, seamless = false } = {}) {
  const p = CHAINS[id];
  const before = loudness(chs, sr);
  const report = { preset: id || 'none', before: +before.toFixed(2) };
  if (!p || !Number.isFinite(before) || chs.length < 2) {
    const pk = truePeak(chs);
    if (pk > dbToGain(ceilingDb)) scale(chs, dbToGain(ceilingDb) / pk);
    report.after = +loudness(chs, sr).toFixed(2);
    return report;
  }
  const n = chs[0].length;
  let work = chs;
  if (seamless) {
    work = chs.map((c) => { const t = new Float32Array(n * 3); t.set(c, 0); t.set(c, n); t.set(c, 2 * n); return t; });
  }
  // start every song from the same level so the thresholds mean the same thing
  scale(work, dbToGain(-20 - before));
  tape(work, sr, p);
  stabilise(work, sr, p);
  dynamicsAndImage(work, sr, p, report);
  glue(work, sr, p, report);
  maximize(work, sr, p, ceilingDb, report);
  if (seamless) chs.forEach((c, i) => c.set(work[i].subarray(n, 2 * n)));
  report.after = +loudness(chs, sr).toFixed(2);
  report.truePeak = +gainToDb(truePeak(chs)).toFixed(2);
  return report;
}

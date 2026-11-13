// Formant-preserving pitch shift for the sampler's keyboard mode.
//
// Plain resampling moves everything in a sound together: the notes, and also
// the resonances (formants) that make a voice sound like that voice. Raise
// it a fifth and it turns into a chipmunk. Here pitch is still moved by
// resampling, which keeps every harmonic exactly in place and attacks crisp,
// and then a repair pass puts the formants back where they were:
//
//   1. analyse(): once per sample, the spectral envelope (the formant shape)
//      of every short frame is measured with the "true envelope" method.
//   2. shift(): for each note, the resampled sound goes through a short-time
//      Fourier transform and each bin is re-weighted by
//        (original envelope at this frequency) / (envelope that was dragged here)
//      Both come from the stored analysis, so a note costs only two FFTs per
//      frame. Only magnitudes change: nothing smears or goes phasey.
//
// As on any sampler, a higher note plays a little shorter.

const OSAMP = 4;

// In-place radix-2 complex FFT. inverse = true scales by 1/n.
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const hann = (n) => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return w;
};

// The "true envelope": cepstral smoothing (keep the first `lifter`
// coefficients) repeated, each time raising the target to whichever is
// higher, the spectrum or the last smoothing. It settles on a curve that
// rides over the tops of the harmonics, which is where the formants are,
// instead of averaging them down with the gaps in between.
function trueEnvelope(logMag, lifter, re, im, out, iters = 12) {
  const N = re.length, HALF = N / 2;
  const target = Float64Array.from(logMag);
  for (let it = 0; it < iters; it++) {
    for (let k = 0; k <= HALF; k++) {
      re[k] = target[k]; im[k] = 0;
      if (k > 0 && k < HALF) { re[N - k] = target[k]; im[N - k] = 0; }
    }
    fft(re, im, true);
    for (let n = lifter; n <= N - lifter; n++) { re[n] = 0; im[n] = 0; }
    for (let n = Math.max(1, lifter - 6); n < lifter; n++) {      // taper the cut
      const w = 0.5 + 0.5 * Math.cos(Math.PI * (n - (lifter - 6)) / 6);
      re[n] *= w; im[n] *= w; re[N - n] *= w; im[N - n] *= w;
    }
    fft(re, im, false);
    if (it < iters - 1) for (let k = 0; k <= HALF; k++) if (re[k] > target[k]) target[k] = re[k];
  }
  for (let k = 0; k <= HALF; k++) out[k] = re[k];
}

// Measure the formant shape of a sound, frame by frame.
// f0: the sound's fundamental in Hz if known (0 if not).
export function analyse(data, sr, f0 = 0) {
  // low voices need finer frequency resolution to keep harmonics apart
  const N = f0 > 0 && f0 < 140 ? 4096 : 2048;
  const HOP = N / OSAMP, HALF = N / 2;
  // detail fine enough to follow formants, coarse enough to step over harmonics
  const lifter = Math.max(18, Math.min(160 * N / 2048, Math.floor(0.8 * sr / (f0 > 40 ? f0 : 300))));
  const win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N), cre = new Float64Array(N), cim = new Float64Array(N);
  const logMag = new Float64Array(HALF + 1), tmp = new Float64Array(HALF + 1);
  const frames = [];
  for (let start = -N / 2; start < data.length; start += HOP) {
    for (let i = 0; i < N; i++) { const j = start + i; re[i] = (j >= 0 && j < data.length ? data[j] : 0) * win[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k <= HALF; k++) logMag[k] = Math.log(Math.hypot(re[k], im[k]) + 1e-9);
    trueEnvelope(logMag, lifter, cre, cim, tmp);
    frames.push(Float32Array.from(tmp));
  }
  return { sr, N, hop: HOP, offset: -N / 2, frames };
}

// Log-envelope of the original at sample position `pos` and bin position
// `bin` (both may be fractional), interpolated.
function envAt(an, pos, bin) {
  const HALF = an.N / 2;
  let f = (pos - an.offset - an.N / 2) / an.hop;
  f = Math.max(0, Math.min(an.frames.length - 1, f));
  const f0 = Math.floor(f), ft = f - f0, f1 = Math.min(an.frames.length - 1, f0 + 1);
  if (bin >= HALF) return Math.min(an.frames[f0][HALF], an.frames[f1][HALF]) - 4.6;   // ~-40 dB beyond the top
  const b0 = Math.floor(bin), bt = bin - b0;
  const A = an.frames[f0], B = an.frames[f1];
  const a = A[b0] * (1 - bt) + A[b0 + 1] * bt, b = B[b0] * (1 - bt) + B[b0 + 1] * bt;
  return a * (1 - ft) + b * ft;
}

// Move `data` by `semis` semitones, keeping its formants (optionally slid
// by `formant` semitones). `an` is analyse(data, ...).
export function shift(data, an, semis, formant = 0) {
  const sr = an.sr;
  const ratio = Math.pow(2, semis / 12), fbeta = Math.pow(2, formant / 12);
  const len = Math.max(1, Math.floor(data.length / ratio));
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) {            // 4-point cubic resampling
    const x = i * ratio, k = Math.floor(x), t = x - k;
    const a = data[k - 1] || 0, b = data[k] || 0, c = data[k + 1] || 0, d = data[k + 2] || 0;
    y[i] = b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  }
  if (Math.abs(semis) < 0.01 && Math.abs(formant) < 0.01) return y;

  const N = an.N, HOP = N / OSAMP, HALF = N / 2;
  const win = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const acc = new Float64Array(len + 2 * N);
  const gain = 1 / 1.5;                       // Hann in and out at 4x overlap sum to 1.5
  for (let start = -N; start < len; start += HOP) {
    for (let i = 0; i < N; i++) { const j = start + i; re[i] = (j >= 0 && j < len ? y[j] : 0) * win[i]; im[i] = 0; }
    fft(re, im, false);
    const pos = (start + N / 2) * ratio;      // the matching moment in the original
    for (let k = 0; k <= HALF; k++) {
      // what is at bin k now came from k / ratio; it should sound like k / fbeta did
      const lg = envAt(an, pos, k / fbeta) - envAt(an, pos, k / ratio);
      const g = Math.exp(Math.max(-6, Math.min(2.8, lg)));
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < HALF) { re[N - k] *= g; im[N - k] *= g; }
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) acc[start + N + i] += re[i] * win[i] * gain;
  }
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = acc[i + N];
  // same loudness as the plain resampled note, a clean ending, no overs
  let a = 0, b = 0;
  for (let i = 0; i < len; i++) { a += y[i] * y[i]; b += out[i] * out[i]; }
  const k = b > 0 ? Math.max(0.5, Math.min(2, Math.sqrt(a / b))) : 1;
  const fade = Math.min(len, Math.floor(sr * 0.01));
  for (let i = 0; i < len; i++) {
    let g = k;
    if (len - i < fade) g *= (len - i) / fade;
    out[i] = Math.max(-1, Math.min(1, out[i] * g));
  }
  return out;
}

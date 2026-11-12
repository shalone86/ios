// Final mastering for an exported file: measure loudness the way
// streaming services do (ITU-R BS.1770 / EBU R128), bring the song to a
// target level, and catch the peaks with a look-ahead limiter.

function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

// K-weighting: a high shelf for the head's acoustic effect + a low cut.
function kWeight(x, fs) {
  let K = Math.tan((Math.PI * 1681.974450955533) / fs);
  const Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const s = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  K = Math.tan((Math.PI * 38.13547087602444) / fs);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  return biquad(s, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

// Integrated loudness in LUFS (gated). Returns -Infinity for silence.
export function loudness(channels, fs) {
  const weighted = channels.map((c) => kWeight(c, fs));
  const block = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const n = weighted[0].length;
  if (n < block) return -Infinity;
  // running energy via a prefix sum per channel
  const prefix = weighted.map((w) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + w[i] * w[i];
    return p;
  });
  const powers = [];
  for (let start = 0; start + block <= n; start += hop) {
    let z = 0;
    for (const p of prefix) z += (p[start + block] - p[start]) / block;
    powers.push(z);
  }
  const toLufs = (z) => -0.691 + 10 * Math.log10(z);
  const abs = powers.filter((z) => z > 0 && toLufs(z) > -70);
  if (!abs.length) return -Infinity;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const rel = toLufs(mean(abs)) - 10;
  const gated = abs.filter((z) => toLufs(z) > rel);
  return gated.length ? toLufs(mean(gated)) : -Infinity;
}

export function peakOf(channels) {
  let peak = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
  return peak;
}

// Look-ahead limiter, both channels moved together so the image stays put.
export function limit(channels, fs, ceiling = 0.891, lookahead = 0.005, release = 0.12) {
  const n = channels[0].length;
  const la = Math.max(1, Math.round(lookahead * fs));
  const need = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (const c of channels) { const v = Math.abs(c[i]); if (v > a) a = v; }
    if (a > ceiling) { need[i] = ceiling / a; any = true; } else need[i] = 1;
  }
  if (!any) return 0;
  // 1. sliding minimum over the look-ahead window (monotonic queue)
  const ahead = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0, j = 0; i < n; i++) {
    const end = Math.min(n - 1, i + la);
    for (; j <= end; j++) {
      while (tail > head && need[queue[tail - 1]] >= need[j]) tail--;
      queue[tail++] = j;
    }
    while (queue[head] < i) head++;
    ahead[i] = need[queue[head]];
  }
  // 2. let the gain recover gently
  const k = Math.exp(-1 / (release * fs));
  let g = 1;
  for (let i = 0; i < n; i++) {
    g = Math.min(ahead[i], 1 - (1 - g) * k);
    ahead[i] = g;
  }
  // 3. smooth the attack with a moving average the length of the look-ahead
  let sum = 0, maxCut = 0;
  for (let i = 0; i < n; i++) {
    sum += ahead[i];
    if (i >= la) sum -= ahead[i - la];
    const gain = sum / Math.min(i + 1, la);
    need[i] = gain;
    if (1 - gain > maxCut) maxCut = 1 - gain;
  }
  for (const c of channels) for (let i = 0; i < n; i++) c[i] *= need[i];
  return maxCut;
}

// Mastering pass, in place. target: LUFS, or null to only guard the peaks.
export function finalize(channels, fs, { target = -14, ceilingDb = -1 } = {}) {
  const ceiling = Math.pow(10, ceilingDb / 20);
  const before = loudness(channels, fs);
  let gainDb = 0;
  if (target != null && Number.isFinite(before)) {
    gainDb = Math.max(-18, Math.min(18, target - before));
    const apply = (db) => {
      const g = Math.pow(10, db / 20);
      for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= g;
    };
    apply(gainDb);
    // limiting takes a little loudness away; make one correction for it
    const dry = channels.map((c) => Float32Array.from(c));
    limit(channels, fs, ceiling);
    const miss = target - loudness(channels, fs);
    if (miss > 0.3 && miss < 6) {
      for (let c = 0; c < channels.length; c++) channels[c].set(dry[c]);
      apply(miss);
      gainDb += miss;
      limit(channels, fs, ceiling);
    }
  } else {
    limit(channels, fs, ceiling);
  }
  return { before, after: loudness(channels, fs), gainDb, peak: peakOf(channels) };
}

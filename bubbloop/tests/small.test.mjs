// Small speakers: on a phone the deepest bass makes the speaker buzz and
// rumble, so with "Small speakers" on, what is below ~60 Hz is trimmed hard,
// the punch around 110 Hz stays, and off it changes nothing.
import { serve, openPage } from './lib.mjs';
const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };
const r = await page.evaluate(async () => {
  const S = await import('/js/state.js');
  const { buildGraph } = await import('/js/graph.js');
  const { getKit } = await import('/js/drums.js');
  const { scheduleRange, loopSegments } = await import('/js/seq.js');
  const SR = 44100, LEN = 8;
  async function render(small) {
    const p = S.demoProject();
    const ctx = new OfflineAudioContext(1, SR * LEN, SR);
    const g = buildGraph(ctx, p, await getKit(SR, p.key), { offline: false, master: true });
    g.master.small(small);
    const spt = 60 / (p.bpm * 96);
    for (const seg of loopSegments(p, 0, 2)) scheduleRange(g, p, seg, 0, seg.len, (tk) => 0.05 + tk * spt);
    return (await ctx.startRendering()).getChannelData(0);
  }
  // energy between lo and hi Hz, from an FFT of 8192-sample frames (clean band edges)
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len;
      for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k), sn = Math.sin(a * k), r2 = re[i + k + len / 2], i2 = im[i + k + len / 2];
        const tr = r2 * c - i2 * sn, ti = r2 * sn + i2 * c;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti; re[i + k] += tr; im[i + k] += ti;
      }
    }
  }
  async function band(x, lo, hi) {
    const N = 8192; let e = 0;
    for (let o = 0; o + N <= x.length; o += N) {
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let i = 0; i < N; i++) re[i] = x[o + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
      fft(re, im);
      for (let k = 1; k < N / 2; k++) { const f = k * SR / N; if (f >= lo && (!hi || f < hi)) e += re[k] * re[k] + im[k] * im[k]; }
    }
    return 10 * Math.log10(e + 1e-12);
  }
  const off = await render(false), on = await render(true);
  const out = {};
  for (const [name, lo, hi] of [['deep', 20, 50], ['punch', 90, 140], ['all', 20, 0]]) out[name] = [await band(off, lo, hi), await band(on, lo, hi)];
  return out;
});
const d = (k) => (r[k][1] - r[k][0]).toFixed(1);
console.log(`    deep bass (<50 Hz) ${d('deep')} dB · punch (90–140 Hz) ${d('punch')} dB · whole mix ${d('all')} dB`);
// compared with the whole mix (the master's compressor evens the overall level out)
const rel = (k) => (r[k][1] - r[k][0]) - (r.all[1] - r.all[0]);
check(rel('deep') < -12, `the deepest bass is trimmed hard (${rel('deep').toFixed(1)} dB against the mix)`);
check(Math.abs(rel('punch')) < 3, `the punch around 110 Hz stays (${rel('punch').toFixed(1)} dB against the mix)`);
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all small-speaker checks passed');
process.exit(failed ? 1 : 0);

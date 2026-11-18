// Recording from the microphone must not crackle, even when the screen is
// busy: a steady tone stands in for the mic, the page's main thread is
// blocked several times during the take, and the recording must come out
// complete (the right length) and smooth (no jumps that the tone itself
// does not have).
import { serve, openPage } from './lib.mjs';

const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };

const r = await page.evaluate(async () => {
  // a pretend microphone: a 220 Hz tone from another audio context
  navigator.mediaDevices.getUserMedia = async () => {
    const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain(), d = ac.createMediaStreamDestination();
    o.frequency.value = 220; g.gain.value = 0.5; o.connect(g).connect(d); o.start();
    return d.stream;
  };
  const { recordMic } = await import('/js/samples.js');
  const ctx = new AudioContext();
  await ctx.resume();
  const rec = await recordMic(ctx);
  const t0 = performance.now();
  // a busy screen: freeze the main thread four times for a quarter second
  for (let k = 0; k < 4; k++) {
    await new Promise((res) => setTimeout(res, 200));
    const until = performance.now() + 250; while (performance.now() < until) { /* busy */ }
  }
  await new Promise((res) => setTimeout(res, 300));
  const secs = (performance.now() - t0) / 1000;
  const sound = await rec.stop();
  const x = sound.data, sr = sound.sr;
  // skip the first 0.2 s while the pretend mic settles
  let worst = 0, gaps = 0;
  const a = Math.floor(0.2 * sr);
  for (let i = a + 2; i < x.length; i++) {
    const d2 = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
    worst = Math.max(worst, d2);
  }
  // a run of exact zeros in the middle of a steady tone is a dropped block
  let run = 0;
  for (let i = a; i < x.length; i++) { if (x[i] === 0) { run++; if (run === 64) gaps++; } else run = 0; }
  // the tone's own smoothness: second difference of a 220 Hz sine at amplitude 0.5
  const smooth = 0.5 * Math.pow(2 * Math.PI * 220 / sr, 2);
  return { worklet: rec.worklet, got: x.length / sr, secs, worst, smooth, gaps };
});
console.log(`    recorded ${r.got.toFixed(2)} s of ${r.secs.toFixed(2)} s, sharpest jump ${r.worst.toFixed(4)} (the tone's own: ${r.smooth.toFixed(4)}), ${r.gaps} gaps`);
check(r.worklet, 'the microphone is recorded on the audio thread');
check(Math.abs(r.got - r.secs) < 0.15, 'nothing is lost while the screen is busy (the take is complete)');
check(r.gaps === 0 && r.worst < r.smooth * 4, 'no gaps or crackles in the recording');
// too loud for the mic: a tone with its tops flattened gets its round peaks back
const dc = await page.evaluate(async () => {
  const { declip } = await import('/js/samples.js');
  const sr = 48000, n = sr, x = new Float32Array(n), truth = new Float32Array(n);
  for (let i = 0; i < n; i++) { truth[i] = 1.5 * Math.sin(2 * Math.PI * 180 * i / sr) + 0.2 * Math.sin(2 * Math.PI * 530 * i / sr); x[i] = Math.max(-1, Math.min(1, truth[i])); }
  const err = (y) => { let e = 0, s = 0; for (let i = 0; i < n; i++) { e += (y[i] - truth[i]) ** 2; s += truth[i] ** 2; } return 10 * Math.log10(e / s); };
  const before = err(x), fixed = declip(x), after = err(x);
  return { before, after, fixed };
});
console.log(`    clipped tone: ${dc.before.toFixed(1)} dB error before, ${dc.after.toFixed(1)} dB after repairing ${dc.fixed} flattened peaks`);
check(dc.fixed > 100 && dc.after < dc.before - 6, 'a recording too loud for the mic gets its flattened peaks rebuilt');
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all microphone checks passed');
process.exit(failed ? 1 : 0);

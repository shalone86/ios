// Sampler: a recorded sound is trimmed, its pitch found, stored, and then
// plays in tune across the bubbles (keyboard mode) or per bubble (kit mode),
// live and in a render.
import { serve, openPage } from './lib.mjs';
const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };
const r = await page.evaluate(async () => {
  const S = await import('/js/state.js'); const X = await import('/js/samples.js'); const { renderProject } = await import('/js/render.js'); const T = await import('/js/theory.js');
  const sr = 44100;
  // a plucked tone at 220 Hz (A3) with half a second of silence either side
  const raw = new Float32Array(sr * 2);
  for (let i = 0; i < sr; i++) { const t = i / sr; raw[i + sr / 2] = 0.3 * Math.exp(-t * 3) * (Math.sin(2 * Math.PI * 220 * t) + 0.4 * Math.sin(2 * Math.PI * 440 * t)); }
  const a = await X.addSample(raw, sr, 'pluck');
  const silent = await X.addSample(new Float32Array(sr), sr, 'nothing');
  const noise = new Float32Array(sr / 4); for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * Math.exp(-i / 2000);
  const hit = await X.addSample(noise, sr, 'hit');
  const p = S.newProject('s'); p.bpm = 120;
  const mel = p.tracks[3]; mel.inst = 'sampler'; mel.rev = 0; mel.dly = 0; mel.smp = { mode: 'keys', key: a.id, kit: {} };
  p.tracks = [mel]; p.sections[0].ev = { [mel.id]: [{ t: 0, d: 180, r: 1, c: 3, v: 0.9 }] };
  const want = T.midiToFreq(T.cellNotes(p, mel, 1, 3)[0]);
  const x = await renderProject(p, { what: 'loop', passes: 1, master: false });
  // pitch of the rendered note
  const d = x.channels[0].subarray(Math.floor(0.1 * sr), Math.floor(0.1 * sr) + 8192);
  const got = T.midiToFreq(X.detectPitch(d, sr));
  mel.smp = { mode: 'kit', key: null, kit: { 8: hit.id } };
  p.sections[0].ev[mel.id] = [{ t: 0, d: 24, r: 1, c: 3, v: 0.9 }, { t: 96, d: 24, r: 0, c: 0, v: 0.9 }];
  const y = await renderProject(p, { what: 'loop', passes: 1, master: false });
  const rms = (c, a0, b0) => { let s = 0; for (let i = Math.floor(a0 * sr); i < Math.floor(b0 * sr); i++) s += c[i] * c[i]; return Math.sqrt(s / ((b0 - a0) * sr)); };
  // round trip through a song file
  const packed = await X.packSamples([a.id]);
  return { dur: a.buffer.duration, root: a.root, pitched: a.pitched, silent: silent === null, hitPitched: hit.pitched, want, got,
    kitHit: rms(y.channels[0], 0.02, 0.2), kitEmpty: rms(y.channels[0], 0.55, 0.9), packed: !!packed[a.id] && packed[a.id].pcm.length > 1000, ids: X.sampleIds(p).length };
});
check(r.dur > 0.9 && r.dur < 1.2, `silence trimmed off both ends (${r.dur.toFixed(2)} s from a 2 s recording)`);
check(r.pitched && Math.abs(r.root - 57) < 0.2, `pitch found: A3 (MIDI ${r.root.toFixed(2)})`);
check(r.silent, 'a silent recording is refused');
check(!r.hitPitched, 'a noise hit is treated as unpitched');
check(Math.abs(1200 * Math.log2(r.got / r.want)) < 15, `keyboard mode plays in tune (${r.got.toFixed(1)} Hz, wanted ${r.want.toFixed(1)})`);
check(r.kitHit > 0.01 && r.kitEmpty < 0.001, 'kit mode: the filled bubble sounds, an empty one is silent');
check(r.packed && r.ids === 1, 'samples pack into a song file');
check(errors.length === 0, 'no page errors ' + errors.join('|'));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all sampler checks passed'); process.exit(failed ? 1 : 0);

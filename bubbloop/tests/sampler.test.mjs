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
  // natural pitch: a sung "ah" (formants at 700 / 1220 / 2600 Hz) moved up a fifth
  const F = [[700, 80, 1], [1220, 90, 0.5], [2600, 120, 0.25]];
  const envAt = (f) => F.reduce((s, [fc, bw, g]) => s + g / (1 + ((f - fc) / bw) ** 2), 0);
  const ah = new Float32Array(sr * 1.5);
  for (let h = 1; h * 150 < 8000; h++) { const g = envAt(h * 150) * 0.15; for (let i = 0; i < ah.length; i++) ah[i] += g * Math.sin(2 * Math.PI * h * 150 * i / sr + h); }
  const voice = await X.addSample(ah, sr, 'ah');
  const amp = (x, f) => { const M = 8192, s0 = Math.floor(x.length / 2 - M / 2); let re = 0, im = 0; for (let i = 0; i < M; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / M); re += x[s0 + i] * w * Math.cos(2 * Math.PI * f * i / sr); im += x[s0 + i] * w * Math.sin(2 * Math.PI * f * i / sr); } return Math.hypot(re, im); };
  // how far, in dB, the harmonics sit from the original voice's shape
  const shape = (x, f0) => { const d = []; for (let h = 1; h * f0 < 4000; h++) d.push(20 * Math.log10(amp(x, h * f0) + 1e-12) - 20 * Math.log10(envAt(h * f0))); const m = d.reduce((a, b) => a + b, 0) / d.length; return Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length); };
  const vp = S.newProject('v'); vp.bpm = 60; vp.key = (Math.round(voice.root) + 7) % 12;   // so a bubble's root note is a fifth above the voice
  const vt = vp.tracks[3]; vt.inst = 'sampler'; vt.rev = 0; vt.dly = 0;
  vp.tracks = [vt];
  const target = T.cellNotes(vp, vt, 0, 0)[0];
  const row = [0, 1, 2, 3, 4].find((r) => T.cellNotes(vp, vt, r, 0)[0] === Math.round(voice.root) + 7);
  vp.sections[0].bars = 1; vp.sections[0].ev = { [vt.id]: [{ t: 0, d: 384, r: row, c: 0, v: 0.9 }] };
  const renderWith = async (smp) => { vt.smp = smp; const x = await renderProject(vp, { what: 'loop', passes: 1, master: false }); return x.channels[0].slice(Math.floor(0.05 * sr), Math.floor(0.05 * sr) + sr / 2); };
  const t0 = performance.now();
  const nat = await renderWith({ mode: 'keys', key: voice.id, kit: {}, shift: 'natural', formant: 0 });
  const natMs = performance.now() - t0;
  const cls = await renderWith({ mode: 'keys', key: voice.id, kit: {}, shift: 'classic' });
  const up = T.midiToFreq(Math.round(voice.root) + 7);       // the bubble's note
  const natPitch = T.midiToFreq(X.detectPitch(nat, sr));
  const voiceOut = { natShape: shape(nat, up), clsShape: shape(cls, up), natPitch, want: up, natMs, row, target };
  return { voiceOut, dur: a.buffer.duration, root: a.root, pitched: a.pitched, silent: silent === null, hitPitched: hit.pitched, want, got,
    kitHit: rms(y.channels[0], 0.02, 0.2), kitEmpty: rms(y.channels[0], 0.55, 0.9), packed: !!packed[a.id] && packed[a.id].pcm.length > 1000, ids: X.sampleIds(p).length };
});
check(r.dur > 0.9 && r.dur < 1.2, `silence trimmed off both ends (${r.dur.toFixed(2)} s from a 2 s recording)`);
check(r.pitched && Math.abs(r.root - 57) < 0.2, `pitch found: A3 (MIDI ${r.root.toFixed(2)})`);
check(r.silent, 'a silent recording is refused');
check(!r.hitPitched, 'a noise hit is treated as unpitched');
check(Math.abs(1200 * Math.log2(r.got / r.want)) < 15, `keyboard mode plays in tune (${r.got.toFixed(1)} Hz, wanted ${r.want.toFixed(1)})`);
check(r.kitHit > 0.01 && r.kitEmpty < 0.001, 'kit mode: the filled bubble sounds, an empty one is silent');
check(r.packed && r.ids === 1, 'samples pack into a song file');
const v = r.voiceOut;
check(v.row != null, 'test setup: a bubble sits a fifth above the voice');
check(Math.abs(1200 * Math.log2(v.natPitch / v.want)) < 15, `natural pitch is in tune (${v.natPitch.toFixed(1)} Hz, wanted ${v.want.toFixed(1)})`);
check(v.natShape < 5 && v.natShape < v.clsShape - 4, `natural keeps the voice's formants (${v.natShape.toFixed(1)} dB off its shape, classic ${v.clsShape.toFixed(1)} dB)`);
check(v.natMs < 8000, `natural notes are prepared before an export renders (${Math.round(v.natMs)} ms)`);
check(errors.length === 0, 'no page errors ' + errors.join('|'));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all sampler checks passed'); process.exit(failed ? 1 : 0);

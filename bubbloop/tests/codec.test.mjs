// Encoder tests, run in plain Node. Each file is decoded again by ffmpeg:
// WAV and Apple Lossless must come back bit-for-bit identical, MP3 must
// come back the right length and shape, and the loudness meter must agree
// with ffmpeg's EBU R128 implementation.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OUT, measureLufs } from './lib.mjs';
import { toInt } from '../web/js/codec/pcm.js';
import { encodeWav } from '../web/js/codec/wav.js';
import { encodeAlac } from '../web/js/codec/alac.js';
import { loudness, limit, finalize, peakOf } from '../web/js/codec/master.js';
import { encodeMidi } from '../web/js/codec/midi.js';
import { newProject, applyPattern, addBlock } from '../web/js/state.js';

fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 1073741823.5 - 1; };
}

// A few seconds that exercise every path: silence, tones, noise, clipping.
function testSignal(sr, seconds, seed) {
  const n = Math.floor(sr * seconds);
  const L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const part = Math.floor(t / (seconds / 6));
    let l = 0, rr = 0;
    if (part === 1) { l = 0.5 * Math.sin(2 * Math.PI * 220 * t); rr = 0.5 * Math.sin(2 * Math.PI * 221 * t + 1); }
    else if (part === 2) { l = 0.3 * Math.sin(2 * Math.PI * 110 * t) + 0.2 * Math.sin(2 * Math.PI * 1760 * t) + 0.05 * r(); rr = l * 0.7 + 0.03 * r(); }
    else if (part === 3) { l = r(); rr = r(); }                                   // full-scale noise
    else if (part === 4) { l = Math.sign(Math.sin(2 * Math.PI * 55 * t)); rr = -l; }  // square at the rails
    else if (part === 5) { l = 0.0003 * r(); rr = 0.6 * Math.exp(-t) * Math.sin(2 * Math.PI * 440 * t); }
    L[i] = l; R[i] = rr;
  }
  return [L, R];
}

function decode(file, bits, channels) {
  const fmt = bits === 24 ? 's24le' : 's16le';
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', fmt, '-acodec', 'pcm_' + fmt, '-ac', String(channels), '-'], { maxBuffer: 1 << 29 });
  const bytes = bits / 8, n = raw.length / bytes / channels;
  const out = Array.from({ length: channels }, () => new Int32Array(n));
  for (let i = 0, o = 0; i < n; i++) for (let c = 0; c < channels; c++, o += bytes) {
    out[c][i] = bits === 24 ? raw.readIntLE(o, 3) : raw.readInt16LE(o);
  }
  return out;
}
const same = (a, b) => a.length === b.length && a.every((ch, c) => ch.length === b[c].length && ch.every((v, i) => v === b[c][i]));
const probe = (file, entry) => String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', entry, '-of', 'default=nw=1:nk=1', file])).trim();

console.log('WAV');
for (const bits of [16, 24]) {
  const ints = toInt(testSignal(44100, 3, 5), bits);
  const file = path.join(OUT, `t${bits}.wav`);
  fs.writeFileSync(file, encodeWav(ints, 44100, bits));
  check(same(decode(file, bits, 2), ints), `${bits}-bit stereo round-trips exactly`);
}

console.log('Apple Lossless');
for (const [bits, nch, sr, secs] of [[16, 2, 44100, 6], [24, 2, 48000, 6], [16, 1, 44100, 3], [16, 2, 44100, 0.05], [24, 1, 48000, 1.3]]) {
  const sig = testSignal(sr, secs, 11 + bits + nch);
  const ints = toInt(nch === 2 ? sig : [sig[1]], bits);
  const file = path.join(OUT, `t${bits}-${nch}-${sr}-${secs}.m4a`);
  const bytes = encodeAlac(ints, sr, bits, { title: 'Test Song' });
  fs.writeFileSync(file, bytes);
  const label = `${bits}-bit ${nch}ch ${sr} Hz ${secs}s`;
  check(probe(file, 'stream=codec_name') === 'alac', `${label}: ffprobe sees ALAC`);
  check(same(decode(file, bits, nch), ints), `${label}: decodes bit-for-bit`);
  const rawSize = ints[0].length * nch * bits / 8;
  console.log(`         size ${(100 * bytes.length / rawSize).toFixed(0)}% of PCM`);
}
{
  // something tonal and quiet should compress well
  const sr = 44100, n = sr * 4;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    L[i] = 0.3 * Math.sin(2 * Math.PI * 261.6 * t) * Math.exp(-t) + 0.2 * Math.sin(2 * Math.PI * 392 * t);
    R[i] = L[i] * 0.9 + 0.05 * Math.sin(2 * Math.PI * 523 * t);
  }
  const ints = toInt([L, R], 16);
  const bytes = encodeAlac(ints, sr, 16);
  const file = path.join(OUT, 'tonal.m4a');
  fs.writeFileSync(file, bytes);
  const ratio = bytes.length / (n * 4);
  check(same(decode(file, 16, 2), ints), 'tonal music: decodes bit-for-bit');
  check(ratio < 0.6, `tonal music compresses (${(ratio * 100).toFixed(0)}% of PCM)`);
  check(probe(file, 'format_tags=title') === '' && /Boba Beats/.test(probe(file, 'format_tags=encoder')), 'carries the encoder tag');
  check(Math.abs(parseFloat(probe(file, 'format=duration')) - 4) < 0.01, 'reports the right duration');
}

console.log('MP3');
{
  const lame = await import('../web/vendor/lamejs.js');
  const sr = 44100, sig = testSignal(sr, 3, 3);
  const ints = toInt(sig, 16);
  const enc = new lame.Mp3Encoder(2, sr, 192);
  const parts = [];
  const L = Int16Array.from(ints[0]), R = Int16Array.from(ints[1]);
  for (let i = 0; i < L.length; i += 1152) parts.push(Buffer.from(enc.encodeBuffer(L.subarray(i, i + 1152), R.subarray(i, i + 1152))));
  parts.push(Buffer.from(enc.flush()));
  const file = path.join(OUT, 't.mp3');
  fs.writeFileSync(file, Buffer.concat(parts));
  check(probe(file, 'stream=codec_name') === 'mp3', 'ffprobe sees MP3');
  const dec = decode(file, 16, 2);
  check(Math.abs(dec[0].length - L.length) < 3000, `length preserved (${dec[0].length} vs ${L.length})`);
  // the 220 Hz section should survive encoding: compare energy there
  const a = Math.floor(sr * 0.6), b = Math.floor(sr * 0.9);
  const energy = (x) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return s; };
  const r = energy(dec[0]) / energy(ints[0]);
  check(r > 0.8 && r < 1.25, `tone energy preserved (ratio ${r.toFixed(2)})`);
}

console.log('Mastering');
{
  const sr = 44100;
  for (const level of [0.05, 0.4]) {
    const sig = testSignal(sr, 12, 21).map((c) => c.map((v) => v * level));
    const mine = loudness(sig, sr);
    const file = path.join(OUT, `lufs-${level}.wav`);
    fs.writeFileSync(file, encodeWav(toInt(sig, 24, false), sr, 24));
    const ref = measureLufs(file).lufs;
    check(Math.abs(mine - ref) < 0.3, `loudness meter agrees with ffmpeg (${mine.toFixed(2)} vs ${ref} LUFS)`);
  }
  const hot = testSignal(sr, 6, 8).map((c) => c.map((v) => v * 2.5));
  limit(hot, sr, 0.891);
  check(peakOf(hot) <= 0.8911, `limiter holds the ceiling (peak ${peakOf(hot).toFixed(4)})`);
  for (const target of [-14, -10]) {
    const sig = testSignal(sr, 12, 30).map((c) => c.map((v) => v * 0.1));
    const info = finalize(sig, sr, { target });
    const file = path.join(OUT, `master${target}.wav`);
    fs.writeFileSync(file, encodeWav(toInt(sig, 24, false), sr, 24));
    const ref = measureLufs(file);
    check(Math.abs(ref.lufs - target) < 1.2, `mastering to ${target} LUFS lands at ${ref.lufs} (ffmpeg), peak ${ref.truePeak} dBTP`);
    check(info.peak <= 0.8913, 'mastered peak stays under -1 dBFS');
  }
}

console.log('Mastering chain');
{
  const { masterChain, CHAINS } = await import('../web/js/codec/chain.js');
  // a 24-second groove: kick, snare, hats, bass and chords, with a quiet intro
  const sr = 44100, n = sr * 24, L = new Float32Array(n), R = new Float32Array(n);
  const r = rng(99), beat = sr * 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / sr, b = i % beat, bt = b / sr, bar = Math.floor(i / (beat * 4)), intro = t < 6 ? 0.35 : 1;
    const kick = (Math.floor(i / beat) % 2 === 0) ? Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-bt * 40)) * bt) * Math.exp(-bt * 9) * 0.9 : 0;
    const snare = (Math.floor(i / beat) % 2 === 1) ? r() * Math.exp(-bt * 22) * 0.6 + Math.sin(2 * Math.PI * 190 * bt) * Math.exp(-bt * 30) * 0.4 : 0;
    const hb = i % (beat / 2) / sr, hat = r() * Math.exp(-hb * 90) * 0.18;
    const root = [55, 44, 49, 41.2][bar % 4];
    const bass = Math.sin(2 * Math.PI * root * t) * 0.35;
    const chord = [1, 1.26, 1.5].reduce((a, k) => a + Math.sin(2 * Math.PI * root * 4 * k * t + k), 0) * 0.07;
    L[i] = (kick + snare + hat * 0.8) * intro + bass * intro + chord * (1.1);
    R[i] = (kick + snare * 0.9 + hat * 1.2) * intro + bass * intro + chord * 0.9;
  }
  for (const id of ['sweet', 'punchy', 'cozy', 'loud', 'stream']) {
    const chs = [Float32Array.from(L), Float32Array.from(R)];
    const rep = masterChain(chs, sr, id);
    const file = path.join(OUT, `chain-${id}.wav`);
    fs.writeFileSync(file, encodeWav(toInt(chs, 24, false), sr, 24));
    const m = measureLufs(file);
    const want = CHAINS[id].lufs;
    // Loud may stop short of its target rather than crush the mix
    // either it reaches its target, or it stopped at its limiting allowance
    // rather than crush a very peaky mix (this test groove is peakier than music)
    const stopped = rep.squashDb >= (CHAINS[id].maxSquash || 3) - 0.3 && m.lufs < want;
    const near = Math.abs(m.lufs - want) < 1.2 || stopped;
    check(near && m.truePeak <= -0.9, `${id}: ${m.lufs} LUFS (target ${want}${stopped ? ', stopped at its limiting allowance' : ''}), true peak ${m.truePeak} dBTP, ${rep.squashDb} LU of limiting`);
  }
  {
    // seamless: a bar that repeats exactly (every part completes whole cycles
    // in it), mastered as a loop, must join to itself with no step or bump
    const bar = sr * 2, beatN = bar / 4, X = new Float32Array(bar), Y = new Float32Array(bar);
    const noise = Array.from({ length: beatN / 2 }, () => r());
    for (let i = 0; i < bar; i++) {
      const b = i % beatN, bt = b / sr, t = i / sr;
      const kick = Math.floor(i / beatN) % 2 === 0 ? Math.sin(2 * Math.PI * 55 * bt) * Math.exp(-bt * 9) * 0.9 : 0;
      const sn = Math.floor(i / beatN) % 2 === 1 ? noise[b % noise.length] * Math.exp(-bt * 22) * 0.6 : 0;
      const tone = Math.sin(2 * Math.PI * 110 * t) * 0.25 + Math.sin(2 * Math.PI * 330 * t) * 0.08;   // whole cycles per bar
      X[i] = kick + sn + tone; Y[i] = kick + sn * 0.9 + tone;
    }
    const chs = [X, Y];
    masterChain(chs, sr, 'sweet', { seamless: true });
    let step = 0; for (let i = 1; i < bar; i++) step += Math.abs(chs[0][i] - chs[0][i - 1]);
    step /= bar;
    const join = Math.abs(chs[0][0] - chs[0][bar - 1]);
    const rms = (a, b) => { let e = 0; for (let i = a; i < b; i++) e += chs[0][i] ** 2; return Math.sqrt(e / (b - a)); };
    const headTail = Math.abs(20 * Math.log10(rms(0, 4410) / rms(beatN * 2, beatN * 2 + 4410)));
    check(join < step * 4 && headTail < 1, `a seamless loop joins cleanly (step at the join ${join.toFixed(4)} vs typical ${step.toFixed(4)}; first beat within ${headTail.toFixed(2)} dB of the third)`);
  }
  {
    const chs = [Float32Array.from(L).map((v) => v * 3), Float32Array.from(R).map((v) => v * 3)];
    masterChain(chs, sr, undefined);
    let pk = 0; for (const c of chs) for (const v of c) pk = Math.max(pk, Math.abs(v));
    check(pk <= 0.8913, 'no preset (stems, Raw): only brought under the ceiling');
  }
}

console.log('MIDI');
{
  const p = newProject('Midi Test');
  applyPattern(p, 0, p.tracks[0].id, 'boombap');
  p.sections[0].ev[p.tracks[2].id] = [{ t: 0, d: 96, r: 1, c: 0, v: 0.8, ch: 'triad' }];
  p.sections[0].ev[p.tracks[3].id] = [{ t: 96, d: 48, r: 2, c: 2, v: 0.9 }];
  addBlock(p); addBlock(p);
  p.song[1].off[p.tracks[0].id] = true;
  const bytes = encodeMidi(p, 'song');
  const file = path.join(OUT, 't.mid');
  fs.writeFileSync(file, bytes);
  const dv = new DataView(bytes.buffer);
  check(String.fromCharCode(...bytes.slice(0, 4)) === 'MThd' && dv.getUint16(8) === 1, 'format 1 header');
  const ntrk = dv.getUint16(10);
  check(ntrk === p.tracks.length + 1, `one tempo track + ${p.tracks.length} instrument tracks`);
  // walk the chunks and count note-ons per track
  let o = 14; const counts = [];
  for (let t = 0; t < ntrk; t++) {
    const len = dv.getUint32(o + 4); let i = o + 8; const end = i + len; let on = 0, status = 0, ok = true;
    while (i < end) {
      while (bytes[i++] & 0x80);                       // delta time
      let b = bytes[i];
      if (b === 0xff) { const l = bytes[i + 2]; i += 3 + l; continue; }
      if (b & 0x80) { status = b; i++; }
      const hi = status & 0xf0;
      if (hi === 0x90) on++;
      i += hi === 0xc0 ? 1 : 2;
      if (i > end) ok = false;
    }
    counts.push(on); o = end;
    if (!ok) check(false, `track ${t} chunk parses cleanly`);
  }
  check(o === bytes.length, 'chunks fill the file exactly');
  const drumHits = p.sections[0].ev[p.tracks[0].id].length;
  check(counts[1] === drumHits, `drums muted in one of two blocks (${counts[1]} hits)`);
  check(counts[3] === 6, `chord exported as three notes per block (${counts[3]})`);
}

// Walk a MIDI file: per track, a list of { t, st, d1, d2 } channel messages
// (absolute ticks; running status honoured, meta and sysex skipped).
function walkMidi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ntrk = dv.getUint16(10), tracks = [];
  let o = 14;
  for (let k = 0; k < ntrk; k++) {
    const end = o + 8 + dv.getUint32(o + 4);
    let i = o + 8, t = 0, status = 0;
    const msgs = [];
    while (i < end) {
      let d = 0, b;
      do { b = bytes[i++]; d = (d << 7) | (b & 127); } while (b & 0x80);
      t += d;
      b = bytes[i];
      if (b === 0xff) { i += 3 + bytes[i + 2]; status = 0; continue; }
      if (b === 0xf0 || b === 0xf7) { i += 2 + bytes[i + 1]; status = 0; continue; }
      if (b & 0x80) { status = b; i++; }
      const hi = status & 0xf0, n = hi === 0xc0 || hi === 0xd0 ? 1 : 2;
      msgs.push({ t, st: hi, ch: status & 15, d1: bytes[i], d2: n === 2 ? bytes[i + 1] : 0 });
      i += n;
    }
    tracks.push(msgs); o = end;
  }
  return tracks;
}

console.log('MIDI export matches playback');
{
  const mk = () => {
    const p = newProject('Spice');
    p.sections[0].ev[p.tracks[3].id] = [{ t: 0, d: 96, r: 2, c: 2, v: 0.5, b: [[0, 0], [48, 100], [72, -200]] }];
    return p;
  };
  // pitch bend
  let p = mk();
  let tr = walkMidi(encodeMidi(p, 'loop'))[4];
  const ch = tr.find((m) => m.st === 0x90).ch;
  const rpn = tr.filter((m) => m.st === 0xb0 && m.t === 0).map((m) => [m.d1, m.d2].join(':')).join(' ');
  check(rpn === '101:0 100:0 6:2 38:0', `bend range set with RPN 0 (${rpn})`);
  const pb = tr.filter((m) => m.st === 0xe0).map((m) => [m.t, m.d1 | (m.d2 << 7)]);
  const noteOff = tr.find((m) => m.st === 0x80).t;
  check(JSON.stringify(pb) === JSON.stringify([[0, 8192], [240, 12288], [360, 0], [noteOff, 8192]]),
    `bend values and reset: ${JSON.stringify(pb)}`);
  check(tr.filter((m) => m.st === 0xe0).every((m) => m.ch === ch), 'bends on the note channel');

  // fills: rep16 only on the last pass of a block, only in the last two beats
  p = mk();
  p.sections[0].ev[p.tracks[3].id] = [{ t: 0, d: 24, r: 2, c: 2, v: 0.8 }, { t: 96 * 3, d: 24, r: 2, c: 2, v: 0.8 }];
  addBlock(p); p.song[0].rep = 2; p.song[0].sp = { [p.tracks[3].id]: { fill: 'rep16' } };
  const pass = p.sections[0].bars * 384 * 5;                      // MIDI ticks per pass
  const ons = walkMidi(encodeMidi(p, 'song'))[4].filter((m) => m.st === 0x90);
  const first = ons.filter((m) => m.t < pass), second = ons.filter((m) => m.t >= pass);
  const tail = (m) => m.t - pass >= pass - 960;
  check(first.length === 2, `no fill on the first pass (${first.length} note-ons)`);
  check(second.length === 10, `rep16 fill adds note-ons on the last pass (${second.length})`);
  check(second.filter(tail).length === 8 && ons.filter((m) => m.t >= pass - 960 && m.t < pass).length === 0, 'fill hits fall in the last two beats only');

  // energy
  p = mk();
  p.sections[0].ev[p.tracks[3].id] = [{ t: 0, d: 24, r: 2, c: 2, v: 0.5 }, { t: 96, d: 24, r: 2, c: 2, v: 0.9 }];
  addBlock(p); p.song[0].sp = { [p.tracks[3].id]: { vel: 1.5 } };
  const vels = walkMidi(encodeMidi(p, 'song'))[4].filter((m) => m.st === 0x90).map((m) => m.d2);
  check(vels[0] === Math.round(0.75 * 127) && vels[1] === 127, `energy scales and clamps velocity (${vels})`);

  // a section's own mute holds in a loop export
  p = mk();
  p.sections[0].mute = { [p.tracks[3].id]: true };
  check(walkMidi(encodeMidi(p, 'loop'))[4].every((m) => m.st !== 0x90), 'muted track has no notes in a loop export');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall codec checks passed');
process.exit(failed ? 1 : 0);

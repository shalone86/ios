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
  check(probe(file, 'format_tags=title') === '' && /Bubbloop/.test(probe(file, 'format_tags=encoder')), 'carries the encoder tag');
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

console.log(failed ? `\n${failed} check(s) failed` : '\nall codec checks passed');
process.exit(failed ? 1 : 0);

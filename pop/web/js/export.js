// Saving beats out of Pop Pads: the loop as a WAV, the pattern as MIDI (it
// lands on the right drums in Logic's Drum Kit Designer or any GM kit), and
// every sound on its own (stems) so a DAW can mix them.

import { renderSong, STEPS } from './engine.js';
import { KITS } from './kits.js';
import { finalize } from './codec/master.js';
import { toInt } from './codec/pcm.js';
import { encodeWav } from './codec/wav.js';
import { encodeZip } from './codec/zip.js';

const TARGET = -12;   // LUFS: about as loud as a finished beat, with a clean ceiling
const SR = 44100;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const baseName = (song) => `pop-pads-${slug(KITS[song.kit].name)}-${song.bpm}bpm`;
const channelsOf = (buf) => [Float32Array.from(buf.getChannelData(0)), Float32Array.from(buf.getChannelData(1))];
// trim the render to the loop itself, plus `tail` seconds of ring-out
const cut = (chs, seconds, tail) => chs.map((c) => c.slice(0, Math.min(c.length, Math.round((seconds + tail) * SR))));

export async function loopWav(song, { loops = 2, tail = 0 } = {}) {
  const { buffer, seconds } = await renderSong(song, { loops, sr: SR });
  // a loop that repeats cleanly: the ring-out from the end is folded back onto the start
  const chs = channelsOf(buffer), n = Math.round(seconds * SR);
  if (!tail) for (const c of chs) { for (let i = n; i < c.length; i++) c[i - n] += c[i]; }
  const out = cut(chs, seconds, tail);
  const stats = finalize(out, SR, { target: TARGET, ceilingDb: -1 });
  return { bytes: encodeWav(toInt(out, 24), SR, 24), stats };
}

export async function stemsZip(song, { loops = 1 } = {}, onStatus = () => {}) {
  // the mix first, to learn how much gain the master adds; each stem gets the same
  onStatus('Mixing…');
  const mix = await renderSong(song, { loops, sr: SR });
  const n = Math.round(mix.seconds * SR);
  const wrap = (chs) => { for (const c of chs) for (let i = n; i < c.length; i++) c[i - n] += c[i]; return cut(chs, mix.seconds, 0); };
  const mixChs = wrap(channelsOf(mix.buffer));
  const { gainDb } = finalize(mixChs, SR, { target: TARGET, ceilingDb: -1 });
  const g = Math.pow(10, gainDb / 20);
  const files = [{ name: 'mix.wav', bytes: encodeWav(toInt(mixChs, 24), SR, 24) }];
  const bars = song.chain.length > 1 ? song.chain : [song.cur];
  const used = [...Array(16).keys()].filter((i) => bars.some((b) => song.patterns[b][i]));
  for (const i of used) {
    onStatus(`${KITS[song.kit].pads[i].name}…`);
    const { buffer } = await renderSong(song, { loops, solo: i, sr: SR });
    const chs = wrap(channelsOf(buffer));
    let pk = 0; for (const c of chs) for (let k = 0; k < c.length; k++) { c[k] *= g; pk = Math.max(pk, Math.abs(c[k])); }
    if (pk > 0.98) for (const c of chs) for (let k = 0; k < c.length; k++) c[k] *= 0.98 / pk;
    files.push({ name: `${String(i + 1).padStart(2, '0')}-${slug(KITS[song.kit].pads[i].name)}.wav`, bytes: encodeWav(toInt(chs, 24), SR, 24) });
  }
  return encodeZip(files.map((f) => ({ name: `${baseName(song)}/${f.name}`, bytes: f.bytes })));
}

// A standard MIDI file: one track on the drum channel, 96 ticks a beat.
export function patternMidi(song, { loops = 1 } = {}) {
  const PPQ = 96, tps = PPQ / 4, bars = song.chain.length > 1 ? song.chain : [song.cur];
  const ev = [];
  const swingTicks = Math.round(song.swing * tps * 0.66);
  for (let b = 0; b < bars.length * loops; b++) {
    const pat = song.patterns[bars[b % bars.length]];
    for (let s = 0; s < STEPS; s++) {
      const at = (b * STEPS + s) * tps + (s % 2 ? swingTicks : 0);
      for (let i = 0; i < 16; i++) if ((pat[i] >> s) & 1) {
        const note = KITS[song.kit].pads[i].gm;
        ev.push([at, 0x99, note, 100], [at + Math.round(tps * 0.9), 0x89, note, 0]);
      }
    }
  }
  ev.sort((a, b) => a[0] - b[0] || (a[1] === 0x89 ? -1 : 1));
  const bytes = [];
  const vlq = (v) => { const out = [v & 0x7f]; while ((v >>= 7)) out.unshift((v & 0x7f) | 0x80); bytes.push(...out); };
  const tempo = Math.round(60000000 / song.bpm);
  const name = new TextEncoder().encode(`Pop Pads ${KITS[song.kit].name}`);
  vlq(0); bytes.push(0xff, 0x03, name.length, ...name);
  vlq(0); bytes.push(0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
  vlq(0); bytes.push(0xff, 0x58, 0x04, 4, 2, 24, 8);
  let last = 0;
  for (const [t, st, a, b] of ev) { vlq(t - last); last = t; bytes.push(st, a, b); }
  vlq(Math.max(0, bars.length * loops * STEPS * tps - last)); bytes.push(0xff, 0x2f, 0x00);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  const len = bytes.length;
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...bytes]);
}

// Hand a file to the person: the Android app saves it to Music or Download,
// a phone browser offers the share sheet, a computer downloads it.
export async function deliver(bytes, name, mime) {
  if (window.PopNative) {
    const id = window.PopNative.beginFile(name, mime);
    if (!id) throw new Error('Could not start the file');
    for (let o = 0; o < bytes.length; o += 0x30000) {
      let s = ''; const part = bytes.subarray(o, o + 0x30000);
      for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
      if (!window.PopNative.appendFile(id, btoa(s))) throw new Error('Could not write the file');
    }
    const res = JSON.parse(window.PopNative.finishFile(id));
    if (!res.ok) throw new Error(res.error || 'Could not save the file');
    return `Saved to ${res.where}`;
  }
  const file = new File([bytes], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: name }); return 'Shared'; } catch (e) { if (e.name === 'AbortError') return ''; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'Downloaded';
}

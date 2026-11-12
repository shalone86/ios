// Export worker: mastering and encoding happen here so the bubbles keep
// bobbing while a song is being written out.

import { toInt } from './pcm.js';
import { encodeWav } from './wav.js';
import { encodeAlac } from './alac.js';
import { finalize } from './master.js';

let lame = null;

async function encodeMp3(ints, sampleRate, kbps, progress) {
  if (!lame) lame = await import('../../vendor/lamejs.js');
  const nc = ints.length;
  const enc = new lame.Mp3Encoder(nc, sampleRate, kbps);
  const to16 = (a) => Int16Array.from(a);
  const L = to16(ints[0]), R = nc > 1 ? to16(ints[1]) : null;
  const parts = [];
  const block = 1152 * 20;
  for (let i = 0; i < L.length; i += block) {
    const out = R ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block));
    if (out.length) parts.push(new Uint8Array(out.buffer, out.byteOffset, out.length).slice());
    if (((i / block) & 7) === 0) progress(i / L.length);
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end.buffer, end.byteOffset, end.length).slice());
  let len = 0;
  for (const p of parts) len += p.length;
  const bytes = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  return bytes;
}

self.onmessage = async (e) => {
  const m = e.data;
  const progress = (v) => self.postMessage({ id: m.id, progress: v });
  try {
    const channels = m.channels;
    let info = null;
    if (m.master !== false) {
      info = finalize(channels, m.sampleRate, { target: m.target, ceilingDb: m.format === 'mp3' ? -1.5 : -1 });
    }
    progress(0.05);
    const bits = m.format === 'mp3' ? 16 : (m.bits || 16);
    const ints = toInt(channels, bits, true);
    let bytes;
    if (m.format === 'wav') bytes = encodeWav(ints, m.sampleRate, bits);
    else if (m.format === 'm4a') bytes = encodeAlac(ints, m.sampleRate, bits, { title: m.title, onProgress: (v) => progress(0.05 + v * 0.95) });
    else if (m.format === 'mp3') bytes = await encodeMp3(ints, m.sampleRate, m.kbps || 256, (v) => progress(0.05 + v * 0.95));
    else throw new Error('Unknown format ' + m.format);
    self.postMessage({ id: m.id, done: true, bytes: bytes.buffer, info }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err && err.message || err) });
  }
};

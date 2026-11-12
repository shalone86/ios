// WAV (PCM) writer. Takes integer samples from pcm.js.

export function encodeWav(intChannels, sampleRate, bits = 16) {
  const nc = intChannels.length, n = intChannels[0].length;
  const bytes = bits / 8;
  const dataLen = n * nc * bytes;
  const out = new Uint8Array(44 + dataLen);
  const dv = new DataView(out.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * nc * bytes, true);
  dv.setUint16(32, nc * bytes, true); dv.setUint16(34, bits, true);
  str(36, 'data'); dv.setUint32(40, dataLen, true);
  let o = 44;
  if (bits === 16) {
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { dv.setInt16(o, intChannels[c][i], true); o += 2; }
  } else {
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      const v = intChannels[c][i];
      out[o++] = v & 255; out[o++] = (v >> 8) & 255; out[o++] = (v >> 16) & 255;
    }
  }
  return out;
}

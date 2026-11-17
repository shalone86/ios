// A store-only ZIP writer: files go in uncompressed, which is all a bundle
// of WAVs needs. Names are UTF-8.

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name: 'folder/file.wav', bytes: Uint8Array }]
export function encodeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const entries = files.map((f) => ({ f, name: enc.encode(f.name), crc: crc32(f.bytes), offset: 0 }));

  let size = 22;
  for (const e of entries) size += 30 + 46 + 2 * e.name.length + e.f.bytes.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  const u16 = (v) => { dv.setUint16(o, v, true); o += 2; };
  const u32 = (v) => { dv.setUint32(o, v, true); o += 4; };

  for (const e of entries) {
    e.offset = o;
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.f.bytes.length); u32(e.f.bytes.length); u16(e.name.length); u16(0);
    out.set(e.name, o); o += e.name.length;
    out.set(e.f.bytes, o); o += e.f.bytes.length;
  }
  const dirStart = o;
  for (const e of entries) {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(dosTime); u16(dosDate);
    u32(e.crc); u32(e.f.bytes.length); u32(e.f.bytes.length); u16(e.name.length);
    u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    out.set(e.name, o); o += e.name.length;
  }
  const dirSize = o - dirStart;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(dirSize); u32(dirStart); u16(0);
  return out;
}

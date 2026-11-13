// Apple Lossless (ALAC) encoder, written out as an .m4a file.
//
// Each packet holds up to 4096 samples per channel: optional mid/side
// decorrelation, an adaptive linear predictor, and an adaptive Golomb-Rice
// coder for the residual. A packet that would not shrink is stored verbatim.
// The format is lossless, so the test suite decodes the result with ffmpeg
// and requires it to match the input sample for sample.

const FRAME = 4096;
const ORDER = 6;          // predictor taps
const QUANT = 9;          // predictor coefficient shift
const HISTORY_MULT = 40, INITIAL_HISTORY = 10, K_LIMIT = 14;

class BitWriter {
  constructor(capacity) {
    this.buf = new Uint8Array(capacity);
    this.reset();
  }
  reset() { this.pos = 0; this.acc = 0; this.n = 0; }
  put(bits, val) {
    if (bits > 16) {
      this.put(bits - 16, val >>> 16);
      this.put(16, val & 0xffff);
      return;
    }
    if (bits === 0) return;
    this.acc = (this.acc << bits) | (val & ((1 << bits) - 1));
    this.n += bits;
    while (this.n >= 8) {
      this.n -= 8;
      this.buf[this.pos++] = (this.acc >>> this.n) & 0xff;
    }
    this.acc &= (1 << this.n) - 1;
  }
  align() {
    if (this.n) {
      this.buf[this.pos++] = (this.acc << (8 - this.n)) & 0xff;
      this.n = 0; this.acc = 0;
    }
  }
  bytes() { return this.buf.slice(0, this.pos); }
}

const log2 = (x) => (x > 0 ? 31 - Math.clz32(x) : 0);

// Linear-prediction coefficients for one block, as integers scaled by
// 2^QUANT. Index j lines up with sample [i - ORDER + j].
function analyse(x, n) {
  const coefs = new Int32Array(ORDER);
  if (n <= ORDER + 1) return coefs;
  const r = new Float64Array(ORDER + 1);
  const w = new Float64Array(n);
  const mid = (n - 1) / 2, half = (n + 1) / 2;
  for (let i = 0; i < n; i++) {
    const u = (i - mid) / half;
    w[i] = x[i] * (1 - u * u);
  }
  for (let k = 0; k <= ORDER; k++) {
    let s = 0;
    for (let i = k; i < n; i++) s += w[i] * w[i - k];
    r[k] = s;
  }
  if (r[0] <= 0) return coefs;
  // Levinson-Durbin
  const a = new Float64Array(ORDER + 1), tmp = new Float64Array(ORDER + 1);
  let err = r[0] * (1 + 1e-9);
  for (let i = 1; i <= ORDER; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc -= a[j] * r[i - j];
    const k = acc / err;
    tmp.set(a);
    a[i] = k;
    for (let j = 1; j < i; j++) a[j] = tmp[j] - k * tmp[i - j];
    err *= 1 - k * k;
    if (err <= 0) break;
  }
  for (let lag = 1; lag <= ORDER; lag++) {
    const q = Math.round(a[lag] * (1 << QUANT));
    coefs[ORDER - lag] = Math.max(-32767, Math.min(32767, Number.isFinite(q) ? q : 0));
  }
  return coefs;
}

// Runs the predictor exactly as a decoder will, including its habit of
// nudging the coefficients after every sample, and returns the residual.
function predict(x, n, bps, initial) {
  const res = new Int32Array(n);
  const c = Int32Array.from(initial);
  const sh = 32 - bps;
  const half = 1 << (QUANT - 1), div = 1 << QUANT;
  res[0] = x[0];
  for (let i = 1; i <= ORDER && i < n; i++) res[i] = ((x[i] - x[i - 1]) << sh) >> sh;
  for (let i = ORDER + 1; i < n; i++) {
    const base = i - ORDER;
    const d = x[base - 1];
    let val = 0;
    for (let j = 0; j < ORDER; j++) val = (val + Math.imul(x[base + j] - d, c[j])) | 0;
    const p = Math.floor((val + half) / div) + d;
    let e = ((x[i] - p) << sh) >> sh;
    res[i] = e;
    if (e !== 0) {
      const es = e > 0 ? 1 : -1;
      for (let j = 0; j < ORDER && Math.imul(e, es) > 0; j++) {
        let v = d - x[base + j];
        const s = (v > 0 ? 1 : v < 0 ? -1 : 0) * es;
        c[j] -= s;
        v = Math.imul(v, s);
        e = (e - Math.imul(v >> QUANT, j + 1)) | 0;
      }
    }
  }
  return res;
}

function scalar(bw, x, k, escapeBits) {
  if (k > K_LIMIT) k = K_LIMIT;
  const divisor = (1 << k) - 1;
  const q = Math.floor(x / divisor), r = x - q * divisor;
  if (q > 8) {
    bw.put(9, 0x1ff);
    bw.put(escapeBits, x);
    return;
  }
  if (q) bw.put(q, (1 << q) - 1);
  bw.put(1, 0);
  if (k !== 1) {
    if (r > 0) bw.put(k, r + 1); else bw.put(k - 1, 0);
  }
}

function entropy(bw, res, n, bps) {
  let history = INITIAL_HISTORY, signMod = 0, i = 0;
  while (i < n) {
    const v = res[i++];
    const x = v >= 0 ? 2 * v : -2 * v - 1;
    scalar(bw, x - signMod, log2((history >>> 9) + 3), bps);
    signMod = 0;
    if (x > 0xffff) history = 0xffff;
    else history += x * HISTORY_MULT - ((history * HISTORY_MULT) >>> 9);
    if (history < 128 && i < n) {
      // a run of zeros is sent as a single count
      const k = 7 - log2(history) + ((history + 16) >>> 6);
      let run = 0;
      while (i < n && res[i] === 0) { i++; run++; }
      scalar(bw, run, k, 16);
      signMod = run <= 0xffff ? 1 : 0;
      history = 0;
    }
  }
}

function header(bw, nch, n, extraBytes, verbatim) {
  bw.put(3, nch === 2 ? 1 : 0);     // channel pair or single channel element
  bw.put(4, 0);                     // instance tag
  bw.put(12, 0);
  const partial = n !== FRAME ? 1 : 0;
  bw.put(1, partial);
  bw.put(2, extraBytes);
  bw.put(1, verbatim);
  if (partial) bw.put(32, n);
}

function writeVerbatim(bw, chans, off, n, bits) {
  header(bw, chans.length, n, 0, 1);
  for (let i = 0; i < n; i++) for (let c = 0; c < chans.length; c++) bw.put(bits, chans[c][off + i]);
  bw.put(3, 7);
  bw.align();
}

function writeCompressed(bw, chans, off, n, bits) {
  const nch = chans.length;
  const extra = bits > 16 ? bits - 16 : 0;
  const bps = bits - extra + nch - 1;
  const work = [], low = [];
  for (let c = 0; c < nch; c++) {
    const src = chans[c].subarray(off, off + n);
    if (extra) {
      const mask = (1 << extra) - 1;
      const hi = new Int32Array(n), lo = new Int32Array(n);
      for (let i = 0; i < n; i++) { lo[i] = src[i] & mask; hi[i] = src[i] >> extra; }
      work.push(hi); low.push(lo);
    } else {
      work.push(Int32Array.from(src));
    }
  }
  let shift = 0, weight = 0;
  if (nch === 2) {
    const L = work[0], R = work[1];
    let plain = 0, ms = 0;
    for (let i = 0; i < n; i++) {
      plain += Math.abs(L[i]) + Math.abs(R[i]);
      ms += Math.abs((L[i] + R[i]) >> 1) + Math.abs(L[i] - R[i]);
    }
    if (ms < plain) {
      for (let i = 0; i < n; i++) {
        const l = L[i];
        L[i] = (l + R[i]) >> 1;
        R[i] = l - R[i];
      }
      shift = 1; weight = 1;
    }
  }
  header(bw, nch, n, extra >> 3, 0);
  bw.put(8, shift);
  bw.put(8, weight);
  const coefs = work.map((x) => analyse(x, n));
  for (let c = 0; c < nch; c++) {
    bw.put(4, 0);                   // prediction type
    bw.put(4, QUANT);
    bw.put(3, 4);                   // rice modifier (x4 = HISTORY_MULT/10)
    bw.put(5, ORDER);
    // the stream lists the tap for the most recent sample first
    for (let k = 0; k < ORDER; k++) bw.put(16, coefs[c][ORDER - 1 - k] & 0xffff);
  }
  if (extra) {
    for (let i = 0; i < n; i++) for (let c = 0; c < nch; c++) bw.put(extra, low[c][i]);
  }
  for (let c = 0; c < nch; c++) entropy(bw, predict(work[c], n, bps, coefs[c]), n, bps);
  bw.put(3, 7);
  bw.align();
}

// ---------- MP4 container ----------

function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u8 = (...v) => Uint8Array.from(v);
const u16 = (v) => u8((v >>> 8) & 255, v & 255);
const u32 = (v) => u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const zeros = (n) => new Uint8Array(n);
function box(type, ...parts) {
  const body = concat(parts);
  return concat([u32(body.length + 8), ascii(type), body]);
}
const full = (type, version, flags, ...parts) => box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
const MATRIX = concat([u32(0x10000), zeros(12), u32(0x10000), zeros(12), u32(0x40000000)]);

function tag(name, text) {
  const data = new TextEncoder().encode(text);
  return box(name, box('data', u32(1), u32(0), data));
}

function container(packets, { sampleRate, channels, bits, totalSamples, title }) {
  const sizes = packets.map((p) => p.length);
  const mdatLen = sizes.reduce((a, b) => a + b, 0);
  const maxPacket = Math.max(0, ...sizes);
  const bitrate = totalSamples ? Math.round((mdatLen * 8 * sampleRate) / totalSamples) : 0;
  const fullPackets = Math.floor(totalSamples / FRAME), rest = totalSamples % FRAME;

  const cookie = concat([
    u32(FRAME), u8(0, bits, HISTORY_MULT, INITIAL_HISTORY, K_LIMIT, channels), u16(255),
    u32(maxPacket), u32(bitrate), u32(sampleRate),
  ]);
  const entry = box('alac',
    zeros(6), u16(1),                       // reserved, data reference index
    zeros(8),                               // version, revision, vendor
    u16(channels), u16(bits), u16(0), u16(0),
    u32(sampleRate << 16 >>> 0),
    full('alac', 0, 0, cookie));
  const stts = [];
  if (fullPackets) stts.push(u32(fullPackets), u32(FRAME));
  if (rest) stts.push(u32(1), u32(rest));
  const sttsCount = (fullPackets ? 1 : 0) + (rest ? 1 : 0);

  const build = (chunkOffset) => {
    const stbl = box('stbl',
      full('stsd', 0, 0, u32(1), entry),
      full('stts', 0, 0, u32(sttsCount), ...stts),
      full('stsc', 0, 0, u32(1), u32(1), u32(packets.length), u32(1)),
      full('stsz', 0, 0, u32(0), u32(packets.length), ...sizes.map(u32)),
      full('stco', 0, 0, u32(1), u32(chunkOffset)));
    const minf = box('minf',
      full('smhd', 0, 0, u16(0), u16(0)),
      box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
      stbl);
    const mdia = box('mdia',
      full('mdhd', 0, 0, u32(0), u32(0), u32(sampleRate), u32(totalSamples), u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, u32(0), ascii('soun'), zeros(12), ascii('SoundHandler\0')),
      minf);
    const trak = box('trak',
      full('tkhd', 0, 7, u32(0), u32(0), u32(1), u32(0), u32(totalSamples), zeros(8), u16(0), u16(0), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)),
      mdia);
    const ilst = box('ilst', ...(title ? [tag('\xa9nam', title)] : []), tag('\xa9too', 'Boba Beats'));
    const udta = box('udta', full('meta', 0, 0,
      full('hdlr', 0, 0, u32(0), ascii('mdir'), ascii('appl'), zeros(8), u8(0)),
      ilst));
    return box('moov',
      full('mvhd', 0, 0, u32(0), u32(0), u32(sampleRate), u32(totalSamples), u32(0x10000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2)),
      trak, udta);
  };

  const ftyp = box('ftyp', ascii('M4A '), u32(0), ascii('M4A '), ascii('mp42'), ascii('isom'));
  const offset = ftyp.length + build(0).length + 8;
  return concat([ftyp, build(offset), u32(mdatLen + 8), ascii('mdat'), ...packets]);
}

// intChannels: Int32Array per channel (from pcm.js), bits: 16 or 24.
export function encodeAlac(intChannels, sampleRate, bits = 16, { title = '', onProgress } = {}) {
  const nch = intChannels.length, total = intChannels[0].length;
  const bw = new BitWriter(FRAME * nch * 4 + 64);
  const packets = [];
  for (let off = 0; off < total; off += FRAME) {
    const n = Math.min(FRAME, total - off);
    bw.reset();
    writeCompressed(bw, intChannels, off, n, bits);
    const rawBytes = Math.ceil((n * nch * bits + 23 + (n !== FRAME ? 32 : 0) + 3) / 8);
    if (bw.pos >= rawBytes) {
      bw.reset();
      writeVerbatim(bw, intChannels, off, n, bits);
    }
    packets.push(bw.bytes());
    if (onProgress && (packets.length & 63) === 0) onProgress(off / total);
  }
  return container(packets, { sampleRate, channels: nch, bits, totalSamples: total, title });
}

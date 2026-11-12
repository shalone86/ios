// Float samples -> integers, with triangular dither so quiet tails fade
// into smooth noise instead of gritty quantisation steps.

export function toInt(channels, bits = 16, dither = true) {
  const scale = bits === 24 ? 8388607 : 32767;
  const lo = -scale - 1, hi = scale;
  let seed = 0x1234567;
  const rnd = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  return channels.map((ch) => {
    const out = new Int32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const d = dither ? rnd() - rnd() : 0;
      const v = Math.round(ch[i] * scale + d);
      out[i] = v < lo ? lo : v > hi ? hi : v;
    }
    return out;
  });
}

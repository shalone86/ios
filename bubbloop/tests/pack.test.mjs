// The instrument pack: a valid zip, an .sfz per track that only names files
// it contains, WAVs that decode and are not silent, and samples that sit on
// the pitch the map claims.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve, openPage, OUT } from './lib.mjs';

const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };

const r = await page.evaluate(async () => {
  const S = await import('/js/state.js');
  const { buildPack } = await import('/js/codec/sfz.js');
  const T = await import('/js/theory.js');
  const p = S.demoProject();
  const t0 = performance.now();
  const pack = await buildPack(p);
  let s = '';
  for (let i = 0; i < pack.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, pack.bytes.subarray(i, i + 0x8000));
  return { name: pack.name, b64: btoa(s), files: pack.files, ms: performance.now() - t0, tracks: p.tracks.map((t) => ({ name: t.name, role: t.role, root: T.rootMidi(p, t) })) };
});

fs.mkdirSync(OUT, { recursive: true });
const zipPath = path.join(OUT, r.name);
fs.writeFileSync(zipPath, Buffer.from(r.b64, 'base64'));
console.log(`  built ${r.name}: ${r.files.length} files, ${(fs.statSync(zipPath).size / 1e6).toFixed(1)} MB, ${(r.ms / 1000).toFixed(1)} s`);

let t = '';
try { t = execFileSync('unzip', ['-t', zipPath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { t = String(e.stdout) + String(e.stderr); }
check(/No errors detected/.test(t), 'unzip -t passes');

const dir = path.join(OUT, 'pack');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
execFileSync('unzip', ['-q', zipPath, '-d', dir]);
const all = [];
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, f.name); f.isDirectory() ? walk(q) : all.push(q); } };
walk(dir);
const sfzs = all.filter((f) => f.endsWith('.sfz')), wavs = all.filter((f) => f.endsWith('.wav'));
check(sfzs.length === r.tracks.length, `one .sfz per track (${sfzs.length} of ${r.tracks.length})`);

let missing = 0, regions = 0;
for (const f of sfzs) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/sample=(\S+)/g)) {
    regions++;
    if (!fs.existsSync(path.join(path.dirname(f), m[1]))) { missing++; console.log('    missing ' + m[1] + ' in ' + f); }
  }
}
check(regions > 0 && missing === 0, `every sample= reference exists (${regions} regions)`);

// WAVs: readable by ffprobe, and decoded through ffmpeg they are not silent
const decode = (file) => {
  const out = execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 28 });
  return new Int16Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.length - (out.length % 2)));
};
let bad = [];
for (const f of wavs) {
  let info;
  try { info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', f]).toString()).streams[0]; } catch (e) { bad.push(path.basename(f) + ' unreadable'); continue; }
  const pcm = decode(f);
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (info.codec_name !== 'pcm_s16le' || info.sample_rate !== '44100') bad.push(path.basename(f) + ' format');
  else if (peak < 300) bad.push(path.basename(f) + ' silent');
  else if (peak > 32700) bad.push(path.basename(f) + ' clips');
}
check(wavs.length > 0 && bad.length === 0, `${wavs.length} WAVs are 16-bit 44.1 kHz, audible and peak-safe ${bad.slice(0, 5).join(', ')}`);

// pitch: autocorrelate the sustained part of a sampled note
function pitchCents(file, midi) {
  const x = decode(file);
  const sr = 44100, a = Math.round(0.25 * sr), n = 8192;
  const seg = Float64Array.from(x.subarray(a, a + n));
  const f0 = 440 * 2 ** ((midi - 69) / 12);
  const lagLo = Math.floor(sr / (f0 * 2 ** (7 / 12))), lagHi = Math.ceil(sr / (f0 / 2 ** (7 / 12)));
  const ac = (lag) => { let s = 0; for (let i = 0; i + lag < n; i++) s += seg[i] * seg[i + lag]; return s; };
  let best = lagLo, bv = -Infinity;
  const vals = {};
  for (let l = lagLo - 1; l <= lagHi + 1; l++) vals[l] = ac(l);
  for (let l = lagLo; l <= lagHi; l++) if (vals[l] > bv) { bv = vals[l]; best = l; }
  const y0 = vals[best - 1], y1 = vals[best], y2 = vals[best + 1];
  const lag = best + (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
  return 1200 * Math.log2((sr / lag) / f0);
}
for (const tr of r.tracks.filter((q) => q.role !== 'drums')) {
  const sfz = sfzs.find((f) => path.basename(f) === `${tr.name}.sfz`);
  const text = fs.readFileSync(sfz, 'utf8');
  const keys = [...text.matchAll(/sample=(\S+) pitch_keycenter=(\d+)/g)];
  const lo = keys[0], mid = keys[Math.floor(keys.length / 2)];
  check(+lo[2] >= tr.root || +lo[2] === 24, `${tr.name}: samples start at the track's lowest note (${lo[2]})`);
  for (const k of [lo, mid]) {
    const c = pitchCents(path.join(path.dirname(sfz), k[1]), +k[2]);
    check(Math.abs(c) <= 20, `${tr.name}: ${k[1]} is ${c.toFixed(1)} cents from pitch_keycenter ${k[2]}`);
  }
}

// drums: keyed by gm note, first pad wins
const drum = sfzs.find((f) => /Drums\.sfz$/.test(f));
const dk = [...fs.readFileSync(drum, 'utf8').matchAll(/key=(\d+)/g)].map((m) => +m[1]);
check(new Set(dk).size === dk.length && dk.includes(36) && fs.readFileSync(drum, 'utf8').includes('one_shot'), `drum keys are unique one-shots (${dk.length} keys)`);
check(errors.length === 0, 'no page errors ' + errors.join('|'));

await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all pack checks passed'); process.exit(failed ? 1 : 0);

// Shared helpers for the test scripts: a tiny static server for the web
// app, a headless Chromium page, and WAV/ffmpeg utilities.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(here, '../web');
export const OUT = process.env.BUBBLOOP_TEST_OUT || path.resolve(here, '.out');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
  '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};

export function serve(root = WEB) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) {
    try { return require(id); } catch (e) { /* try next */ }
  }
  throw new Error('playwright is not installed');
}

export async function openPage(url, options = {}) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', ...(options.args || [])] });
  delete options.args;
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  return { browser, context, page, errors };
}

export function writeWav(file, channels, sampleRate) {
  const n = channels[0].length, nc = channels.length;
  const buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * nc * 2, 28);
  buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(n * nc * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32767))), o);
    o += 2;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

export function stats(ch) {
  let peak = 0, sum = 0, bad = 0;
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i];
    if (!Number.isFinite(x)) { bad++; continue; }
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  const rms = Math.sqrt(sum / Math.max(1, ch.length));
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  return { peak, rms, peakDb: +db(peak).toFixed(1), rmsDb: +db(rms).toFixed(1), bad };
}

export function ffmpeg(args) {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
  } catch (e) {
    return Buffer.concat([e.stdout || Buffer.alloc(0), e.stderr || Buffer.alloc(0)]);
  }
}

// Integrated loudness of a file according to ffmpeg's EBU R128 meter.
export function lufs(file) {
  const out = execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return out;
}
export function measureLufs(file) {
  let text = '';
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) { text = String(e.stderr); }
  if (!text) {
    const r = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostdin -i "${file}" -af ebur128=peak=true -f null - 2>&1`]);
    text = String(r);
  }
  const tail = text.slice(text.lastIndexOf('Summary:'));
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(tail);
  const pk = /Peak:\s+(-?[\d.]+) dBFS/.exec(tail);
  return { lufs: i ? +i[1] : NaN, truePeak: pk ? +pk[1] : NaN };
}

// Pull Float32Array channels out of the page without choking on size.
export async function pullChannels(page, expr) {
  const b64 = await page.evaluate(async (e) => {
    const r = await (0, eval)(e);
    const out = [];
    for (const ch of r.channels) {
      const bytes = new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.push(btoa(s));
    }
    return { sampleRate: r.sampleRate, channels: out };
  }, expr);
  return {
    sampleRate: b64.sampleRate,
    channels: b64.channels.map((s) => {
      const b = Buffer.from(s, 'base64');
      return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    }),
  };
}

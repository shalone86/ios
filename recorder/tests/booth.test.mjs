// Voice Booth: records three lines from a fake microphone, keeps them across
// a reload, and saves a zip whose WAV files ffprobe can read.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url)), WEB = path.resolve(here, '../web');
const OUT = fs.mkdtempSync(path.join(process.env.BOOTH_TEST_OUT || os.tmpdir(), 'booth-'));
const server = http.createServer((q, s) => {
  let r = new URL(q.url, 'http://x').pathname; if (r.endsWith('/')) r += 'index.html';
  const f = path.join(WEB, r); if (!f.startsWith(WEB) || !fs.existsSync(f)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }
const browser = await pw.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'], acceptDownloads: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let failed = 0; const check = (ok, m) => { console.log((ok ? '  ok   ' : '  FAIL ') + m); if (!ok) failed++; };

await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.click('#allow');
await page.waitForSelector('#start', { state: 'hidden' });
check((await page.textContent('#file')) === 'intro.wav', 'it starts on the first line, intro');
for (let i = 0; i < 3; i++) {
  await page.click('#rec'); await page.waitForTimeout(1200); await page.click('#rec');
  await page.waitForTimeout(200);
  if (i < 2) await page.click('#next');
}
const st = await page.evaluate(() => Object.fromEntries(Object.entries(window.booth.takes).map(([k, t]) => [k, { s: +(t.pcm.length / t.rate).toFixed(2), peak: +t.peak.toFixed(2) }])));
check(Object.keys(st).join() === 'intro,tap,weave' && Object.values(st).every((t) => t.s > 1 && t.s < 1.6 && t.peak > 0.01), 'three lines recorded with sound: ' + JSON.stringify(st));
await page.waitForTimeout(500);

await page.reload();
await page.click('#allow');
await page.waitForSelector('#start', { state: 'hidden' });
check((await page.textContent('#file')) === 'hold.wav' && (await page.$$('#list li.done')).length === 3, 'after closing the page, the takes are still there and it picks up at the next line');

const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
const zipFile = path.join(OUT, dl.suggestedFilename());
await dl.saveAs(zipFile);
execFileSync('unzip', ['-o', '-q', zipFile, '-d', OUT]);
const names = fs.readdirSync(OUT).filter((f) => f.endsWith('.wav')).sort();
const probe = names.map((f) => String(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,bits_per_sample', '-of', 'csv=p=0', path.join(OUT, f)])).trim());
check(dl.suggestedFilename() === 'deep-drift-voice.zip' && names.join() === 'intro.wav,tap.wav,weave.wav' && probe.every((p) => /,1,24$/.test(p)),
  `the zip holds intro.wav, tap.wav, weave.wav as 24-bit mono WAV (${probe.join(' | ')})`);
check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await page.screenshot({ path: path.join(OUT, 'booth.png') });
console.log('output in', OUT);
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all Voice Booth checks passed');
process.exit(failed ? 1 : 0);

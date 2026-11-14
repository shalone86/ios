// Kit mode: hold an empty bubble to record into it (with Chromium's fake
// microphone, which plays a beep), and chop a file of hits across the bubbles.
import { serve, openPage } from './lib.mjs';
const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/index.html', {
  viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };
await page.click('#btn-start', { force: true });
await page.waitForFunction(() => window.bubbloop && window.bubbloop.engine.ready);

// chop: six hits, 0.3 s apart
const chopped = await page.evaluate(async () => {
  const X = await import('/js/samples.js');
  const sr = 44100, x = new Float32Array(sr * 2);
  for (let h = 0; h < 6; h++) for (let i = 0; i < sr * 0.2; i++) x[Math.floor(h * 0.3 * sr) + i] = (Math.random() * 2 - 1) * Math.exp(-i / 1500) * 0.7 + Math.sin(i / 8) * Math.exp(-i / 3000) * 0.3;
  const one = new Float32Array(sr * 3); for (let i = 0; i < one.length; i++) one[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / sr);
  return { hits: X.chop(x, sr).length, held: X.chop(one, sr).length };
});
check(chopped.hits === 6, `a file with six hits chops into six slices (${chopped.hits})`);
check(chopped.held === 8, `a long held sound is cut into even pieces (${chopped.held})`);

// make the melody a kit-mode sampler and hold an empty bubble
await page.evaluate(() => {
  const b = window.bubbloop, t = b.project.tracks.find((x) => x.role === 'melody');
  t.inst = 'sampler'; t.smp = { mode: 'kit', key: null, kit: {} };
  document.querySelector(`.pod[data-track="${t.id}"]`).click();
});
check((await page.locator('#grid .cell[data-r="0"][data-c="0"] .lbl').innerText()) === 'hold', 'empty kit bubbles say "hold"');
const box = await page.locator('#grid .cell[data-r="0"][data-c="0"]').boundingBox();
const result = await page.evaluate(async ([x, y]) => {
  const el = document.elementFromPoint(x, y);
  const fire = (type) => el.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  fire('pointerdown');
  await new Promise((r) => setTimeout(r, 300));
  const recording = el.classList.contains('rec');
  await new Promise((r) => setTimeout(r, 900));
  fire('pointerup');
  await new Promise((r) => setTimeout(r, 800));
  const t = window.bubbloop.project.tracks.find((q) => q.role === 'melody');
  return { recording, filled: !!t.smp.kit[0], still: el.classList.contains('rec') };
}, [box.x + box.width / 2, box.y + box.height / 2]);
check(result.recording, 'holding an empty bubble records (it pulses red)');
check(result.filled && !result.still, 'letting go keeps the sound in that bubble');
check((await page.locator('#grid .cell[data-r="0"][data-c="0"] .lbl').innerText()).startsWith('Pad'), 'the bubble now shows its sound');

check(errors.length === 0, 'no page errors ' + errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all kit checks passed'); process.exit(failed ? 1 : 0);

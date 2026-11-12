// Opens the app at phone size, pokes at it, and saves screenshots.
import path from 'node:path';
import fs from 'node:fs';
import { serve, openPage, OUT } from './lib.mjs';
const server = await serve();
const W = +(process.env.W || 412), H = +(process.env.H || 892);
const { browser, page, errors } = await openPage(server.url + '/index.html', { viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
fs.mkdirSync(OUT, { recursive: true });
const shot = (n) => page.screenshot({ path: path.join(OUT, `shot-${n}.png`) });
await page.waitForTimeout(600);
await shot('0-splash');
await page.click('#btn-start', { force: true });
await page.waitForTimeout(1200);
await shot('1-play');
// STEPS="name::selector;;name::js:code" clicks (or runs) each step and snaps it
for (const step of (process.env.STEPS || '').split(';;').filter(Boolean)) {
  const cut = step.indexOf('::');
  const name = step.slice(0, cut), sel = step.slice(cut + 2);
  if (sel.startsWith('js:')) await page.evaluate(sel.slice(3)); else await page.click(sel, { force: true });
  await page.waitForTimeout(700);
  await shot(name);
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close(); server.close();

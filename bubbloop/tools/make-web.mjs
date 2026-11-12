// Prepares web/ for hosting as an installable app:
//   - renders the PNG icons from web/icons/icon.svg (needs Playwright)
//   - rewrites the list of files the service worker keeps for offline use
// Run it after adding, removing or changing files in web/:  node bubbloop/tools/make-web.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const skip = new Set(['sw.js', 'blank.html', 'icons/icon.svg']);

if (process.argv.includes('--icons')) {
  const require = createRequire(import.meta.url);
  let pw;
  for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }
  const svg = fs.readFileSync(path.join(web, 'icons/icon.svg'), 'utf8');
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  // "maskable" icons are cropped to a circle by the launcher, so their art is shrunk into the safe middle
  for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.1], ['apple-touch-icon', 180, 0]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:#2b1f66"><div style="width:${size}px;height:${size}px;background:linear-gradient(#2b1f66,#6b45a6 50%,#e07fb6)"><div style="position:absolute;inset:${-size * 0.17 + size * pad}px">${svg}</div></div></body>`);
    await page.screenshot({ path: path.join(web, 'icons', name + '.png'), clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
}

const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f), rel = path.relative(web, full).split(path.sep).join('/');
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (!skip.has(rel) && !rel.endsWith('.txt')) files.push(rel);
  }
})(web);
const hash = crypto.createHash('sha1');
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(web, f)));
const sw = path.join(web, 'sw.js');
const src = fs.readFileSync(sw, 'utf8')
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${hash.digest('hex').slice(0, 10)}';`)
  .replace(/const FILES = \[[\s\S]*?\];/, `const FILES = ${JSON.stringify(['./', ...files], null, 2)};`);
if (process.argv.includes('--check')) {
  // used by the tests: fails when sw.js was not refreshed after a change
  if (src !== fs.readFileSync(sw, 'utf8')) { console.error('web/sw.js is out of date: run node bubbloop/tools/make-web.mjs'); process.exit(1); }
  console.log('sw.js is up to date');
  process.exit(0);
}
fs.writeFileSync(sw, src);
console.log(`sw.js lists ${files.length} files`);

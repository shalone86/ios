// Draws a web app's home-screen icons from its Android launcher icon (the
// vector drawables), so the installed web app and the APK look the same.
//   node tools/make-icons.mjs <android res folder> <web icons folder>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [res, out] = process.argv.slice(2);
const color = (c) => { // #AARRGGBB or #RRGGBB → css
  const h = c.replace('#', '');
  if (h.length === 8) return `rgba(${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${parseInt(h.slice(6, 8), 16)},${(parseInt(h.slice(0, 2), 16) / 255).toFixed(3)})`;
  return '#' + h;
};
let gid = 0;
function toSvg(xml) {
  const defs = [], parts = [];
  const re = /<path\b([^>]*?)(\/>|>([\s\S]*?)<\/path>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const a = m[1], inner = m[3] || '', at = (k) => { const r = new RegExp(`android:${k}="([^"]*)"`).exec(a); return r && r[1]; };
    let fill = at('fillColor') ? color(at('fillColor')) : 'none';
    const g = /<gradient([^>]*)>([\s\S]*?)<\/gradient>/.exec(inner);
    if (g) {
      const ga = (k) => { const r = new RegExp(`android:${k}="([^"]*)"`).exec(g[1]); return r && r[1]; };
      const stops = [...g[2].matchAll(/android:color="([^"]*)"\s+android:offset="([^"]*)"/g)].map((s) => `<stop offset="${s[2]}" stop-color="${color(s[1])}"/>`).join('');
      const id = 'g' + (gid++);
      defs.push(ga('type') === 'radial'
        ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${ga('centerX')}" cy="${ga('centerY')}" r="${ga('gradientRadius')}">${stops}</radialGradient>`
        : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${ga('startX')}" y1="${ga('startY')}" x2="${ga('endX')}" y2="${ga('endY')}">${stops}</linearGradient>`);
      fill = `url(#${id})`;
    }
    const stroke = at('strokeColor') ? ` stroke="${color(at('strokeColor'))}" stroke-width="${at('strokeWidth') || 1}" stroke-linecap="${at('strokeLineCap') || 'butt'}" stroke-linejoin="${at('strokeLineJoin') || 'miter'}"` : '';
    parts.push(`<path d="${at('pathData')}" fill="${fill}"${stroke}/>`);
  }
  return { defs: defs.join(''), body: parts.join('') };
}
const bg = toSvg(fs.readFileSync(path.join(res, 'drawable/ic_launcher_background.xml'), 'utf8'));
const fg = toSvg(fs.readFileSync(path.join(res, 'drawable/ic_launcher_foreground.xml'), 'utf8'));
// the full 108-unit canvas (Android crops it to a shape); "any" icons show its middle
const svg = (view, round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="100%" height="100%"><defs>${bg.defs}${fg.defs}<clipPath id="r"><rect x="0" y="0" width="108" height="108" rx="${round}"/></clipPath></defs><g clip-path="url(#r)">${bg.body}${fg.body}</g></svg>`;
const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { pw = require(id); break; } catch (e) { /* next */ } }
const browser = await pw.chromium.launch();
const page = await browser.newPage();
fs.mkdirSync(out, { recursive: true });
const shots = [['icon-192.png', 192, '9 9 90 90', 0], ['icon-512.png', 512, '9 9 90 90', 0], ['icon-maskable-512.png', 512, '0 0 108 108', 0], ['apple-touch-icon.png', 180, '9 9 90 90', 0]];
for (const [name, px, view] of shots) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(view, 0)}`);
  await page.screenshot({ path: path.join(out, name), omitBackground: true });
}
await browser.close();
console.log('icons in', out);

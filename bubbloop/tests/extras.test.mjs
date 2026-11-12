// Per-track FX, song-block fills and energy, accidentals and extended chords
// all have to survive a real render and actually change the sound.
import { serve, openPage } from './lib.mjs';
const server = await serve();
const { browser, page, errors } = await openPage(server.url + '/blank.html');
let failed = 0;
const check = (ok, msg) => { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failed++; };
const r = await page.evaluate(async () => {
  const S = await import('/js/state.js'); const { renderProject } = await import('/js/render.js'); const T = await import('/js/theory.js');
  const diff = (a, b) => { let s = 0, e = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { s += (a[i] - b[i]) ** 2; e += a[i] ** 2; } return Math.sqrt(s / e); };
  const ok = (x) => x.channels[0].every(Number.isFinite);
  const base = () => { const p = S.demoProject(); p.song = [{ sec: 0, rep: 2, off: {}, fx: [] }]; p.sections[0].fx = []; return p; };
  const ref = await renderProject(base(), { what: 'song' });
  const out = {};
  let p = base(); p.sections[0].fx = [{ t: 96, d: 192, k: 'crunch', tr: p.tracks[1].id }, { t: 400, d: 96, k: 'reverb', tr: p.tracks[0].id }, { t: 700, d: 96, k: 'stutter', p: 1, tr: p.tracks[3].id }];
  let x = await renderProject(p, { what: 'song' }); out.trackFx = [ok(x), diff(ref.channels[0], x.channels[0])];
  p = base(); p.song[0].sp = { [p.tracks[0].id]: { fill: 'jumble' }, [p.tracks[1].id]: { fill: 'stutter' }, [p.tracks[2].id]: { fill: 'rep16' }, [p.tracks[3].id]: { fill: 'rep8', vel: 0.55 } };
  x = await renderProject(p, { what: 'song' }); out.spice = [ok(x), diff(ref.channels[0], x.channels[0])];
  p = base(); for (const e of p.sections[0].ev[p.tracks[3].id]) e.a = 1; for (const e of p.sections[0].ev[p.tracks[2].id]) e.ch = 'thirteen';
  x = await renderProject(p, { what: 'song' }); out.notes = [ok(x), diff(ref.channels[0], x.channels[0])];
  p = base(); for (const e of p.sections[0].ev[p.tracks[3].id]) e.b = [[4, 60], [12, 150], [24, -100], [36, 0]];
  x = await renderProject(p, { what: 'song' }); out.bend = [ok(x), diff(ref.channels[0], x.channels[0])];
  const tr = { role: 'pads', oct: 0 }, proj = { key: 0, scale: 'major' };
  out.ninth = T.cellNotes(proj, tr, 0, 0, 'nine').map((m) => m % 12).join();
  out.sharp = T.cellNotes(proj, tr, 0, 0, 'off', 1)[0] % 12;
  out.maj7 = T.cellNotes(proj, tr, 0, 1, 'maj7').map((m) => m % 12).join() + ' ' + T.chordLabel(proj, 1, 'maj7');
  out.label = T.chordLabel(proj, 0, 'nine') + ' ' + T.chordLabel(proj, 4, 'eleven');
  return out;
});
check(r.trackFx[0] && r.trackFx[1] > 0.05, `FX aimed at single tracks render and change the mix (${(r.trackFx[1] * 100).toFixed(0)}%)`);
check(r.spice[0] && r.spice[1] > 0.05, `fills and energy on a song block render (${(r.spice[1] * 100).toFixed(0)}%)`);
check(r.notes[0] && r.notes[1] > 0.05, `accidentals and 13th chords render (${(r.notes[1] * 100).toFixed(0)}%)`);
check(r.bend[0] && r.bend[1] > 0.05, `recorded pitch bends play back (${(r.bend[1] * 100).toFixed(0)}%)`);
check(r.ninth === '0,4,7,11,2' && r.sharp === 1, `C ninth is C E G B D, sharp C is C sharp (${r.ninth}; ${r.sharp}; ${r.label})`);
check(r.maj7 === '2,6,9,1 Dmaj7', `Maj7 is a major seventh on any bubble (${r.maj7})`);
check(errors.length === 0, 'no page errors ' + errors.join('|'));
await browser.close(); server.close();
console.log(failed ? `${failed} failed` : 'all extras passed'); process.exit(failed ? 1 : 0);

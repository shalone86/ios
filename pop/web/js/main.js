// Pop Pads: the screen. Sixteen soda bubbles to drum on (Play), or to tap
// beats into one sound at a time (Steps); eight patterns to chain; a few
// knobs; and saving the beat as WAV, MIDI or stems.

import { PopEngine, newSong, tweakOf, PATTERNS, LFO_RATES, LFO_TARGETS } from './engine.js';
import { KITS, KIT_ORDER } from './kits.js';
import { loopWav, stemsZip, patternMidi, deliver, baseName } from './export.js';

const $ = (id) => document.getElementById(id);
const SAVE = 'poppads.song';
let eng = null, mode = 'play', sel = 0, chainEdit = false;

// ---------- the song, kept on this device ----------
function demo(song) {
  // a starter beat in pattern 1, so the first press of play does something
  const P = song.patterns[0], bits = (...s) => s.reduce((m, x) => m | (1 << (x - 1)), 0);
  P[0] = bits(1, 9, 11); P[2] = bits(5, 13); P[4] = bits(1, 3, 5, 7, 9, 11, 13, 15); P[5] = bits(16);
  return song;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE));
    if (s && s.v === 1 && Array.isArray(s.patterns) && KITS[s.kit]) return { ...newSong(), ...s, fx: { ...newSong().fx, ...s.fx } };
  } catch (e) { /* a fresh one */ }
  return demo(newSong());
}
let song = load();
let saveTimer = 0;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(SAVE, JSON.stringify(song)); } catch (e) { /* full or private */ } }, 300); };

// ---------- drawing ----------
const FACE = `<svg viewBox="0 0 64 40"><g fill="none" stroke="rgba(40,10,0,.75)" stroke-width="3.2" stroke-linecap="round">
  <g class="shut"><path d="M14 14 q5 -6 10 0"/><path d="M40 14 q5 -6 10 0"/></g>
  <g class="wink"><path d="M14 14 q5 -6 10 0"/><path d="M40 12 h10"/></g>
  <g class="dizzy"><path d="M15 9 l8 8 M23 9 l-8 8 M41 9 l8 8 M49 9 l-8 8"/></g>
  <path class="smile" d="M27 25 q5 5 10 0"/></g>
  <ellipse class="o" cx="32" cy="27" rx="4.5" ry="5.5" fill="rgba(40,10,0,.75)"/>
  <ellipse cx="9" cy="24" rx="5" ry="3" fill="rgba(255,120,150,.45)"/><ellipse cx="55" cy="24" rx="5" ry="3" fill="rgba(255,120,150,.45)"/></svg>`;
// pads are laid out bottom row first: kicks and snares under the thumbs
const padAt = (cell) => (3 - Math.floor(cell / 4)) * 4 + (cell % 4);

function applyKitColours() {
  const k = KITS[song.kit], r = document.documentElement.style;
  k.color.forEach((c, n) => r.setProperty(`--c${n}`, c));
  document.querySelector('meta[name=theme-color]').content = k.color[0];
  $('kit').querySelector('span').textContent = k.name;
  $('kit').title = `${k.name}: ${k.style}`;
}
function drawGrid() {
  const g = $('grid'), k = KITS[song.kit];
  if (mode === 'play') {
    g.innerHTML = [...Array(16).keys()].map((cell) => { const i = padAt(cell); return `<button class="pad" data-pad="${i}" aria-label="${k.pads[i].name}">${FACE}<b>${k.pads[i].name}</b></button>`; }).join('');
  } else {
    const bits = song.patterns[song.cur][sel];
    g.innerHTML = [...Array(16).keys()].map((s) => `<button class="step ${(bits >> s) & 1 ? 'on' : ''} ${s % 4 === 0 ? 'beat' : ''}" data-step="${s}">${s + 1}</button>`).join('');
  }
}
function drawSounds() {
  const k = KITS[song.kit], pat = song.patterns[song.cur];
  $('sounds').innerHTML = k.pads.map((p, i) => `<button data-sel="${i}" class="${i === sel ? 'on' : ''} ${pat[i] ? 'has' : ''}">${p.name}</button>`).join('');
}
function drawPatterns() {
  const order = (i) => song.chain.length > 1 || chainEdit ? song.chain.map((c, k) => (c === i ? k + 1 : 0)).filter(Boolean) : [];
  $('patterns').innerHTML = [...Array(PATTERNS).keys()].map((i) => {
    const o = order(i);
    return `<button class="pat ${i === song.cur ? 'cur' : ''} ${song.patterns[i].some(Boolean) ? 'has' : ''}" data-pat="${i}">${i + 1}${o.length ? `<sup>${o.join(',')}</sup>` : ''}</button>`;
  }).join('') + `<button class="chip small ${chainEdit || song.chain.length > 1 ? 'on' : ''}" id="chain">${chainEdit ? 'done' : 'chain'}</button>`;
}
function drawPanel() {
  const fx = song.fx;
  $('f-filter').value = Math.round(fx.filter * 100); $('f-drive').value = Math.round(fx.drive * 100);
  $('f-crush').value = Math.round(fx.crush * 100); $('f-swing').value = Math.round(song.swing * 100); $('f-lfo').value = Math.round(fx.lfo * 100);
  $('lfo-to').textContent = `LFO → ${fx.lfoTo}`; $('lfo-rate').textContent = LFO_RATES[fx.lfoRate][0];
  const t = tweakOf(song, sel);
  $('p-pitch').value = t.pitch; $('p-len').value = Math.round(t.len * 100); $('p-tone').value = Math.round(t.tone * 100); $('p-vol').value = Math.round(t.vol * 100);
  $('p-clear').textContent = `Clear ${KITS[song.kit].pads[sel].name}`;
}
function drawAll() {
  applyKitColours(); drawPatterns(); drawGrid(); drawSounds(); drawPanel();
  $('bpm').textContent = `${song.bpm} bpm`;
  $('fx-panel').hidden = mode !== 'play'; $('pad-panel').hidden = mode !== 'steps'; $('sounds').hidden = mode !== 'steps';
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('hint').textContent = mode === 'play' ? 'hold a pad to repeat · slide up to stutter · slide down to jumble' : `tap the steps where ${KITS[song.kit].pads[sel].name} plays`;
}
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2000); };

// ---------- fizz in the background ----------
const fz = $('fizz'), fg = fz.getContext('2d');
const bubbles = Array.from({ length: 46 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 3.5, v: 0.0006 + Math.random() * 0.0016, w: Math.random() * 6 }));
let burst = 0;
function fizz(t) {
  const W = fz.width = innerWidth, H = fz.height = innerHeight;
  fg.clearRect(0, 0, W, H);
  fg.fillStyle = 'rgba(255,255,255,.28)';
  burst *= 0.95;
  for (const b of bubbles) {
    b.y -= b.v * (1 + burst * 6); if (b.y < -0.02) { b.y = 1.02; b.x = Math.random(); }
    fg.beginPath(); fg.arc(b.x * W + Math.sin(t / 700 + b.w) * 4, b.y * H, b.r, 0, 7); fg.fill();
  }
  requestAnimationFrame(fizz);
}
requestAnimationFrame(fizz);

// ---------- audio ----------
async function start() {
  if (eng) { if (eng.ctx.state !== 'running') await eng.ctx.resume(); return; }
  eng = await PopEngine.create();
  eng.setSong(song);
  await eng.setKit(song.kit);
  eng.onHit = (i) => {
    burst = Math.min(1, burst + 0.15);
    const el = document.querySelector(`.pad[data-pad="${i}"]`); if (!el) return;
    el.classList.add('hit'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('hit'), 110);
  };
  eng.onStep = (s, pi, fx) => {
    document.querySelectorAll('.pat').forEach((p) => p.classList.toggle('now', +p.dataset.pat === pi && eng.playing));
    if (mode === 'steps') document.querySelectorAll('.step').forEach((el) => el.classList.toggle('now', +el.dataset.step === s && pi === song.cur && eng.playing));
  };
  eng.onWrite = () => { save(); if (mode === 'steps') { drawGrid(); drawSounds(); } drawPatterns(); };
}

// ---------- playing the pads ----------
const touches = new Map();     // pointerId -> { pad, el, y0, timer, holding }
function letGo(id) {
  const t = touches.get(id); if (!t) return;
  touches.delete(id); clearTimeout(t.timer);
  if (t.holding) eng.release(t.pad);
  t.el.classList.remove('rep', 'stutter', 'jumble');
  if (![...touches.values()].some((x) => x.holding)) document.querySelectorAll('.pad').forEach((p) => p.classList.remove('stutter', 'jumble'));
}
$('grid').addEventListener('pointerdown', async (e) => {
  const pad = e.target.closest('.pad'), stepEl = e.target.closest('.step');
  if (!pad && !stepEl) return;
  e.preventDefault();
  await start();
  if (stepEl) {
    // steps: toggle this sound on that step
    const s = +stepEl.dataset.step, P = song.patterns[song.cur];
    P[sel] ^= 1 << s;
    if ((P[sel] >> s) & 1) eng.hit(sel);
    stepEl.classList.toggle('on', !!((P[sel] >> s) & 1));
    save(); drawSounds(); drawPatterns();
    return;
  }
  // a new first finger while others are "down": those were lost touches, let them go
  if (e.isPrimary) for (const id of [...touches.keys()]) letGo(id);
  const i = +pad.dataset.pad;
  try { pad.setPointerCapture(e.pointerId); } catch (err) { /* a pointer the browser can't capture: moves still reach the grid */ }
  eng.tap(i);
  const t = { pad: i, el: pad, y0: e.clientY, holding: false };
  t.timer = setTimeout(() => { t.holding = true; eng.hold(i); pad.classList.add('rep'); }, 220);
  touches.set(e.pointerId, t);
});
$('grid').addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId); if (!t || !t.holding) return;
  const dy = t.y0 - e.clientY, all = document.querySelectorAll('.pad');
  if (dy > 24) { eng.setPerf('stutter', Math.min(1, (dy - 24) / 130)); all.forEach((p) => { p.classList.add('stutter'); p.classList.remove('jumble'); }); }
  else if (dy < -24) { eng.setPerf('jumble', Math.min(1, (-dy - 24) / 130)); all.forEach((p) => { p.classList.add('jumble'); p.classList.remove('stutter'); }); }
  else { eng.setPerf(null); all.forEach((p) => p.classList.remove('stutter', 'jumble')); }
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => $('grid').addEventListener(ev, (e) => letGo(e.pointerId)));
addEventListener('blur', () => { for (const id of [...touches.keys()]) letGo(id); });

// ---------- transport and modes ----------
$('play').onclick = async () => {
  await start();
  if (eng.playing) { eng.stop(); $('rec').classList.remove('on'); document.querySelectorAll('.now').forEach((n) => n.classList.remove('now')); }
  else eng.play();
  $('play').classList.toggle('on', eng.playing); $('play').textContent = eng.playing ? '■' : '▶';
};
$('rec').onclick = async () => {
  await start();
  eng.rec = !eng.rec;
  if (eng.rec && !eng.playing) { eng.play(); $('play').classList.add('on'); $('play').textContent = '■'; }
  $('rec').classList.toggle('on', eng.rec);
  if (eng.rec) toast(`recording into pattern ${song.cur + 1}`);
};
document.querySelector('.seg').onclick = (e) => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  mode = b.dataset.mode; drawAll();
};
$('sounds').onclick = async (e) => {
  const b = e.target.closest('[data-sel]'); if (!b) return;
  sel = +b.dataset.sel; await start(); eng.hit(sel); drawAll();
};

// ---------- patterns and chains ----------
let patHold = 0;
$('patterns').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-pat]'); if (!b || chainEdit) return;
  const i = +b.dataset.pat;
  // hold a pattern to copy the current one into it
  patHold = setTimeout(() => {
    patHold = -1;
    if (i === song.cur) return;
    song.patterns[i] = song.patterns[song.cur].slice(); song.cur = i; save(); drawAll();
    toast(`copied into pattern ${i + 1}`);
  }, 550);
});
$('patterns').addEventListener('pointerup', () => { if (patHold > 0) clearTimeout(patHold); });
$('patterns').onclick = (e) => {
  if (e.target.id === 'chain') {
    if (!chainEdit) { chainEdit = true; song.chain = []; toast('tap patterns in the order to play them'); }
    else { chainEdit = false; if (!song.chain.length) song.chain = [song.cur]; toast(song.chain.length > 1 ? `chain: ${song.chain.map((c) => c + 1).join(' → ')}` : 'one pattern'); }
    if (eng) eng.bars.clear();
    save(); drawAll(); return;
  }
  const b = e.target.closest('[data-pat]'); if (!b) return;
  if (patHold === -1) { patHold = 0; return; }
  const i = +b.dataset.pat;
  if (chainEdit) { song.chain.push(i); song.cur = i; }
  else { song.cur = i; song.chain = [i]; }
  if (eng) eng.bars.clear();
  save(); drawAll();
};

// ---------- knobs ----------
const fxInput = (id, fn) => $(id).addEventListener('input', (e) => { fn(+e.target.value); if (eng) eng.updateFx(); save(); });
fxInput('f-filter', (v) => { song.fx.filter = Math.abs(v) < 6 ? 0 : v / 100; });
fxInput('f-drive', (v) => { song.fx.drive = v / 100; });
fxInput('f-crush', (v) => { song.fx.crush = v / 100; });
fxInput('f-swing', (v) => { song.swing = v / 100; });
fxInput('f-lfo', (v) => { song.fx.lfo = v / 100; });
$('lfo-to').onclick = () => { song.fx.lfoTo = LFO_TARGETS[(LFO_TARGETS.indexOf(song.fx.lfoTo) + 1) % LFO_TARGETS.length]; if (eng) eng.updateFx(); save(); drawPanel(); };
$('lfo-rate').onclick = () => { song.fx.lfoRate = (song.fx.lfoRate + 1) % LFO_RATES.length; if (eng) eng.updateFx(); save(); drawPanel(); };
const padInput = (id, key, scale) => $(id).addEventListener('input', (e) => {
  const all = song.tweaks[song.kit] = song.tweaks[song.kit] || [];
  all[sel] = { ...tweakOf(song, sel), [key]: +e.target.value / scale };
  save();
});
padInput('p-pitch', 'pitch', 1); padInput('p-len', 'len', 100); padInput('p-tone', 'tone', 100); padInput('p-vol', 'vol', 100);
// hear the change when a pad knob is let go
['p-pitch', 'p-len', 'p-tone', 'p-vol'].forEach((id) => $(id).addEventListener('change', () => { if (eng) eng.hit(sel); }));
$('p-clear').onclick = () => { song.patterns[song.cur][sel] = 0; save(); drawAll(); };

// ---------- sheets ----------
function openSheet(html, wire) {
  $('sheet').innerHTML = html; $('sheet').hidden = false; $('scrim').hidden = false;
  if (wire) wire($('sheet'));
}
const closeSheet = () => { $('sheet').hidden = true; $('scrim').hidden = true; };
$('scrim').onclick = closeSheet;

$('kit').onclick = () => openSheet(`<h3>Flavours</h3>${KIT_ORDER.map((id) => {
  const k = KITS[id];
  return `<button class="big ${id === song.kit ? 'on' : ''}" data-kit="${id}"><i class="flav" style="background:radial-gradient(circle at 35% 30%,#fff,${k.color[2]} 45%,${k.color[1]})"></i><span>${k.name}<small>${k.style}</small></span></button>`;
}).join('')}`, (s) => s.onclick = async (e) => {
  const b = e.target.closest('[data-kit]'); if (!b) return;
  await start();
  song.kit = b.dataset.kit; await eng.setKit(song.kit); save(); drawAll();
  s.querySelectorAll('[data-kit]').forEach((x) => x.classList.toggle('on', x === b));
  eng.hit(0); setTimeout(() => eng.hit(2), 260);
});

let taps = [];
$('bpm').onclick = () => openSheet(`<h3>Tempo</h3>
  <div class="tempo"><button data-d="-1">−</button><span id="t-val">${song.bpm}</span><button data-d="1">+</button></div>
  <input type="range" id="t-slide" min="60" max="180" value="${song.bpm}">
  <div class="row" style="justify-content:center;margin-top:10px"><button class="chip" id="t-tap">tap the beat</button></div>`, (s) => {
  const set = (v) => { song.bpm = Math.max(60, Math.min(180, Math.round(v))); s.querySelector('#t-val').textContent = song.bpm; s.querySelector('#t-slide').value = song.bpm; $('bpm').textContent = `${song.bpm} bpm`; if (eng) eng.updateFx(); save(); };
  s.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => set(song.bpm + +b.dataset.d));
  s.querySelector('#t-slide').oninput = (e) => set(+e.target.value);
  s.querySelector('#t-tap').onclick = () => {
    const now = performance.now(); taps = taps.filter((t) => now - t < 2500); taps.push(now);
    if (taps.length >= 3) set(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  };
});

let loops = 2;
$('menu').onclick = () => openSheet(`<h3>Save the beat</h3>
  <p style="margin:0 0 10px;color:var(--dim);font-size:14px">${song.chain.length > 1 ? `The chain: ${song.chain.map((c) => c + 1).join(' → ')}` : `Pattern ${song.cur + 1}`}, played <span class="row" style="display:inline-flex">${[1, 2, 4].map((n) => `<button class="chip small ${n === loops ? 'on' : ''}" data-loops="${n}">${n}×</button>`).join('')}</span></p>
  <button class="big" data-save="wav">🎵<span>Loop<small>a WAV that loops cleanly in any app</small></span></button>
  <button class="big" data-save="midi">🎹<span>Pattern for Logic<small>MIDI on the GM drum notes</small></span></button>
  <button class="big" data-save="stems">🎚️<span>Every sound<small>a zip with each drum as its own WAV, plus the mix</small></span></button>
  <p id="s-status" style="min-height:1.3em;color:var(--dim);font-size:14px;margin:6px 0 0"></p>
  <h4>Pattern ${song.cur + 1}</h4>
  <div class="row"><button class="chip" data-clear="1">Clear it</button></div>`, (s) => s.onclick = async (e) => {
  const L = e.target.closest('[data-loops]');
  if (L) { loops = +L.dataset.loops; s.querySelectorAll('[data-loops]').forEach((x) => x.classList.toggle('on', x === L)); return; }
  if (e.target.closest('[data-clear]')) { song.patterns[song.cur] = new Array(16).fill(0); save(); drawAll(); closeSheet(); toast(`pattern ${song.cur + 1} cleared`); return; }
  const b = e.target.closest('[data-save]'); if (!b) return;
  const st = s.querySelector('#s-status'), name = baseName(song);
  if (!song.patterns.some((p) => p.some(Boolean))) { st.textContent = 'There is nothing in the pattern yet.'; return; }
  try {
    st.textContent = 'Making it…';
    let msg;
    if (b.dataset.save === 'wav') msg = await deliver((await loopWav(song, { loops })).bytes, `${name}.wav`, 'audio/wav');
    if (b.dataset.save === 'midi') msg = await deliver(patternMidi(song, { loops }), `${name}.mid`, 'audio/midi');
    if (b.dataset.save === 'stems') msg = await deliver(await stemsZip(song, { loops: 1 }, (m) => { st.textContent = m; }), `${name}-stems.zip`, 'application/zip');
    st.textContent = msg ? `✓ ${msg}` : '';
  } catch (err) { st.textContent = `Could not save: ${err.message}`; }
});

// ---------- go ----------
$('go').onclick = async () => { $('start').classList.add('gone'); await start(); };
// the Android app: the beat stops when you leave the app
window.popPadsPause = () => { if (eng && eng.playing) $('play').click(); };
// the Android back button closes a sheet first
window.popPadsBack = () => { if (!$('sheet').hidden) { closeSheet(); return true; } return false; };
drawAll();
window.popPads = { get eng() { return eng; }, get song() { return song; }, start };

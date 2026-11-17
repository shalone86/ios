// Pop Pads: the screen. Sixteen soda bubbles to drum on (Play), or to tap
// beats into one sound at a time (Steps); eight patterns to chain; a few
// knobs; and saving the beat as WAV, MIDI or stems.

import { PopEngine, newSong, tweakOf, padAt as padSettings, mixAt, laneOf, motionOf, hasMotion, PATTERNS, LFO_RATES, LFO_TARGETS } from './engine.js';
import { KITS, KIT_ORDER } from './kits.js';
import { loopWav, stemsZip, patternMidi, deliver, baseName, bobaSong, handOff } from './export.js';

// the other bubble apps (in the Android app these open in the browser)
const APPS = [['Boba Beats', 'https://shalonely.com/boba/', '🧋', 'make whole songs out of bubbles'], ['Deep Drift', 'https://shalonely.com/night/', '🪼', 'a sleepy sea that sings you to sleep']];

const $ = (id) => document.getElementById(id);
const SAVE = 'poppads.song';
let eng = null, mode = 'play', sel = 0, chainEdit = false;
let tab = 'drum', lockStep = null;       // steps mode: which panel, and the step being given its own settings

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
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(SAVE, JSON.stringify(song)); } catch (e) { /* full or private */ } }, 300);
  remember();
};

// ---------- undo ----------
// After each burst of editing (a drag, a recording pass, a clear…) the song
// is snapshotted; ↶ steps back through them. Which pattern you are looking
// at and the metronome are not edits, so they are left out.
const UNDO_MAX = 40, undos = [];
const snap = () => { const { cur, metro, ...rest } = song; return JSON.stringify(rest); };
let lastSnap = snap(), snapTimer = 0;
function remember() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    const now = snap();
    if (now === lastSnap) return;
    undos.push(lastSnap); if (undos.length > UNDO_MAX) undos.shift();
    lastSnap = now; drawUndo();
  }, 450);
}
function drawUndo() { const b = $('undo'); if (b) b.disabled = !undos.length; }
async function undo() {
  clearTimeout(snapTimer);
  if (snap() !== lastSnap) { lastSnap = snap(); }        // an edit still settling counts as the latest step
  else if (!undos.length) return;
  else lastSnap = undos.pop();
  const back = JSON.parse(lastSnap), kitWas = song.kit;
  for (const k of Object.keys(song)) if (k !== 'cur' && k !== 'metro') delete song[k];
  Object.assign(song, back);
  song.cur = Math.min(song.cur, PATTERNS - 1);
  if (eng) { if (song.kit !== kitWas) await eng.setKit(song.kit); eng.updateFx(); eng.bars.clear(); }
  lockStep = null;
  try { localStorage.setItem(SAVE, JSON.stringify(song)); } catch (e) { /* fine */ }
  drawAll(); drawUndo(); toast('undone');
}

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
    const bits = song.patterns[song.cur][sel], lanes = motionOf(song, song.cur).pads[sel] || {};
    const locked = (st) => Object.values(lanes).some((l) => l && l[st] != null);
    g.innerHTML = [...Array(16).keys()].map((st) => `<button class="step ${(bits >> st) & 1 ? 'on' : ''} ${st % 4 === 0 ? 'beat' : ''} ${locked(st) ? 'lock' : ''} ${st === lockStep ? 'sel' : ''}" data-step="${st}">${st + 1}</button>`).join('');
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
  }).join('') + `<button class="chip small ${chainEdit || song.chain.length > 1 ? 'on' : ''}" id="chain">${chainEdit ? 'done' : 'chain'}</button><button class="chip small icon" id="undo" aria-label="Undo" ${undos.length ? '' : 'disabled'}>↶</button>`;
}
// how a knob's slider value maps to its setting
const SCALE = { pitch: 1 };
const toVal = (key, raw) => raw / (SCALE[key] || 100);
const toRaw = (key, v) => Math.round(v * (SCALE[key] || 100));
function drawPanel() {
  const pi = song.cur, base = tweakOf(song, sel);
  const here = lockStep != null ? padSettings(song, pi, sel, lockStep) : base;
  document.querySelectorAll('#panel input[data-scope]').forEach((el) => {
    const { scope, key } = el.dataset;
    const v = scope === 'mix' ? song.fx[key] : here[key];
    el.value = toRaw(key, v);
    const lane = laneOf(song, pi, scope === 'mix' ? 'mix' : sel, key);
    el.closest('.sl').classList.toggle('moving', !!lane && lane.some((x) => x != null));
  });
  $('f-swing').value = Math.round(song.swing * 100);
  $('lfo-to').textContent = `LFO → ${song.fx.lfoTo}`; $('lfo-rate').textContent = LFO_RATES[song.fx.lfoRate][0];
  $('p-lfo-to').textContent = `LFO → ${base.lfoTo}`;
  const name = KITS[song.kit].pads[sel].name;
  $('p-clear').textContent = `Clear ${name}`;
  $('p-clear').hidden = lockStep != null || tab === 'mix'; $('lock-clear').hidden = $('lock-done').hidden = lockStep == null;
  $('panel').classList.toggle('locked', lockStep != null);
  document.querySelector('[data-tab="drum"]').textContent = name;
  document.querySelectorAll('.tabs [data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
}
function drawAll() {
  applyKitColours(); drawPatterns(); drawGrid(); drawSounds(); drawPanel();
  $('bpm').textContent = `${song.bpm} bpm`;
  if (mode !== 'steps') lockStep = null;
  const showMix = mode === 'play' || tab === 'mix';
  $('fx-panel').hidden = !showMix; $('pad-panel').hidden = showMix; $('sounds').hidden = mode !== 'steps'; $('tabs').hidden = mode !== 'steps';
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  showHint();
  $('metro').classList.toggle('on', !!song.metro);
  fit();
}
function showHint() {
  $('hint').classList.remove('count');
  $('hint').textContent = mode === 'play' ? 'hold a pad to repeat it · slide up for rolls · slide down to jumble it'
    : lockStep != null ? `step ${lockStep + 1}: the sliders below set this hit only` : `tap steps for ${KITS[song.kit].pads[sel].name} · hold a step for its own settings`;
}
// the pads get whatever room the other rows leave (sideways: the right-hand side)
function fit() {
  const app = $('app'), grid = $('grid');
  const VH = (window.visualViewport && visualViewport.height) || innerHeight;
  const wide = innerWidth > VH * 1.15 && VH < 700;
  document.body.classList.toggle('wide', wide);
  let size;
  if (wide) size = Math.min(VH - 28, innerWidth * 0.55);
  else {
    const cs = getComputedStyle(app), pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const rows = [...app.children].filter((el) => el !== grid && !el.hidden && el.offsetParent !== null);
    const used = rows.reduce((a, el) => a + el.offsetHeight, 0) + 10 * rows.length + pad;
    size = Math.min(app.clientWidth - 28, Math.min(VH, app.clientHeight) - used - 6);
  }
  const px = Math.max(200, Math.floor(size));
  grid.style.width = grid.style.maxWidth = `${px}px`;
  grid.style.gap = `${Math.round(px * 0.03)}px`;   // a % gap is measured against the height, which overlaps rows
}
addEventListener('resize', fit);
if (window.visualViewport) visualViewport.addEventListener('resize', fit);
if (document.fonts) document.fonts.ready.then(fit);
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
  // the count-in: 1 2 3 4 big in the hint line, then back to normal
  eng.onCount = (beat) => {
    if (!beat) { showHint(); return; }
    $('hint').classList.add('count'); $('hint').textContent = '● '.repeat(beat).trim() + '  ' + beat;
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
}
$('grid').addEventListener('pointerdown', async (e) => {
  const pad = e.target.closest('.pad'), stepEl = e.target.closest('.step');
  if (!pad && !stepEl) return;
  e.preventDefault();
  await start();
  if (stepEl) {
    // steps: a tap turns this drum on or off there; holding a step gives that one hit its own settings
    const st = +stepEl.dataset.step;
    stepHold = { st, done: false, id: e.pointerId };
    stepHold.timer = setTimeout(() => {
      stepHold.done = true;
      const P = song.patterns[song.cur];
      if (!((P[sel] >> st) & 1)) { P[sel] |= 1 << st; save(); }
      lockStep = lockStep === st ? null : st; tab = 'drum';
      eng.hit(sel, undefined, false, padSettings(song, song.cur, sel, st));
      drawAll();
    }, 380);
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
  // only the held pad changes: up = it rolls faster, down = it jumbles
  const dy = t.y0 - e.clientY, el = t.el;
  if (dy > 24) { eng.setPerf(t.pad, 'stutter', Math.min(1, (dy - 24) / 130)); el.classList.add('stutter'); el.classList.remove('jumble'); }
  else if (dy < -24) { eng.setPerf(t.pad, 'jumble', Math.min(1, (-dy - 24) / 130)); el.classList.add('jumble'); el.classList.remove('stutter'); }
  else { eng.setPerf(t.pad, null); el.classList.remove('stutter', 'jumble'); }
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => $('grid').addEventListener(ev, (e) => letGo(e.pointerId)));
let stepHold = null;
$('grid').addEventListener('pointerup', (e) => {
  if (!stepHold || stepHold.id !== e.pointerId) return;
  const h = stepHold; stepHold = null; clearTimeout(h.timer);
  if (h.done) return;
  const st = h.st, P = song.patterns[song.cur];
  if (lockStep != null) { lockStep = st === lockStep ? null : lockStep; }   // while editing a step, a tap elsewhere just ends it
  else {
    P[sel] ^= 1 << st;
    if ((P[sel] >> st) & 1) eng.hit(sel, undefined, false, padSettings(song, song.cur, sel, st));
    save();
  }
  drawAll();
});
$('grid').addEventListener('pointercancel', () => { if (stepHold) { clearTimeout(stepHold.timer); stepHold = null; } });
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
  // from a stop, a bar of clicks first so you know where "one" is
  if (eng.rec && !eng.playing) { eng.play(true); $('play').classList.add('on'); $('play').textContent = '■'; }
  $('rec').classList.toggle('on', eng.rec);
  if (eng.rec) toast(`recording into pattern ${song.cur + 1}`);
};
$('metro').onclick = () => { song.metro = !song.metro; save(); $('metro').classList.toggle('on', song.metro); toast(song.metro ? 'metronome on' : 'metronome off'); };
document.querySelector('.seg').onclick = (e) => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  mode = b.dataset.mode; drawAll();
};
$('sounds').onclick = async (e) => {
  const b = e.target.closest('[data-sel]'); if (!b) return;
  sel = +b.dataset.sel; lockStep = null; await start(); eng.hit(sel); drawAll();
};

// ---------- patterns and chains ----------
let patHold = 0, holdDone = false;   // holdDone: the press that just ended was a long one (its click is not a tap)
const isEmpty = (i) => !song.patterns[i].some(Boolean);
const copyInto = (i) => {
  song.patterns[i] = song.patterns[song.cur].slice();
  motionOf(song, i); song.motion[i] = JSON.parse(JSON.stringify(motionOf(song, song.cur)));
};
const clearPattern = (i) => { song.patterns[i] = new Array(16).fill(0); motionOf(song, i); song.motion[i] = { mix: {}, pads: {} }; };
function choose(i) { lockStep = null; song.cur = i; if (!chainEdit) song.chain = [i]; if (eng) eng.bars.clear(); save(); drawAll(); }
// Boba-style: a menu of what can be done with a pattern
function patternMenu(i, emptyAsk) {
  const from = song.cur;
  openSheet(`<h3>Pattern ${i + 1}${emptyAsk ? ' is empty' : ''}</h3>
    ${emptyAsk ? `<button class="big" data-p="empty">✨<span>Start empty<small>a fresh pattern</small></span></button>` : ''}
    ${i !== from && !isEmpty(from) ? `<button class="big" data-p="copy">📋<span>Copy pattern ${from + 1} here<small>${isEmpty(i) ? 'then change what you like' : `replaces what is in pattern ${i + 1} (↶ brings it back)`}</small></span></button>` : ''}
    ${!emptyAsk && !isEmpty(i) ? `<button class="big" data-p="clear">🧽<span>Clear pattern ${i + 1}<small>every drum and knob move in it (↶ brings it back)</small></span></button>` : ''}
    ${!emptyAsk && i !== from ? `<button class="big" data-p="go">▶<span>Go to pattern ${i + 1}</span></button>` : ''}`, (r) => r.onclick = (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const what = b.dataset.p;
    if (what === 'copy') { copyInto(i); toast(`pattern ${from + 1} copied into ${i + 1}`); }
    if (what === 'clear') { clearPattern(i); toast(`pattern ${i + 1} cleared`); }
    closeSheet(); choose(i);
  });
}
$('patterns').addEventListener('pointerdown', (e) => {
  holdDone = false;                     // any new press: the last long press is over
  const b = e.target.closest('[data-pat]'); if (!b || chainEdit) return;
  const i = +b.dataset.pat;
  holdDone = false;                     // a new press: forget the last long press
  patHold = setTimeout(() => { patHold = 0; holdDone = true; patternMenu(i, false); }, 500);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('patterns').addEventListener(ev, () => { if (patHold > 0) { clearTimeout(patHold); patHold = 0; } }));
$('patterns').onclick = (e) => {
  if (e.target.id === 'chain') {
    if (!chainEdit) { chainEdit = true; song.chain = []; toast('tap patterns in the order to play them'); }
    else { chainEdit = false; if (!song.chain.length) song.chain = [song.cur]; toast(song.chain.length > 1 ? `chain: ${song.chain.map((c) => c + 1).join(' → ')}` : 'one pattern'); }
    if (eng) eng.bars.clear();
    save(); drawAll(); return;
  }
  if (e.target.id === 'undo') { undo(); return; }
  const b = e.target.closest('[data-pat]'); if (!b) return;
  if (holdDone) { holdDone = false; return; }
  const i = +b.dataset.pat;
  if (chainEdit) { song.chain.push(i); choose(i); return; }
  // an empty pattern: start it empty, or as a copy of the one you were on
  if (isEmpty(i) && i !== song.cur && !isEmpty(song.cur)) { patternMenu(i, true); return; }
  choose(i);
};

// ---------- knobs ----------
// Every knob works the same way. Moved while recording (and playing), it is
// written onto the steps it passes; while a step is held in Steps mode, it
// sets that step only; otherwise it changes the setting itself.
function setKnob(el) {
  const { scope, key } = el.dataset, pi = song.cur;
  let v = toVal(key, +el.value);
  if ((key === 'filter' || key === 'filt') && Math.abs(v) < 0.06) v = 0;     // a little notch at the middle
  if (key === 'nudge' && Math.abs(v) < 0.04) v = 0;
  const who = scope === 'mix' ? 'mix' : sel;
  if (scope === 'pad' && lockStep != null) {
    laneOf(song, pi, sel, key, true)[lockStep] = v;
  } else if (eng && eng.rec && eng.playing && key !== 'nudge') {
    eng.touch(who, key, v);
  } else if (scope === 'mix') {
    song.fx[key] = v; if (eng) eng.updateFx();
  } else {
    const all = song.tweaks[song.kit] = song.tweaks[song.kit] || [];
    all[sel] = { ...tweakOf(song, sel), [key]: v };
  }
  save();
}
document.querySelectorAll('#panel input[data-scope]').forEach((el) => {
  el.addEventListener('input', () => setKnob(el));
  // let go: stop writing motion, show what was recorded, and hear a drum change
  el.addEventListener('change', () => {
    if (eng && eng.touching.size) { eng.untouch(); drawPanel(); if (mode === 'steps') drawGrid(); }
    if (eng && el.dataset.scope === 'pad') eng.hit(sel, undefined, false, lockStep != null ? padSettings(song, song.cur, sel, lockStep) : tweakOf(song, sel));
  });
});
$('f-swing').addEventListener('input', (e) => { song.swing = +e.target.value / 100; save(); });
$('lfo-to').onclick = () => { song.fx.lfoTo = LFO_TARGETS[(LFO_TARGETS.indexOf(song.fx.lfoTo) + 1) % LFO_TARGETS.length]; if (eng) eng.updateFx(); save(); drawPanel(); };
$('lfo-rate').onclick = () => { song.fx.lfoRate = (song.fx.lfoRate + 1) % LFO_RATES.length; if (eng) eng.updateFx(); save(); drawPanel(); };
$('p-lfo-to').onclick = () => {
  const all = song.tweaks[song.kit] = song.tweaks[song.kit] || [], t = tweakOf(song, sel);
  all[sel] = { ...t, lfoTo: LFO_TARGETS[(LFO_TARGETS.indexOf(t.lfoTo) + 1) % LFO_TARGETS.length] };
  save(); drawPanel();
};
$('tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; if (tab === 'mix') lockStep = null; drawAll(); };
$('p-clear').onclick = () => { song.patterns[song.cur][sel] = 0; delete motionOf(song, song.cur).pads[sel]; save(); drawAll(); };
$('lock-clear').onclick = () => {
  const lanes = motionOf(song, song.cur).pads[sel] || {};
  for (const l of Object.values(lanes)) if (l) l[lockStep] = null;
  save(); drawAll();
};
$('lock-done').onclick = () => { lockStep = null; drawAll(); };

// ---------- sheets ----------
// Menus work the way Boba Beats' do: each one gets a fresh body (so its
// handlers go with it), rises with a little bounce, and can be pulled down
// to close (it follows the finger, and springs back if not pulled far).
let sheetBusy = false;
function openSheet(html, wire) {
  const sh = $('sheet'), body = $('sheet-body'), root = document.createElement('div');
  root.innerHTML = html;
  body.textContent = ''; body.appendChild(root);
  sh.hidden = false; $('scrim').hidden = false;
  sh.style.transform = ''; sh.style.animation = 'none'; void sh.offsetWidth; sh.style.animation = '';
  sh.scrollTop = 0;
  if (wire) wire(root);
}
function closeSheet() {
  if (sheetBusy) return;
  $('sheet').hidden = true; $('scrim').hidden = true; $('sheet').style.transform = ''; $('sheet-body').textContent = '';
}
$('scrim').onclick = closeSheet;
{
  const sh = $('sheet');
  let startY = null, pulling = false, dy = 0;
  sh.addEventListener('touchstart', (e) => {
    startY = (sh.scrollTop <= 0 && e.target.tagName !== 'INPUT' && !sheetBusy) ? e.touches[0].clientY : null;
    pulling = false; dy = 0;
  }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (!pulling && dy > 10) pulling = true;
    if (!pulling) { if (dy < -6) startY = null; return; }
    e.preventDefault();
    sh.style.animation = 'none';
    sh.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = () => {
    if (pulling && dy > 90) closeSheet();
    else if (pulling) { sh.style.transition = 'transform .18s'; sh.style.transform = ''; setTimeout(() => { sh.style.transition = ''; }, 200); }
    startY = null; pulling = false;
  };
  sh.addEventListener('touchend', end);
  sh.addEventListener('touchcancel', end);
}

$('kit').onclick = () => openSheet(`<h3>Flavors</h3>${KIT_ORDER.map((id) => {
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
  <button class="big" data-boba="1">🧋<span>Send to Boba Beats<small>${window.PopNative ? 'saves a Boba song: open it there from its song menu → Import song file' : 'opens Boba with these drums and this beat, ready to add bass and chords'}</small></span></button>
  <p id="s-status" style="min-height:1.3em;color:var(--dim);font-size:14px;margin:6px 0 0"></p>
  <h4>Pattern ${song.cur + 1}</h4>
  <div class="row"><button class="chip" data-clear="1">Clear it</button>${hasMotion(song, song.cur) ? '<button class="chip" data-unmove="1">Clear its knob moves</button>' : ''}<button class="chip" data-how="1">▶ How it works</button></div>
  <h4>Bubble apps</h4>${APPS.map(([n, u, ic, d]) => `<a class="big" href="${u}" style="text-decoration:none;color:inherit">${ic}<span>${n}<small>${d}</small></span></a>`).join('')}
  ${window.PopNative || /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? '' : '<h4>On Android</h4><a class="big" href="PopPads.apk" download style="text-decoration:none;color:inherit">📱<span>Get the Android app<small>works offline, saves beats to your Music folder</small></span></a>'}`, (s) => s.onclick = async (e) => {
  const L = e.target.closest('[data-loops]');
  if (L) { loops = +L.dataset.loops; s.querySelectorAll('[data-loops]').forEach((x) => x.classList.toggle('on', x === L)); return; }
  if (e.target.closest('[data-how]')) { closeSheet(); showTour(); return; }
  if (e.target.closest('[data-boba]')) {
    const st = s.querySelector('#s-status');
    const bars = song.chain.length > 1 ? song.chain : [song.cur];
    if (!bars.some((b) => song.patterns[b].some(Boolean))) { st.textContent = 'There is nothing in the pattern yet.'; return; }
    try {
      st.textContent = 'Packing the drums…';
      const file = await bobaSong(song);
      if (window.PopNative) {
        const msg = await deliver(new TextEncoder().encode(JSON.stringify(file)), `${baseName(song)}.bobabeats.json`, 'application/json');
        st.textContent = `✓ ${msg}. In Boba Beats: song menu → Import song file.`;
      } else {
        await handOff(file);
        st.textContent = '✓ Opening Boba Beats…';
        if (eng && eng.playing) $('play').click();
        location.href = new URL('../boba/?from=pop', location.href).href.replace(/\/pop\/\.\.\//, '/');
      }
    } catch (err) { st.textContent = `Could not send it: ${err.message}`; }
    return;
  }
  if (e.target.closest('[data-unmove]')) { song.motion[song.cur] = { mix: {}, pads: {} }; if (eng) eng.updateFx(); save(); drawAll(); closeSheet(); toast(`knob moves cleared from pattern ${song.cur + 1}`); return; }
  if (e.target.closest('[data-clear]')) { song.patterns[song.cur] = new Array(16).fill(0); song.motion[song.cur] = { mix: {}, pads: {} }; save(); drawAll(); closeSheet(); toast(`pattern ${song.cur + 1} cleared`); return; }
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

// ---------- how it works: the video ----------
// the video tutorial; the beat stops while it plays
function showTour() {
  const box = $('tour'), v = $('tour-video');
  if (eng && eng.playing) $('play').click();
  if (!v.src) v.src = 'media/tutorial.mp4';
  box.hidden = false; v.currentTime = 0; v.play().catch(() => {});
}
const closeTour = () => { $('tour-video').pause(); $('tour').hidden = true; };
$('tour-close').onclick = closeTour;
$('tour-video').onended = closeTour;
$('how-start').onclick = () => { $('start').classList.add('gone'); start(); showTour(); };

// ---------- go ----------
$('go').onclick = async () => { $('start').classList.add('gone'); await start(); };
// the Android app: the beat stops when you leave the app
window.popPadsPause = () => { if (eng && eng.playing) $('play').click(); };
// the Android back button closes a sheet first
window.popPadsBack = () => { if (!$('tour').hidden) { closeTour(); return true; } if (!$('sheet').hidden) { closeSheet(); return true; } return false; };
drawAll();
window.popPads = { get eng() { return eng; }, get song() { return song; }, start };

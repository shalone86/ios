// Cozy Chords: tap a chord bubble, swipe the strings to strum it. A gentle
// beat with a bass that follows the chords, a take you can record, and
// saves for sharing, for Logic, and for Boba Beats.

import { Cozy, BEATS, beatOf, renderTake } from './engine.js';
import { VOICES } from './sound.js';
import { KEY_NAMES, chordsOf, stringNotes } from './theory.js';
import { offer, install, goOffline } from './install.js';

const $ = (id) => document.getElementById(id);
let eng = null;
const toast = (msg) => { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); };

// ---------- what is kept on this device ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
const S = { key: 0, mode: 'major', voice: 'omni', beat: 'none', bpm: 84, bars: 4, dub: false, ...load('cozy.settings', {}) };
let take = load('cozy.take', null);
const save = () => keep('cozy.settings', S);

// ---------- the chords ----------
const FACE = `<svg viewBox="0 0 64 24"><g fill="none" stroke="rgba(40,10,20,.72)" stroke-width="3.2" stroke-linecap="round">
  <g class="shut"><path d="M12 8 q5 5 10 0"/><path d="M42 8 q5 5 10 0"/></g>
  <g class="open"><path d="M12 9 q5 -6 10 0"/><path d="M42 9 q5 -6 10 0"/></g>
  <path class="smile" d="M27 15 q5 5 10 0"/></g>
  <ellipse class="o" cx="32" cy="16" rx="5" ry="5.6" fill="rgba(40,10,20,.72)"/>
  <ellipse cx="6" cy="14" rx="5" ry="3" fill="rgba(255,110,140,.4)"/><ellipse cx="58" cy="14" rx="5" ry="3" fill="rgba(255,110,140,.4)"/></svg>`;
// a cocoa mug: steam, two marshmallows, the cup with its face and its chord
const STEAM = '<svg class="steam" viewBox="0 0 40 24"><path d="M10 22 q-5 -6 0 -11 t0 -10"/><path d="M28 22 q-5 -6 0 -11 t0 -10"/></svg>';
const mug = (label, numeral) => `${STEAM}<span class="cup">${FACE}<b>${label}</b><small>${numeral}</small></span><span class="float"><i class="m m1"></i><i class="m m2"></i></span>`;
let chords = chordsOf(S.key, S.mode), cur = -1;
function drawChords() {
  chords = chordsOf(S.key, S.mode);
  $('chords').innerHTML = chords.map((c, i) => `<button class="chord r${Math.floor(i / 4)} ${i === cur ? 'cur' : ''}" data-i="${i}" aria-label="${c.label} (${c.numeral})">${mug(c.label, c.numeral.replace(/maj7|7|sus\d/, ''))}</button>`).join('');
  $('key').textContent = `${KEY_NAMES[S.key]} ${S.mode}`;
  $('voice').textContent = VOICES.find((v) => v.id === S.voice).name;
  $('beat').textContent = beatOf(S.beat).name; $('beat').classList.toggle('on', S.beat !== 'none');
  $('bpm').textContent = `${S.bpm} bpm`;
  drawStrings();
  fit();
}
const curChord = () => chords[cur >= 0 ? cur : 0];
// a mug sings when its chord plays: mouth open, marshmallows bobbing down
// into the cocoa (for a moment, or as long as it is held)
function sing(b) {
  if (!b) return;
  b.classList.add('sing'); clearTimeout(b.singing);
  b.singing = setTimeout(() => { if (!b.classList.contains('down')) b.classList.remove('sing'); }, 520);
}
const unsing = (b) => { b.classList.remove('down'); setTimeout(() => { if (!b.classList.contains('down')) b.classList.remove('sing'); }, 260); };
function drawStrings() {
  const notes = stringNotes(curChord());
  $('strings').innerHTML = notes.map(() => '<i></i>').join('');
  $('strip-name').textContent = curChord().label;
}
function select(i) {
  cur = i;
  document.querySelectorAll('.chord').forEach((b) => b.classList.toggle('cur', +b.dataset.i === i));
  drawStrings();
}

// ---------- bubbles: press to play, let go to stop a held chord ----------
const downs = new Map();   // pointer -> bubble index
async function start() {
  if (eng) return;
  eng = await Cozy.create();
  Object.assign(eng, { voice: S.voice, beat: S.beat, bpm: S.bpm });
  eng.onCount = (n) => { const h = $('hint'); if (n) { h.textContent = n; h.classList.add('count'); } else { showHint(); } };
  eng.onStep = (s, steps, bar) => {
    if (s !== 0) return;
    $('play').animate([{ transform: 'scale(1.12)' }, { transform: 'none' }], 180);
    if (eng.rec && bar >= 1 && bar <= eng.rec.bars) { const h = $('hint'); h.classList.remove('count'); h.textContent = `${eng.rec.dub ? 'dubbing' : 'recording'} · bar ${bar} of ${eng.rec.bars}`; }
  };
  eng.onRecEnd = () => { if (eng.rec) finishTake(); };
  warmLoop();
}
$('chords').addEventListener('pointerdown', async (e) => {
  const b = e.target.closest('.chord'); if (!b) return;
  e.preventDefault();
  await start();
  const i = +b.dataset.i;
  try { b.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
  downs.set(e.pointerId, i);
  b.classList.add('down'); sing(b);
  select(i);
  eng.press(i, chords[i]);
});
const up = (e) => {
  if (!downs.has(e.pointerId)) return;
  const i = downs.get(e.pointerId); downs.delete(e.pointerId);
  const b = document.querySelector(`.chord[data-i="${i}"]`); if (b) unsing(b);
  // a held chord stops when its bubble is let go (unless another finger has moved on to a new one)
  if (eng && eng.idx === i && ![...downs.values()].includes(i)) eng.release();
};
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => $('chords').addEventListener(ev, up));

// ---------- the strip: every string crossed plays ----------
const strums = new Map();   // pointer -> { last string, last position, last time }
function stringAt(e) {
  const r = $('strip').getBoundingClientRect(), tall = $('strip').classList.contains('tall'), n = stringNotes(curChord()).length;
  const k = tall ? 1 - (e.clientY - r.top - 10) / (r.height - 20) : (e.clientX - r.left - 10) / (r.width - 20);
  return Math.max(0, Math.min(n - 1, Math.round(k * (n - 1))));
}
function pluck(k, vel) {
  const notes = stringNotes(curChord());
  eng.string(notes[k], vel);
  const el = $('strings').children[k];
  if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 160); }
}
$('strip').addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  await start();
  if (cur < 0) select(0);
  try { $('strip').setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
  const k = stringAt(e);
  strums.set(e.pointerId, { k, x: e.clientX, y: e.clientY, t: performance.now() });
  pluck(k, 0.85);
});
$('strip').addEventListener('pointermove', (e) => {
  const s = strums.get(e.pointerId); if (!s) return;
  const k = stringAt(e); if (k === s.k) return;
  // faster swipes ring a little louder
  const now = performance.now(), dist = Math.hypot(e.clientX - s.x, e.clientY - s.y), speed = dist / Math.max(1, now - s.t);
  const vel = Math.max(0.55, Math.min(1.1, 0.6 + speed * 0.35)), dir = k > s.k ? 1 : -1;
  for (let j = s.k + dir; j !== k + dir; j += dir) pluck(j, vel);
  Object.assign(s, { k, x: e.clientX, y: e.clientY, t: now });
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => $('strip').addEventListener(ev, (e) => strums.delete(e.pointerId)));

// ---------- keys, for a laptop: 1-4 / Q-R / A-F are the bubbles, space strums ----------
const KEYMAP = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f'];
addEventListener('keydown', async (e) => {
  if (e.repeat || !$('sheet').hidden || e.metaKey || e.ctrlKey) return;
  const i = KEYMAP.indexOf(e.key.toLowerCase());
  if (i >= 0) {
    await start(); select(i); eng.press(i, chords[i]);
    const b = document.querySelector(`.chord[data-i="${i}"]`); if (b) { b.classList.add('down'); sing(b); }
  } else if (e.key === ' ') {
    e.preventDefault(); await start(); if (cur < 0) select(0);
    const n = stringNotes(curChord()).length;
    for (let k = 0; k < n; k++) setTimeout(() => pluck(k, 0.8), k * 18);
  }
});
addEventListener('keyup', (e) => {
  const i = KEYMAP.indexOf(e.key.toLowerCase()); if (i < 0) return;
  const b = document.querySelector(`.chord[data-i="${i}"]`); if (b) unsing(b);
  if (eng && eng.idx === i) eng.release();
});

// ---------- the beat and recording ----------
function showHint() {
  drawRecChip();
  const h = $('hint'); h.classList.remove('count');
  h.textContent = eng && eng.rec ? 'recording · tap ● to stop' : take ? `your take: ${take.bars} bars · ▶ to hear it${S.dub ? ' · ● dubs on top' : ''} · ☰ to save it` : 'tap a chord · swipe the strings to strum it';
}
function setPlaying(on) { $('play').classList.toggle('on', on); $('play').textContent = on ? '■' : '▶'; }
// ▶: stops whatever is playing; otherwise plays your take back if you have
// one (the beat starts from the Beat menu), or else starts the beat
$('play').onclick = async () => {
  await start();
  if (playingTake) { stopTake(); return; }
  if (eng.playing) { if (eng.rec) finishTake(); eng.stop(); setPlaying(false); showHint(); return; }
  if (take) { playTake(); return; }
  if (S.beat === 'none') { openBeats(); return; }
  eng.play(); setPlaying(true);
};
// your take, played back as it will be saved, the mugs lighting up as it goes
// The take as a seamless loop: rendered once (and again only when the take
// changes), its ring-out folded back onto its start, exactly its own length.
// Made ahead of time, so ▶ and dubbing start at once.
let loopCache = { key: '', buf: null, job: null };
function loopOf(t) {
  const key = JSON.stringify(t) + '@' + eng.ctx.sampleRate;
  if (loopCache.key === key) return loopCache.job;
  const job = renderTake(t, { sr: eng.ctx.sampleRate, tail: 3 }).then(({ buffer }) => {
    const sr = buffer.sampleRate, n = Math.round(t.dur * sr), out = eng.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const src = buffer.getChannelData(c), d = out.getChannelData(c);
      d.set(src.subarray(0, n));
      for (let i = n; i < src.length; i++) d[i % n] += src[i];
    }
    if (loopCache.key === key) loopCache.buf = out;
    return out;
  });
  loopCache = { key, buf: null, job };
  return job;
}
const warmLoop = () => { if (eng && take) loopOf(take).catch(() => {}); };
// the chord on at a moment of the take (for lighting up the mugs)
const chordAt = (t, pos) => { let i = -1; for (const e of t.ev) { if (e.t > pos + 0.02) break; if (e.k === 'c') i = e.i; } return i; };

let playingTake = null;
async function playTake() {
  setPlaying(true);
  if (!loopCache.buf) $('hint').textContent = 'getting your take ready…';
  const buf = await loopOf(take);
  eng.wake();
  const src = eng.ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(eng.ctx.destination);
  const at = eng.ctx.currentTime + 0.03; src.start(at);
  const evs = [...take.ev].sort((a, b) => a.t - b.t), same = take.key === S.key && take.mode === S.mode;
  let lit = -2;
  const follow = () => {
    if (!playingTake || playingTake.src !== src) return;
    const pos = ((eng.ctx.currentTime - at) % take.dur + take.dur) % take.dur, i = chordAt({ ev: evs }, pos);
    if (same && i !== lit && i >= 0) { lit = i; select(i); }
    requestAnimationFrame(follow);
  };
  playingTake = { src };
  requestAnimationFrame(follow);
  $('hint').textContent = '▶ your take, looping · tap ■ to stop';
}
function stopTake() {
  if (!playingTake) return;
  const p = playingTake; playingTake = null;
  try { p.src.stop(); } catch (e) { /* ended */ }
  setPlaying(false); showHint();
}
$('rec').onclick = async () => {
  await start();
  if (eng.rec) { finishTake(); return; }
  stopTake();
  const dub = S.dub && take ? take : null;
  if (dub) {
    // dubbing: the take plays (its tempo, its beat) while you add to it
    if (!loopCache.buf) $('hint').textContent = 'getting your take ready…';
    const buffer = await loopOf(take);
    const at = eng.record({ dub });
    const src = eng.ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(eng.ctx.destination); src.start(at);
    dubbing = src;
    toast('a bar to get ready, then play on top');
  } else {
    eng.record({ bars: S.bars });
    toast(S.beat === 'none' ? 'four clicks, then play' : 'one bar to get ready, then play');
  }
  setPlaying(true);
  $('rec').classList.add('on');
};
let dubbing = null;
function finishTake() {
  const wasDub = !!(eng.rec && eng.rec.dub);
  const t = eng.stopRec();
  $('rec').classList.remove('on');
  if (dubbing) { try { dubbing.stop(); } catch (e) { /* ended */ } dubbing = null; }
  if (wasDub) { eng.beat = S.beat; eng.bpm = S.bpm; }
  if (S.beat === 'none' || wasDub) { eng.stop(); setPlaying(false); }
  if (t && wasDub) { take = t; keep('cozy.take', take); toast('added on top · ▶ to hear it'); }
  else if (t) { t.key = S.key; t.mode = S.mode; take = t; keep('cozy.take', take); toast(`take kept: ${t.bars} bars · ▶ to hear it`); }
  else toast('nothing played, so nothing was kept');
  warmLoop();
  showHint();
}

// ---------- menus (Boba Beats' sheets) ----------
let sheetBusy = false;
function openSheet(html, wire) {
  const sh = $('sheet'), body = $('sheet-body'), root = document.createElement('div');
  root.innerHTML = html; body.textContent = ''; body.appendChild(root);
  sh.hidden = false; $('scrim').hidden = false;
  sh.style.transform = ''; sh.style.animation = 'none'; void sh.offsetWidth; sh.style.animation = '';
  sh.scrollTop = 0;
  if (wire) wire(root);
}
function closeSheet() {
  if (sheetBusy) return;
  $('sheet').hidden = true; $('scrim').hidden = true; $('sheet').style.transform = ''; $('sheet-body').textContent = '';
  stopListening();
}
$('scrim').onclick = closeSheet;
{
  const sh = $('sheet'); let startY = null, pulling = false, dy = 0;
  sh.addEventListener('touchstart', (e) => { startY = (sh.scrollTop <= 0 && e.target.tagName !== 'INPUT' && !sheetBusy) ? e.touches[0].clientY : null; pulling = false; dy = 0; }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (!pulling && dy > 10) pulling = true;
    if (!pulling) { if (dy < -6) startY = null; return; }
    e.preventDefault(); sh.style.animation = 'none'; sh.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = () => { if (pulling && dy > 90) closeSheet(); else if (pulling) { sh.style.transition = 'transform .18s'; sh.style.transform = ''; setTimeout(() => { sh.style.transition = ''; }, 200); } startY = null; pulling = false; };
  sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
}

$('key').onclick = () => openSheet(`<h3>Key</h3>
  <div class="row" style="margin-bottom:12px"><button class="chip ${S.mode === 'major' ? 'on' : ''}" data-mode="major">Major · bright</button><button class="chip ${S.mode === 'minor' ? 'on' : ''}" data-mode="minor">Minor · wistful</button></div>
  <div class="keys">${KEY_NAMES.map((n, k) => `<button class="chip ${k === S.key ? 'on' : ''}" data-key="${k}">${n}</button>`).join('')}</div>
  <p class="note" style="margin-top:12px">Every bubble stays in the key you pick. The top row is home, the middle row more from the key, the bottom row a few warm colors from nearby keys.</p>`, (r) => r.onclick = (e) => {
  const m = e.target.closest('[data-mode]'), k = e.target.closest('[data-key]');
  if (m) S.mode = m.dataset.mode; else if (k) S.key = +k.dataset.key; else return;
  save(); cur = -1; drawChords();
  r.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === S.mode));
  r.querySelectorAll('[data-key]').forEach((x) => x.classList.toggle('on', +x.dataset.key === S.key));
});
$('voice').onclick = () => openSheet(`<h3>Sound</h3>${VOICES.map((v) => `<button class="big ${v.id === S.voice ? 'on' : ''}" data-v="${v.id}"><span>${v.name}<small>${v.hint}</small></span></button>`).join('')}`, (r) => r.onclick = async (e) => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  S.voice = b.dataset.v; save(); await start(); eng.voice = S.voice; drawChords();
  r.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
  eng.press(cur >= 0 ? cur : 0, curChord()); setTimeout(() => eng.release(), 700);
});
function openBeats() {
  openSheet(`<h3>Beat</h3><p class="note">Soft drums, and a bass that follows your chords. Picking one starts it; ■ stops it.</p>${BEATS.map((b) => `<button class="big ${b.id === S.beat ? 'on' : ''}" data-b="${b.id}"><span>${b.name}<small>${b.hint}</small></span></button>`).join('')}`, (r) => r.onclick = async (e) => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    S.beat = b.dataset.b; save(); await start(); eng.beat = S.beat; drawChords();
    r.querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('on', x === b));
    if (S.beat === 'none' && eng.playing && !eng.rec) { eng.stop(); setPlaying(false); }
    else if (S.beat !== 'none' && !eng.playing) { stopTake(); eng.play(); setPlaying(true); }
  });
}
$('beat').onclick = openBeats;
// Recording: how long a take is, and whether ● starts a new one or dubs on top
function drawRecChip() { $('reclen').textContent = S.dub && take ? `dub · ${take.bars} bars` : `${S.bars} bars`; $('reclen').classList.toggle('on', !!(S.dub && take)); }
$('reclen').onclick = () => openSheet(`<h3>Recording</h3>
  <h4>Length</h4>
  <div class="row">${[4, 8, 16].map((n) => `<button class="chip ${n === S.bars ? 'on' : ''}" data-bars="${n}">${n} bars</button>`).join('')}</div>
  <p class="note" style="margin-top:8px">A take stops by itself at the end, ready to loop.</p>
  <h4>When you press ●</h4>
  <button class="big ${S.dub ? '' : 'on'}" data-dub="0">●<span>Record over<small>a fresh take, replacing the last one</small></span></button>
  <button class="big ${S.dub ? 'on' : ''}" data-dub="1" ${take ? '' : 'disabled'}>◎<span>Dub on top<small>${take ? `your ${take.bars}-bar take plays, and whatever you play is added to it: chords first, then strum on top` : 'record a take first'}</small></span></button>`, (r) => r.onclick = (e) => {
  const L = e.target.closest('[data-bars]'), D = e.target.closest('[data-dub]');
  if (L) { S.bars = +L.dataset.bars; r.querySelectorAll('[data-bars]').forEach((x) => x.classList.toggle('on', x === L)); }
  else if (D && !D.disabled) { S.dub = D.dataset.dub === '1'; r.querySelectorAll('[data-dub]').forEach((x) => x.classList.toggle('on', x === D)); }
  else return;
  save(); drawRecChip(); showHint();
});
let taps = [];
$('bpm').onclick = () => openSheet(`<h3>Tempo</h3>
  <div class="tempo"><button data-d="-1">−</button><span id="t-val">${S.bpm}</span><button data-d="1">+</button></div>
  <input type="range" id="t-slide" min="50" max="160" value="${S.bpm}">
  <div class="row" style="justify-content:center;margin-top:10px"><button class="chip" id="t-tap">tap the beat</button></div>`, (r) => {
  const set = (v) => { S.bpm = Math.max(50, Math.min(160, Math.round(v))); r.querySelector('#t-val').textContent = S.bpm; r.querySelector('#t-slide').value = S.bpm; $('bpm').textContent = `${S.bpm} bpm`; if (eng && !eng.rec) eng.bpm = S.bpm; save(); };
  r.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => set(S.bpm + +b.dataset.d));
  r.querySelector('#t-slide').oninput = (e) => set(+e.target.value);
  r.querySelector('#t-tap').onclick = () => { const now = performance.now(); taps = taps.filter((t) => now - t < 2500); taps.push(now); if (taps.length >= 3) set(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))); };
});

// ---------- the menu: the take, and saving it ----------
let listening = null;
function stopListening() { if (listening) { try { listening.stop(); } catch (e) { /* done */ } listening = null; } }
const APPS = [['Pop Pads', 'https://shalonely.com/pop/', '🥤', 'a fizzy little drum machine'], ['Boba Beats', 'https://shalonely.com/boba/', '🧋', 'make whole songs out of bubbles'], ['Deep Drift', 'https://shalonely.com/drift/', '🪼', 'a sleepy sea that sings']];
$('menu').onclick = () => {
  const has = !!take, secs = has ? take.dur.toFixed(1) : 0;
  openSheet(`<h3>Your take</h3>
  <p class="note">${has ? `${take.bars} bar${take.bars > 1 ? 's' : ''}, ${secs} s, at ${take.bpm} bpm${take.beat !== 'none' ? ` with the ${beatOf(take.beat).name} beat` : ''}. Record again (●) to replace it.` : 'Nothing recorded yet. Press ● and play: you get a bar of clicks, then everything you play is kept.'}</p>
  <button class="big" data-do="listen" ${has ? '' : 'disabled'}>▶<span>Listen<small>hear it back, as it will be saved</small></span></button>
  <button class="big" data-save="song" ${has ? '' : 'disabled'}>🎶<span>Song<small>a WAV from the first chord to the last ring-out</small></span></button>
  <button class="big" data-save="loop" ${has ? '' : 'disabled'}>🎵<span>Loop<small>a WAV that loops cleanly</small></span></button>
  <button class="big" data-save="midi" ${has ? '' : 'disabled'}>🎹<span>MIDI for Logic<small>chords, strings, bass and drums on their own tracks</small></span></button>
  <button class="big" data-save="stems" ${has ? '' : 'disabled'}>🎚️<span>Stems<small>a zip: chords, strings, bass and drums as their own WAVs, plus the mix, lined up from bar 1</small></span></button>
  <button class="big" data-boba="1" ${has ? '' : 'disabled'}>🧋<span>Send to Boba Beats<small>opens Boba with your chords, strings, bass and beat as sampler tracks</small></span></button>
  <p id="s-status" class="note" style="min-height:1.3em"></p>
  <h4>Bubble apps</h4>${APPS.map(([n, u, ic, d]) => `<a class="big" href="${u}" style="text-decoration:none;color:inherit">${ic}<span>${n}<small>${d}</small></span></a>`).join('')}
  ${offer() ? '<h4>On your phone</h4><button class="big" data-install="1">📲<span>Put it on your home screen<small>opens like an app, works with no signal</small></span></button>' : ''}`, (r) => r.onclick = async (e) => {
    const st = r.querySelector('#s-status');
    const I = e.target.closest('[data-install]');
    if (I) { const how = await install(); if (how) I.querySelector('small').textContent = how; else closeSheet(); return; }
    const L = e.target.closest('[data-do="listen"]');
    if (L && take) {
      await start(); stopListening();
      st.textContent = 'Getting it ready…';
      const { buffer } = await renderTake(take, { sr: eng.ctx.sampleRate });
      const src = eng.ctx.createBufferSource(); src.buffer = buffer; src.connect(eng.ctx.destination); src.start();
      listening = src; st.textContent = '▶ playing your take';
      src.onended = () => { if (listening === src) { listening = null; st.textContent = ''; } };
      return;
    }
    const B = e.target.closest('[data-boba]'), b = e.target.closest('[data-save]');
    if (!take || (!B && !b)) return;
    const X = await import('./export.js'), name = X.baseName(take);
    try {
      sheetBusy = true;
      if (B) {
        st.textContent = 'Packing the sounds…';
        const file = await X.bobaSong(take);
        if (window.CozyNative) { st.textContent = `✓ ${await X.deliver(new TextEncoder().encode(JSON.stringify(file)), `${name}.bobabeats.json`, 'application/json')}`; return; }
        await X.handOff(file);
        st.textContent = '✓ Opening Boba Beats…';
        if (eng && eng.playing) { eng.stop(); setPlaying(false); }
        location.href = new URL('../boba/?from=chords', location.href).href.replace(/\/chords\/\.\.\//, '/');
        return;
      }
      st.textContent = 'Making it…';
      let msg;
      if (b.dataset.save === 'song') msg = await X.deliver(await X.songWav(take, { tail: 3 }), `${name}-song.wav`, 'audio/wav');
      if (b.dataset.save === 'loop') msg = await X.deliver(await X.songWav(take, { tail: 0 }), `${name}-loop.wav`, 'audio/wav');
      if (b.dataset.save === 'midi') msg = await X.deliver(X.takeMidi(take), `${name}.mid`, 'audio/midi');
      if (b.dataset.save === 'stems') msg = await X.deliver(await X.stemsZip(take, (m) => { st.textContent = m; }), `${name}-stems.zip`, 'application/zip');
      st.textContent = `✓ ${msg}`;
    } catch (err) { st.textContent = `Could not save it: ${err.message}`; }
    finally { sheetBusy = false; }
  });
};

// ---------- the background: snow falling softly outside, and a warm glow from the fire ----------
{
  const c = $('glow'), g = c.getContext('2d');
  let flakes = [];
  const size = () => {
    c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
    // bigger flakes are nearer: they fall a little faster and sway wider
    flakes = Array.from({ length: Math.round(Math.min(80, innerWidth / 7)) }, () => {
      const near = Math.random();
      return { x: Math.random(), y: Math.random(), r: 0.7 + near * 2.4, v: 0.000018 + near * 0.00003, p: Math.random() * 6.28, w: 0.012 + near * 0.03, sway: 5000 + Math.random() * 5000, a: 0.3 + near * 0.35 };
    });
  };
  size(); addEventListener('resize', size);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = 0;
  const draw = (t) => {
    const dt = Math.min(64, t - last || 16); last = t;
    g.clearRect(0, 0, c.width, c.height);
    // the fire's glow at the bottom, breathing slowly
    const f = 0.16 + 0.04 * Math.sin(t / 900) + 0.025 * Math.sin(t / 370 + 1.3);
    const glow = g.createRadialGradient(c.width / 2, c.height * 1.08, 0, c.width / 2, c.height * 1.08, c.height * 0.75);
    glow.addColorStop(0, `rgba(255, 150, 80, ${f})`); glow.addColorStop(1, 'rgba(255, 150, 80, 0)');
    g.fillStyle = glow; g.fillRect(0, 0, c.width, c.height);
    // snow: a gentle winter snowfall, slow, swaying, drifting with a light
    // breeze that changes now and then, fading as it nears the warm floor
    const breeze = 0.000004 * Math.sin(t / 23000) + 0.000002 * Math.sin(t / 9000 + 2);
    for (const s of flakes) {
      if (!still) {
        s.y += s.v * dt; s.x += breeze * dt * (0.5 + s.r / 3);
        if (s.y > 1.02) { s.y = -0.02; s.x = Math.random(); }
        if (s.x > 1.05) s.x -= 1.1; else if (s.x < -0.05) s.x += 1.1;
      }
      const x = (s.x + Math.sin(t / s.sway + s.p) * s.w) * c.width, y = s.y * c.height, fade = Math.max(0, Math.min(1, (1 - s.y) * 2.2));
      g.fillStyle = `rgba(255, 250, 245, ${s.a * fade})`;
      g.beginPath(); g.arc(x, y, s.r * devicePixelRatio, 0, 6.29); g.fill();
    }
    if (!document.hidden) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(draw); });
}

// ---------- layout: bubbles as big as the room allows ----------
function fit() {
  const VH = (window.visualViewport && visualViewport.height) || innerHeight;
  const wide = innerWidth > VH * 1.1 && innerWidth >= 700;
  document.body.classList.toggle('wide', wide);
  const box = $('chords').getBoundingClientRect();
  const b = Math.max(54, Math.min((box.width - 30) / 4, (box.height - 20) / 3, 150));
  $('chords').style.setProperty('--b', `${Math.floor(b)}px`);
  const s = $('strip').getBoundingClientRect();
  $('strip').classList.toggle('tall', s.height > s.width);
}
addEventListener('resize', fit);
if (window.visualViewport) visualViewport.addEventListener('resize', fit);

// ---------- go ----------
goOffline();
if (offer()) {
  const b = $('apk'); b.hidden = false;
  b.onclick = async () => { const how = await install(); if (how) { b.textContent = how; b.style.textDecoration = 'none'; } else b.hidden = true; };
}
$('go').onclick = async () => { $('start').classList.add('gone'); await start(); fit(); };
drawChords(); showHint();
window.cozy = { get eng() { return eng; }, S, loopLength: () => (loopCache.buf ? loopCache.buf.length : 0), get take() { return take; }, set take(t) { take = t; keep('cozy.take', t); }, select };

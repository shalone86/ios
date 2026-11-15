// Deep Drift: a dark sea of sleepy, glowing orbs that sing when touched.

import { Drift, MOODS, orbNotes, VOICE_NAMES } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('sea'), g = canvas.getContext('2d');
let ctx = null, drift = null;
const state = { mood: 'deep', animate: false, hum: false, timerMin: 0, timerEnd: 0 };

// ---------- the orbs ----------

const COUNT = 12;
let notes = orbNotes(state.mood, 45, COUNT);
const orbs = [];
function layout() {
  const W = innerWidth, H = innerHeight;
  const top = 80, bottom = H - 250;
  orbs.length = 0;
  for (let i = 0; i < COUNT; i++) {
    // low notes deep down, high notes near the surface; scattered side to side
    const depth = 1 - i / (COUNT - 1);
    const x = W * (0.14 + 0.72 * ((i * 0.618034 + 0.31) % 1));
    const y = top + (bottom - top) * (0.06 + 0.88 * depth) + Math.sin(i * 2.1) * 14;
    orbs.push({ i, x, y, r: Math.max(20, Math.min(34, W / 14)) * (1.12 - 0.3 * (1 - depth)), hue: 185 + i * 9,
      phase: i * 1.7, glow: 0, held: false });
  }
}

// ---------- drawing ----------

const snow = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.6, v: 0.004 + Math.random() * 0.01 }));
const ripples = [];
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout();
}

function draw(t) {
  const W = innerWidth, H = innerHeight;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a1a3a'); bg.addColorStop(0.45, '#061027'); bg.addColorStop(1, '#020511');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // light from far above, swaying
  const sway = Math.sin(t / 7000) * 40;
  const beam = g.createRadialGradient(W * 0.5 + sway, -120, 10, W * 0.5 + sway, -120, H * 0.9);
  beam.addColorStop(0, 'rgba(90,150,230,.18)'); beam.addColorStop(1, 'rgba(90,150,230,0)');
  g.fillStyle = beam; g.fillRect(0, 0, W, H);
  // marine snow drifting down
  g.fillStyle = 'rgba(200,225,255,.35)';
  for (const p of snow) {
    p.y += p.v / 60; if (p.y > 1) { p.y = 0; p.x = Math.random(); }
    g.beginPath(); g.arc(p.x * W + Math.sin(t / 3000 + p.y * 9) * 6, p.y * H, p.s, 0, 7); g.fill();
  }
  // ripples from notes
  for (let k = ripples.length - 1; k >= 0; k--) {
    const r = ripples[k]; r.age += 1 / 60;
    if (r.age > 3) { ripples.splice(k, 1); continue; }
    g.strokeStyle = `hsla(${r.hue},90%,75%,${(1 - r.age / 3) * 0.35 * r.level})`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(r.x, r.y - r.age * 18, r.r + r.age * 34, 0, 7); g.stroke();
  }
  for (const o of orbs) drawOrb(o, t);
}

function drawOrb(o, t) {
  o.glow *= o.held ? 1 : 0.985;
  // a jellyfish whose loop is playing stays softly lit
  const looping = !!(drift && drift.isLooping(o.i));
  if (looping) o.glow = Math.max(o.glow, 0.28);
  const bob = Math.sin(t / 1900 + o.phase) * 5, x = o.x + Math.sin(t / 4300 + o.phase) * 4, y = o.y + bob;
  const breathe = 0.35 + 0.1 * Math.sin(t / 2400 + o.phase) + 0.65 * Math.min(1, o.glow);
  const R = o.r * (1 + 0.08 * Math.min(1, o.glow));
  if (looping) {
    g.strokeStyle = `hsla(${o.hue},90%,80%,${0.22 + 0.1 * Math.sin(t / 1300 + o.phase)})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, y - R * 0.1, R * 1.45, 0, 7); g.stroke();
  }
  // tentacles
  g.strokeStyle = `hsla(${o.hue},80%,70%,${0.18 + 0.3 * breathe})`;
  g.lineWidth = 1.6;
  for (let k = -1; k <= 1; k++) {
    g.beginPath();
    for (let s = 0; s <= 10; s++) {
      const yy = y + R * 0.55 + s * R * 0.12, xx = x + k * R * 0.35 + Math.sin(t / 900 + s * 0.7 + o.phase + k) * (2 + s * 0.6);
      s ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
    }
    g.stroke();
  }
  // halo
  const halo = g.createRadialGradient(x, y, R * 0.3, x, y, R * 2.6);
  halo.addColorStop(0, `hsla(${o.hue},90%,70%,${0.22 * breathe})`); halo.addColorStop(1, `hsla(${o.hue},90%,60%,0)`);
  g.fillStyle = halo; g.beginPath(); g.arc(x, y, R * 2.6, 0, 7); g.fill();
  // bell (a dome, flatter underneath)
  const body = g.createRadialGradient(x - R * 0.3, y - R * 0.4, R * 0.1, x, y, R);
  body.addColorStop(0, `hsla(${o.hue},90%,${80 + 12 * breathe}%,${0.55 + 0.4 * breathe})`);
  body.addColorStop(1, `hsla(${o.hue + 20},70%,40%,${0.25 + 0.3 * breathe})`);
  g.fillStyle = body;
  g.beginPath(); g.ellipse(x, y, R, R * 0.82, 0, Math.PI, 0); g.quadraticCurveTo(x, y + R * 0.75, x - R, y); g.fill();
  // sleepy face: closed eyes, or open while singing
  const ink = 'rgba(10,20,45,.75)';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = Math.max(1.5, R * 0.07); g.lineCap = 'round';
  const ex = R * 0.28, ey = y - R * 0.12;
  if (o.glow > 0.35) {
    g.beginPath(); g.arc(x - ex, ey, R * 0.07, 0, 7); g.arc(x + ex, ey, R * 0.07, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x, y + R * 0.14, R * 0.08, R * 0.1, 0, 0, 7); g.fill();
  } else {
    g.beginPath(); g.arc(x - ex, ey - R * 0.04, R * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.beginPath(); g.arc(x + ex, ey - R * 0.04, R * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.beginPath(); g.arc(x, y + R * 0.06, R * 0.07, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  }
  g.fillStyle = 'rgba(255,140,190,.35)';
  g.beginPath(); g.ellipse(x - R * 0.5, y + R * 0.06, R * 0.12, R * 0.07, 0, 0, 7); g.ellipse(x + R * 0.5, y + R * 0.06, R * 0.12, R * 0.07, 0, 0, 7); g.fill();
  o.sx = x; o.sy = y; o.sr = R;
}

function frame(t) { draw(t); requestAnimationFrame(frame); }

// ---------- sound ----------

async function startAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    drift = new Drift(ctx);
    drift.onNote = (i, level) => {
      const o = orbs[i]; if (!o) return;
      o.glow = Math.max(o.glow, 0.4 + level);
      ripples.push({ x: o.sx || o.x, y: o.sy || o.y, r: o.sr || o.r, hue: o.hue, level, age: 0 });
    };
    setInterval(() => { drift.tick(); animateStep(); timerStep(); }, 50);
    ['depth', 'tide', 'tape'].forEach((k) => drift.set(k, $(k).value / 100));
  }
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  native('playing', true);             // Android app: keep playing with the screen off
}

// the Android app's shell, when there is one
function native(fn, ...args) { try { if (window.DriftNative) window.DriftNative[fn](...args); } catch (e) { /* web */ } }

// ---------- touching ----------

const touches = new Map();     // pointerId -> { orb, timer, held }
function orbAt(x, y) {
  let best = null, bd = Infinity;
  for (const o of orbs) {
    const d = Math.hypot(x - (o.sx || o.x), y - (o.sy || o.y));
    if (d < (o.sr || o.r) * 1.6 && d < bd) { bd = d; best = o; }
  }
  return best;
}
function release(pid) {
  const t = touches.get(pid);
  if (!t) return;
  touches.delete(pid);
  clearTimeout(t.timer);
  if (t.hold) { t.hold.release(); t.orb.held = false; }
  else {
    // a quick tap starts this jellyfish's loop, or lets it rest if it is playing
    const started = drift.tap(t.orb.i, notes[t.orb.i], 0.85);
    if (started && !state.toldRest) { state.toldRest = true; toast('it keeps singing. tap it again to let it rest'); }
  }
}
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (e.isPrimary && touches.size) for (const pid of [...touches.keys()]) release(pid);
  startAudio();
  if (!drift) return;
  const o = orbAt(e.clientX, e.clientY);
  if (!o) return;
  const t = { orb: o, hold: null };
  // keep a finger down to hum the note for as long as you like
  t.timer = setTimeout(() => { t.hold = drift.hold(o.i, notes[o.i], 0.75); o.held = true; o.glow = 1.2; }, 350);
  touches.set(e.pointerId, t);
});
addEventListener('pointerup', (e) => release(e.pointerId));
addEventListener('pointercancel', (e) => release(e.pointerId));
addEventListener('blur', () => { for (const pid of [...touches.keys()]) release(pid); });

// ---------- controls ----------

const toast = (msg) => { const el = $('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); };

const voicesRow = $('voices');
voicesRow.innerHTML = Object.entries(VOICE_NAMES).map(([id, n]) => `<button class="chip ${id === 'pad' ? 'on' : ''}" data-voice="${id}">${n}</button>`).join('');
voicesRow.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-voice]'); if (!b) return;
  await startAudio();
  drift.voiceName = b.dataset.voice;
  voicesRow.querySelectorAll('.chip').forEach((n) => n.classList.toggle('on', n === b));
});

['depth', 'tide', 'tape'].forEach((k) => $(k).addEventListener('input', (e) => { if (drift) drift.set(k, e.target.value / 100); }));

$('mood').onclick = () => {
  const keys = Object.keys(MOODS), next = keys[(keys.indexOf(state.mood) + 1) % keys.length];
  state.mood = next; notes = orbNotes(next, 45, COUNT);
  $('mood').textContent = MOODS[next].name;
  if (drift && state.hum) drift.background(true, notes[0] + 12);
  toast(`${MOODS[next].name}: the lights are retuned`);
};

$('hum').onclick = async () => {
  await startAudio();
  state.hum = !state.hum;
  drift.background(state.hum, notes[0] + 12);
  $('hum').textContent = `Hum: ${state.hum ? 'on' : 'off'}`;
  $('hum').classList.toggle('on', state.hum);
};

// Animate: the three controls wander slowly together, so the sea keeps changing
const walk = { depth: Math.random() * 6, tide: Math.random() * 6, tape: Math.random() * 6 };
function animateStep() {
  if (!state.animate) return;
  const tm = performance.now() / 1000;
  for (const k of ['depth', 'tide', 'tape']) {
    const base = { depth: 0.55, tide: 0.55, tape: 0.35 }[k], span = { depth: 0.35, tide: 0.35, tape: 0.3 }[k];
    const v = base + span * (0.6 * Math.sin(tm / 23 + walk[k]) + 0.4 * Math.sin(tm / 61 + walk[k] * 2));
    $(k).value = Math.round(v * 100);
    drift.set(k, v);
  }
}
$('animate').onclick = async () => {
  await startAudio();
  state.animate = !state.animate;
  $('animate').classList.toggle('on', state.animate);
  toast(state.animate ? 'the tide is moving on its own' : 'still water');
};

// sleep timer: off, 15, 30, 60 minutes; the last two minutes fade away.
// The fade is booked on the audio clock when the timer is set, so it still
// happens with the screen off.
const STEPS = [0, 15, 30, 60];
// once the sea has faded out: everything off, and the phone may sleep
function quiet() {
  state.animate = false; $('animate').classList.remove('on');
  state.hum = false; $('hum').textContent = 'Hum: off'; $('hum').classList.remove('on');
  state.timerEnd = 0; state.timerMin = 0; $('timer').textContent = 'sleep: off'; $('timer').classList.remove('on');
  drift.wake();
  native('playing', false);
}
// the Stop button on the Android app's notification
window.deepDriftStop = () => { if (drift) drift.fadeOut(3, quiet); };
function setTimer(seconds) {
  state.timerEnd = seconds ? Date.now() + seconds * 1000 : 0;
  drift.wake();
  if (!seconds) return;
  const fade = Math.min(120, seconds);
  drift.fadeOut(fade, quiet, seconds - fade);
}
$('timer').onclick = async () => {
  await startAudio();
  state.timerMin = STEPS[(STEPS.indexOf(state.timerMin) + 1) % STEPS.length];
  setTimer(state.timerMin * 60);
  $('timer').textContent = state.timerMin ? `sleep: ${state.timerMin} min` : 'sleep: off';
  $('timer').classList.toggle('on', !!state.timerMin);
};
function timerStep() {
  if (!state.timerEnd) return;
  const left = Math.max(0, (state.timerEnd - Date.now()) / 1000);
  $('timer').textContent = left > 120 ? `sleep: ${Math.ceil(left / 60)} min` : 'sleep: fading';
}

$('go').onclick = async () => { $('start').classList.add('gone'); await startAudio(); };

// the tutorial video: from the start screen, and from ? at any time
function showTour() {
  const box = $('tour'), video = $('tour-video');
  try { localStorage.setItem('deepdrift.seenTour', '1'); } catch (e) { /* private mode */ }
  if (drift) drift.hush(true);                          // the sea goes quiet while it plays
  if (!video.src) video.src = 'media/tutorial.mp4';
  box.hidden = false;
  video.currentTime = 0;
  video.play().catch(() => {});
}
function closeTour() {
  $('tour-video').pause(); $('tour').hidden = true;
  if (drift) drift.hush(false);
}
$('tour-link').onclick = () => { $('start').classList.add('gone'); showTour(); };
$('help').onclick = showTour;
$('tour-close').onclick = closeTour;
$('tour-video').onended = closeTour;

addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
window.deepDrift = { state, get drift() { return drift; }, orbs, setTimer };

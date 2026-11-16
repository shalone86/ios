// Voice Booth: shows a script one line at a time, records each line from the
// microphone as plain PCM, keeps the takes on this device (IndexedDB) and
// saves them all as one zip of WAV files named after their lines.

const $ = (id) => document.getElementById(id);
const S = window.SCRIPTS;
let scriptId = Object.keys(S)[0];
let idx = 0;
const takes = {};                     // file -> { rate, pcm: Float32Array }
let ctx, src, tap, recording = null, playing = null;

try { const saved = localStorage.getItem('booth.script'); if (saved && S[saved]) scriptId = saved; } catch (e) { /* fine */ }

// ---------- storing takes on this device ----------
const db = new Promise((resolve) => {
  try {
    const r = indexedDB.open('voice-booth', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('takes');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  } catch (e) { resolve(null); }
});
async function store(key, value) {
  const d = await db; if (!d) return;
  try { const tx = d.transaction('takes', 'readwrite'); value ? tx.objectStore('takes').put(value, key) : tx.objectStore('takes').delete(key); } catch (e) { /* not kept */ }
}
async function loadTakes() {
  for (const k of Object.keys(takes)) delete takes[k];
  const d = await db; if (!d) return;
  await new Promise((resolve) => {
    try {
      const req = d.transaction('takes').objectStore('takes').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        const [sid, file] = String(c.key).split('/');
        if (sid === scriptId) takes[file] = c.value;
        c.continue();
      };
      req.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}

// ---------- the microphone ----------
// Every input channel is passed on: an audio interface often has the mic on
// input 2, and the booth keeps whichever channel actually has the voice.
const WORKLET = `registerProcessor('grab', class extends AudioWorkletProcessor {
  process(inputs) { const i = inputs[0]; if (i && i.length) this.port.postMessage(i.map((c) => c.slice(0))); return true; }
});`;
let stream = null;
const MIC_KEY = 'booth.mic';
async function openMic(deviceId) {
  closeMic();
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
  if (deviceId) audio.deviceId = { exact: deviceId };
  stream = await navigator.mediaDevices.getUserMedia({ audio });
  // run at the microphone's own rate: some browsers refuse to mix rates
  const rate = stream.getAudioTracks()[0].getSettings().sampleRate;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = rate ? new AC({ sampleRate: rate }) : new AC(); } catch (e) { ctx = new AC(); }
  await ctx.resume();
  src = ctx.createMediaStreamSource(stream);
  const onChunk = (chs) => {
    // the meter and pitch follow the loudest channel
    let peak = 0, best = 0;
    chs.forEach((ch, k) => { for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) { peak = a; best = k; } } });
    meter(peak);
    if (recording) {
      recording.chunks.push(chs); recording.peak = Math.max(recording.peak, peak);
      recording.recent.push(chs[best]); if (recording.recent.length > 24) recording.recent.shift();
    }
  };
  try {
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
    tap = new AudioWorkletNode(ctx, 'grab', { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
    tap.port.onmessage = (e) => onChunk(e.data);
  } catch (e) {
    // older browsers
    tap = ctx.createScriptProcessor(2048, 2, 2);
    tap.channelInterpretation = 'discrete';
    tap.onaudioprocess = (e) => onChunk([0, 1].slice(0, e.inputBuffer.numberOfChannels).map((k) => new Float32Array(e.inputBuffer.getChannelData(k))));
  }
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(tap).connect(mute).connect(ctx.destination);
  const label = stream.getAudioTracks()[0].label;
  try { localStorage.setItem(MIC_KEY, stream.getAudioTracks()[0].getSettings().deviceId || ''); } catch (e) { /* fine */ }
  await listMics();
  return label;
}
function closeMic() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) ctx.close().catch(() => {});
  stream = null; ctx = null;
}
// the microphone menu: every input the browser can see
async function listMics() {
  const sel = $('mic');
  try {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    const now = stream && stream.getAudioTracks()[0].getSettings().deviceId;
    sel.innerHTML = all.map((d, i) => `<option value="${d.deviceId}">${(d.label || `Microphone ${i + 1}`).replace(/[<&]/g, '')}</option>`).join('');
    if (now) sel.value = now;
    sel.hidden = all.length < 2;
  } catch (e) { sel.hidden = true; }
}
// why the microphone would not open, in plain words
function micProblem(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'The browser was not allowed to use the microphone. On a Mac: System Settings → Privacy & Security → Microphone, turn on your browser, then reload this page.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'That microphone could not be found. Check it is plugged in and switched on, then try again.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The microphone is busy or could not start. Close other apps using it (Logic, Zoom…), then try again.';
  return `The microphone could not be opened (${n || 'error'}: ${(e && e.message) || ''}).`;
}
let shown = 0;
function meter(peak) {
  shown = Math.max(peak, shown * 0.9);
  const m = $('meter');
  m.firstElementChild.style.width = Math.min(100, Math.sqrt(shown) * 100) + '%';
  m.classList.toggle('hot', shown > 0.95);
}

// ---------- recording ----------
let refTimer = 0;
function startRec() {
  stopPlay();
  const midi = line()[3];
  if (midi != null && !startRec.now) {
    // a choir line: play the note, then start recording
    const d = refNote(midi, 1.4);
    $('rec').classList.add('on'); $('rec').textContent = '♪';
    $('status').textContent = `Listen: ${window.noteName(midi)}…`;
    refTimer = setTimeout(() => { startRec.now = true; startRec(); startRec.now = false; }, d * 1000 + 150);
    return;
  }
  recording = { chunks: [], peak: 0, t0: performance.now(), recent: [] };
  $('rec').classList.add('on'); $('rec').textContent = 'Stop';
  $('status').textContent = 'Recording… read the line, then tap Stop';
  tick();
}
function tick() {
  if (!recording) return;
  const secs = ((performance.now() - recording.t0) / 1000).toFixed(1), midi = line()[3];
  $('status').textContent = midi == null ? `Recording… ${secs} s` : `Sing! ${secs} s · ${pitchReport(midi)}`;
  setTimeout(tick, 200);
}
function stopRec() {
  if (!recording) { clearTimeout(refTimer); $('rec').classList.remove('on'); render(); $('status').textContent = ''; return; }
  const r = recording; recording = null;
  $('rec').classList.remove('on');
  const n = r.chunks.reduce((a, c) => a + c[0].length, 0);
  if (n < ctx.sampleRate * 0.3) { $('status').textContent = 'That was very short. Try again.'; render(); return; }
  // keep the channel with the voice on it (input 1 or 2 of an interface)
  const energy = [];
  for (const chs of r.chunks) chs.forEach((c, k) => { let e = 0; for (let i = 0; i < c.length; i++) e += c[i] * c[i]; energy[k] = (energy[k] || 0) + e; });
  const use = energy.indexOf(Math.max(...energy));
  const pcm = new Int16Array(n);
  let o = 0;
  for (const chs of r.chunks) { const c = chs[use] || chs[0]; for (let i = 0; i < c.length; i++) pcm[o++] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))); }
  const file = line()[0];
  takes[file] = { rate: ctx.sampleRate, pcm, peak: r.peak };
  store(`${scriptId}/${file}`, takes[file]);
  render();
  $('status').textContent = r.peak > 0.98 ? '⚠ A little loud: move back a bit and try again'
    : r.peak < 0.05 ? '⚠ Very quiet: come a little closer and try again' : `✓ Saved (${(n / ctx.sampleRate).toFixed(1)} s). Play it back, or tap Next.`;
}
function play() {
  stopPlay();
  const t = takes[line()[0]]; if (!t) return;
  const b = ctx.createBuffer(1, t.pcm.length, t.rate);
  b.copyToChannel(t.pcm instanceof Int16Array ? Float32Array.from(t.pcm, (x) => x / 32768) : t.pcm, 0);
  playing = ctx.createBufferSource(); playing.buffer = b; playing.connect(ctx.destination);
  playing.onended = () => { playing = null; $('play').textContent = '▶ Play'; };
  playing.start(); $('play').textContent = '■ Stop';
}
function stopPlay() { if (playing) { try { playing.stop(); } catch (e) { /* done */ } playing = null; $('play').textContent = '▶ Play'; } }

// ---------- saving: WAV files in a zip ----------
function wav(t) {
  if (t.pcm instanceof Int16Array) return wav16(t);
  // 24-bit mono PCM
  const n = t.pcm.length, buf = new ArrayBuffer(44 + n * 3), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 3, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, t.rate, true);
  v.setUint32(28, t.rate * 3, true); v.setUint16(32, 3, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, n * 3, true);
  for (let i = 0, o = 44; i < n; i++, o += 3) {
    const s = Math.max(-1, Math.min(1, t.pcm[i])), x = Math.round(s * 8388607) & 0xffffff;
    v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255);
  }
  return new Uint8Array(buf);
}
function wav16(t) {
  const n = t.pcm.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, t.rate, true);
  v.setUint32(28, t.rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(t.pcm);           // WAV is little-endian, like every phone and computer
  return new Uint8Array(buf);
}

// ---------- the reference note and a pitch reading ----------
function refNote(midi, dur) {
  const f = 440 * Math.pow(2, (midi - 69) / 12), t = ctx.currentTime + 0.02, g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.05);
  g.gain.setValueAtTime(0.25, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
  g.connect(ctx.destination);
  for (const [mul, lvl, type] of [[1, 1, 'triangle'], [2, 0.25, 'sine']]) {
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = f * mul; og.gain.value = lvl;
    o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.05);
  }
  return dur;
}
// the sung pitch from the last ~0.2 s, by autocorrelation, compared with the target
function pitchReport(midi) {
  const rec = recording && recording.recent; if (!rec || !rec.length) return '';
  const n = rec.reduce((a, c) => a + c.length, 0), x = new Float32Array(n);
  let o = 0; for (const c of rec) { x.set(c, o); o += c.length; }
  let e = 0; for (let i = 0; i < n; i++) e += x[i] * x[i];
  if (e / n < 1e-5) return '…';
  const target = 440 * Math.pow(2, (midi - 69) / 12), sr = ctx.sampleRate;
  // look within half an octave either side of the target
  const lo = Math.floor(sr / (target * 1.45)), hi = Math.ceil(sr / (target / 1.45)), W = Math.min(n - hi, 2048);
  if (W < 256) return '';
  let best = 0, bestLag = 0;
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0, a = 0, b = 0;
    for (let i = 0; i < W; i++) { s += x[i] * x[i + lag]; a += x[i] * x[i]; b += x[i + lag] * x[i + lag]; }
    const r = s / Math.sqrt(a * b + 1e-12);
    if (r > best) { best = r; bestLag = lag; }
  }
  if (best < 0.6) return '…';
  const cents = Math.round(1200 * Math.log2((sr / bestLag) / target));
  return Math.abs(cents) <= 15 ? `in tune ✓` : cents > 0 ? `${cents} cents sharp ↓` : `${-cents} cents flat ↑`;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files) {
  // a plain "stored" zip: no compression, which WAV barely needs anyway
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of files) {
    const nm = new TextEncoder().encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((a, p) => a + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
async function exportAll() {
  const files = S[scriptId].lines.filter(([f]) => takes[f]).map(([f]) => ({ name: `${f}.wav`, data: wav(takes[f]) }));
  if (!files.length) return;
  const name = `${scriptId}-voice.zip`, blob = zip(files);
  const asFile = new File([blob], name, { type: 'application/zip' });
  // on a phone, the share sheet can send it straight to the Claude app
  if (navigator.canShare && navigator.canShare({ files: [asFile] })) {
    try { await navigator.share({ files: [asFile], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// ---------- screen ----------
const line = () => S[scriptId].lines[idx];
function render() {
  const sc = S[scriptId], [file, text, hint] = line();
  $('num').textContent = `Line ${idx + 1} of ${sc.lines.length}`;
  $('file').textContent = `${file}.wav`;
  $('text').textContent = text;
  $('hint').textContent = line()[3] != null || sc.sounds ? hint : `On screen: ${hint}. ${sc.tip}`;
  $('note').hidden = line()[3] == null;
  $('rec').textContent = recording ? 'Stop' : takes[file] ? 'Redo' : 'Record';
  $('play').disabled = !takes[file];
  $('prev').disabled = idx === 0;
  $('next').textContent = idx === sc.lines.length - 1 ? 'Done ✓' : 'Next ›';
  const done = sc.lines.filter(([f]) => takes[f]).length;
  $('export').disabled = !done;
  $('export').textContent = done === sc.lines.length ? `Save all ${done} as a zip` : `Save ${done} of ${sc.lines.length} as a zip`;
  $('list').innerHTML = sc.lines.map(([f, t], i) => `<li data-i="${i}" class="${i === idx ? 'cur' : ''} ${takes[f] ? 'done' : ''}">
    <b>${takes[f] ? '✓' : i + 1}</b><span>${t.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</span><em>${takes[f] ? (takes[f].pcm.length / takes[f].rate).toFixed(1) + ' s' : ''}</em></li>`).join('');
}
function go(i) {
  if (recording) stopRec();
  stopPlay();
  idx = Math.max(0, Math.min(S[scriptId].lines.length - 1, i));
  $('status').textContent = takes[line()[0]] ? 'Already recorded. Play it, or Redo.' : 'Tap Record, read the line, tap Stop.';
  render();
}

// the menu, in groups: tutorials, the choir session, Angelio
const GROUP_LABEL = { '': 'Tutorials', Choir: 'Choir session', Angelio: 'Angelio apps' };
$('script').innerHTML = Object.entries(GROUP_LABEL).map(([g, label]) => {
  const opts = Object.entries(S).filter(([, s]) => (s.group || '') === g)
    .map(([id, s]) => `<option value="${id}">${s.title.replace(/^(Choir|Angelio) · /, '')}</option>`).join('');
  return opts ? `<optgroup label="${label}">${opts}</optgroup>` : '';
}).join('');
$('script').value = scriptId;
$('script').onchange = async (e) => {
  scriptId = e.target.value;
  try { localStorage.setItem('booth.script', scriptId); } catch (err) { /* fine */ }
  await loadTakes(); go(0);
};
$('rec').onclick = () => (recording ? stopRec() : startRec());
$('play').onclick = () => (playing ? stopPlay() : play());
$('prev').onclick = () => go(idx - 1);
$('next').onclick = () => {
  if (idx === S[scriptId].lines.length - 1) { if (recording) stopRec(); $('export').scrollIntoView({ behavior: 'smooth' }); return; }
  go(idx + 1);
};
$('list').onclick = (e) => { const li = e.target.closest('li'); if (li) { go(+li.dataset.i); document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
$('export').onclick = async () => { await exportAll(); $('clear').hidden = false; };
$('note').onclick = () => { if (ctx && !recording) refNote(line()[3], 1.4); };
// once a batch is saved and sent, its takes can go, to free up the phone
$('clear').onclick = async () => {
  if (!confirm('Delete the takes for this script from this device? Only do this once the zip has reached Claude.')) return;
  for (const [f] of S[scriptId].lines) { if (takes[f]) { delete takes[f]; await store(`${scriptId}/${f}`, null); } }
  $('clear').hidden = true; go(0);
};
$('allow').onclick = async () => {
  let saved = ''; try { saved = localStorage.getItem(MIC_KEY) || ''; } catch (e) { /* fine */ }
  try {
    // the microphone used last time, if it is still there
    let label;
    try { label = await openMic(saved || undefined); } catch (e) { if (!saved) throw e; label = await openMic(); }
    $('start').hidden = true;
    $('status').textContent = `Using ${label || 'the microphone'}. Say something: the bar should move.`;
  } catch (e) { $('mic-err').textContent = micProblem(e); }
};
$('mic').onchange = async (e) => {
  if (recording) stopRec();
  try { const label = await openMic(e.target.value); $('status').textContent = `Using ${label}. Say something: the bar should move.`; }
  catch (err) { $('status').textContent = micProblem(err); }
};

(async () => {
  await loadTakes();
  // start at the first line not yet recorded
  const first = S[scriptId].lines.findIndex(([f]) => !takes[f]);
  go(first < 0 ? 0 : first);
})();
window.booth = { takes, get ctx() { return ctx; }, zip, wav,
  // for tests: read the pitch of a made-up tone against a target note
  pitchOf(midi, hz) {
    const sr = ctx.sampleRate, x = new Float32Array(4096).map((_, i) => 0.3 * Math.sin(2 * Math.PI * hz * i / sr) + 0.1 * Math.sin(4 * Math.PI * hz * i / sr));
    const save = recording; recording = { recent: [x] }; const r = pitchReport(midi); recording = save; return r;
  } };

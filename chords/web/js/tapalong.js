// Tap along: measures how late your taps land behind what you hear (Bluetooth
// headphones add 150–300 ms), so recordings can be put back on the beat.
// Plays a few clicks; you tap on each one; the typical gap is the delay.
// Shared by the bubble apps (the same file in each).
//
//   const secs = await tapAlong(ctx, ctx.destination, element)   // null if cancelled
//
// element: an empty element (a menu) to draw into.

const BPM = 96, LEAD = 4, COUNT = 8;

function click(ctx, out, t, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1320;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.25, t + 0.002); g.gain.setTargetAtTime(0, t + 0.004, 0.015);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.12);
}

export function tapAlong(ctx, out, root) {
  return new Promise((done) => {
    if (ctx.state !== 'running') ctx.resume();
    const beat = 60 / BPM, t0 = ctx.currentTime + 0.4, clicks = [];
    for (let k = 0; k < LEAD + COUNT; k++) { const t = t0 + k * beat; click(ctx, out, t, k % 4 === 0); if (k >= LEAD) clicks.push(t); }
    root.innerHTML = `<p style="margin:0 0 12px;opacity:.75;font-size:14px">With your headphones on: four clicks to get ready, then tap the circle on every click.</p>
      <button data-tap style="display:block;margin:6px auto 10px;width:150px;height:150px;border-radius:50%;border:2px solid currentColor;background:rgba(255,255,255,.14);color:inherit;font:inherit;font-size:20px;font-weight:600;touch-action:none">tap</button>
      <p data-say style="text-align:center;min-height:1.4em;margin:0;font-weight:600">listen…</p>`;
    const pad = root.querySelector('[data-tap]'), say = root.querySelector('[data-say]'), gaps = [];
    let finished = false;
    const finish = (v) => { if (finished) return; finished = true; clearInterval(tick); done(v); };
    const tick = setInterval(() => {
      const now = ctx.currentTime;
      if (!root.isConnected) { finish(null); return; }
      if (now < clicks[0] - 0.05) say.textContent = `get ready… ${Math.min(LEAD, Math.ceil((clicks[0] - now) / beat))}`;
      else if (now < clicks[COUNT - 1] + beat) say.textContent = `tap! ${gaps.length} of ${COUNT}`;
      else if (gaps.length < 4) { say.textContent = 'not enough taps: close and try again'; finish(null); }
      else {
        // the typical gap (median), so one stray tap doesn't throw it off
        const s = [...gaps].sort((a, b) => a - b), m = s[Math.floor(s.length / 2)];
        say.textContent = m > 0.03 ? `your taps land ${Math.round(m * 1000)} ms late: recordings will be moved back by that much` : 'right on time: nothing to fix';
        finish(Math.max(0, m));
      }
    }, 60);
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const t = ctx.currentTime;
      pad.animate([{ transform: 'scale(.92)' }, { transform: 'none' }], 140);
      // the click this tap belongs to: the nearest one before it (or just after, if early)
      let best = null; for (const c of clicks) if (t > c - beat * 0.3 && t < c + beat * 0.7) best = c;
      if (best != null) gaps.push(t - best);
    });
  });
}

// First-visit help, kept tiny. Shared by the bubble apps (the same file in each).
//
//   const tip = tips('cozy')
//   tip.show('swipe', 'swipe the strings to strum', anchorEl)   // once ever; ✕ or 7 s hides it
//   tip.done('swipe')                                         // they did it: hide, never show
//   tip.seen('first')                                          // true once marked
//   tip.glow('.pad .face', '.pad')                             // a soft pulse on what matches, until it is first tapped
//   unlockAudio(() => ctx)                                     // phones: resume sound on the first finger lift
//
// Seen tips are remembered in localStorage under '<app>.tips'.

const CSS = `.bb-tip{position:fixed;z-index:40;left:50%;width:max-content;max-width:min(340px,calc(100vw - 32px));display:flex;gap:8px;align-items:center;
  padding:9px 10px 9px 16px;border-radius:18px;background:rgba(20,14,30,.88);color:#fff;font:600 14px/1.3 inherit;font-family:inherit;
  box-shadow:0 6px 20px rgba(0,0,0,.3);transform:translate(-50%,6px);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s}
.bb-tip.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.bb-tip button{flex:none;width:28px;height:28px;border-radius:50%;border:0;background:rgba(255,255,255,.16);color:inherit;font:inherit;cursor:pointer}
@keyframes bb-glow{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}50%{box-shadow:0 0 0 9px rgba(255,255,255,.5)}}`;

export function tips(app) {
  const key = `${app}.tips`;
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { seen = new Set(); }
  const mark = (id) => { seen.add(id); try { localStorage.setItem(key, JSON.stringify([...seen])); } catch (e) { /* private mode */ } };

  if (!document.getElementById('bb-tip-css')) {
    const s = document.createElement('style'); s.id = 'bb-tip-css'; s.textContent = CSS; document.head.append(s);
  }
  const el = document.createElement('div');
  el.className = 'bb-tip'; el.setAttribute('role', 'status');
  el.innerHTML = '<span></span><button aria-label="Got it">✕</button>';
  document.body.append(el);
  let cur = null, timer = 0;
  const hide = () => { el.classList.remove('on'); cur = null; clearTimeout(timer); };
  el.querySelector('button').onclick = hide;

  return {
    seen: (id) => seen.has(id),
    show(id, text, at) {
      if (seen.has(id)) return false;
      mark(id); cur = id;                         // shown once, whether or not they act on it
      el.firstChild.textContent = text;
      // just above the thing it is about (or below, if that's near the top), else near the top
      const r = at && at.getBoundingClientRect();
      el.style.top = el.style.bottom = '';
      if (r && r.top > 90) el.style.bottom = `${Math.max(8, innerHeight - r.top + 10)}px`;
      else el.style.top = r ? `${r.bottom + 10}px` : 'calc(env(safe-area-inset-top) + 70px)';
      el.classList.add('on');
      clearTimeout(timer); timer = setTimeout(hide, 7000);
      return true;
    },
    done(id) { mark(id); if (cur === id) hide(); },
    // a style rule, not a class, so it survives the app redrawing its buttons
    glow(selector, tapped = selector, id = 'first') {   // tapped: what counts as touching it
      if (seen.has(id)) return;
      const st = document.createElement('style');
      st.textContent = `${selector}{animation:bb-glow 1.6s ease-in-out infinite}
        @media (prefers-reduced-motion:reduce){${selector}{animation:none;outline:3px solid rgba(255,255,255,.6);outline-offset:3px}}`;
      document.head.append(st);
      const off = (e) => { if (!e.target.closest || !e.target.closest(tapped)) return; st.remove(); mark(id); removeEventListener('pointerdown', off, true); };
      addEventListener('pointerdown', off, true);
    },
  };
}

// Some phones only let sound start when a finger lifts, not when it lands.
// Call once at load; it resumes the app's audio on the first lift.
export function unlockAudio(getCtx) {
  const go = () => {
    const c = getCtx();
    if (!c) return;                               // no sound made yet: try again next lift
    if (c.state !== 'running') c.resume().catch(() => {});
    if (c.state === 'running') ['pointerup', 'touchend', 'keydown'].forEach((t) => removeEventListener(t, go, true));
  };
  ['pointerup', 'touchend', 'keydown'].forEach((t) => addEventListener(t, go, true));
}

// The thin line between the web app and whatever is hosting it. Inside the
// Android app a small native bridge saves files to the Music folder, shares
// them, and buzzes the phone; in a plain browser we fall back to downloads.

const N = window.BubbloopNative || null;
export const isNative = !!N;

export function haptic() {
  try {
    if (N) N.haptic('tap');
    else if (navigator.vibrate) navigator.vibrate(6);
  } catch (e) { /* no haptics here */ }
}

export function keepAwake(on) {
  try { if (N) N.keepAwake(!!on); } catch (e) { /* not available */ }
}

export function exitApp() {
  try { if (N) N.exitApp(); } catch (e) { /* browser */ }
}

const CHUNK = 240 * 1024;       // multiple of 3, so base64 pieces join cleanly
const tick = () => new Promise((r) => setTimeout(r, 0));

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Save a finished file. Resolves to { where, uri } on success.
export async function saveFile(name, mime, bytes, onProgress) {
  if (N) {
    let keep = false;
    try { keep = !!JSON.parse(localStorage.getItem('bubbloop.settings') || '{}').versions; } catch (e) { /* default */ }
    // by default a file of the same name is replaced, not numbered (1), (2)...
    const id = N.beginFileEx ? N.beginFileEx(name, mime, keep) : N.beginFile(name, mime);
    if (!id) throw new Error('Could not create the file');
    for (let i = 0; i < bytes.length; i += CHUNK) {
      if (!N.appendFile(id, base64(bytes.subarray(i, Math.min(bytes.length, i + CHUNK))))) {
        throw new Error('Ran out of room while saving');
      }
      if (onProgress) onProgress(i / bytes.length);
      await tick();
    }
    const res = JSON.parse(N.finishFile(id) || '{}');
    if (!res.ok) throw new Error(res.error || 'Could not save the file');
    return { where: res.where || 'Music/Bubbloop', uri: res.uri, mime };
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  return { where: 'Downloads', uri: null, mime };
}

export function canShare(saved) {
  return !!(N && saved && saved.uri);
}

export function shareFile(saved, title) {
  if (N && saved && saved.uri) N.shareFile(saved.uri, saved.mime, title || '');
}

// Lets the Android back button close sheets before leaving the app.
export function onBack(handler) {
  window.bubbloopBack = () => !!handler();
}

export function onPause(handler) {
  window.bubbloopPause = handler;
  document.addEventListener('visibilitychange', () => { if (document.hidden) handler(); });
}

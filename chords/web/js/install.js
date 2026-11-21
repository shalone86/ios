// "Put it on your home screen": installs this page as an app (a PWA), with no
// app store and no developer mode. Chrome on Android and computers can do it
// in one tap; Safari needs the person to do it from the Share menu.
let ask = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ask = e; });
addEventListener('appinstalled', () => { ask = null; });

const native = () => !!(window.PopNative || window.DriftNative || window.BubbloopNative);
export const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
// worth offering: on the website, not already opened from the home screen
export const offer = () => !native() && !installed();

export function steps() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'In Safari, tap Share ⬆, then “Add to Home Screen”.';
  if (/Android/.test(ua)) return 'In Chrome, tap the ⋮ menu, then “Add to Home screen” or “Install app”.';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'In Safari, choose File → Add to Dock.';
  return 'Click the install icon at the right end of the address bar, or the browser menu → Install.';
}

// Ask the browser to install; when it can't ask, return the steps to show.
export async function install() {
  if (ask) {
    const a = ask; ask = null;
    a.prompt();
    const r = await a.userChoice.catch(() => null);
    return r && r.outcome === 'accepted' ? '' : steps();
  }
  return steps();
}

// Keep an offline copy so the installed app opens with no signal.
export function goOffline() {
  if (native() || !('serviceWorker' in navigator) || !/^https:|^http:\/\/(localhost|127\.)/.test(location.href)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

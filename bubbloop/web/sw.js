// Service worker: keeps a copy of the app so it opens with no signal, like
// an installed app. VERSION and FILES are written by tools/make-web.mjs.
const VERSION = '398134dae3';
const FILES = [
  "./",
  "css/app.css",
  "fonts/fredoka-latin-400-normal.woff2",
  "fonts/fredoka-latin-500-normal.woff2",
  "fonts/fredoka-latin-600-normal.woff2",
  "fonts/fredoka-latin-700-normal.woff2",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "index.html",
  "js/codec/alac.js",
  "js/codec/master.js",
  "js/codec/midi.js",
  "js/codec/pcm.js",
  "js/codec/sfz.js",
  "js/codec/wav.js",
  "js/codec/worker.js",
  "js/codec/zip.js",
  "js/drums.js",
  "js/engine.js",
  "js/exporter.js",
  "js/graph.js",
  "js/instruments.js",
  "js/midi.js",
  "js/patterns.js",
  "js/platform.js",
  "js/render.js",
  "js/samples.js",
  "js/seq.js",
  "js/state.js",
  "js/theory.js",
  "js/ui/app.js",
  "js/ui/art.js",
  "js/ui/particles.js",
  "js/ui/sheets.js",
  "manifest.webmanifest",
  "vendor/lamejs.js"
];

const CACHE = 'bubbloop-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // drop copies left by older versions
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bubbloop-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});

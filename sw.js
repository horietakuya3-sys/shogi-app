// Service Worker
// 1. すべての応答に COOP/COEP を付けて crossOriginIsolated にする
// 2. オフラインでも開けるようにキャッシュする
// 3. 他アプリからの棋譜共有（Web Share Target）を受け取る

const VERSION = 'v8';
const APP_CACHE = `app-${VERSION}`;
const ENGINE_CACHE = 'engine-k-p-7.6.3';
const SHARE_CACHE = 'share';
const BOOK_CACHE = 'book-petabook233-v1';

const APP_FILES = [
  './', 'index.html', 'terms.html', 'coi.js', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/shogi.js', 'js/kif.js', 'js/engine.js', 'js/ai.js', 'js/review.js', 'js/records.js', 'js/sound.js', 'js/book.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const ENGINE_FILES = [
  'engine/yaneuraou.k-p.js', 'engine/yaneuraou.k-p.wasm', 'engine/yaneuraou.k-p.worker.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(APP_CACHE);
    await c.addAll(APP_FILES).catch(() => {});
    const e = await caches.open(ENGINE_CACHE);
    await e.addAll(ENGINE_FILES).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (![APP_CACHE, ENGINE_CACHE, SHARE_CACHE, BOOK_CACHE].includes(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

function withIsolation(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function handleShare(req) {
  const form = await req.formData();
  let text = '';
  const file = form.get('kif');
  if (file && typeof file !== 'string') {
    const buf = await file.arrayBuffer();
    const c = await caches.open(SHARE_CACHE);
    await c.put('shared-file', new Response(buf, { headers: { 'X-Name': encodeURIComponent(file.name || '') } }));
    return Response.redirect('./?shared=file', 303);
  }
  text = form.get('text') || form.get('title') || '';
  const c = await caches.open(SHARE_CACHE);
  await c.put('shared-text', new Response(String(text)));
  return Response.redirect('./?shared=text', 303);
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share')) {
    ev.respondWith(handleShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  const isEngine = url.pathname.includes('/engine/') || url.pathname.includes('/book/');
  const bigCache = url.pathname.includes('/book/') ? BOOK_CACHE : ENGINE_CACHE;
  ev.respondWith((async () => {
    if (isEngine) {
      // エンジンは大きく変わらないのでキャッシュ優先
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return withIsolation(hit);
      const res = await fetch(req);
      if (res.ok) (await caches.open(bigCache)).put(req, res.clone());
      return withIsolation(res);
    }
    // アプリ本体はネット優先（更新をすぐ反映）、つながらなければキャッシュ
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) (await caches.open(APP_CACHE)).put(req, res.clone());
      return withIsolation(res);
    } catch (e) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return withIsolation(hit);
      throw e;
    }
  })());
});

/* =====================================================================
   sw.js — Service Worker(cache-first / プリキャッシュ)
   仕様: spec_quest_v4_1.md §7
   ・31d831fdb207 は build.mjs が dist/index.html の内容ハッシュで置換する
     → 中身が変わったときだけキャッシュ名が変わり、更新が検出される
   ・install で skipWaiting はしない(学習中の強制リロードをしないため)。
     ページから SKIP_WAITING を受け取ったときだけ待機解除する
   ===================================================================== */

const CACHE = "quest-31d831fdb207";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if(event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;

  /* 画面遷移は常に index.html を返す(単一HTMLアプリ・オフライン起動) */
  if(req.mode === "navigate"){
    event.respondWith(
      caches.match("./index.html").then(hit => hit || fetch(req).catch(() => caches.match("./")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => {
      if(hit) return hit;
      return fetch(req).then(res => {
        if(res && res.ok && new URL(req.url).origin === self.location.origin){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

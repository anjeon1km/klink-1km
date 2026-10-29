// 안키로 서비스 워커: 한 번 연 뒤에는 인터넷이 없어도 앱이 열리게 합니다.
// 같은 출처 파일은 '네트워크 먼저'(온라인이면 항상 최신, 오프라인이면 저장본), 글꼴은 '저장본 먼저'.
// 앱 파일 목록과 VERSION은 `npm run pwa`(tools/make_pwa.js)가 채웁니다 — 내용이 바뀌면 VERSION도 바뀌어 예전 저장본이 지워집니다.
const VERSION = 'ankiro-ee891e9482';
const CORE = [
  // <precache>
  './',
  'css/app.css',
  'data/base.json',
  'data/bike.json',
  'data/grid.json',
  'data/hubs.json',
  'data/layers.json',
  'data/meta.json',
  'data/models.json',
  'data/network.json',
  'data/transit.json',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'index.html',
  'js/core/analysis.js',
  'js/core/glm.js',
  'js/core/grading.js',
  'js/core/graph.js',
  'js/core/params.js',
  'js/core/router.js',
  'js/core/transfer.js',
  'js/data.js',
  'js/geo.js',
  'js/live.js',
  'js/main.js',
  'js/map/mapview.js',
  'js/map/vcanvas.js',
  'js/state.js',
  'js/store.js',
  'js/ui/charts.js',
  'js/ui/citizen/guide.js',
  'js/ui/citizen/history.js',
  'js/ui/citizen/hubs.js',
  'js/ui/citizen/report.js',
  'js/ui/citizen/ride.js',
  'js/ui/citizen/route.js',
  'js/ui/citizen/steps.js',
  'js/ui/dom.js',
  'js/ui/icons.js',
  'js/ui/policy/method.js',
  'js/ui/policy/ops.js',
  'js/ui/policy/sim.js',
  'js/ui/policy/types.js',
  'js/ui/policy/vuln.js',
  'manifest.webmanifest',
  'vendor/leaflet.css',
  'vendor/leaflet.js',
  // </precache>
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    // 오프라인: 같은 주소(쿼리 무시) 저장본, 페이지 이동이면 첫 화면
    return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

// Loads the prebuilt data (app/data/*.json, produced by pipeline/03_build_app_data.js) and prepares indexes.
import { Planner } from './core/router.js';

const FILES = ['meta', 'network', 'base', 'transit', 'bike', 'hubs', 'grid', 'layers', 'models'];

export async function loadData(onProgress) {
  const out = {}; let done = 0;
  await Promise.all(FILES.map(async f => {
    const r = await fetch(`data/${f}.json`);
    if (!r.ok) throw new Error(`data/${f}.json을 불러오지 못했습니다 (HTTP ${r.status}).`);
    out[f] = await r.json();
    onProgress?.(++done / FILES.length, f);
  }));
  out.planner = new Planner({ net: out.network, hubs: out.hubs, transit: out.transit, crosswalks: out.layers.crosswalks });
  out.hubById = new Map(out.hubs.hubs.map(h => [h.id, h]));
  out.cellById = new Map(out.grid.cells.map(c => [c.id, c]));
  out.pilot = Object.fromEntries(out.hubs.hubs.filter(h => h.code).map(h => [h.code, h]));
  out.search = buildSearchIndex(out);
  return out;
}

// Places a person can type: hubs, subway stations, bus stops, campuses/parks, 행정동
function buildSearchIndex(d) {
  const items = [];
  d.hubs.hubs.forEach(h => items.push({ label: h.code ? `${h.code} ${h.name}` : h.name, kind: h.code ? '시범 거점' : `${h.grade}급 거점`, lat: h.lat, lon: h.lon, hub: h.id }));
  d.transit.stations.forEach(s => items.push({ label: `${s.name}역`, kind: s.lines.map(l => d.transit.lineNames[l]).join('·') || '지하철', lat: s.lat, lon: s.lon }));
  const seen = new Set();
  d.transit.busStops.forEach(b => { const k = b.name; if (seen.has(k)) return; seen.add(k); items.push({ label: b.name, kind: '버스정류장', lat: b.lat, lon: b.lon }); });
  d.base.campuses.filter(c => c.name).forEach(c => { const p = centroid(c.ring); items.push({ label: c.name, kind: c.kind === 'hospital' ? '병원' : '학교', lat: p[0], lon: p[1] }); });
  d.base.parks.filter(c => c.name).forEach(c => { const p = centroid(c.ring); items.push({ label: c.name, kind: '공원', lat: p[0], lon: p[1] }); });
  d.base.dongs.filter(x => x.inDdm).forEach(x => items.push({ label: x.name, kind: '행정동', lat: x.c[0], lon: x.c[1] }));
  return items;
}
const centroid = ring => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];

// 250 m grid cell containing a point (same frame as pipeline/lib/geo.js)
export function cellAt(data, lat, lon) {
  const LAT0 = 37.585, LON0 = 127.05, MY = 110950, MX = 111320 * Math.cos(LAT0 * Math.PI / 180), C = data.grid.cell;
  return data.cellById.get(`${Math.floor((lon - LON0) * MX / C)}_${Math.floor((lat - LAT0) * MY / C)}`) || null;
}

export function searchPlaces(data, q, n = 8) {
  const s = q.trim().replace(/\s+/g, '');
  if (!s) return [];
  const score = it => { const l = it.label.replace(/\s+/g, ''); return l.startsWith(s) ? 0 : l.includes(s) ? 1 : 9; };
  return data.search.map(it => ({ it, sc: score(it) })).filter(o => o.sc < 9).sort((a, b) => a.sc - b.sc || a.it.label.length - b.it.label.length).slice(0, n).map(o => o.it);
}

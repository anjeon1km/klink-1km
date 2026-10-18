// Transit supply: subway stations/entrances (OSM) and bus stops (OSM) joined to ridership by ARS number or stop name.
import { dist, pointInRing, round } from '../lib/geo.js';

export const LINE_NAME = { line1: '1호선', line2: '2호선', line2b: '2호선 성수지선', line4: '4호선', line5: '5호선', line6: '6호선', line7: '7호선', gyeongui: '경의중앙선', suinbundang: '수인분당선', gyeongchun: '경춘선', ui: '우이신설선' };
// 역별 운행 노선 (공식 노선도 기준)
const STATION_LINES = {
  회기: ['line1', 'gyeongui'], 청량리: ['line1', 'gyeongui', 'suinbundang', 'gyeongchun'], 외대앞: ['line1'], 신이문: ['line1'], 제기동: ['line1'],
  신설동: ['line1', 'line2b', 'ui'], 동묘앞: ['line1', 'line6'], 용두: ['line2b'], 신답: ['line2b'], 용답: ['line2b'], 답십리: ['line5'], 장한평: ['line5'],
  군자: ['line5', 'line7'], 고려대: ['line6'], 안암: ['line6'], 보문: ['line6', 'ui'], 상월곡: ['line6'], 월곡: ['line6'], 돌곶이: ['line6'], 석계: ['line1', 'line6'],
  중랑: ['gyeongui'], 상봉: ['line7', 'gyeongui', 'gyeongchun'], 중화: ['line7'], 면목: ['line7'], 사가정: ['line7'], 왕십리: ['line2', 'line5', 'suinbundang', 'gyeongui'],
  마장: ['line5'], 한양대: ['line2'], 상왕십리: ['line2'], 신당: ['line2', 'line6'], 성신여대입구: ['line4', 'ui'], 창신: ['line6'], 동대문: ['line1', 'line4'], 청구: ['line5', 'line6'],
  신금호: ['line5'], 행당: ['line5'], 응봉: ['gyeongui'], 길음: ['line4'], 미아사거리: ['line4'], 정릉: ['ui'], 먹골: ['line7'], 중곡: ['line7'], 용마산: ['line7'], 아차산: ['line5'], 금호역: ['line3'],
};

export function routeType(no) {
  if (/^N\d+/.test(no)) return 'night';
  if (/^[가-힣]+\d+/.test(no)) return 'village';
  if (/^9\d{3}$/.test(no)) return 'express';
  if (/^\d{4}$/.test(no)) return 'branch';
  if (/^\d{2,3}[AB]?$/.test(no)) return 'trunk';
  return 'branch';
}
export const ROUTE_TYPE_NAME = { trunk: '간선', branch: '지선', village: '마을', express: '광역', night: '심야(올빼미)' };
const norm = s => String(s).replace(/\(\d+\)$/, '').replace(/[\s.·()]/g, '');

export function buildTransit({ osm, clipRing, ringsDdm, busHourly, busDaily, subwayHourly }) {
  // ── subway
  const stNodes = osm.elements.filter(e => e.tags?.railway === 'station' && e.lat);
  const byName = new Map();
  for (const e of stNodes) {
    const name = e.tags.name.replace(/역$/, '');
    if (!byName.has(name)) byName.set(name, []); byName.get(name).push(e);
  }
  const stations = [];
  for (const [name, arr] of byName) {
    const lat = arr.reduce((s, e) => s + e.lat, 0) / arr.length, lon = arr.reduce((s, e) => s + e.lon, 0) / arr.length;
    if (!pointInRing(lat, lon, clipRing)) continue;
    stations.push({ name, lat: round(lat), lon: round(lon), lines: STATION_LINES[name] || [], inDdm: ringsDdm.some(r => pointInRing(lat, lon, r)), entrances: [] });
  }
  const ents = osm.elements.filter(e => e.tags?.railway === 'subway_entrance' && e.lat);
  for (const e of ents) {
    const label = e.tags.description || e.tags.name || '';
    let st = stations.find(s => label.startsWith(s.name));
    if (!st) { const near = stations.map(s => ({ s, d: dist([e.lat, e.lon], [s.lat, s.lon]) })).sort((a, b) => a.d - b.d)[0]; if (near && near.d < 350) st = near.s; }
    if (!st || dist([e.lat, e.lon], [st.lat, st.lon]) > 600) continue;
    st.entrances.push({ ref: e.tags.ref || '', lat: round(e.lat), lon: round(e.lon), wheelchair: ['yes', 'no', 'limited'].includes(e.tags.wheelchair) ? e.tags.wheelchair : null });
  }
  for (const s of stations) if (!s.entrances.length) s.entrances.push({ ref: '', lat: s.lat, lon: s.lon });
  // ridership (only stations present in the provided file — 회기)
  const subwayRows = subwayHourly.rows;
  for (const s of stations) {
    const rows = subwayRows.filter(r => r.station === s.name);
    if (!rows.length) continue;
    const months = [...new Set(rows.map(r => r.month))].sort();
    const last = months[months.length - 1];
    const lastRows = rows.filter(r => r.month === last);
    s.ridership = {
      month: last, lines: lastRows.map(r => r.line),
      on: Array.from({ length: 24 }, (_, h) => lastRows.reduce((a, r) => a + r.on[h], 0)),
      off: Array.from({ length: 24 }, (_, h) => lastRows.reduce((a, r) => a + r.off[h], 0)),
      trend: months.slice(-25).map(m => ({ month: m, on: rows.filter(r => r.month === m).reduce((a, r) => a + r.on.reduce((x, y) => x + y, 0), 0) })),
    };
  }

  // ── bus routes and stops
  const routes = new Map();
  const byArs = new Map(), byNm = new Map();
  for (const r of busHourly.rows) {
    if (!byArs.has(r.ars)) byArs.set(r.ars, []); byArs.get(r.ars).push(r);
    const k = norm(r.name); if (!byNm.has(k)) byNm.set(k, []); byNm.get(k).push(r);
    if (!routes.has(r.route)) routes.set(r.route, { no: r.route, name: r.routeName, type: routeType(r.route), hourly: Array(24).fill(0) });
    const rt = routes.get(r.route); r.on.forEach((v, h) => { rt.hourly[h] += v; });
  }
  // Service span per route from hourly boardings: the complement of the longest idle stretch on the 24-hour
  // clock. first = first active hour, last = end of the last active hour; values ≥ 24 mean after midnight.
  for (const rt of routes.values()) {
    rt.monthOn = rt.hourly.reduce((a, b) => a + b, 0);
    const minRide = Math.max(1, rt.monthOn * 0.001); // ignore stray taps
    const on = rt.hourly.map(v => v >= minRide);
    if (!on.some(Boolean)) { rt.first = rt.last = null; continue; }
    let bestStart = -1, bestLen = 0;
    for (let s = 0; s < 24; s++) {
      if (on[s] || !on[(s + 23) % 24]) continue; // gap must start right after an active hour
      let len = 0; while (len < 24 && !on[(s + len) % 24]) len++;
      if (len > bestLen) { bestLen = len; bestStart = s; }
    }
    if (bestStart < 0) { rt.first = 0; rt.last = 24; continue; } // runs all day
    // service-day clock: a route that starts between 00:00 and 03:59 belongs to the previous day (24–27)
    rt.first = (bestStart + bestLen) % 24; if (rt.first < 4) rt.first += 24;
    rt.last = bestStart; while (rt.last <= rt.first) rt.last += 24;
  }
  const osmStops = osm.elements.filter(e => e.tags?.highway === 'bus_stop' && e.lat && pointInRing(e.lat, e.lon, clipRing));
  const busStops = []; let byRef = 0, byName2 = 0, fromRef = 0;
  for (const e of osmStops) {
    const ars = e.tags.ref ? String(e.tags.ref).padStart(5, '0') : null;
    let rows = ars ? byArs.get(ars) : null;
    if (rows) byRef++;
    else {
      const nm = norm(e.tags.name || '');
      rows = byNm.get(nm) || byNm.get(nm.replace(/앞$/, '')) || byNm.get(nm + '앞');
      if (rows) byName2++;
    }
    rows = rows || [];
    let routeNos = [...new Set(rows.map(r => r.route))];
    // no ridership match (renamed stop): fall back to the route list mapped in OSM (route_ref)
    if (!routeNos.length && e.tags.route_ref) { routeNos = e.tags.route_ref.split(/[;,]/).map(s => s.trim()).filter(Boolean); fromRef++; }
    const on = Array(24).fill(0), off = Array(24).fill(0);
    // when matched by name, several ARS stops share the name → average them
    const arsSet = new Set(rows.map(r => r.ars)); const div = Math.max(1, arsSet.size);
    rows.forEach(r => r.on.forEach((v, h) => { on[h] += v / div; off[h] += r.off[h] / div; }));
    busStops.push({ id: e.id, name: e.tags.name || '정류장', ars: ars || (arsSet.size === 1 ? [...arsSet][0] : ''), lat: round(e.lat), lon: round(e.lon), routes: routeNos, on: on.map(Math.round), off: off.map(Math.round), matched: rows.length ? (ars && byArs.has(ars) ? 'ars' : 'name') : (routeNos.length ? 'osm-route' : 'none'), inDdm: ringsDdm.some(r => pointInRing(e.lat, e.lon, r)) });
  }
  // routes known only from OSM still need a type for headway assumptions
  for (const b of busStops) for (const no of b.routes) if (!routes.has(no)) routes.set(no, { no, name: no, type: routeType(no), hourly: Array(24).fill(0), first: routeType(no) === 'night' ? 24 : 5, last: routeType(no) === 'night' ? 29 : 24, monthOn: 0, osmOnly: true });
  console.log(`  bus stops: ${busStops.length} (ridership matched by ARS ${byRef}, by name ${byName2}; routes from OSM route_ref ${fromRef})`);

  // recent daily village-bus counts (동대문01)
  const village = {};
  for (const s of busDaily.stops) {
    const v = (village[s.route] ??= { route: s.route, name: s.routeName, from: busDaily.from, to: busDaily.to, stops: [] });
    const seq = +(s.name.match(/\((\d+)\)$/)?.[1] || 0);
    const osmStop = busStops.find(b => b.ars === s.ars);
    v.stops.push({ seq, name: s.name.replace(/\(\d+\)$/, ''), ars: s.ars, perDayOn: Math.round(s.on / s.days), perDayOff: Math.round(s.off / s.days), lat: osmStop?.lat, lon: osmStop?.lon });
  }
  Object.values(village).forEach(v => v.stops.sort((a, b) => a.seq - b.seq));

  return { lineNames: LINE_NAME, routeTypeNames: ROUTE_TYPE_NAME, stations, busStops, routes: [...routes.values()].map(r => ({ no: r.no, name: r.name, type: r.type, first: r.first, last: r.last, monthOn: r.monthOn, hourly: r.hourly, osmOnly: !!r.osmOnly })), village: Object.values(village), busMonth: busHourly.month };
}

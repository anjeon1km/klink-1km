// Road network: OSM ways → junction-to-junction segments → links ≤ 50 m with slope, crossings, lighting, risk proxy.
import { dist, splitPolyline, pointSegDist, PointIndex, pointInRing, round, toXY } from '../lib/geo.js';
import { CLS, F } from '../../app/js/core/grading.js';

const MAX_LINK = 50;
const DROP_HIGHWAY = new Set(['proposed', 'construction', 'platform', 'corridor', 'elevator', 'bus_guideway', 'raceway', 'busway', 'services', 'rest_area', 'bridleway', 'via_ferrata', 'abandoned', 'disused', 'escape', 'emergency_bay']);

function classify(t) {
  const h = t.highway;
  if (DROP_HIGHWAY.has(h)) return null;
  if (t.area === 'yes' || t.indoor === 'yes') return null;
  if (h === 'footway' && (t.footway === 'sidewalk' || t.footway === 'crossing')) return null; // 보도·횡단은 도로 중심선과 횡단보도 데이터로 대체
  if (h === 'service' && ['parking_aisle', 'driveway', 'drive-through'].includes(t.service)) return null;
  if (['private', 'no'].includes(t.access) && !['yes', 'designated', 'permissive'].includes(t.foot)) return null;
  const bikeOk = ['yes', 'designated'].includes(t.bicycle);
  if (/^(motorway|motorway_link)$/.test(h)) return { cls: CLS.MOTORROAD };
  if (/^trunk/.test(h)) return { cls: (t.motorroad === 'yes' || t.expressway === 'yes') ? CLS.MOTORROAD : CLS.PRIMARY };
  if (/^primary/.test(h)) return { cls: CLS.PRIMARY };
  if (/^secondary/.test(h)) return { cls: CLS.SECONDARY };
  if (/^tertiary/.test(h)) return { cls: CLS.TERTIARY };
  if (['residential', 'unclassified', 'road', 'living_street'].includes(h)) return { cls: CLS.RESIDENTIAL };
  if (h === 'service' || h === 'track') return { cls: CLS.SERVICE };
  if (h === 'cycleway') return { cls: CLS.CYCLEWAY };
  if ((h === 'footway' || h === 'path') && t.bicycle === 'designated') return { cls: CLS.CYCLEWAY }; // 자전거·보행자 겸용도로
  if (['footway', 'pedestrian', 'path'].includes(h)) return { cls: CLS.FOOTWAY, bikeOk };
  if (h === 'steps') return { cls: CLS.STEPS };
  return null;
}

function flagsFor(t, c) {
  let f = 0;
  const pmBlocked = t.bicycle === 'no' || t.access === 'no';
  if (c.cls >= CLS.PRIMARY && c.cls <= CLS.CYCLEWAY && !pmBlocked) f |= F.PM;
  // 보행: 도로에 foot=no가 붙은 경우는 대부분 보도를 별도 선(footway=sidewalk)으로 그린 경우이므로,
  // 보도선 대신 도로 중심선을 보행 가능으로 본다 (자동차전용도로만 제외).
  const roadClass = c.cls >= CLS.PRIMARY && c.cls <= CLS.SERVICE;
  if (c.cls !== CLS.MOTORROAD && (t.foot !== 'no' || roadClass)) f |= F.WALK;
  if (c.cls !== CLS.CYCLEWAY && (t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1') && t['oneway:bicycle'] !== 'no') f |= F.ONEWAY;
  if (t.bridge && t.bridge !== 'no') f |= F.BRIDGE;
  if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') f |= F.TUNNEL;
  if (t.cycleway && t.cycleway !== 'no' || ['lane', 'track'].includes(t['cycleway:right']) || ['lane', 'track'].includes(t['cycleway:both']) || c.cls === CLS.CYCLEWAY) f |= F.CYCLELANE;
  if (t.lit === 'yes' || t.lit === 'automatic') f |= F.LIT_YES;
  if (t.lit === 'no') f |= F.LIT_NO;
  // 보행 약자 경로용: 보도 유무(태그 → 없으면 도로 위계로 추정), 거친 노면
  const roadClass2 = c.cls >= CLS.PRIMARY && c.cls <= CLS.SERVICE;
  if (['both', 'left', 'right', 'separate', 'yes'].includes(t.sidewalk) || (roadClass2 && t.foot === 'no') || (t.sidewalk !== 'no' && c.cls >= CLS.PRIMARY && c.cls <= CLS.TERTIARY)) f |= F.SIDEWALK;
  else if (roadClass2) f |= F.SHARED; // 보차혼용 (생활도로·이면도로)
  if (['dirt', 'unpaved', 'sand', 'grass', 'stepping_stones', 'pebblestone', 'sett', 'grass_paver', 'stone', 'gravel', 'ground'].includes(t.surface) || t.smoothness === 'bad' || t.wheelchair === 'no') f |= F.ROUGH;
  return f;
}

export function buildNetwork({ osm, clipRing, dem, crosswalks, pedSignals, lights, osmLamps, securityLights = [], cctv = [], busStops, entrances, parks, campuses, accidents }) {
  // 1) keep ways touching the clip polygon (district + 400 m)
  const ways = [];
  for (const e of osm.elements) {
    if (e.type !== 'way' || !e.tags?.highway || !e.geometry) continue;
    const c = classify(e.tags); if (!c) continue;
    if (!e.geometry.some(g => pointInRing(g.lat, g.lon, clipRing))) continue;
    if (e.tags.oneway === '-1') { e.geometry.reverse(); e.nodes.reverse(); }
    ways.push({ id: e.id, tags: e.tags, c, nodes: e.nodes, pts: e.geometry.map(g => [g.lat, g.lon]) });
  }
  // 2) junctions = nodes used more than once or way ends
  const use = new Map();
  for (const w of ways) w.nodes.forEach((n, i) => use.set(n, (use.get(n) || 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  const nodeIdx = new Map(); const N = { lat: [], lon: [], z: [] };
  const addNode = (key, p) => { if (nodeIdx.has(key)) return nodeIdx.get(key); const i = N.lat.length; N.lat.push(p[0]); N.lon.push(p[1]); N.z.push(dem.at(p[0], p[1])); nodeIdx.set(key, i); return i; };

  const names = []; const nameIdx = new Map(); const nameOf = s => { if (!s) return -1; if (!nameIdx.has(s)) { nameIdx.set(s, names.length); names.push(s); } return nameIdx.get(s); };
  const L = { a: [], b: [], len: [], cls: [], flags: [], g: [], x: [], xs: [], acc: [], lt: [], cc: [], name: [], way: [], pos: [], geom: {} };

  for (const w of ways) {
    const flags0 = flagsFor(w.tags, w.c);
    const nm = nameOf(w.tags.name || w.tags.ref);
    // cumulative distance along the way
    const cum = [0]; for (let i = 1; i < w.pts.length; i++) cum.push(cum[i - 1] + dist(w.pts[i - 1], w.pts[i]));
    // elevation profile along the whole way (bridges/tunnels: linear between ends)
    const flat = flags0 & (F.BRIDGE | F.TUNNEL);
    const z0 = dem.at(...w.pts[0]), z1 = dem.at(...w.pts[w.pts.length - 1]); const total = cum[cum.length - 1] || 1;
    const zAt = d => {
      if (flat) return z0 + (z1 - z0) * d / total;
      let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); const p = w.pts[i - 1], q = w.pts[i];
      return dem.at(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
    };
    // split at junctions
    let segStart = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i < w.nodes.length - 1 && (use.get(w.nodes[i]) || 0) < 2) continue;
      const segPts = w.pts.slice(segStart, i + 1);
      const pieces = splitPolyline(segPts, MAX_LINK);
      let along = cum[segStart];
      pieces.forEach((pc, k) => {
        const a = k === 0 ? addNode('o' + w.nodes[segStart], pc[0]) : addNode('w' + w.id + ':' + segStart + ':' + k, pc[0]);
        const b = k === pieces.length - 1 ? addNode('o' + w.nodes[i], pc[pc.length - 1]) : addNode('w' + w.id + ':' + segStart + ':' + (k + 1), pc[pc.length - 1]);
        let len = 0; for (let j = 1; j < pc.length; j++) len += dist(pc[j - 1], pc[j]);
        if (len < 0.5 || a === b) { along += len; return; }
        // gradient over a ≥30 m window centred on the link
        const mid = along + len / 2, half = Math.max(len, 30) / 2;
        const lo = Math.max(0, mid - half), hi = Math.min(total, mid + half);
        const g = hi - lo > 5 ? (zAt(hi) - zAt(lo)) / (hi - lo) * 100 : 0;
        const li = L.a.length;
        L.a.push(a); L.b.push(b); L.len.push(round(len, 1)); L.cls.push(w.c.cls); L.flags.push(flags0); L.g.push(round(g, 1));
        L.x.push(0); L.xs.push(0); L.acc.push(0); L.lt.push(0); L.cc.push(0); L.name.push(nm); L.way.push(w.id); L.pos.push(mid);
        if (pc.length > 2) L.geom[li] = pc.slice(1, -1).map(p => [round(p[0]), round(p[1])]);
        along += len;
      });
      segStart = i;
    }
  }
  const nL = L.a.length;
  console.log(`  network: ${ways.length} ways → ${N.lat.length} nodes, ${nL} links`);

  // helpers
  const midOf = i => { const g = L.geom[i]; if (g && g.length) return g[Math.floor(g.length / 2)]; return [(N.lat[L.a[i]] + N.lat[L.b[i]]) / 2, (N.lon[L.a[i]] + N.lon[L.b[i]]) / 2]; };
  const mids = Array.from({ length: nL }, (_, i) => { const m = midOf(i); return { lat: m[0], lon: m[1], i }; });
  const midIdx = new PointIndex(mids, 60);
  const isPM = i => L.flags[i] & F.PM;

  // 3) crossings: snap each crosswalk to the nearest PM link (≤ 20 m); signalised if a pedestrian signal head is within 25 m
  const sigIdx = new PointIndex(pedSignals, 40);
  const perWay = new Map();
  let snapped = 0, unsig = 0;
  for (const c of crosswalks) {
    const cand = midIdx.within(c.lat, c.lon, 60).filter(o => isPM(o.i));
    let best = null;
    for (const o of cand) {
      const pts = [[N.lat[L.a[o.i]], N.lon[L.a[o.i]]], ...(L.geom[o.i] || []), [N.lat[L.b[o.i]], N.lon[L.b[o.i]]]];
      for (let k = 1; k < pts.length; k++) { const r = pointSegDist([c.lat, c.lon], pts[k - 1], pts[k]); if (!best || r.d < best.d) best = { d: r.d, i: o.i }; }
    }
    if (!best || best.d > 20) continue;
    const signal = sigIdx.within(c.lat, c.lon, 25).length > 0;
    c.signal = signal; c.link = best.i; snapped++; if (!signal) unsig++;
    const w = L.way[best.i]; if (!perWay.has(w)) perWay.set(w, []); perWay.get(w).push({ pos: L.pos[best.i], signal });
  }
  for (let i = 0; i < nL; i++) {
    const arr = perWay.get(L.way[i]); if (!arr) continue;
    for (const c of arr) if (Math.abs(c.pos - L.pos[i]) <= 50) { if (c.signal) L.xs[i]++; else L.x[i]++; }
  }
  console.log(`  crossings: ${snapped} snapped (${unsig} unsignalised)`);

  // 4) lighting score (0..1): measured lamps (서울시 가로등 + 보안등 + OSM) + OSM lit tags + road-class prior
  const PRIOR = { [CLS.MOTORROAD]: 0.9, [CLS.PRIMARY]: 0.9, [CLS.SECONDARY]: 0.85, [CLS.TERTIARY]: 0.75, [CLS.RESIDENTIAL]: 0.55, [CLS.SERVICE]: 0.4, [CLS.CYCLEWAY]: 0.5, [CLS.FOOTWAY]: 0.4, [CLS.STEPS]: 0.4 };
  const lampIdx = new PointIndex(lights.concat(osmLamps, securityLights), 40);
  const stopIdx = new PointIndex(busStops, 60), entIdx = new PointIndex(entrances, 60);
  const camIdx = new PointIndex(cctv, 60);
  const inAny = (lat, lon, polys) => polys.some(p => lat >= p.bb.s && lat <= p.bb.n && lon >= p.bb.w && lon <= p.bb.e && pointInRing(lat, lon, p.ring));
  for (let i = 0; i < nL; i++) {
    const m = mids[i];
    let lt = PRIOR[L.cls[i]];
    if (inAny(m.lat, m.lon, parks)) { L.flags[i] |= F.PARK; lt = Math.min(lt, 0.3); }
    if (inAny(m.lat, m.lon, campuses)) L.flags[i] |= F.CAMPUS;
    const lamps = lampIdx.within(m.lat, m.lon, 30).length;
    if (lamps >= 2) lt = Math.max(lt, 0.95); else if (lamps === 1) lt = Math.max(lt, 0.8);
    if (L.flags[i] & F.LIT_YES) lt = Math.max(lt, 0.9);
    if (L.flags[i] & F.LIT_NO) lt = Math.min(lt, 0.2);
    if (stopIdx.within(m.lat, m.lon, 40).length || entIdx.within(m.lat, m.lon, 40).length) lt = Math.min(1, lt + 0.1); // 자연감시(정류장·역 출구)
    L.lt[i] = round(lt, 2);
    // CCTV cameras within 100 m (야간 안심구간 요건 ②), 역 출구 100 m (안전속도구역 15 km/h), 차량 혼용 차도
    L.cc[i] = Math.min(20, camIdx.within(m.lat, m.lon, 100).reduce((s, o) => s + (o.item.n || 1), 0));
    if (entIdx.within(m.lat, m.lon, 100).length) L.flags[i] |= F.STATION;
    if (L.cls[i] >= CLS.PRIMARY && L.cls[i] <= CLS.TERTIARY && !(L.flags[i] & F.CYCLELANE)) L.flags[i] |= F.MIXED;
  }
  console.log(`  CCTV: ${L.cc.filter(v => v > 0).length} of ${nL} links have a camera within 100 m`);

  // 5) risk score A (0..1). With TAAS accident points: kernel density within 50 m. Without: environment proxy.
  const deg = new Int32Array(N.lat.length); const majorAt = new Uint8Array(N.lat.length);
  for (let i = 0; i < nL; i++) { deg[L.a[i]]++; deg[L.b[i]]++; if (L.cls[i] <= CLS.TERTIARY) { majorAt[L.a[i]] = 1; majorAt[L.b[i]] = 1; } }
  const accIdx = accidents?.length ? new PointIndex(accidents, 60) : null;
  const hotspots = [];
  for (let i = 0; i < nL; i++) {
    if (!isPM(i)) { L.acc[i] = 0; continue; }
    const m = mids[i];
    let taas = 0;
    if (accIdx) { // TAAS 사고다발지역: 반경 50 m 안 → 적색(hotspot), 사고 건수로 점수
      const near = accIdx.within(m.lat, m.lon, 50);
      taas = Math.min(1, near.reduce((s, o) => s + (o.item.weight || 1) * (1 - o.d / 50), 0) / 3);
      if (near.some(o => o.item.hotspot)) hotspots.push(i);
    }
    // 대리지표: 큰길 교차로 상충 + 버스 정류장 앞 합류 + 역 출구 보행 밀집 (차량 혼용은 별도 등급 기준 F.MIXED)
    let a = 0;
    const dmax = Math.max(deg[L.a[i]], deg[L.b[i]]);
    const majorJ = (deg[L.a[i]] >= 3 && majorAt[L.a[i]]) || (deg[L.b[i]] >= 3 && majorAt[L.b[i]]);
    if (dmax >= 4 && majorJ) a += 0.35; else if (dmax >= 3 && majorJ) a += 0.2;
    if (stopIdx.within(m.lat, m.lon, 25).length) a += 0.2;
    if (entIdx.within(m.lat, m.lon, 30).length) a += 0.1;
    // TAAS가 있으면 등급은 TAAS가 정하고(대리지표는 0.7배로 줄여 0.5 기준을 넘지 않음), 대리지표는 비용에만 남긴다
    L.acc[i] = round(accIdx ? Math.max(taas, 0.7 * Math.min(1, a)) : Math.min(1, a), 2);
  }
  if (accIdx) console.log(`  TAAS: ${hotspots.length} links within 50 m of an accident hotspot`);

  delete L.pos;
  return { nodes: { lat: N.lat.map(v => round(v)), lon: N.lon.map(v => round(v)), z: N.z.map(v => round(v, 1)) }, links: L, names, hotspots, accidentSource: accIdx ? 'taas' : 'proxy' };
}

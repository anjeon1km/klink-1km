// 250 m 격자 진단: TAI(대중교통 접근성) · PUI(공유모빌리티 이용강도) · 위험 · 서비스 공백 → PTVI / NIGHT-TVI → 지역 유형
import { toXY, toLatLon, pointInRing, dist, round } from '../lib/geo.js';
import { buildAdjacency, nearestNode, dijkstra, mainComponentAccept } from '../../app/js/core/graph.js';
import { F, walkCost, linkGrade, scores } from '../../app/js/core/grading.js';
import { PARAMS } from '../../app/js/core/params.js';
import { classifyCell, quadrant, kmeans } from '../../app/js/core/analysis.js';

const CELL = 250;

function pctRank(values) { // average-rank percentile 0..100
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = ((i + j) / 2) / Math.max(1, idx.length - 1) * 100;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}
const band = m => (m < 300 ? 0.2 : m < 500 ? 0.6 : m <= 1500 ? 1 : m <= 2500 ? 0.6 : 0.3); // 마지막 1 km 대역 (PM 평균 1.01 km, 1.5 km 미만 76.3%)

export function buildGrid({ net, transit, bike, ringsDdm, dongs, overrides, population = null }) {
  buildAdjacency(net);
  const L = net.links, NN = net.nodes;
  const inDdm = (la, lo) => ringsDdm.some(r => pointInRing(la, lo, r));
  // 1) cells
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  ringsDdm.forEach(r => r.forEach(([la, lo]) => { const [x, y] = toXY(la, lo); xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }));
  const cells = [];
  for (let gx = Math.floor(xmin / CELL); gx * CELL < xmax; gx++) for (let gy = Math.floor(ymin / CELL); gy * CELL < ymax; gy++) {
    const inside = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { const [la, lo] = toLatLon((gx + (i + 0.5) / 5) * CELL, (gy + (j + 0.5) / 5) * CELL); if (inDdm(la, lo)) inside.push([la, lo]); }
    if (inside.length < 6) continue; // ≥ 25% inside
    const c = { id: `${gx}_${gy}`, gx, gy, cover: inside.length / 25 };
    c.lat = inside.reduce((a, p) => a + p[0], 0) / inside.length; c.lon = inside.reduce((a, p) => a + p[1], 0) / inside.length;
    c.corners = [[gx, gy], [gx + 1, gy], [gx + 1, gy + 1], [gx, gy + 1]].map(([x, y]) => toLatLon(x * CELL, y * CELL).map(v => round(v)));
    const dc = {}; inside.forEach(([la, lo]) => { const d = dongs.find(d => d.inDdm && d.rings.some(r => pointInRing(la, lo, r))); if (d) dc[d.name] = (dc[d.name] || 0) + 1; });
    c.dong = Object.entries(dc).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    cells.push(c);
  }
  console.log(`  grid: ${cells.length} cells of ${CELL} m`);

  const walkAccept = mainComponentAccept(net, l => L.flags[l] & F.WALK);
  const wcost = (l, d) => walkCost(net, l, d);
  const snap = (la, lo) => nearestNode(net, la, lo, walkAccept, 400);

  // 2) stops/entrances snapped to the walking graph
  const stopNodes = transit.busStops.filter(b => b.routes.length).map(b => { const s = snap(b.lat, b.lon); return s && { b, node: s.node, extra: s.d / 1.33 }; }).filter(Boolean);
  const entNodes = transit.stations.flatMap(st => st.entrances.map(e => { const s = snap(e.lat, e.lon); return s && { st, node: s.node, extra: s.d / 1.33 }; })).filter(Boolean);
  const routeBy = new Map(transit.routes.map(r => [r.no, r]));
  const nodeStops = new Map(); stopNodes.forEach(s => { if (!nodeStops.has(s.node)) nodeStops.set(s.node, []); nodeStops.get(s.node).push(s); });
  const nodeEnts = new Map(); entNodes.forEach(s => { if (!nodeEnts.has(s.node)) nodeEnts.set(s.node, []); nodeEnts.get(s.node).push(s); });

  // nearest-station walking time everywhere (multi-source)
  const stRes = dijkstra(net, entNodes.map(e => ({ node: e.node, cost: e.extra })), wcost, { maxCost: 3600 });

  const HW = PARAMS.tai.headway, REL = PARAMS.tai.reliability;
  const busHw = r => HW[{ trunk: 'trunk', branch: 'branch', village: 'village', express: 'express', night: 'night' }[r.type]] || 10;
  const edfSum = edfs => { if (!edfs.length) return 0; edfs.sort((a, b) => b - a); return edfs[0] + 0.5 * edfs.slice(1).reduce((a, b) => a + b, 0); };

  // 3) per-cell accessibility
  for (const c of cells) {
    const o = snap(c.lat, c.lon); if (!o) { c.skip = true; continue; }
    const res = dijkstra(net, [{ node: o.node, cost: o.d / 1.33 }], wcost, { maxCost: 12 * 60 + 60 });
    const routeWalk = new Map(); const lineWalk = new Map();
    // walk only over reached nodes — scan the maps of stop/entrance nodes
    for (const [node, arr] of nodeStops) { const t = res.dist[node]; if (t > 8 * 60 + 30) continue; for (const s of arr) { const tm = (t + s.extra) / 60; for (const r of s.b.routes) if (!routeWalk.has(r) || routeWalk.get(r) > tm) routeWalk.set(r, tm); } }
    for (const [node, arr] of nodeEnts) { const t = res.dist[node]; if (t > 12 * 60 + 30) continue; for (const s of arr) { const tm = (t + s.extra) / 60; for (const ln of s.st.lines) if (!lineWalk.has(ln) || lineWalk.get(ln) > tm) lineWalk.set(ln, tm); } }
    const tai = (window) => {
      const bus = [], rail = [];
      for (const [no, w] of routeWalk) {
        const r = routeBy.get(no); if (!r) continue;
        let hw = busHw(r);
        if (window === 'day') { if (r.type === 'night') continue; }
        else if (window === 'late') { if (r.last == null || r.last < 24 || r.first > 22) continue; hw *= PARAMS.tai.lateFactor; }
        else if (window === 'deep') { if (r.last == null || r.last < 26) continue; }
        bus.push(30 / (w + 0.5 * hw + REL.bus));
      }
      if (window !== 'deep') for (const [ln, w] of lineWalk) { const hw = (HW[ln] || 8) * (window === 'late' ? PARAMS.tai.lateFactor : 1); rail.push(30 / (w + 0.5 * hw + REL.rail)); }
      return edfSum(bus) + edfSum(rail);
    };
    c.taiDay = round(tai('day'), 2); c.taiLate = round(tai('late'), 2); c.taiDeep = round(tai('deep'), 2);
    c.routes = routeWalk.size; c.lines = [...lineWalk.keys()];
    c.tStation = round(Math.min(60, (stRes.dist[o.node] + o.d / 1.33) / 60), 1);
    let tBus = Infinity; for (const [node, arr] of nodeStops) { const t = res.dist[node]; if (t < tBus) tBus = t + arr[0].extra; } c.tBus = round(Math.min(15, tBus / 60), 1);
    let lastBus = 0; for (const [no, w] of routeWalk) { const r = routeBy.get(no); if (r && r.type !== 'night' && w <= 6 && r.last) lastBus = Math.max(lastBus, r.last); }
    c.lastBus = lastBus || null;
    c.stationDistM = Math.round(c.tStation * 80);
  }

  // 4) PUI — Gaussian spread (σ = 150 m) of estimated trips at docking stations
  const centres = cells.map(c => toXY(c.lat, c.lon));
  cells.forEach(c => { c.pui = 0; c.puiNight = 0; });
  for (const s of bike.stations) {
    if (!s.estTripsPerDay) continue;
    const [sx, sy] = toXY(s.lat, s.lon);
    const w = centres.map(([x, y]) => Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 150 * 150)));
    const sw = w.reduce((a, b) => a + b, 0); if (sw < 1e-6) continue;
    cells.forEach((c, i) => { c.pui += s.estTripsPerDay * w[i] / sw; c.puiNight += s.estTripsPerDay * (s.estNightShare || 0) * w[i] / sw; });
  }
  cells.forEach(c => { c.pui = round(c.pui, 1); c.puiNight = round(c.puiNight, 2); });

  // 5) risk of PM links inside each cell (day and night grade context, with pilot overrides)
  const ov = new Map(Object.entries(overrides).map(([k, v]) => [+k, v]));
  const cellOf = (la, lo) => { const [x, y] = toXY(la, lo); return `${Math.floor(x / CELL)}_${Math.floor(y / CELL)}`; };
  // population: 100 m SGIS cells summed into each 250 m cell by centre point
  const popBy = new Map();
  if (population) for (const [la, lo, n] of population) { const k = cellOf(la, lo); popBy.set(k, (popBy.get(k) || 0) + n); }
  cells.forEach(c => { c.pop = population ? Math.round(popBy.get(c.id) || 0) : null; });
  const acc = new Map(cells.map(c => [c.id, { len: 0, risk: 0, riskN: 0, red: 0, redN: 0, lit: 0, slope: 0, all: 0, park: 0, campus: 0, urban: 0 }]));
  for (let i = 0; i < L.a.length; i++) {
    const la = (NN.lat[L.a[i]] + NN.lat[L.b[i]]) / 2, lo = (NN.lon[L.a[i]] + NN.lon[L.b[i]]) / 2;
    const a = acc.get(cellOf(la, lo)); if (!a) continue;
    a.all += L.len[i];
    if (L.flags[i] & F.PARK) a.park += L.len[i]; else if (L.flags[i] & F.CAMPUS) a.campus += L.len[i];
    else if (L.cls[i] >= 1 && L.cls[i] <= 5) a.urban += L.len[i];
    if (!(L.flags[i] & F.PM)) continue;
    const len = L.len[i];
    const sF = scores(net, i, 1, true), sB = scores(net, i, -1, true);
    const S = Math.max(sF.S, sB.S), A = L.acc[i], X = sF.X, N = sF.N;
    a.len += len; a.risk += len * (0.35 * S + 0.35 * A + 0.30 * X); a.riskN += len * (0.3 * S + 0.3 * A + 0.2 * X + 0.2 * N);
    const g = (dir, night) => linkGrade(net, i, dir, { night, overrides: ov });
    if (g(1, false) === 'R' || g(-1, false) === 'R') a.red += len;
    if (g(1, true) === 'R' || g(-1, true) === 'R') a.redN += len;
    a.lit += len * L.lt[i]; a.slope += len * Math.abs(L.g[i]);
  }
  for (const c of cells) {
    const a = acc.get(c.id); const n = a.len || 1;
    c.pmLenM = Math.round(a.len); c.risk = round(a.risk / n, 3); c.riskNight = round(a.riskN / n, 3);
    c.redShare = round(a.red / n, 3); c.redShareNight = round(a.redN / n, 3); c.lit = round(a.lit / n, 2); c.slope = round(a.slope / n, 1);
    // land use from the share of path length: mostly park/forest paths with few streets → no resident 생활권
    const all = a.all || 1;
    c.landuse = a.park / all > 0.5 ? 'park' : a.campus / all > 0.5 ? 'campus' : 'urban';
    c.urbanRoadM = Math.round(a.urban);
    // 생활권이 아닌 격자: 인구 자료가 있으면 인구 30명 미만(캠퍼스 제외), 없으면 공원 위주·도로 희박
    if (c.pop != null) { if (c.pop < 30 && c.landuse !== 'campus' && c.pui < 5) c.lowActivity = true; }
    else if ((c.landuse === 'park' && c.pui < 5) || c.urbanRoadM < 250) c.lowActivity = true;
  }

  // 6) components (0–100, percentile within 동대문구, 생활권 격자만) → PTVI and NIGHT-TVI
  for (const c of cells) if (c.lowActivity && !c.skip) { c.type = c.typeNight = 'P'; c.excluded = true; }
  const live = cells.filter(c => !c.skip && !c.lowActivity);
  const P = k => pctRank(live.map(k));
  const pNegTai = P(c => -c.taiDay), pNegLate = P(c => -c.taiLate), pTst = P(c => c.tStation);
  const pRisk = P(c => c.risk), pRed = P(c => c.redShare), pRiskN = P(c => c.riskNight), pRedN = P(c => c.redShareNight);
  const dRaw = live.map(c => 0.5 * (1 - (c.taiDay ? c.taiLate / c.taiDay : 0)) + 0.3 * Math.max(0, Math.min(1, (25 - (c.lastBus || 21)) / 4)) + 0.2 * (c.taiDeep > 0 ? 0 : 1));
  const pD = pctRank(dRaw);
  const pPui = P(c => c.pui), pPuiN = P(c => c.puiNight);
  const hasPop = live.some(c => c.pop != null), pPop = hasPop ? P(c => c.pop || 0) : null;
  // C 저탄소 전환 잠재력 = 공유모빌리티 이용 + 생활권 수요(인구) + 마지막 1 km 대역
  const cOf = (i, pu, c) => hasPop ? 0.4 * pu[i] + 0.3 * pPop[i] + 30 * band(c.stationDistM) : 0.5 * pu[i] + 50 * band(c.stationDistM);
  const W = PARAMS.ptvi;
  live.forEach((c, i) => {
    const comp = {
      A: 0.6 * pNegTai[i] + 0.4 * pTst[i],
      R: 0.6 * pRisk[i] + 0.4 * pRed[i],
      D: pD[i],
      C: cOf(i, pPui, c),
    };
    const compN = {
      A: 0.6 * pNegLate[i] + 0.4 * pTst[i],
      R: 0.6 * pRiskN[i] + 0.4 * pRedN[i],
      D: pD[i],
      C: cOf(i, pPuiN, c),
    };
    for (const k in comp) { comp[k] = round(comp[k], 1); compN[k] = round(compN[k], 1); }
    c.comp = comp; c.compN = compN; c.puiPct = round(pPui[i], 1); c.taiPct = round(100 - pNegTai[i], 1);
    c.ptvi = round(W.A * comp.A + W.R * comp.R + W.D * comp.D + W.C * comp.C, 1);
    c.nightTvi = round(W.A * compN.A + W.R * compN.R + W.D * compN.D + W.C * compN.C, 1);
    c.type = classifyCell(comp, c.puiPct); c.typeNight = classifyCell(compN, round(pPuiN[i], 1));
    c.quad = quadrant(c.taiPct, c.puiPct);
  });
  const km = kmeans(live.map(c => [c.comp.A, c.comp.R, c.comp.D, c.comp.C]), 5, 7);
  live.forEach((c, i) => { c.cluster = km.labels[i]; });
  const rankBy = (k, out) => live.slice().sort((a, b) => b[k] - a[k]).forEach((c, i) => { c[out] = i + 1; });
  rankBy('ptvi', 'rank'); rankBy('nightTvi', 'rankNight');
  delete net.adj; delete net.grid;
  console.log(`  ${live.length} 생활권 cells ranked, ${cells.filter(c => c.excluded).length} park/low-activity cells excluded`);
  return { cell: CELL, cells: cells.filter(c => !c.skip).map(c => { const { skip, gx, gy, lowActivity, ...rest } = c; return rest; }), kmeans: { k: 5, centroids: km.centroids.map(v => v.map(x => round(x, 1))) } };
}

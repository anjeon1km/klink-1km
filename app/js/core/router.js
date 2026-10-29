// 이동 계획: 거점 기반 안전 PM 경로 + 가장 빠른 PM 경로(비교용) + 도보 + 버스 + 야간 대안.
// 앱 개발안 3장 규칙: 출발·도착은 환승거점, 적색 구간은 지도에서 제외, 야간에는 야간 안심구간만 사용.
import { PARAMS, isNightHour } from './params.js';
import { buildAdjacency, nearestNode, dijkstra, pathTo, pathCoords, linkCoords, metres, mainComponentAccept } from './graph.js';
import { F, CLS, linkGrade, safeCost, fastCost, walkCost, walkSeconds, speedFor, linkReasons, isNightSafeLink, WALK_PROFILES, WHEELCHAIR_MAX_SLOPE } from './grading.js';
import { netSavingPerKm } from './analysis.js';

const HUB_RADIUS_WALK = 450; // m — 출발지·목적지에서 거점까지 걸을 수 있는 최대 직선거리

export class Planner {
  constructor({ net, hubs, transit, crosswalks = [] }) {
    this.net = buildAdjacency(net);
    this.crosswalks = crosswalks; // [lat, lon, signalised 0/1]
    this.blocked = new Set();
    this.hubs = hubs.hubs; this.corridors = hubs.corridors;
    this.overrides = new Map(Object.entries(hubs.overrides).map(([k, v]) => [+k, v]));
    this.hotspots = new Set(net.hotspots || []);
    this.transit = transit;
    const L = net.links;
    this.pmOk = mainComponentAccept(net, l => L.flags[l] & F.PM);
    this.walkOk = mainComponentAccept(net, l => L.flags[l] & F.WALK);
    this.roadOk = mainComponentAccept(net, l => L.cls[l] <= CLS.SERVICE && L.cls[l] >= CLS.PRIMARY);
    this.routeBy = new Map(transit.routes.map(r => [r.no, r]));
  }

  ctx({ night = false, weights = null, useOverrides = true } = {}) {
    return { night, weights: weights || PARAMS.weights, overrides: useOverrides ? this.overrides : null, hotspots: this.hotspots };
  }

  snapWalk(p) { return nearestNode(this.net, p.lat, p.lon, this.walkOk, 500); }
  snapPm(p) { return nearestNode(this.net, p.lat, p.lon, this.pmOk, 500); }
  snapRoad(p) { return nearestNode(this.net, p.lat, p.lon, this.roadOk, 500); }

  hubsNear(p, { night = false, maxM = HUB_RADIUS_WALK, limit = 5, forStart = false } = {}) {
    return this.hubs.filter(h => h.node >= 0 && !(forStart && h.arriveOnly)) // H3 같은 '오르막 도착 전용' 거점은 출발에 쓰지 않음
      .map(h => ({ h, d: metres(p.lat, p.lon, h.lat, h.lon) }))
      .filter(o => o.d <= maxM && (!night || o.h.nightSafe || o.h.grade !== 'C'))
      .sort((a, b) => (a.d - (night && a.h.nightSafe ? 120 : 0)) - (b.d - (night && b.h.nightSafe ? 120 : 0)))
      .slice(0, limit);
  }

  // 시민 제보(보도 파손·단절, 포트홀) 반경 20 m 안 링크 → 휠체어·시각장애 경로에서 제외
  setHazards(reports) {
    const pts = (reports || []).filter(r => ['broken', 'pothole'].includes(r.cat) && r.lat != null);
    const blocked = new Set(); const N = this.net.nodes, L = this.net.links;
    if (pts.length) for (let i = 0; i < L.a.length; i++) {
      const la = (N.lat[L.a[i]] + N.lat[L.b[i]]) / 2, lo = (N.lon[L.a[i]] + N.lon[L.b[i]]) / 2;
      if (pts.some(p => Math.abs(p.lat - la) < 0.0004 && metres(la, lo, p.lat, p.lon) < 20)) blocked.add(i);
    }
    this.blocked = blocked;
    return blocked.size;
  }

  walk(from, to, { night = false, profile = 'general' } = {}) {
    const a = this.snapWalk(from), b = this.snapWalk(to);
    if (!a || !b) return null;
    const ctx = { night, preferLit: night, profile, blocked: this.blocked };
    const res = dijkstra(this.net, [{ node: a.node, cost: a.d / 1.33 }], (l, d) => walkCost(this.net, l, d, ctx), { target: b.node });
    if (!isFinite(res.dist[b.node])) return null;
    const path = pathTo(this.net, res, b.node);
    const L = this.net.links;
    // real walking time and what the route is made of
    let sec = (a.d + b.d) / 1.33, len = a.d + b.d, lit = 0, stairs = 0, steepM = 0, maxSlope = 0, sharedM = 0, sidewalkM = 0, roughM = 0, blockedNear = 0;
    for (const { link, dir } of path) {
      const l = L.len[link], s = Math.abs(L.g[link]);
      sec += walkSeconds(this.net, link, dir, profile); len += l; lit += L.lt[link] * l;
      if (L.cls[link] === CLS.STEPS) stairs++;
      if (s > 5) steepM += l; maxSlope = Math.max(maxSlope, s);
      if (L.flags[link] & F.SHARED) sharedM += l; if (L.flags[link] & F.SIDEWALK) sidewalkM += l; if (L.flags[link] & F.ROUGH) roughM += l;
      if (this.blocked?.has(link)) blockedNear++;
    }
    const cross = this.crossingsAlong(path);
    const alerts = this.alertsAlong(path, profile);
    return {
      profile, path, coords: [[from.lat, from.lon], ...pathCoords(this.net, path), [to.lat, to.lon]], sec, len, litShare: len ? lit / len : 0,
      summary: { stairs, steepM, maxSlope, sharedShare: len ? sharedM / len : 0, sidewalkShare: len ? sidewalkM / len : 0, roughM, blockedNear, crossSig: cross.sig, crossUnsig: cross.unsig },
      steps: this.buildSteps(path),
      alerts, pathLen: path.reduce((a, p) => a + L.len[p.link], 0),
    };
  }

  // crosswalk points (서울시 횡단보도 위치) within 12 m of the route's vertices
  crosswalksNear(lat, lon, r) {
    if (!this._cwGrid) { this._cwGrid = new Map(); this.crosswalks.forEach((c, i) => { const k = Math.floor(c[0] / 0.0003) + ':' + Math.floor(c[1] / 0.0004); if (!this._cwGrid.has(k)) this._cwGrid.set(k, []); this._cwGrid.get(k).push(i); }); }
    const gi = Math.floor(lat / 0.0003), gj = Math.floor(lon / 0.0004); const out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const i of this._cwGrid.get((gi + di) + ':' + (gj + dj)) || []) {
      const c = this.crosswalks[i]; const d = metres(lat, lon, c[0], c[1]); if (d < r) out.push({ i, d });
    }
    return out;
  }
  crossingsAlong(path) {
    if (!this.crosswalks?.length) return { sig: 0, unsig: 0, points: [] };
    const seen = new Set();
    for (const p of pathCoords(this.net, path)) for (const { i } of this.crosswalksNear(p[0], p[1], 12)) seen.add(i);
    const pts = [...seen].map(i => this.crosswalks[i]);
    return { sig: pts.filter(c => c[2]).length, unsig: pts.filter(c => !c[2]).length, points: pts };
  }

  // 미리 알릴 지점 — 경로 시작에서 몇 m 지점인지(dist)와, 몇 m 앞에서 알릴지(lead):
  // 횡단보도(서울시 횡단보도·보행등 위치, 경로 12 m 안) 30 m 앞, 계단 30 m 앞,
  // 급경사(휠체어 1/12 초과, 그 밖 8% 초과 — 10 m 안에서 이어지면 한 구간) 50 m 앞.
  alertsAlong(path, profile = 'general') {
    const L = this.net.links;
    const wheel = profile.startsWith('wheelchair');
    const steepAt = wheel ? WHEELCHAIR_MAX_SLOPE : 8;
    const out = []; const verts = []; let cum = 0, steep = null;
    for (const { link, dir } of path) {
      const c = linkCoords(this.net, link); const pts = dir === 1 ? c : c.slice().reverse();
      let geo = 0; const at = [0];
      for (let k = 1; k < pts.length; k++) { geo += metres(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]); at.push(geo); }
      const scale = geo > 0 ? L.len[link] / geo : 0;
      pts.forEach((p, k) => { if (k > 0 || !verts.length) verts.push([p[0], p[1], cum + at[k] * scale]); });
      const s = L.g[link] * dir;
      if (L.cls[link] === CLS.STEPS) out.push({ kind: 'stairs', dist: cum, at: pts[0], lead: 30 });
      if (Math.abs(s) > steepAt) {
        if (steep && cum - steep.endDist < 10) { steep.endDist = cum + L.len[link]; steep.len = steep.endDist - steep.dist; if (Math.abs(s) > Math.abs(steep.slope)) steep.slope = s; }
        else { steep = { kind: 'steep', dist: cum, endDist: cum + L.len[link], len: L.len[link], slope: s, at: pts[0], lead: 50 }; out.push(steep); }
      }
      cum += L.len[link];
    }
    if (this.crosswalks?.length) {
      const best = new Map();
      for (const v of verts) for (const { i, d } of this.crosswalksNear(v[0], v[1], 12)) if (!best.has(i) || d < best.get(i).d) best.set(i, { dist: v[2], d });
      for (const [i, b] of best) { const c = this.crosswalks[i]; out.push({ kind: c[2] ? 'crossSig' : 'crossUnsig', dist: b.dist, at: [c[0], c[1]], lead: 30 }); }
    }
    out.sort((a, b) => a.dist - b.dist);
    // 횡단보도 양 끝이 따로 찍힌 경우 등: 같은 종류가 25 m 안에 또 있으면 하나로
    // 교차로에서 연달아 건너는 경우: 같은 종류가 40 m 안에 또 있으면 한 번에 "연달아 N곳"으로
    const merged = [];
    for (const a of out) {
      if (a.kind === 'steep' && !wheel && a.len < 15) continue; // 휠체어가 아니면 아주 짧은 급경사는 알리지 않음
      const p = [...merged].reverse().find(m => m.kind === a.kind);
      if (p && a.kind !== 'steep' && a.dist - p.dist < 40) { p.count = (p.count || 1) + 1; continue; }
      merged.push({ ...a });
    }
    return merged.map(a => ({ ...a, dist: Math.round(a.dist), len: a.len != null ? Math.round(a.len) : undefined, slope: a.slope != null ? Math.round(a.slope * 10) / 10 : undefined }));
  }

  // Turn-by-turn steps for voice guidance: group links by road name and heading; mark slopes, stairs, crossings, shared streets.
  buildSteps(path) {
    const L = this.net.links; const names = this.net.names; const out = [];
    const bearing = (p, q) => { const y = (q[1] - p[1]) * Math.cos(p[0] * Math.PI / 180), x = q[0] - p[0]; return Math.atan2(y, x) * 180 / Math.PI; };
    let prevEnd = null;
    for (const { link, dir } of path) {
      const c = linkCoords(this.net, link); const pts = dir === 1 ? c : c.slice().reverse();
      const b0 = bearing(pts[0], pts[1]), b1 = bearing(pts[pts.length - 2], pts[pts.length - 1]);
      const name = L.name[link] >= 0 ? names[L.name[link]] : (L.cls[link] === CLS.STEPS ? '계단' : L.cls[link] === CLS.FOOTWAY ? '보행로' : '골목길');
      let turn = 0; if (prevEnd != null) { turn = ((b0 - prevEnd + 540) % 360) - 180; }
      const s = L.g[link] * dir;
      const last = out[out.length - 1];
      const stairs = L.cls[link] === CLS.STEPS;
      if (last && last.name === name && Math.abs(turn) < 35 && last.stairs === stairs) {
        last.len += L.len[link]; last.maxUp = Math.max(last.maxUp, s); last.maxDown = Math.min(last.maxDown, s); last.end = pts[pts.length - 1];
        if (L.flags[link] & F.SHARED) last.sharedM += L.len[link];
      } else {
        out.push({ name, turn, len: L.len[link], maxUp: Math.max(0, s), maxDown: Math.min(0, s), stairs, sharedM: (L.flags[link] & F.SHARED) ? L.len[link] : 0, at: pts[0], end: pts[pts.length - 1] });
      }
      prevEnd = b1;
    }
    // merge very short pieces into the previous step so the voice does not chatter
    const merged = [];
    for (const st of out) {
      const p = merged[merged.length - 1];
      if (p && st.len < 15 && !st.stairs && !p.stairs) { p.len += st.len; p.end = st.end; p.maxUp = Math.max(p.maxUp, st.maxUp); p.maxDown = Math.min(p.maxDown, st.maxDown); p.sharedM += st.sharedM; }
      else merged.push(st);
    }
    // crossings at the start of each step (junction)
    for (const st of merged) {
      const near = (this.crosswalks || []).filter(c => Math.abs(c[0] - st.at[0]) < 0.0003 && metres(st.at[0], st.at[1], c[0], c[1]) < 20);
      st.crossSig = near.some(c => c[2]); st.crossUnsig = !st.crossSig && near.length > 0;
      st.turnText = Math.abs(st.turn) < 35 ? '직진' : Math.abs(st.turn) > 150 ? '유턴' : st.turn > 0 ? '오른쪽' : '왼쪽';
    }
    if (merged[0]) merged[0].turnText = '출발';
    let acc = 0; for (const st of merged) { st.startDist = acc; acc += st.len; } // 경로 시작에서 몇 m — 음성 안내의 위치 기준
    return merged;
  }

  // Night-safe link: 야간 안심 환승구간(조도 + CCTV + 낮 녹·황) or within 60 m of an A/B hub (거점 조명·CCTV 설치 — 정책안 3장)
  isNightSafe(l, dir = 1) {
    const ov = this.overrides.get(l)?.night?.[dir === 1 ? 'f' : 'b'];
    if (ov) return ov !== 'R'; // 시범구간 고시 등급이 야간 등급을 정함 (C1 야간 황색, C2·C3 야간 적색)
    if (isNightSafeLink(this.net, l, dir, { hotspots: this.hotspots })) return true;
    if (!this._hubLit) {
      this._hubLit = new Set();
      const N = this.net.nodes, L = this.net.links;
      const ab = this.hubs.filter(h => h.grade !== 'C');
      for (let i = 0; i < L.a.length; i++) for (const h of ab) {
        if (metres(N.lat[L.a[i]], N.lon[L.a[i]], h.lat, h.lon) < 60 || metres(N.lat[L.b[i]], N.lon[L.b[i]], h.lat, h.lon) < 60) { this._hubLit.add(i); break; }
      }
    }
    return this._hubLit.has(l);
  }
  safeCostFn(ctx) {
    const litOnly = ctx.night && ctx.litOnly !== false;
    return (l, d) => (litOnly && !this.isNightSafe(l, d)) ? Infinity : safeCost(this.net, l, d, ctx);
  }

  // PM leg between two network nodes with a cost profile
  pmLeg(fromNode, toNode, profile, ctx) {
    const cost = profile === 'safe' ? this.safeCostFn(ctx) : (l, d) => fastCost(this.net, l, d, ctx);
    const res = dijkstra(this.net, [{ node: fromNode, cost: 0 }], cost, { target: toNode });
    if (!isFinite(res.dist[toNode])) return null;
    return this.describePm(pathTo(this.net, res, toNode), ctx);
  }

  describePm(path, ctx) {
    const L = this.net.links; const names = this.net.names;
    const byGrade = { G: 0, Y: 0, R: 0, X: 0 }; let sec = 0, len = 0, cross = 0, maxUp = 0, maxDown = 0;
    const segs = []; const steps = [];
    for (const { link, dir } of path) {
      const g = linkGrade(this.net, link, dir, ctx);
      const v = speedFor(g === 'X' ? 'R' : g, ctx.night || ctx.slow, this.net, link); // 야간·비·눈·강풍이면 한 단계 낮게
      const l = L.len[link]; len += l; sec += l / (v / 3.6); byGrade[g] += l; cross += L.x[link] > 0 ? 1 : 0;
      const s = L.g[link] * dir; maxUp = Math.max(maxUp, s); maxDown = Math.min(maxDown, s);
      const name = L.name[link] >= 0 ? names[L.name[link]] : (L.cls[link] === CLS.CYCLEWAY ? '자전거도로' : '이름 없는 길');
      const last = segs[segs.length - 1];
      const reasons = g === 'G' ? [] : linkReasons(this.net, link, dir, ctx);
      if (last && last.name === name && last.grade === g) { last.len += l; last.links.push(link); reasons.forEach(r => { if (!last.reasons.includes(r)) last.reasons.push(r); }); }
      else segs.push({ name, grade: g, len: l, speed: v, reasons, links: [link] });
      steps.push({ link, dir, grade: g, speed: v, len: l });
    }
    return { path, steps, segs, coords: pathCoords(this.net, path), len, sec, byGrade, crossings: cross, maxUp, maxDown };
  }

  // Links the safe route avoided: red/yellow links on the fast route that the safe route does not use
  avoided(fast, safe, ctx) {
    if (!fast) return [];
    const used = new Set(safe ? safe.path.map(p => p.link) : []);
    const out = []; const seen = new Set();
    for (const { link, dir } of fast.path) {
      if (used.has(link)) continue;
      const g = linkGrade(this.net, link, dir, ctx); if (g === 'G') continue;
      for (const r of linkReasons(this.net, link, dir, ctx)) {
        const key = r.replace(/[\d.]+/g, '#'); if (seen.has(key + g)) continue; seen.add(key + g);
        out.push({ link, grade: g, reason: r });
      }
    }
    return out.sort((a, b) => (b.grade === 'R') - (a.grade === 'R')).slice(0, 6);
  }

  bus(from, to, hour, night) {
    const stops = this.transit.busStops.filter(b => b.routes.length);
    const near = (p, m) => stops.map(b => ({ b, d: metres(p.lat, p.lon, b.lat, b.lon) })).filter(o => o.d <= m);
    const A = near(from, 450), B = near(to, 450);
    let best = null;
    const roadCost = l => this.roadOk(l) ? this.net.links.len[l] : Infinity;
    for (const a of A) {
      const ra = this.snapRoad(a.b); if (!ra) continue;
      const shared = a.b.routes.filter(no => B.some(o => o.b.routes.includes(no)));
      if (!shared.length) continue;
      const res = dijkstra(this.net, [{ node: ra.node, cost: 0 }], roadCost, { maxCost: 8000 }); // one search per boarding stop
      for (const no of shared) {
        const r = this.routeBy.get(no); if (!r) continue;
        const b = B.filter(o => o.b.routes.includes(no) && o.b.id !== a.b.id).sort((x, y) => x.d - y.d)[0]; if (!b) continue;
        const span = r.first != null ? [r.first, r.last] : [5, 24];
        const h = hour < 4 ? hour + 24 : hour;
        const running = h >= span[0] && h < span[1];
        const hw = (PARAMS.tai.headway[r.type] || 10) * (night && r.type !== 'night' ? PARAMS.tai.lateFactor : 1);
        const rb = this.snapRoad(b.b); if (!rb) continue;
        const rideM = res.dist[rb.node]; if (!isFinite(rideM) || rideM < 200) continue;
        const walkMin = (a.d + b.d) * 1.25 / 80; // 직선거리 → 보행 네트워크 보정 1.25
        const rideMin = rideM / 1000 / PARAMS.busKmh * 60;
        const total = walkMin + hw / 2 + rideMin;
        const lastText = span[1] ? `${String(Math.floor(span[1]) % 24).padStart(2, '0')}시` : '';
        const score = total + (running ? 0 : 1000) + (r.type === 'village' ? -2 : 0);
        if (!best || score < best.score) best = { route: r, from: a.b, to: b.b, walkMin, waitMin: hw / 2, rideMin, rideM, total, running, lastText, score };
      }
    }
    return best;
  }

  // profile: 'pm' (PM 환승, 기본) | 'general' (걷기) | 'wheelchair' | 'blind' | 'lowslope'
  // weather: 실시간 길 상태 { slow, noPm, why } (live.js conditions) — 없으면 예측치만으로 계산
  plan({ from, to, hour = new Date().getHours(), forceNight = null, weights = null, litOnly = true, useOverrides = true, profile = 'pm', weather = null }) {
    const night = forceNight ?? isNightHour(hour);
    const ctx = { ...this.ctx({ night, weights, useOverrides }), litOnly, slow: !!weather?.slow };
    const out = { from, to, hour, night, ctx, profile, weather };
    if (profile !== 'pm') { // 걷기·교통약자: PM 없이 보행 경로 + 버스
      out.walk = this.walk(from, to, { night, profile });
      if (!out.walk && WALK_PROFILES[profile + 'Relaxed']) { // 기준을 지키는 길이 없으면 가장 완만한 길을 경고와 함께
        out.walk = this.walk(from, to, { night, profile: profile + 'Relaxed' });
        if (out.walk) out.walk.relaxed = true;
      }
      if (!out.walk && WALK_PROFILES[profile + 'Steep']) {
        out.walk = this.walk(from, to, { night, profile: profile + 'Steep' });
        if (out.walk) { out.walk.relaxed = true; out.walk.assist = true; }
      }
      out.walkGeneral = profile !== 'general' ? this.walk(from, to, { night, profile: 'general' }) : null;
      out.bus = this.bus(from, to, hour, night);
      out.pm = null;
      out.recommend = out.walk ? 'walk' : 'no-route';
      return out;
    }
    out.walk = this.walk(from, to, { night });

    // Hubs: try start hubs near the origin and end hubs near the destination, widening to 900 m when the
    // closest ones have no safe connection (e.g. downhill from campus → "walk to the gate hub, then rent").
    const sNear = this.hubsNear(from, { night, maxM: 900, limit: 5, forStart: true });
    const eNear = this.hubsNear(to, { night, maxM: 900, limit: 8 });
    const starts = sNear.length ? sNear : [{ h: null, d: this.snapPm(from)?.d ?? 0, node: this.snapPm(from)?.node }];
    const ends = eNear.length ? eNear : [{ h: null, d: this.snapPm(to)?.d ?? 0, node: this.snapPm(to)?.node }];
    const walkSec = m => m * 1.25 / 1.33 * 1.6; // 걷는 시간은 1.6배로 무겁게 — 안전 경로가 있으면 가장 가까운 거점에서 탄다
    let best = null; const reachable = new Set();
    for (const s of starts) {
      const sNode = s.h ? s.h.node : s.node; if (sNode == null) continue;
      const res = dijkstra(this.net, [{ node: sNode, cost: 0 }], this.safeCostFn(ctx), { maxCost: 3600 });
      for (const e of ends) {
        const eNode = e.h ? e.h.node : e.node; if (eNode == null || eNode === sNode || !isFinite(res.dist[eNode])) continue;
        reachable.add(s);
        const est = walkSec(s.d) + res.dist[eNode] + walkSec(e.d);
        if (!best || est < best.est) best = { est, s, e, res, sNode, eNode };
      }
    }
    let pm = null;
    if (best) {
      const safe = this.describePm(pathTo(this.net, best.res, best.eNode), ctx);
      pm = { startHub: best.s.h, endHub: best.e.h, safe, endNode: best.eNode };
      const first = sNear[0];
      if (first && best.s.h !== first.h) {
        const why = first.h.arriveOnly ? '오르막 도착 전용 거점이라 출발할 수 없어'
          : reachable.has(first) ? '바로 타면 내리막·횡단 위험 점수가 더 높아' : `안전 기준을 지키는 ${night ? '야간 ' : ''}경로가 없어`;
        pm.walkFirstNote = `${first.h.name}은(는) ${why} ${best.s.h.name}까지 걸어가 대여합니다.`;
      }
      if (eNear[0] && best.e.h !== eNear[0].h) pm.walkLastNote = `${eNear[0].h.name}까지는 ${night ? '야간 안심구간' : '안전 구간'}으로 이어지지 않아 ${best.e.h.name}에 반납 후 걸어갑니다.`;
    }
    const startNode = best?.sNode;
    if (pm) {
      pm.fast = this.pmLeg(startNode, pm.endNode, 'fast', ctx);
      pm.avoided = this.avoided(pm.fast, pm.safe, ctx);
      const startHub = pm.startHub;
      const sp = startHub ? { lat: startHub.lat, lon: startHub.lon } : from;
      const ep = pm.endHub ? { lat: pm.endHub.lat, lon: pm.endHub.lon } : to;
      pm.walkIn = metres(from.lat, from.lon, sp.lat, sp.lon) > 25 ? this.walk(from, sp, { night }) : null;
      pm.walkOut = metres(to.lat, to.lon, ep.lat, ep.lon) > 25 ? this.walk(ep, to, { night }) : null;
      pm.totalMin = ((pm.walkIn?.sec || 0) + pm.safe.sec + (pm.walkOut?.sec || 0)) / 60 + PARAMS.pmUnlockMin + PARAMS.pmParkMin;
      pm.fastMin = pm.fast ? ((pm.walkIn?.sec || 0) + pm.fast.sec + (pm.walkOut?.sec || 0)) / 60 + PARAMS.pmUnlockMin + PARAMS.pmParkMin : null;
      pm.km = pm.safe.len / 1000;
      pm.co2VsTaxi = Math.round((PARAMS.carbon.ef.car - PARAMS.carbon.ef.pmNow) * pm.km); // g, 택시를 대신했을 때
      pm.transferEligible = !!(startHub && pm.endHub);
    } else {
      out.pmBlocked = night ? '야간 안심구간(조명 점수 0.7 이상)만으로 이어지는 PM 경로가 없습니다.' : '적색 구간을 빼면 이어지는 PM 경로가 없습니다.';
    }
    out.pm = pm;
    out.bus = this.bus(from, to, hour, night);
    if (night) {
      const road = this.snapRoad(from), road2 = this.snapRoad(to);
      if (road && road2) {
        const res = dijkstra(this.net, [{ node: road.node, cost: 0 }], l => this.roadOk(l) ? this.net.links.len[l] : Infinity, { target: road2.node });
        const m = res.dist[road2.node];
        if (isFinite(m)) out.taxi = { km: m / 1000, min: m / 1000 / 22 * 60 + 4 }; // 22 km/h + 호출 대기 4분 (가정)
      }
    }
    // recommendation
    out.recommend = !pm ? (night ? 'walk-or-taxi' : 'walk') : (night && pm.safe.byGrade.Y > pm.safe.len * 0.6 ? 'pm-caution' : 'pm');
    if (weather?.noPm) { out.weatherNoPm = `${weather.why} — 오늘은 PM 대신 걷기나 버스를 권해요.`; out.recommend = night ? 'walk-or-taxi' : 'walk'; }
    return out;
  }
}

export const co2PerKmSaved = () => netSavingPerKm();

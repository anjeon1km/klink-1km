// 환승거점(환승주차구역) 지정 — 정책안 3장
//  A 역 환승거점   : 역 출구 50 m 안 (최대 250 m). 주차면 30, 조명·CCTV·공유 헬멧·바닥 표시. 역마다 1번 출구 + 가장 먼 출구(120 m 이상)
//  B 목적지 거점   : 대학 정문·병원 입구 등 통행 발생지 + 버스 승차 상위 정류장(역 거점에서 350 m 이상). 주차면 20, 조명
//  C 보조거점      : 구간 중간·주거지 입구 — 기존 따릉이 대여소 자리(A·B에서 150 m 이상). 주차면 10
//  야간 안심거점   : A·B 중 조명(점수 0.7 이상)과 CCTV(50 m 안)가 확인된 곳 + 정책안이 지정한 H1
//  시범구간        : H1 회기역 1번 출구(A·야간 안심) · H2 경희대 정문·의료원(B) · H3 캠퍼스 상부 평화의전당 일대(B, 오르막 도착 전용)
//                    · H4 회기시장 일대(C, 선택) / 구간 C1 H1→H4, C2 H4→H2, C3 H2→H3
import { dist, pointInRing, round, PointIndex } from '../lib/geo.js';
import { buildAdjacency, nearestNode, dijkstra, pathTo, mainComponentAccept } from '../../app/js/core/graph.js';
import { F, fastCost } from '../../app/js/core/grading.js';

const SLOTS = { A: 30, B: 20, C: 10 };
const PEACE_HALL = [37.59868, 127.05274]; // 경희대 평화의전당 (OSM way 중심)

export function buildHubs({ net, transit, bike, osm, ringsDdm, cctv = [] }) {
  buildAdjacency(net);
  const pmAccept = mainComponentAccept(net, l => net.links.flags[l] & F.PM);
  const pmNode = (lat, lon) => nearestNode(net, lat, lon, pmAccept, 300)?.node ?? -1;
  const inDdm = (lat, lon) => ringsDdm.some(r => pointInRing(lat, lon, r));
  const nearDdm = (lat, lon) => inDdm(lat, lon) || ringsDdm.some(r => r.some(p => dist(p, [lat, lon]) < 250));
  const hubs = [];
  const add = h => { h.node = pmNode(h.lat, h.lon); h.slots = SLOTS[h.grade]; hubs.push(h); return h; };
  const farFrom = (lat, lon, grades, m) => !hubs.some(h => grades.includes(h.grade) && dist([h.lat, h.lon], [lat, lon]) < m);

  // ── 시범구간 H1 먼저 (다른 거점과 겹치지 않게)
  const hoegi = transit.stations.find(s => s.name === '회기');
  const e1 = hoegi?.entrances.find(e => e.ref === '1') || { lat: 37.58993, lon: 127.05761 };
  const H1 = add({ id: 'pilot-H1', code: 'H1', grade: 'A', kind: 'pilot', station: '회기', name: '회기역 1번 출구', lat: e1.lat, lon: e1.lon, designatedNightSafe: true, note: '동대문01 회기역 승차 평일 약 6,000명' });

  // ── A급: 역 출구
  for (const s of transit.stations.filter(s => nearDdm(s.lat, s.lon))) {
    const ents = s.entrances.slice().sort((a, b) => (+a.ref || 99) - (+b.ref || 99));
    for (const e of [ents[0], ents.slice(1).map(x => ({ x, d: dist([x.lat, x.lon], [ents[0].lat, ents[0].lon]) })).sort((a, b) => b.d - a.d)[0]?.x].filter(Boolean)) {
      if (!farFrom(e.lat, e.lon, ['A'], 120)) continue;
      add({ id: `${s.name}-${e.ref || 'm'}`, grade: 'A', kind: 'station', station: s.name, name: `${s.name}역${e.ref ? ' ' + e.ref + '번 출구' : ''}`, lat: e.lat, lon: e.lon });
    }
  }

  // ── 시범구간 H3 (캠퍼스 상부·평화의전당 일대)와 H2 (정문): 정책안 3장 — C3 정문→상부 직선 약 300 m, +24 m.
  // H3 = 평화의전당에 가장 가까운 PM 통행 노드, H2 = 회기역→H3 경로에서 평화의전당과 직선 300 m 떨어진 지점.
  const ctxDay = { night: false };
  const fast = (from, to) => pathTo(net, dijkstra(net, [{ node: from.node, cost: 0 }], (l, d) => fastCost(net, l, d, ctxDay), { target: to.node }), to.node);
  const h3node = pmNode(PEACE_HALL[0], PEACE_HALL[1]);
  const h3probe = { node: h3node };
  const p13 = fast(H1, h3probe);
  let h2node = H1.node;
  for (let k = p13.length - 1; k >= 0; k--) {
    const s = p13[k]; const v = s.dir === 1 ? net.links.a[s.link] : net.links.b[s.link];
    if (dist([net.nodes.lat[v], net.nodes.lon[v]], PEACE_HALL) >= 300) { h2node = v; break; }
  }
  const H2 = add({ id: 'pilot-H2', code: 'H2', grade: 'B', kind: 'pilot', name: '경희대 정문·경희의료원', lat: round(net.nodes.lat[h2node]), lon: round(net.nodes.lon[h2node]), note: `의료원 정류장 승하차 평일 각 약 4,000명 · 정문 위치는 정책안 거리(상부까지 직선 300 m)로 추정, 표고 약 ${Math.round(net.nodes.z[h2node])} m` });

  // ── B급: 대학·병원 입구 (캠퍼스 경계 중 승차 많은 정류장에 가장 가까운 점)
  const stopsWithUse = transit.busStops.filter(b => b.routes.length).map(b => ({ b, daily: b.on.reduce((a, v) => a + v, 0) / 31 }));
  const gates = osm.elements.filter(e => e.type === 'way' && e.geometry && /university|college|hospital/.test(e.tags?.amenity || '') && e.tags?.name && !/경희대학교/.test(e.tags.name))
    .map(e => ({ name: e.tags.name, kind: e.tags.amenity, ring: e.geometry.map(g => [g.lat, g.lon]) }))
    .filter(g => g.ring.some(p => inDdm(p[0], p[1])) && g.ring.length > 4);
  for (const g of gates) {
    const near = stopsWithUse.filter(o => g.ring.some(p => dist(p, [o.b.lat, o.b.lon]) < 150)).sort((a, b) => b.daily - a.daily)[0];
    if (!near) continue;
    const p = g.ring.slice().sort((a, b) => dist(a, [near.b.lat, near.b.lon]) - dist(b, [near.b.lat, near.b.lon]))[0];
    if (!inDdm(p[0], p[1]) || !farFrom(p[0], p[1], ['A', 'B'], 250)) continue;
    add({ id: `gate-${g.name}`, grade: 'B', kind: g.kind === 'hospital' ? 'hospital' : 'campus', name: `${g.name} 입구`, lat: round(p[0]), lon: round(p[1]), busDaily: Math.round(near.daily) });
  }
  // ── B급: 버스 승차 상위 정류장
  let nB = 0;
  for (const { b, daily } of stopsWithUse.filter(o => o.b.inDdm).sort((a, b) => b.daily - a.daily)) {
    if (nB >= 10) break;
    if (!farFrom(b.lat, b.lon, ['A'], 350) || !farFrom(b.lat, b.lon, ['B'], 300)) continue;
    add({ id: `stop-${b.ars || b.id}`, grade: 'B', kind: 'stop', name: `${b.name} 정류장`, lat: b.lat, lon: b.lon, busDaily: Math.round(daily) }); nB++;
  }

  const H3 = add({ id: 'pilot-H3', code: 'H3', grade: 'B', kind: 'pilot', name: '캠퍼스 상부 (평화의전당 일대)', lat: round(net.nodes.lat[h3node]), lon: round(net.nodes.lon[h3node]), arriveOnly: true, note: `표고 약 ${Math.round(net.nodes.z[h3node])} m — 오르막 도착 전용, 하행은 H2까지 도보 (학교 협약 필요)` });

  // ── 시범구간 H4 (회기시장 일대, 선택): H1→H2 경로에서 C1 380 m : C2 410 m 비율 지점
  const p12 = fast(H1, H2); const tot = p12.reduce((a, s) => a + net.links.len[s.link], 0);
  let acc = 0, h4node = H1.node;
  for (const s of p12) { acc += net.links.len[s.link]; h4node = s.dir === 1 ? net.links.b[s.link] : net.links.a[s.link]; if (acc >= tot * 380 / 790) break; }
  const H4 = add({ id: 'pilot-H4', code: 'H4', grade: 'C', kind: 'pilot', name: '회기시장 일대 (위치 확인 필요)', lat: round(net.nodes.lat[h4node]), lon: round(net.nodes.lon[h4node]), note: '회기로 중간, 주거지 연결 — 정확한 위치는 현장 확인 후 수정' });

  // ── C급: 따릉이 대여소 자리
  for (const s of bike.stations.filter(s => s.dong)) {
    if (!farFrom(s.lat, s.lon, ['A', 'B', 'C'], 150)) continue;
    add({ id: `bike-${s.ref || s.name}`, grade: 'C', kind: 'bike', name: `${s.name} (따릉이${s.ref ? ' ' + s.ref : ''})`, lat: s.lat, lon: s.lon, bikeTrips: s.estTripsPerDay });
  }

  // Corridors (정책안 3장 회기역–경희대 적용안). grade[0] = 진행 방향, grade[1] = 반대 방향
  const corridors = [
    { id: 'C1', name: 'C1 회기역 → 회기시장', from: 'H1', to: 'H4', grade: { day: ['Y', 'Y'], night: ['Y', 'Y'] }, speedNote: '황색 15 km/h — 버스 혼용, 비신호 횡단 다수', path: fast(H1, H4) },
    { id: 'C2', name: 'C2 회기시장 → 정문', from: 'H4', to: 'H2', grade: { day: ['Y', 'Y'], night: ['R', 'R'] }, speedNote: '황색 15 km/h — 조도 확인 전까지 야간 적색', path: fast(H4, H2) },
    { id: 'C3', name: 'C3 정문 → 캠퍼스 상부', from: 'H2', to: 'H3', grade: { day: ['Y', 'R'], night: ['R', 'R'] }, speedNote: '오르막 황색 10 km/h · 내리막 적색(하행은 H2까지 도보) · 야간 전면 적색', path: fast(H2, H3) },
  ];
  const overrides = {};
  for (const c of corridors) for (const { link, dir } of c.path) {
    const along = dir === 1 ? 'f' : 'b', against = dir === 1 ? 'b' : 'f';
    overrides[link] = { corridor: c.id, day: { [along]: c.grade.day[0], [against]: c.grade.day[1] }, night: { [along]: c.grade.night[0], [against]: c.grade.night[1] } };
  }

  // 야간 안심거점, 심야버스 거점
  const camIdx = new PointIndex(cctv, 60);
  const nStops = transit.busStops.filter(b => b.routes.some(r => /^N\d/.test(r)));
  for (const h of hubs) {
    const { start, link } = net.adj; let minLt = 1;
    if (h.node >= 0) for (let k = start[h.node]; k < start[h.node + 1]; k++) minLt = Math.min(minLt, net.links.lt[link[k]]);
    h.cctv = camIdx.within(h.lat, h.lon, 50).reduce((s, o) => s + (o.item.n || 1), 0);
    h.nightSafe = h.grade !== 'C' && h.node >= 0 && (h.designatedNightSafe || (minLt >= 0.7 && h.cctv > 0));
    h.nightBus = nStops.some(b => dist([b.lat, b.lon], [h.lat, h.lon]) < 80);
  }
  console.log(`  hubs: ${['A', 'B', 'C'].map(g => g + ' ' + hubs.filter(h => h.grade === g).length).join(', ')}; night-safe ${hubs.filter(h => h.nightSafe).length}; corridors ${corridors.map(c => c.id + ':' + Math.round(c.path.reduce((a, s) => a + net.links.len[s.link], 0)) + 'm').join(' ')}`);
  delete net.adj; delete net.grid;
  return {
    hubs: hubs.map(h => ({ ...h, lat: round(h.lat), lon: round(h.lon) })),
    corridors: corridors.map(c => ({ id: c.id, name: c.name, from: c.from, to: c.to, speedNote: c.speedNote, grade: c.grade, links: c.path.map(p => p.link), dirs: c.path.map(p => p.dir) })),
    overrides,
  };
}

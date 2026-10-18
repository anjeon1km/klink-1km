// Smoke test of the trip planner and transfer judgment on the 회기역–경희대 scenarios: node tools/test_core.js
import fs from 'fs';
import { Planner } from '../app/js/core/router.js';
import { judge } from '../app/js/core/transfer.js';
const J = f => JSON.parse(fs.readFileSync(new URL(`../app/data/${f}`, import.meta.url)));
const t0 = Date.now();
const planner = new Planner({ net: J('network.json'), hubs: J('hubs.json'), transit: J('transit.json') });
console.log('planner ready', Date.now() - t0, 'ms');
const H = Object.fromEntries(planner.hubs.filter(h => h.code).map(h => [h.code, h]));
const show = (label, r) => {
  console.log(`\n== ${label} (hour ${r.hour}, night ${r.night})`);
  console.log(' walk:', r.walk && `${(r.walk.len).toFixed(0)} m, ${(r.walk.sec / 60).toFixed(1)} min, lit ${(r.walk.litShare * 100).toFixed(0)}%`);
  if (r.pm) {
    const p = r.pm;
    console.log(` PM: ${p.startHub?.name} → ${p.endHub?.name}; ride ${p.safe.len.toFixed(0)} m ${(p.safe.sec / 60).toFixed(1)} min; total ${p.totalMin.toFixed(1)} min; grades`, Object.fromEntries(Object.entries(p.safe.byGrade).map(([k, v]) => [k, Math.round(v)])));
    console.log('  segs:', p.safe.segs.map(s => `${s.name} ${Math.round(s.len)}m ${s.grade}/${s.speed}${s.reasons.length ? ' [' + s.reasons.join('; ') + ']' : ''}`).join(' → '));
    if (p.fast) console.log(`  fastest: ${p.fast.len.toFixed(0)} m ${(p.fast.sec / 60).toFixed(1)} min grades`, Object.fromEntries(Object.entries(p.fast.byGrade).map(([k, v]) => [k, Math.round(v)])));
    console.log('  avoided:', p.avoided.map(a => `${a.grade}:${a.reason}`).join(' | '));
  } else console.log(' PM blocked:', r.pmBlocked);
  if (r.bus) console.log(` bus: ${r.bus.route.no} ${r.bus.from.name}→${r.bus.to.name} total ${r.bus.total.toFixed(1)} min (wait ${r.bus.waitMin}, ride ${r.bus.rideMin.toFixed(1)}), running ${r.bus.running} last ${r.bus.lastText}`);
  if (r.taxi) console.log(` taxi: ${r.taxi.km.toFixed(1)} km ${r.taxi.min.toFixed(0)} min`);
  console.log(' recommend:', r.recommend);
};
let t = Date.now();
const a = planner.plan({ from: { lat: H.H1.lat, lon: H.H1.lon }, to: { lat: H.H3.lat + 0.0003, lon: H.H3.lon }, hour: 8 });
show('시나리오 A 08시 회기역 → 캠퍼스 상부', a); console.log(' plan ms', Date.now() - t);
t = Date.now();
const b = planner.plan({ from: { lat: H.H1.lat, lon: H.H1.lon }, to: { lat: 37.5985, lon: 127.0640 }, hour: 23 });
show('시나리오 B 23시 회기역 → 이문동 주택가', b); console.log(' plan ms', Date.now() - t);
const c = planner.plan({ from: { lat: H.H3.lat, lon: H.H3.lon }, to: { lat: H.H1.lat, lon: H.H1.lon }, hour: 17 });
show('역방향 17시 캠퍼스 상부 → 회기역', c);
const d = planner.plan({ from: { lat: 37.5805, lon: 127.0472 }, to: { lat: 37.5745, lon: 127.0560 }, hour: 19 });
show('청량리역 → 전농동', d);

const now = new Date(2026, 9, 14, 8, 40);
const add = m => new Date(now.getTime() + m * 60000);
const base = { direction: 'toPm', tagTime: now, rentTime: add(3), returnTime: add(9), rentPos: H.H1, returnPos: { lat: H.H2.lat + 0.00005, lon: H.H2.lon }, rentHub: H.H1, returnHub: H.H2, photo: true, photoTime: add(9), redLinks: 0, overSpeedShare: 0, rideM: 900, todayCount: 0, linked: true };
const at = (h, m) => new Date(2026, 9, 14, h, m);
for (const [label, trip] of [
  ['정책안 예시 08:40→08:49 안전', base], ['헬멧 인증', { ...base, helmet: true }], ['거점 밖 22m', { ...base, returnPos: { lat: H.H2.lat + 0.00033, lon: H.H2.lon } }], ['사진 없음', { ...base, photo: false }],
  ['적색 1곳 통과', { ...base, redLinks: 1 }], ['태그 40분 후', { ...base, rentTime: add(40), returnTime: add(48) }], ['2.4 km 상한 초과', { ...base, rideM: 2400 }],
  ['같은 거점 왕복', { ...base, returnHub: H.H1, returnPos: H.H1, rideM: 120, returnTime: add(4) }], ['C급끼리', { ...base, rentHub: H.H4, rentPos: H.H4, returnHub: { ...H.H4, id: 'x', grade: 'C' }, returnPos: H.H4 }],
  ['야간 23:10 (H1 야간 안심)', { ...base, tagTime: at(23, 10), rentTime: at(23, 12), returnTime: at(23, 20), photoTime: at(23, 20) }],
  ['심야 01:30', { ...base, tagTime: at(1, 30), rentTime: at(1, 32), returnTime: at(1, 40), photoTime: at(1, 40) }],
  ['계정 미연동', { ...base, linked: false }], ['역방향 대기', { ...base, direction: 'toTransit', tagTime: null }],
]) { const r = judge(trip); console.log(`judge ${label}: ${r.levelName} ${r.won}원 ${r.mileage}M | unmet: ${r.unmet.join(', ')}`); }

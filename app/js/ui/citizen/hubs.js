// 시민 앱 · 거점: 환승거점 목록과 상세(등급, 주차면, 업체별 가용 기기, 야간 안심 여부, 주변 대중교통).
import { h, clear, fmtM, fmtN, toast } from '../dom.js';
import { state, set, hour, isNight } from '../../state.js';
import { metres } from '../../core/graph.js';

// 정책안 3장 '환승거점 등급'
const GRADE_TEXT = { A: 'A 역 환승거점', B: 'B 목적지 거점', C: 'C 보조거점' };
const GRADE_SPEC = { A: '주차면 30 · 조명 · CCTV · 공유 헬멧 · 바닥 표시 — 오전 7~9시 가용 대수 유지', B: '주차면 20 · 조명 — 오후 5~7시 가용 대수 유지', C: '주차면 10 내외 — 방치 점검' };
const VENDORS = ['지쿠', '스윙', '킥고잉', '일레클'];

// Device counts are demo values (deterministic per hub & hour) until the TAGO shared-PM API is connected.
export function demoAvailability(hub, hr) {
  let s = 0; for (const ch of hub.id) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const base = hub.grade === 'A' ? 5 : hub.grade === 'B' ? 3 : 1.5;
  const peak = (hr >= 7 && hr <= 9) || (hr >= 17 && hr <= 19) ? 0.6 : (hr >= 22 || hr < 5) ? 0.8 : 1;
  const rows = VENDORS.map(v => ({ vendor: v, count: Math.max(0, Math.round(base * peak * (0.4 + rnd() * 1.2))), lightOk: rnd() > 0.15 }));
  const used = rows.reduce((a, r) => a + r.count, 0);
  return { rows, used, free: Math.max(0, hub.slots - used) };
}

export function renderHubs(app, body) {
  const { data, map } = app;
  const hubs = data.hubs.hubs;
  let filter = 'pilot';

  function draw() {
    clear(body);
    const sel = state.selectedHub ? data.hubById.get(state.selectedHub) : null;
    if (sel) body.append(detail(sel));
    const list = hubs.filter(x => filter === 'pilot' ? x.code : x.grade === filter).sort((a, b) => (a.code || 'Z').localeCompare(b.code || 'Z') || a.name.localeCompare(b.name));
    body.append(h('div.card', null,
      h('div.row-between', null, h('h3', null, '환승거점'), h('small.muted', null, `A ${hubs.filter(x => x.grade === 'A').length} · B ${hubs.filter(x => x.grade === 'B').length} · C ${hubs.filter(x => x.grade === 'C').length}곳`)),
      h('div.scenarios', null, [['pilot', '시범구간 H1–H4'], ['A', 'A 역 환승거점'], ['B', 'B 목적지'], ['C', 'C 보조']].map(([k, l]) => h('button.chip-btn', { type: 'button', 'aria-pressed': String(filter === k), style: filter === k ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : null, onclick: () => { filter = k; draw(); } }, l))),
      h('ul.list', null, list.map(x => h('li', null, h('button.btn.ghost', { type: 'button', style: { width: '100%', textAlign: 'left', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '10px', alignItems: 'center' }, onclick: () => { set({ selectedHub: x.id }); map.flyTo(x.lat, x.lon, 16.5); draw(); } },
        h('span.hub-badge.' + x.grade, { style: { width: '30px', height: '30px', fontSize: '15px' } }, x.code || x.grade),
        h('span', null, h('b', null, x.name), h('small.muted', { style: { display: 'block' } }, GRADE_TEXT[x.grade] + (x.nightSafe ? ' · 야간 안심' : '') + (x.arriveOnly ? ' · 도착 전용' : '') + (x.nightBus ? ' · 심야버스' : ''))),
        h('small.muted', null, `${x.slots}면`))))),
      h('small.muted', null, '정책안 3장 기준: A는 역 출구, B는 대학·병원 입구와 버스 승차 상위 정류장, C는 기존 따릉이 대여소 자리입니다. 야간 안심거점은 A·B 중 조명과 CCTV(50 m 안)가 확인된 곳입니다. 환승 인정은 출발·반납 중 한 곳 이상이 A·B급이어야 합니다.')));
  }

  function detail(hb) {
    const hr = hour(); const av = demoAvailability(hb, hr); const night = isNight();
    const stops = data.transit.busStops.filter(b => metres(hb.lat, hb.lon, b.lat, b.lon) < 200).slice(0, 4);
    const bike = data.bike.stations.find(s => metres(hb.lat, hb.lon, s.lat, s.lon) < 30);
    const corridorFrom = data.hubs.corridors.filter(c => hb.code && (c.from === hb.code || c.to === hb.code));
    const setTrip = which => { state.trip = { ...(state.trip || {}), [which]: { lat: hb.lat, lon: hb.lon, label: hb.code ? `${hb.code} ${hb.name}` : hb.name }, plan: null, profile: state.trip?.profile || 'pm' }; app.goTab('route'); };
    const station = data.transit.stations.find(s => s.name === hb.station);
    const wcExits = station ? station.entrances.filter(e => e.wheelchair === 'yes').map(e => e.ref).filter(Boolean) : [];
    return h('section.hero', null,
      h('div.hub-head', null, h('span.hub-badge.' + hb.grade, null, hb.code || hb.grade), h('div', null, h('h3', { style: { fontSize: '18px' } }, hb.name), h('small.muted', null, GRADE_TEXT[hb.grade]))),
      h('div.hero-checks', null,
        h('span.check', null, `빈 자리 ${av.free} / ${hb.slots}`),
        h('span.check', null, `기기 ${av.used}대`),
        hb.nightSafe ? h('span.check.good', null, '야간 안심') : null,
        wcExits.length ? h('span.check.good', null, `휠체어 출구 ${wcExits.join('·')}번`) : null),
      hb.note ? h('p.hero-sub', null, hb.note) : null,
      h('div.btn-row', null,
        h('button.btn.primary', { type: 'button', disabled: !!hb.arriveOnly, onclick: () => setTrip('from') }, hb.arriveOnly ? '도착 전용 거점' : '여기서 출발'),
        h('button.btn', { type: 'button', onclick: () => setTrip('to') }, '여기로 도착'),
        h('button.btn.ghost', { type: 'button', onclick: () => { set({ selectedHub: null }); draw(); } }, '닫기')),
      h('details.more', null, h('summary', null, '업체별 기기'),
        h('div', null, ...av.rows.map(r => h('div.vendor-row', null, h('span', null, r.vendor), h('span.num', null, `${r.count}대`), night ? h('small', { style: { color: r.lightOk ? 'var(--g)' : 'var(--r)' } }, r.lightOk ? '전조등 정상' : '전조등 점검 필요') : h('button.btn.small', { type: 'button', disabled: !r.count, onclick: () => toast(`${r.vendor} 앱으로 이동해 대여합니다 (시연)`) }, '대여'))),
          h('small.muted', null, '기기 수는 시연 값입니다. TAGO 실시간 위치 API를 연결하면 실제 수로 바뀝니다.'))),
      stops.length || bike ? h('details.more', null, h('summary', null, '주변 대중교통'),
        h('ul.list', null, stops.map(s => h('li', null, h('b', null, s.name), h('small.muted', null, ' ' + (s.routes.slice(0, 6).join(', ') || '노선 정보 없음'))))),
        bike ? h('p.muted', null, `따릉이 대여소 하루 평균 ${fmtN(bike.estTripsPerDay, 1)}회 대여`) : null) : null,
      corridorFrom.length ? h('details.more', null, h('summary', null, '시범 환승구간'), h('ul.list', null, corridorFrom.map(c => h('li', null, h('b', null, c.name), h('small.muted', { style: { display: 'block' } }, c.speedNote))))) : null,
      h('details.more', null, h('summary', null, '거점 기준'), h('p.muted', null, GRADE_SPEC[hb.grade])));
  }

  if (state.selectedHub) { const s = data.hubById.get(state.selectedHub); if (s) map.flyTo(s.lat, s.lon, 16.5); }
  draw();
  return { refresh: draw };
}

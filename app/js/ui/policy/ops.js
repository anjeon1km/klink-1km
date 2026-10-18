// 정책 대시보드 · 운영 현황(구청 담당자): 구간 등급, 위험 구간, 거점 반납, 제보, 환승 판정, 이용·대중교통 데이터.
import { h, clear, fmtN, fmtM, fmtDate } from '../dom.js';
import { hourlyChart, barList } from '../charts.js';
import { store } from '../../store.js';
import { isNight } from '../../state.js';
import { F, linkReasons } from '../../core/grading.js';
import { LEVEL } from '../../core/transfer.js';
import { REPORT_CATS } from '../citizen/report.js';

export function renderOps(app, body) {
  const { data, map } = app;
  const net = data.network, L = net.links;
  let rides = [], reports = [], dongSel = '회기동';
  // link → 행정동 via the grid cell of its midpoint
  const CELL = data.grid.cell; const LAT0 = 37.585, LON0 = 127.05, MY = 110950, MX = 111320 * Math.cos(LAT0 * Math.PI / 180);
  const dongOfLink = i => { const la = (net.nodes.lat[L.a[i]] + net.nodes.lat[L.b[i]]) / 2, lo = (net.nodes.lon[L.a[i]] + net.nodes.lon[L.b[i]]) / 2; return data.cellById.get(`${Math.floor((lo - LON0) * MX / CELL)}_${Math.floor((la - LAT0) * MY / CELL)}`)?.dong; };

  function draw() {
    clear(body);
    const night = isNight(); const grades = night ? map.gNight : map.gDay;
    // 0. 시범구간 현황: 정책안 1장 수치를 이 앱의 데이터로 다시 계산
    const facts = data.models?.pilotFacts || [];
    if (facts.length) {
      const valueText = f => `${typeof f.value === 'number' ? fmtN(f.value, f.value % 1 ? 1 : 0) : f.value}${f.unit ? ' ' + f.unit : ''}`;
      const row = f => h('tr', null,
        h('td', { style: { whiteSpace: 'normal', minWidth: '120px' } }, f.key, h('small.muted', { style: { display: 'block' } }, f.note)),
        h('td.n', { style: { whiteSpace: 'normal' } }, valueText(f)),
        h('td', { style: { whiteSpace: 'normal', color: 'var(--muted)' } }, f.doc));
      body.append(h('div.card', null,
        h('h3', null, '시범구간 회기역–경희대 현황'),
        h('small.muted', null, '정책안 1장에 적힌 수치를 이 앱이 쓰는 원자료로 다시 계산했습니다. 기간·기준이 다르면 값이 조금 다릅니다.'),
        h('div.table-wrap', null, h('table.tbl', null,
          h('thead', null, h('tr', null, ['항목', '이 앱', '정책안'].map(t => h('th', null, t)))),
          h('tbody', null, facts.map(row))))));
    }
    // 1. grades by dong
    const byDong = {};
    for (let i = 0; i < L.a.length; i++) { if (!(L.flags[i] & F.PM)) continue; const d = dongOfLink(i); if (!d) continue; const o = (byDong[d] ??= { G: 0, Y: 0, R: 0 }); o[grades[i]] += L.len[i]; }
    const tot = Object.values(byDong).reduce((a, o) => ({ G: a.G + o.G, Y: a.Y + o.Y, R: a.R + o.R }), { G: 0, Y: 0, R: 0 });
    body.append(h('div.card', null,
      h('h3', null, `PM 통행 구간 등급 ${night ? '(야간)' : '(주간)'}`),
      h('div.stat-row', null, ['G', 'Y', 'R'].map(g => h('div.stat', null, h('small', null, { G: '녹색', Y: '황색', R: '적색' }[g]), h('b', null, fmtM(tot[g])), h('small', null, `${Math.round(tot[g] / (tot.G + tot.Y + tot.R) * 100)}%`)))),
      h('div.stack', null, Object.entries(byDong).sort((a, b) => (b[1].R + b[1].Y) / (b[1].G + b[1].Y + b[1].R) - (a[1].R + a[1].Y) / (a[1].G + a[1].Y + a[1].R)).map(([d, o]) => {
        const t = o.G + o.Y + o.R;
        return h('div', { style: { display: 'grid', gridTemplateColumns: '72px 1fr 44px', gap: '8px', alignItems: 'center', fontSize: '12.5px' } }, h('span', null, d),
          h('span.bar-grades', null, ['G', 'Y', 'R'].map(g => h('span', { style: { width: `${o[g] / t * 100}%`, background: `var(--${g.toLowerCase()})` }, title: `${d} ${g} ${fmtM(o[g])}` }))), h('span.num', { style: { textAlign: 'right' } }, `${Math.round((o.Y + o.R) / t * 100)}%`));
      })),
      h('small.muted', null, '오른쪽 숫자는 황색+적색 비율입니다.')));

    // 2. red segments by road
    const ctx = { night, overrides: data.planner.overrides, hotspots: data.planner.hotspots };
    const red = {};
    for (let i = 0; i < L.a.length; i++) {
      if (grades[i] !== 'R') continue;
      const nm = L.name[i] >= 0 ? net.names[L.name[i]] : '이름 없는 길';
      const o = (red[nm + '|' + (dongOfLink(i) || '')] ??= { name: nm, dong: dongOfLink(i) || '구 경계', len: 0, i, reasons: new Map() });
      o.len += L.len[i];
      // one entry per reason type, keeping the largest number seen (e.g. the steepest slope)
      for (const r of [...linkReasons(net, i, 1, ctx), ...linkReasons(net, i, -1, ctx)]) {
        const text = r.replace(/\s*\(기준.*\)/, '').trim(); const key = text.replace(/[\d.]+/g, '#'); const num = parseFloat(text.match(/[\d.]+/)?.[0] || '0');
        const prev = o.reasons.get(key); if (!prev || num > prev.num) o.reasons.set(key, { text, num });
      }
    }
    const redTop = Object.values(red).sort((a, b) => b.len - a.len).slice(0, 10);
    body.append(h('div.card', null, h('h3', null, '적색 구간 상위 (현장 점검 목록)'),
      h('div.table-wrap', null, h('table.tbl', null, h('thead', null, h('tr', null, ['도로', '행정동', '길이', '사유'].map(t => h('th', null, t)))),
        h('tbody', null, redTop.map(o => h('tr', { 'data-cell': '1', onclick: () => { const la = net.nodes.lat[L.a[o.i]], lo = net.nodes.lon[L.a[o.i]]; map.flyTo(la, lo, 17); } }, h('td', null, o.name), h('td', null, o.dong), h('td.n', null, fmtM(o.len)), h('td', { style: { whiteSpace: 'normal', minWidth: '140px' } }, [...o.reasons.values()].slice(0, 2).map(r => r.text).join(' · ')))))))));

    // 3. transfers & hub returns (from ride records)
    const trips = rides.filter(r => r.level);
    const lv = {}; trips.forEach(r => { lv[r.level] = (lv[r.level] || 0) + 1; });
    const unmet = {}; trips.forEach(r => (r.unmet || []).forEach(u => { const k = u.replace(/\d+/g, '#'); unmet[k] = (unmet[k] || 0) + 1; }));
    const hubRet = {}; trips.forEach(r => { if (!r.to) return; const o = (hubRet[r.to] ??= { n: 0, safe: 0 }); o.n++; if (['safe', 'night'].includes(r.level)) o.safe++; });
    // 성과 지표 (정책안 9장) — 판정 기록에서 바로 계산
    if (trips.length) {
      const ok = trips.filter(r => ['basic', 'safe', 'night'].includes(r.level));
      const kpi = (label, v, target, good) => h('div.stat', null, h('small', null, label), h('b', { style: { color: target == null ? 'inherit' : good ? 'var(--g)' : 'var(--r)' } }, v), target != null ? h('small', null, target) : null);
      const atHub = trips.filter(r => r.atHub !== false).length / trips.length;
      const red = trips.filter(r => (r.red || 0) > 0).length / trips.length;
      body.append(h('div.card', null, h('h3', null, '시범사업 성과 지표'),
        h('div.stat-row', null,
          kpi('거점 반납률', `${Math.round(atHub * 100)}%`, '목표 80% 이상', atHub >= 0.8),
          kpi('환승 인정 비중', `${Math.round(ok.length / trips.length * 100)}%`, '매달 증가', null),
          kpi('적색 구간 통행 비중', `${Math.round(red * 100)}%`, '감소', red === 0),
          kpi('야간 환승 인정', `${trips.filter(r => r.nightBenefit).length}건`, '22~01시', null)),
        h('small.muted', null, '정책안 9장 지표 중 앱 기록으로 계산되는 것만 보입니다. 방치 민원·견인, 사고, 대체 수단 설문은 구청·업체·TAAS 자료로 채웁니다.')));
    }
    body.append(h('div.card', null, h('h3', null, `환승 판정 기록 ${trips.length}건`),
      trips.length ? h('div.stack', null,
        barList({ items: Object.entries(LEVEL).filter(([k]) => lv[k]).map(([k, v]) => ({ label: v.name, value: lv[k] })), fmt: v => `${v}건` }),
        Object.keys(unmet).length ? h('div.stack', null, h('h4', null, '안전 환승을 못 받은 이유'), barList({ items: Object.entries(unmet).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ label: k, value: v })), fmt: v => `${v}건`, color: 'var(--cat-2)' })) : null,
        h('h4', null, '거점별 반납'), h('ul.list', null, Object.entries(hubRet).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([id, o]) => h('li', null, h('b', null, data.hubById.get(id)?.name || id), h('small.muted', null, ` 반납 ${o.n}건 · 안전 반납률 ${Math.round(o.safe / o.n * 100)}%`)))))
        : h('p.empty', null, '시민 앱의 주행 탭에서 반납까지 마치면 판정 기록이 여기에 모입니다.'),
      h('small.muted', null, store.mode === 'local' ? '이 브라우저의 기록만 보입니다.' : '팀 공유 저장소의 기록입니다. 개인을 알아볼 수 없는 구간·거점 단위로만 집계합니다.')));

    // 4. reports
    const rc = {}; reports.forEach(r => { rc[r.cat] = (rc[r.cat] || 0) + 1; });
    body.append(h('div.card', null, h('h3', null, `시민 제보 ${reports.length}건`),
      reports.length ? barList({ items: Object.entries(rc).map(([k, v]) => ({ label: REPORT_CATS[k]?.name || k, value: v, note: REPORT_CATS[k]?.hint })), fmt: v => `${v}건`, color: 'var(--cat-2)' }) : h('p.empty', null, '아직 제보가 없습니다.'),
      reports.slice(0, 5).map(r => h('small', { style: { display: 'block' } }, `${fmtDate(r.at)} · ${REPORT_CATS[r.cat]?.name || r.cat}${r.note ? ' — ' + r.note : ''}`))));

    // 5. shared mobility use
    const bike = data.bike; const d = bike.dongs.find(x => x.name === dongSel) || bike.dongs[0];
    body.append(h('div.card', null,
      h('div.row-between', null, h('h3', null, '공유모빌리티 이용 (따릉이)'),
        h('select.input', { id: 'ops-dong', style: { width: 'auto' }, onchange: e => { dongSel = e.target.value; draw(); } }, bike.dongs.map(x => h('option', { value: x.name, selected: x.name === d.name }, x.name)))),
      h('small.muted', null, `${bike.period.from.slice(4, 6)}/${bike.period.from.slice(6)}–${bike.period.to.slice(4, 6)}/${bike.period.to.slice(6)} · 평일 ${fmtN(bike.period.weekdays, 1)}일·주말/공휴일 ${fmtN(bike.period.weekendHolidays, 1)}일 환산 평균. 출발 시각 기준 하루 평균 대여.`),
      hourlyChart({ series: [{ name: '평일', values: d.depWd, color: '#2a78d6' }, { name: '주말·공휴일', values: d.depWe, color: '#eb6834' }], unit: '회', title: `${d.name} 시간대별 대여` }),
      h('dl.kv', null, h('dt', null, '하루 대여'), h('dd', null, `${fmtN(d.tripsPerDay, 1)}회`), h('dt', null, '야간(22~05시) 비중'), h('dd', null, `${Math.round(d.nightShare * 100)}%`), h('dt', null, '평균 거리 · 시간'), h('dd', null, `${fmtM(d.avgDistM)} · ${d.avgMin}분`), h('dt', null, '동대문구 안 도착 비율'), h('dd', null, `${Math.round(d.withinDdmShare * 100)}%`)),
      h('h4', null, '행정동별 야간 이용 비중'),
      barList({ items: bike.dongs.slice().sort((a, b) => b.nightShare - a.nightShare).map(x => ({ label: x.name, value: x.nightShare * 100, note: `하루 ${fmtN(x.tripsPerDay, 1)}회` })), fmt: v => `${fmtN(v, 0)}%`, max: 30, onClick: it => { dongSel = it.label; draw(); } }),
      h('h4', null, '이동 거리 분포 (동대문구 관련 통행)'),
      (() => { const e = bike.distanceBins.edges, c = bike.distanceBins.counts, t = c.reduce((a, b) => a + b, 0); return barList({ items: c.map((v, i) => ({ label: i < e.length - 1 ? `${fmtM(e[i])}–${fmtM(e[i + 1])}` : `${fmtM(e[i])} 이상`, value: v / t * 100 })), fmt: v => `${fmtN(v, 1)}%` }); })(),
      h('small.muted', null, '공유 전동킥보드 통행 OD는 공개되지 않아(TAGO는 실시간 위치만 제공) 공공자전거 이용을 대리지표로 씁니다.')));

    // 6. transit
    const hoegi = data.transit.stations.find(s => s.name === '회기')?.ridership;
    const v01 = data.transit.village.find(v => v.route === '동대문01');
    body.append(h('div.card', null, h('h3', null, '시범구간 대중교통'),
      hoegi ? [h('h4', null, `회기역 ${hoegi.lines.join('·')} 시간대별 승하차 (${hoegi.month.slice(0, 4)}.${hoegi.month.slice(4)}, 월 합계)`),
        hourlyChart({ series: [{ name: '승차', values: hoegi.on, color: '#2a78d6' }, { name: '하차', values: hoegi.off, color: '#eb6834' }], unit: '명', title: '회기역 시간대별 승하차' })] : null,
      v01 ? [h('h4', null, `마을버스 동대문01 정류장별 하루 평균 (${v01.from.slice(4, 6)}/${v01.from.slice(6)}–${v01.to.slice(4, 6)}/${v01.to.slice(6)})`),
        barList({ items: v01.stops.map(s => ({ label: `${s.seq}. ${s.name}`, value: s.perDayOn, note: `하차 ${fmtN(s.perDayOff)}명` })), fmt: v => `승차 ${fmtN(v)}명` }),
        h('small.muted', null, '회기역과 캠퍼스 사이 마지막 1 km가 이 한 노선에 기대고 있습니다 (정책제안서 Ⅱ-5).')] : null));
  }
  const u1 = store.subscribe('rides', l => { rides = l; draw(); });
  const u2 = store.subscribe('reports', l => { reports = l.filter(r => r.cat); draw(); });
  return { refresh: draw, dispose: () => { u1(); u2(); } };
}

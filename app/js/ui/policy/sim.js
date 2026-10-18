// 정책 대시보드 · 시뮬레이터: 대상 지역을 고르고 정책을 조합해 PTVI·NIGHT-TVI·유형·탄소 변화를 비교합니다.
import { h, clear, fmtN } from '../dom.js';
import { state, set } from '../../state.js';
import { INTERVENTIONS, simulate, classifyCell, annualCo2, breakEvenCarShare, TYPES } from '../../core/analysis.js';
import { PARAMS } from '../../core/params.js';
import { metres } from '../../core/graph.js';
import { typeColor } from './vuln.js';

export function renderSim(app, body) {
  const { data, map } = app;
  const cells = data.grid.cells.filter(c => !c.excluded);
  const H1 = data.pilot.H1;
  const groups = {
    cell: { name: '선택한 격자', pick: () => cells.filter(c => c.id === state.selectedCell) },
    pilot: { name: '시범지역: 회기역 반경 1 km', pick: () => cells.filter(c => metres(c.lat, c.lon, H1.lat, H1.lon) <= 1000) },
    E: { name: 'E형 종합취약 격자 전체', pick: () => cells.filter(c => c.type === 'E') },
    B: { name: 'B형 PM 의존 격자 전체', pick: () => cells.filter(c => c.type === 'B') },
    C: { name: 'C형 대중교통 고립 격자 전체', pick: () => cells.filter(c => c.type === 'C') },
    all: { name: '동대문구 전체', pick: () => cells },
  };
  const s = { target: state.selectedCell ? 'cell' : 'pilot', picks: new Set(['hub', 'light']), mult: 1.0, improved: false, vulnerable: true, daily: 125, avgBenefit: PARAMS.pilot.avgBenefit, days: PARAMS.pilot.semesterDays };

  function compute() {
    const tg = groups[s.target].pick();
    const res = tg.map(c => ({ c, r: simulate(c, [...s.picks]) }));
    const avg = f => res.length ? res.reduce((a, o) => a + f(o), 0) / res.length : 0;
    const before = { ptvi: avg(o => o.c.ptvi), night: avg(o => o.c.nightTvi), A: avg(o => o.c.comp.A), R: avg(o => o.c.comp.R), D: avg(o => o.c.comp.D), C: avg(o => o.c.comp.C), Rn: avg(o => o.c.compN.R) };
    const after = { ptvi: avg(o => o.r.ptvi), night: avg(o => o.r.nightTvi), A: avg(o => o.r.comp.A), R: avg(o => o.r.comp.R), D: avg(o => o.r.comp.D), C: avg(o => o.r.comp.C), Rn: avg(o => o.r.compN.R) };
    const typeAfter = res.map(o => classifyCell(o.r.comp, o.c.puiPct));
    const changed = res.filter((o, i) => typeAfter[i] !== o.c.type).length;
    const trips = res.reduce((a, o) => a + o.c.pui, 0) * s.mult;
    const base = s.vulnerable ? PARAMS.carbon.replaceVulnerable.car : PARAMS.carbon.replace.car;
    const carShare = base + (s.picks.has('fare') ? INTERVENTIONS.fare.effect.carShare : 0);
    const ef = s.improved ? PARAMS.carbon.ef.pmImproved : PARAMS.carbon.ef.pmNow;
    return { tg, before, after, changed, typeAfter, trips, carShare, co2: annualCo2(trips, carShare, ef), co2Base: annualCo2(trips, base, ef), be: breakEvenCarShare(PARAMS.carbon.replace.transit, ef), ef };
  }

  function draw() {
    clear(body);
    const r = compute();
    map.showGrid(data.grid.cells, c => (r.tg.some(t => t.id === c.id) ? typeColor(c.type) : null), c => (r.tg.some(t => t.id === c.id) ? c.type : null), c => { set({ selectedCell: c.id }); s.target = 'cell'; draw(); }, state.selectedCell);
    body.append(h('div.card', null,
      h('h3', null, '정책 시뮬레이터'),
      h('div.field', null, h('label', { for: 'sim-target' }, '대상 지역'),
        h('select.input', { id: 'sim-target', onchange: e => { s.target = e.target.value; draw(); } }, Object.entries(groups).filter(([k]) => k !== 'cell' || state.selectedCell).map(([k, g]) => h('option', { value: k, selected: s.target === k }, `${g.name}${k === 'cell' ? ` (${data.cellById.get(state.selectedCell)?.dong})` : ''}`)))),
      h('small.muted', null, `대상 격자 ${r.tg.length}개${r.tg.some(c => c.pop != null) ? ` · 인구 ${fmtN(r.tg.reduce((a, c) => a + (c.pop || 0), 0))}명 (2024 SGIS)` : ''} · 지도에서 격자를 누르면 그 격자를 대상으로 바꿉니다.`),
      h('div.stack', null, Object.entries(INTERVENTIONS).map(([k, v]) => h('label.check-row', { for: `iv-${k}`, style: { alignItems: 'flex-start' } },
        h('input', { type: 'checkbox', id: `iv-${k}`, checked: s.picks.has(k), onchange: e => { e.target.checked ? s.picks.add(k) : s.picks.delete(k); draw(); } }),
        h('span', null, h('b', null, v.name), h('small.muted', { style: { display: 'block' } }, v.desc)))))));

    const delta = (a, b) => { const d = b - a; return h('span', { style: { color: d < -0.05 ? 'var(--g)' : d > 0.05 ? 'var(--r)' : 'var(--muted)', fontWeight: 600 } }, `${d > 0 ? '+' : ''}${fmtN(d, 1)}`); };
    body.append(h('div.card', null,
      h('h3', null, '결과'),
      h('div.stat-row', null,
        h('div.stat', null, h('small', null, 'PTVI 평균'), h('b', null, `${fmtN(r.before.ptvi, 1)} → ${fmtN(r.after.ptvi, 1)}`), delta(r.before.ptvi, r.after.ptvi)),
        h('div.stat', null, h('small', null, 'NIGHT-TVI 평균'), h('b', null, `${fmtN(r.before.night, 1)} → ${fmtN(r.after.night, 1)}`), delta(r.before.night, r.after.night))),
      h('div.comp-bars', null, [['A', 'A 접근성'], ['R', 'R 위험'], ['Rn', 'R 야간위험'], ['D', 'D 공백'], ['C', 'C 전환']].map(([k, l]) => h('div.comp-bar', null, h('span', null, l),
        h('span.track', null, h('span.fill', { style: { width: `${r.before[k]}%`, opacity: 0.45 } }), h('span.fill.after', { style: { width: `${r.after[k]}%` } })), h('span.num', null, fmtN(r.after[k], 0))))),
      h('div.legend', null, h('span', null, h('i', { style: { background: 'var(--seq-5)', opacity: 0.45 } }), '현재'), h('span', null, h('i', { style: { background: 'var(--g)' } }), '정책 후')),
      h('p', null, `유형이 바뀌는 격자 ${r.changed}개`, r.changed ? ` (예: ${r.tg.map((c, i) => c.type !== r.typeAfter[i] ? `${c.dong} ${c.type}→${r.typeAfter[i]}` : null).filter(Boolean).slice(0, 3).join(', ')})` : '')));

    body.append(h('div.card', null,
      h('h3', null, '탄소 감축 추정'),
      h('div.field', null, h('label', { for: 'sim-mult' }, `공유 PM 연계 통행 = 따릉이 이용 × ${s.mult.toFixed(1)}`), h('input', { type: 'range', id: 'sim-mult', min: 0.5, max: 3, step: 0.1, value: s.mult, oninput: e => { s.mult = +e.target.value; draw(); } })),
      h('label.check-row', { for: 'sim-vuln' }, h('input', { type: 'checkbox', id: 'sim-vuln', checked: s.vulnerable, onchange: e => { s.vulnerable = e.target.checked; draw(); } }), '교통취약지역 가정 (승용차·택시 대체 50%, 아니면 37%)'),
      h('label.check-row', { for: 'sim-ef' }, h('input', { type: 'checkbox', id: 'sim-ef', checked: s.improved, onchange: e => { s.improved = e.target.checked; draw(); } }), '수명주기 관리 의무화 (내구연한 2배·재배치 전동화: 125.5 → 67.2 g/km)'),
      h('dl.kv', null,
        h('dt', null, '하루 PM 연계 통행 (추정)'), h('dd', null, `${fmtN(r.trips, 0)}회`),
        h('dt', null, '승용차·택시 대체율'), h('dd', null, `${Math.round(r.carShare * 100)}%`),
        h('dt', null, '손익분기 대체율'), h('dd', null, `${Math.round(r.be * 100)}%`),
        h('dt', null, '연간 CO₂ (정책 후)'), h('dd', null, h('b', { style: { color: r.co2 >= 0 ? 'var(--g)' : 'var(--r)' } }, `${r.co2 >= 0 ? '−' : '+'}${fmtN(Math.abs(r.co2), 1)} t`)),
        h('dt', null, '통합요금 없을 때'), h('dd', null, `${r.co2Base >= 0 ? '−' : '+'}${fmtN(Math.abs(r.co2Base), 1)} t`)),
      h('small.muted', null, `순감축 = Σ(대체수단 비중 × 배출계수) − PM 배출계수(${r.ef} g/인·km), 평균 ${PARAMS.carbon.pmAvgKm} km × 365일. 승용차 257.2, 버스 51.0 g/인·km (정책제안서 표 6). PM 이용량을 늘리는 것만으로는 감축이 되지 않으며, 대체율이 손익분기를 넘어야 줄어듭니다.`)),
      h('div.note', null, '개입별 효과 크기는 시범사업 전후 비교로 보정해야 할 가정값입니다. 값은 app/js/core/analysis.js의 INTERVENTIONS에서 바꿀 수 있습니다.'));

    // 시범사업 할인 예산 (정책안 4장): 하루 환승 인정 건수 × 평균 혜택 × 학기 중 평일, 구 부담 50%
    const total = s.daily * s.avgBenefit * s.days, gu = total * PARAMS.pilot.guShare;
    const lo = PARAMS.pilot.dailyRecognized[0] * s.avgBenefit * s.days, hi = PARAMS.pilot.dailyRecognized[1] * s.avgBenefit * s.days;
    body.append(h('div.card', null,
      h('h3', null, '시범사업 할인 예산'),
      h('div.field', null, h('label', { for: 'bud-daily' }, `하루 환승 인정 ${s.daily}건`), h('input', { type: 'range', id: 'bud-daily', min: 50, max: 300, step: 5, value: s.daily, oninput: e => { s.daily = +e.target.value; draw(); } })),
      h('div.field', null, h('label', { for: 'bud-avg' }, `평균 혜택 ${s.avgBenefit.toLocaleString()}원`), h('input', { type: 'range', id: 'bud-avg', min: 400, max: 1500, step: 50, value: s.avgBenefit, oninput: e => { s.avgBenefit = +e.target.value; draw(); } })),
      h('dl.kv', null,
        h('dt', null, '학기 중 평일'), h('dd', null, `${s.days}일`),
        h('dt', null, '할인 지원 총액'), h('dd', null, h('b', null, `${fmtN(total / 10000)}만 원`)),
        h('dt', null, `구 부담 (${Math.round(PARAMS.pilot.guShare * 100)}%, 나머지 업체)`), h('dd', null, `${fmtN(gu / 10000)}만 원`),
        h('dt', null, '정책안 범위 (하루 100~150건)'), h('dd', null, `${fmtN(lo / 10000)}만 ~ ${fmtN(hi / 10000)}만 원`)),
      h('small.muted', null, '거점 시설비(바닥 도색·조명·CCTV)는 별도입니다. 같은 예산으로 마을버스 막차 연장·오전 증편을 했을 때와 비교해 평가합니다(정책안 9장).')));
  }
  draw();
  return { refresh: draw, dispose: () => map.clearGrid() };
}

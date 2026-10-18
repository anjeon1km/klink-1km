// 정책 대시보드 · 취약지도: 250 m 격자 PTVI / NIGHT-TVI / 구성요소 지도, 순위, 격자 상세(취약요인 분해·정책 패키지).
import { h, clear, fmtN, fmtM } from '../dom.js';
import { seqColor, rampLegend, barList } from '../charts.js';
import { state, set, isNight } from '../../state.js';
import { TYPES, TYPE_ORDER, QUADS } from '../../core/analysis.js';
import { PARAMS } from '../../core/params.js';

export const METRICS = {
  ptvi: { name: 'PTVI (주간)', get: c => c.ptvi, desc: 'PM–대중교통 환승취약지수 = 0.30A + 0.30R + 0.20D + 0.20C' },
  nightTvi: { name: 'NIGHT-TVI (야간)', get: c => c.nightTvi, desc: '야간 구성요소(22~24시 대중교통, 조명 반영 위험, 야간 이용)로 다시 계산한 지수' },
  A: { name: 'A 접근성 부족', get: c => c.comp?.A, desc: '역·정류장까지 실제 보행시간(경사 반영)과 대중교통 접근성지수(TAI)의 역순위' },
  R: { name: 'R PM·보행 위험', get: c => c.comp?.R, desc: '격자 안 PM 통행 링크의 경사·횡단·교차로 위험과 적색 구간 비율' },
  D: { name: 'D 서비스 공백', get: c => c.comp?.D, desc: '주간 대비 야간 서비스 감소, 인근 버스 막차 시각, 심야버스 유무' },
  C: { name: 'C 저탄소 전환 잠재력', get: c => c.comp?.C, desc: '공유모빌리티 이용강도, 생활권 인구, 역까지 0.5~1.5 km 마지막 1 km 대역' },
  pop: { name: '인구 (2024)', get: c => c.pop, desc: '통계청 SGIS 100 m 격자 총인구를 250 m 격자로 합산 (색은 동대문구 안 상대값)', scale: true },
  type: { name: '지역 유형 (A~E)', get: c => c.type, desc: 'K-Link 1km 4장의 진단 기준' },
};
// Type colours: categorical slots + the type letter drawn in every cell (colour never carries the type alone).
const CATCOL = { E: '#d03b3b', B: '#eb6834', C: '#4a3aa7', A: '#eda100', D: '#1baf7a', N: '#b8c4d2', P: null };
export const typeColor = t => CATCOL[t];

export function renderVuln(app, body) {
  const { data, map } = app;
  const cells = data.grid.cells;
  const ranked = cells.filter(c => !c.excluded);

  const popMax = Math.max(1, ...cells.map(c => c.pop || 0));
  const paint = () => {
    const m = METRICS[state.gridMetric] || METRICS.ptvi;
    map.showGrid(cells, c => c.excluded ? null : state.gridMetric === 'type' ? typeColor(isNight() ? c.typeNight : c.type) : m.scale ? seqColor(m.get(c), 0, popMax) : seqColor(m.get(c)),
      c => (state.gridMetric === 'type' && !c.excluded ? (isNight() ? c.typeNight : c.type) : null), c => { set({ selectedCell: c.id }); draw(); paint(); }, state.selectedCell);
    const lg = document.getElementById('map-legend'); clear(lg);
    if (state.gridMetric === 'type') lg.append(h('b', null, '지역 유형'), h('div.legend', null, TYPE_ORDER.filter(t => t !== 'P').map(t => h('span', null, h('i', { style: { background: CATCOL[t] } }), `${t} ${TYPES[t].short}`)), h('span', null, h('i', { style: { background: 'transparent', border: '1px dashed var(--muted)' } }), '녹지·비거주')));
    else if (m.scale) lg.append(rampLegend(m.name, '0명', `${fmtN(popMax)}명`));
    else lg.append(rampLegend(m.name, '0 낮음', '100 높음 (동대문구 안 상대순위)'));
  };

  function draw() {
    clear(body);
    const metric = state.gridMetric;
    body.append(h('div.card', null,
      h('div.row-between', null, h('h3', null, '교통취약 진단 지도'), h('small.muted', null, `250 m 격자 ${ranked.length}개`)),
      h('div.field', null, h('label', { for: 'metric' }, '지도에 칠할 값'),
        h('select.input', { id: 'metric', onchange: e => { set({ gridMetric: e.target.value }); draw(); paint(); } }, Object.entries(METRICS).map(([k, v]) => h('option', { value: k, selected: metric === k }, v.name)))),
      h('small.muted', null, METRICS[metric].desc)));

    // 취약 인구: 취약유형(E·B·C) 격자에 사는 사람
    if (ranked.some(c => c.pop != null)) {
      const tk = isNight() ? 'typeNight' : 'type'; const totalPop = ranked.reduce((a, c) => a + (c.pop || 0), 0);
      const vp = t => ranked.filter(c => c[tk] === t).reduce((a, c) => a + (c.pop || 0), 0);
      body.append(h('div.card.soft', null, h('h4', null, `취약 유형 격자에 사는 인구 ${isNight() ? '(야간)' : ''}`),
        h('div.stat-row', null, ['E', 'B', 'C'].map(t => h('div.stat', null, h('small', null, TYPES[t].name), h('b', null, `${fmtN(vp(t))}명`), h('small', null, `${(vp(t) / totalPop * 100).toFixed(1)}%`)))),
        h('small.muted', null, `동대문구 생활권 격자 인구 ${fmtN(totalPop)}명 기준 (통계청 SGIS 2024 격자 총인구)`)));
    }
    const sel = state.selectedCell ? data.cellById.get(state.selectedCell) : null;
    if (sel) body.append(cellDetail(sel, app, () => { set({ selectedCell: null }); draw(); paint(); }));

    // ranking
    const key = metric === 'nightTvi' ? 'nightTvi' : 'ptvi';
    const top = ranked.slice().sort((a, b) => b[key] - a[key]).slice(0, 12);
    body.append(h('div.card', null, h('h3', null, `${key === 'ptvi' ? 'PTVI' : 'NIGHT-TVI'} 상위 격자`),
      h('div.table-wrap', null, h('table.tbl', null,
        h('thead', null, h('tr', null, ['순위', '행정동', '지수', '유형', '역까지'].map(t => h('th', null, t)))),
        h('tbody', null, top.map((c, i) => h('tr', { 'data-cell': c.id, onclick: () => { set({ selectedCell: c.id }); map.flyTo(c.lat, c.lon, 15.5); draw(); paint(); } },
          h('td.n', null, i + 1), h('td', null, c.dong), h('td.n', null, h('span.minibar', { style: { width: `${c[key] * 0.5}px`, marginRight: '6px' } }), fmtN(c[key], 1)),
          h('td', null, h('span.type-chip', { style: { background: CATCOL[key === 'ptvi' ? c.type : c.typeNight] } }, key === 'ptvi' ? c.type : c.typeNight)), h('td.n', null, `${fmtN(c.tStation, 0)}분`))))))));

    // by dong
    const dongs = {}; ranked.forEach(c => { (dongs[c.dong] ??= []).push(c); });
    const dongRows = Object.entries(dongs).map(([d, cs]) => ({ label: d, value: cs.reduce((a, c) => a + c[key], 0) / cs.length, note: `격자 ${cs.length}개 · 취약유형(B·C·E) ${cs.filter(c => ['B', 'C', 'E'].includes(c.type)).length}개` })).sort((a, b) => b.value - a.value);
    body.append(h('div.card', null, h('h3', null, '행정동 평균'), barList({ items: dongRows, max: 100, fmt: v => fmtN(v, 1) }),
      h('small.muted', null, '행정동 평균은 격자 차이를 가립니다. 같은 동 안에서도 지수가 크게 다른 격자를 지도에서 확인하세요 (정책제안서 쟁점 ①).')));
  }

  draw(); paint();
  return { refresh: () => { draw(); paint(); }, dispose: () => { map.clearGrid(); clear(document.getElementById('map-legend')); } };
}

export function cellDetail(c, app, onClose) {
  const night = isNight();
  if (c.excluded) return h('div.card', null, h('h3', null, `${c.dong} 격자`), h('p', null, TYPES.P.rule), h('button.btn.small', { type: 'button', onclick: onClose }, '닫기'));
  const comp = night ? c.compN : c.comp, type = night ? c.typeNight : c.type;
  const W = PARAMS.ptvi;
  const bar = (k, label) => h('div.comp-bar', null, h('span', null, label), h('span.track', null, h('span.fill', { style: { width: `${comp[k]}%` } })), h('span.num', null, fmtN(comp[k], 0)));
  return h('div.card', null,
    h('div.row-between', null, h('h3', null, `${c.dong} 격자 #${night ? c.rankNight : c.rank}`), h('button.btn.small.ghost', { type: 'button', onclick: onClose }, '닫기')),
    h('div.row', null, h('span.type-chip', { style: { background: CATCOL[type] } }, type), h('b', null, TYPES[type].name), h('span.pill', null, QUADS[c.quad]?.name || '')),
    h('div.stat-row', null,
      h('div.stat', null, h('small', null, 'PTVI'), h('b', null, fmtN(c.ptvi, 1))),
      h('div.stat', null, h('small', null, 'NIGHT-TVI'), h('b', null, fmtN(c.nightTvi, 1)))),
    h('div.comp-bars', null, bar('A', `A 접근성 ×${W.A}`), bar('R', `R 위험 ×${W.R}`), bar('D', `D 공백 ×${W.D}`), bar('C', `C 전환 ×${W.C}`)),
    h('dl.kv', null,
      c.pop != null ? [h('dt', null, '인구 (2024 SGIS)'), h('dd', null, `${fmtN(c.pop)}명`)] : null,
      h('dt', null, '가장 가까운 역까지 도보'), h('dd', null, `${fmtN(c.tStation, 1)}분`),
      h('dt', null, '가장 가까운 정류장까지'), h('dd', null, `${fmtN(c.tBus, 1)}분`),
      h('dt', null, '대중교통 접근성 TAI (주간·22~24시·심야)'), h('dd', null, `${c.taiDay} · ${c.taiLate} · ${c.taiDeep}`),
      h('dt', null, '걸어서 닿는 버스 노선'), h('dd', null, `${c.routes}개`),
      h('dt', null, '공유모빌리티 이용 (하루, 추정)'), h('dd', null, `${fmtN(c.pui, 1)}회`),
      h('dt', null, 'PM 통행 가능 도로'), h('dd', null, fmtM(c.pmLenM)),
      h('dt', null, '적색 구간 비율 (주간·야간)'), h('dd', null, `${Math.round(c.redShare * 100)}% · ${Math.round(c.redShareNight * 100)}%`),
      h('dt', null, '평균 경사 · 조명 점수'), h('dd', null, `${c.slope}% · ${Math.round(c.lit * 100)}`)),
    h('div.stack', null, h('h4', null, '추천 정책 패키지'), h('ul.list', null, TYPES[type].policy.map(p => h('li', null, '· ', p)))),
    h('div.btn-row', null, h('button.btn.primary', { type: 'button', onclick: () => { set({ selectedCell: c.id }); app.goTab('sim'); } }, '정책 시뮬레이터로')));
}

// 정책 대시보드 · 유형·정책: K-Link A~E 유형 분포와 정책 패키지, TAI×PUI 4유형 산점도, K-means 군집(AI 유형화).
import { h, clear, fmtN } from '../dom.js';
import { scatter, barList } from '../charts.js';
import { state, set, isNight } from '../../state.js';
import { TYPES, TYPE_ORDER, QUADS, kmeans } from '../../core/analysis.js';
import { typeColor } from './vuln.js';

const CLUSTER_COL = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#e87ba4', '#008300'];

export function renderTypes(app, body) {
  const { data, map } = app;
  const cells = data.grid.cells.filter(c => !c.excluded);
  let k = 5, km = null, view = 'type';
  const recluster = () => { km = kmeans(cells.map(c => [c.comp.A, c.comp.R, c.comp.D, c.comp.C]), k, 7); };
  recluster();

  const paint = () => {
    if (view === 'type') map.showGrid(data.grid.cells, c => c.excluded ? null : typeColor(isNight() ? c.typeNight : c.type), c => c.excluded ? null : (isNight() ? c.typeNight : c.type), c => { set({ selectedCell: c.id }); app.goTab('vuln'); }, state.selectedCell);
    else if (view === 'quad') map.showGrid(data.grid.cells, c => c.excluded ? null : { I: '#2a78d6', II: '#eb6834', III: '#d03b3b', IV: '#b8c4d2' }[c.quad], c => c.excluded ? null : c.quad, c => { set({ selectedCell: c.id }); app.goTab('vuln'); }, state.selectedCell);
    else { const idx = new Map(cells.map((c, i) => [c.id, km.labels[i]])); map.showGrid(data.grid.cells, c => idx.has(c.id) ? CLUSTER_COL[idx.get(c.id)] : null, c => idx.has(c.id) ? `${idx.get(c.id) + 1}` : null, c => { set({ selectedCell: c.id }); app.goTab('vuln'); }, state.selectedCell); }
    const lg = document.getElementById('map-legend'); clear(lg);
    const items = view === 'type' ? TYPE_ORDER.filter(t => t !== 'P').map(t => [typeColor(t), `${t} ${TYPES[t].short}`])
      : view === 'quad' ? [['#2a78d6', 'Ⅰ 연계형'], ['#eb6834', 'Ⅱ PM 의존형'], ['#d03b3b', 'Ⅲ 이중 취약형'], ['#b8c4d2', 'Ⅳ 대중교통 충분형']]
        : km.centroids.map((_, j) => [CLUSTER_COL[j], `군집 ${j + 1}`]);
    lg.append(h('b', null, view === 'type' ? '지역 유형 (격자 안 글자)' : view === 'quad' ? 'TAI×PUI 4유형' : 'K-means 군집 (격자 안 번호)'), h('div.legend', null, items.map(([c, l]) => h('span', null, h('i', { style: { background: c } }), l))));
  };

  function draw() {
    clear(body);
    body.append(h('div.card', null, h('h3', null, '지도 보기'),
      h('div.scenarios', null, [['type', 'K-Link 유형 A~E'], ['quad', 'TAI×PUI 4유형'], ['cluster', 'AI 군집(K-means)']].map(([v, l]) => h('button.chip-btn', { type: 'button', style: view === v ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : null, onclick: () => { view = v; draw(); paint(); } }, l)))));

    // K-Link types
    const key = isNight() ? 'typeNight' : 'type';
    const counts = TYPE_ORDER.filter(t => t !== 'P').map(t => ({ t, n: cells.filter(c => c[key] === t).length }));
    body.append(h('div.card', null,
      h('h3', null, `지역 유형별 정책 패키지 ${isNight() ? '(야간)' : '(주간)'}`),
      barList({ items: counts.map(o => ({ label: `${o.t} ${TYPES[o.t].short}`, value: o.n, color: typeColor(o.t), note: TYPES[o.t].rule })), fmt: v => `${v}개` }),
      ...counts.filter(o => o.t !== 'N').map(o => h('details', null, h('summary', null, h('b', null, TYPES[o.t].name), h('small.muted', null, ` · ${o.n}개 격자`)),
        h('div.stack', { style: { padding: '6px 0 4px 4px' } }, h('small.muted', null, `진단 기준: ${TYPES[o.t].rule}`), h('ul.list', null, TYPES[o.t].policy.map(p => h('li', null, '· ', p))))))));

    // quadrant scatter
    body.append(h('div.card', null,
      h('h3', null, '대중교통 접근성(TAI) × 공유모빌리티 이용(PUI)'),
      h('small.muted', null, '정책제안서 표 7의 4유형. 오른쪽 위로 갈수록 대중교통이 좋고 PM 이용이 많습니다. 점을 누르면 격자 상세로 갑니다.'),
      scatter({ points: cells.map(c => ({ x: c.taiPct, y: c.puiPct, id: c.id, color: { I: '#2a78d6', II: '#eb6834', III: '#d03b3b', IV: '#9aa6b4' }[c.quad], label: [h('b', null, `${c.dong} · ${QUADS[c.quad].name}`), h('div', null, `TAI 순위 ${fmtN(c.taiPct, 0)} · PUI 순위 ${fmtN(c.puiPct, 0)}`), h('div', null, `PTVI ${c.ptvi}`)] })),
        xLabel: 'TAI 순위', yLabel: 'PUI 순위', quad: [50, 50], quadNames: ['Ⅰ 연계형', 'Ⅱ PM 의존형', 'Ⅲ 이중 취약형', 'Ⅳ 대중교통 충분형'], selected: state.selectedCell, onClick: p => { set({ selectedCell: p.id }); app.goTab('vuln'); } }),
      h('div.stack', null, Object.entries(QUADS).map(([q, v]) => h('small', null, h('b', null, v.name), ` (${cells.filter(c => c.quad === q).length}) — ${v.policy}`)))));

    // k-means
    const sizes = km.centroids.map((_, j) => km.labels.filter(l => l === j).length);
    body.append(h('div.card', null,
      h('div.row-between', null, h('h3', null, 'AI 군집 분석 (K-means)'),
        h('label', { for: 'k-sel', class: 'row', style: { gap: '6px', fontSize: '12.5px' } }, 'k =', h('select.input', { id: 'k-sel', style: { width: 'auto' }, onchange: e => { k = +e.target.value; recluster(); draw(); paint(); } }, [3, 4, 5, 6].map(v => h('option', { value: v, selected: k === v }, v))))),
      h('small.muted', null, '구성요소 A·R·D·C를 입력으로 비지도 군집을 만들고, 규칙 기반 유형과 비교합니다. 같은 입력이면 항상 같은 결과가 나오도록 시드를 고정했습니다.'),
      h('div.table-wrap', null, h('table.tbl', null,
        h('thead', null, h('tr', null, ['군집', '격자', 'A', 'R', 'D', 'C', '주된 유형'].map(t => h('th', null, t)))),
        h('tbody', null, km.centroids.map((cen, j) => {
          const members = cells.filter((_, i) => km.labels[i] === j); const tc = {}; members.forEach(c => { tc[c.type] = (tc[c.type] || 0) + 1; });
          const main = Object.entries(tc).sort((a, b) => b[1] - a[1])[0];
          return h('tr', null, h('td', null, h('span.type-chip', { style: { background: CLUSTER_COL[j] } }, j + 1)), h('td.n', null, sizes[j]), ...cen.map(v => h('td.n', null, fmtN(v, 0))), h('td', null, main ? `${main[0]} ${TYPES[main[0]].short} ${Math.round(main[1] / members.length * 100)}%` : '—'));
        }))))));
  }
  draw(); paint();
  return { refresh: () => { draw(); paint(); }, dispose: () => { map.clearGrid(); clear(document.getElementById('map-legend')); } };
}

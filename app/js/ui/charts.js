// Hand-built SVG charts (no library): one y-axis, thin marks, recessive grid, hover tooltips, text in ink tokens.
import { svg, h, showTip, hideTip, fmtN } from './dom.js';

const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; };

// Hourly line chart: series = [{ name, values[24], color }]; shades 22–05시 as night.
export function hourlyChart({ series, unit = '', height = 170, shadeNight = true, title }) {
  const W = 360, H = height, m = { l: 36, r: 10, t: 10, b: 22 };
  const max = niceMax(Math.max(...series.flatMap(s => s.values)));
  const x = i => m.l + (W - m.l - m.r) * i / 23, y = v => H - m.b - (H - m.t - m.b) * v / max;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': title || '시간대별 추이' });
  if (shadeNight) {
    root.append(svg('rect', { x: m.l, y: m.t, width: x(5) - m.l, height: H - m.t - m.b, fill: 'var(--panel-2)' }));
    root.append(svg('rect', { x: x(22), y: m.t, width: W - m.r - x(22), height: H - m.t - m.b, fill: 'var(--panel-2)' }));
    root.append(svg('text', { x: x(23) - 2, y: m.t + 10, 'text-anchor': 'end' }, '야간'));
  }
  for (let k = 0; k <= 4; k++) { const v = max * k / 4; root.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }), svg('text', { x: m.l - 6, y: y(v) + 3, 'text-anchor': 'end' }, fmtN(v, v < 10 && v % 1 ? 1 : 0))); }
  [0, 6, 12, 18, 23].forEach(i => root.append(svg('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }, `${i}시`)));
  series.forEach(s => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    root.append(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  });
  const cross = svg('line', { y1: m.t, y2: H - m.b, stroke: 'var(--muted)', 'stroke-dasharray': '3 3', visibility: 'hidden' });
  const dots = series.map(s => svg('circle', { r: 4, fill: s.color, stroke: 'var(--panel)', 'stroke-width': 2, visibility: 'hidden' }));
  root.append(cross, ...dots);
  const hit = svg('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent' });
  hit.addEventListener('pointermove', e => {
    const r = root.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(23, Math.round((px - m.l) / (W - m.l - m.r) * 23)));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => { d.setAttribute('cx', x(i)); d.setAttribute('cy', y(series[k].values[i])); d.setAttribute('visibility', 'visible'); });
    showTip(e, [h('b', null, `${i}시–${i + 1}시`), ...series.map(s => h('div', null, h('span', { style: { color: s.color } }, '● '), `${s.name} ${fmtN(s.values[i], 1)}${unit}`))]);
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hideTip(); });
  root.append(hit);
  const wrap = h('div.stack');
  if (series.length > 1) wrap.append(h('div.legend', null, series.map(s => h('span', null, h('i', { style: { background: s.color } }), s.name))));
  wrap.append(root);
  return wrap;
}

// Horizontal bars: items = [{ label, value, color?, note? }]
export function barList({ items, max = null, fmt = v => fmtN(v), color = 'var(--seq-5)', onClick }) {
  const mx = max ?? Math.max(...items.map(i => i.value), 1);
  return h('div.stack', null, items.map(it => {
    const row = h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(70px,auto) 1fr auto', gap: '8px', alignItems: 'center', fontSize: '12.5px', cursor: onClick ? 'pointer' : 'default' } },
      h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, it.label),
      h('span', { style: { height: '10px', background: 'var(--panel-2)', borderRadius: '5px', overflow: 'hidden' } }, h('span', { style: { display: 'block', height: '100%', width: `${Math.max(1.5, it.value / mx * 100)}%`, background: it.color || color, borderRadius: '5px' } })),
      h('span.num', { style: { fontSize: '12px', color: 'var(--ink-2)' } }, fmt(it.value)));
    if (it.note) row.title = it.note;
    if (onClick) row.addEventListener('click', () => onClick(it));
    row.addEventListener('pointermove', e => showTip(e, [h('b', null, it.label), h('div', null, fmt(it.value)), it.note ? h('div', null, it.note) : null]));
    row.addEventListener('pointerleave', hideTip);
    return row;
  }));
}

// Scatter with optional quadrant lines: points = [{ x, y, color, id, label }]
export function scatter({ points, xLabel, yLabel, xMax = 100, yMax = 100, quad = null, onClick, selected, height = 260, quadNames }) {
  const W = 360, H = height, m = { l: 34, r: 10, t: 12, b: 30 };
  const x = v => m.l + (W - m.l - m.r) * v / xMax, y = v => H - m.b - (H - m.t - m.b) * v / yMax;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${xLabel} 대비 ${yLabel}` });
  for (let k = 0; k <= 4; k++) { const v = xMax * k / 4, w = yMax * k / 4; root.append(svg('line', { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, class: 'grid' }), svg('line', { x1: m.l, x2: W - m.r, y1: y(w), y2: y(w), class: 'grid' }), svg('text', { x: x(v), y: H - m.b + 13, 'text-anchor': 'middle' }, Math.round(v)), svg('text', { x: m.l - 5, y: y(w) + 3, 'text-anchor': 'end' }, Math.round(w))); }
  if (quad) {
    root.append(svg('line', { x1: x(quad[0]), x2: x(quad[0]), y1: m.t, y2: H - m.b, class: 'axis', 'stroke-dasharray': '4 3' }), svg('line', { x1: m.l, x2: W - m.r, y1: y(quad[1]), y2: y(quad[1]), class: 'axis', 'stroke-dasharray': '4 3' }));
    if (quadNames) [[x(quad[0]) + 4, m.t + 10, 'start', quadNames[0]], [x(quad[0]) - 4, m.t + 10, 'end', quadNames[1]], [x(quad[0]) - 4, H - m.b - 6, 'end', quadNames[2]], [x(quad[0]) + 4, H - m.b - 6, 'start', quadNames[3]]].forEach(([a, b, an, t]) => root.append(svg('text', { x: a, y: b, 'text-anchor': an, class: 'lbl' }, t)));
  }
  root.append(svg('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end' }, xLabel + ' →'), svg('text', { x: 2, y: m.t - 2 }, '↑ ' + yLabel));
  for (const p of points) {
    const c = svg('circle', { cx: x(p.x), cy: y(p.y), r: p.id === selected ? 6.5 : 4.2, fill: p.color, stroke: p.id === selected ? 'var(--ink)' : 'var(--panel)', 'stroke-width': p.id === selected ? 2.5 : 1.5, style: onClick ? 'cursor:pointer' : '' });
    c.addEventListener('pointermove', e => showTip(e, p.label));
    c.addEventListener('pointerleave', hideTip);
    if (onClick) c.addEventListener('click', () => onClick(p));
    root.append(c);
  }
  return root;
}

// Stacked grade bar (G/Y/R) with 2px gaps; byGrade in metres
export function gradeBar(byGrade) {
  const tot = (byGrade.G || 0) + (byGrade.Y || 0) + (byGrade.R || 0) || 1;
  return h('div.bar-grades', { role: 'img', 'aria-label': `녹색 ${Math.round(byGrade.G / tot * 100)}%, 황색 ${Math.round(byGrade.Y / tot * 100)}%, 적색 ${Math.round((byGrade.R || 0) / tot * 100)}%` },
    ['G', 'Y', 'R'].filter(g => byGrade[g] > 0).map(g => h('span', { style: { width: `${byGrade[g] / tot * 100}%`, background: `var(--${g.toLowerCase()})` } })));
}

export const SEQ = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)', 'var(--seq-7)'];
export const seqColor = (v, min = 0, max = 100) => { if (v == null || !isFinite(v)) return null; const t = Math.max(0, Math.min(0.9999, (v - min) / (max - min))); return SEQ[Math.floor(t * SEQ.length)]; };
export function rampLegend(label, min, max) {
  return h('div.stack', { style: { gap: '4px' } }, h('b', null, label), h('div.legend-ramp', null, SEQ.map(c => h('span', { style: { background: c } }))), h('div.row-between', null, h('small.muted', null, min), h('small.muted', null, max)));
}

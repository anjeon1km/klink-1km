// Small DOM helpers. h('div.card', {onclick}, child, ...) — strings become text nodes (never parsed as HTML).
export function h(tag, attrs = null, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // only for trusted, static markup (icons)
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = el => { el.replaceChildren(); return el; };

export const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};

// formatting
export const fmtMin = m => (m == null || !isFinite(m) ? '—' : m < 1 ? '1분 미만' : `${Math.round(m)}분`);
export const fmtM = m => (m == null || !isFinite(m) ? '—' : m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);
export const fmtN = (n, d = 0) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pad2 = n => String(n).padStart(2, '0');
export const fmtClock = mins => `${pad2(Math.floor(mins / 60) % 24)}:${pad2(Math.round(mins % 60))}`;
export const fmtHour = h => `${pad2(((h % 24) + 24) % 24)}시`;
export const fmtDate = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// In-page modal (the artifact viewer blocks alert/confirm). Returns a promise resolving to the clicked action key.
export function modal(content, actions = [{ key: 'ok', label: '확인', primary: true }]) {
  const m = $('#modal'), card = $('#modal-card');
  return new Promise(resolve => {
    clear(card).append(...[content].flat(), h('div.btn-row', { style: { justifyContent: 'flex-end' } },
      actions.map(a => h('button.btn' + (a.primary ? '.primary' : ''), { type: 'button', onclick: () => close(a.key) }, a.label))));
    m.hidden = false;
    card.querySelector('button.primary, button')?.focus();
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    function close(key) { m.hidden = true; document.removeEventListener('keydown', onKey); resolve(key); }
  });
}

// Floating tooltip for charts
let tipEl;
export function showTip(e, content) {
  if (!tipEl) { tipEl = h('div.tip'); document.body.append(tipEl); }
  clear(tipEl).append(...[content].flat());
  tipEl.hidden = false;
  const x = e.clientX + 14, y = e.clientY + 14;
  tipEl.style.left = Math.min(x, window.innerWidth - tipEl.offsetWidth - 8) + 'px';
  tipEl.style.top = Math.min(y, window.innerHeight - tipEl.offsetHeight - 8) + 'px';
}
export function hideTip() { if (tipEl) tipEl.hidden = true; }

export const gradeChip = (g, label) => h('span.grade.' + g, null, label ?? { G: '녹색', Y: '황색', R: '적색', X: '통행 불가' }[g]);

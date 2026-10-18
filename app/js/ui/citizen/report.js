// 시민 앱 · 제보: 어두운 길·포트홀·방치 기기·보도 단절 등을 지도 위치와 함께 남기고, 구간 재평가 자료로 씁니다.
import { h, clear, fmtDate, toast } from '../dom.js';
import { store } from '../../store.js';
import { state } from '../../state.js';

export const REPORT_CATS = {
  dark: { name: '어두운 길', hint: '조명 보강 목록' },
  pothole: { name: '포트홀·노면 파손', hint: '도로 보수' },
  parked: { name: '방치된 PM', hint: '업체 수거 요청' },
  broken: { name: '보도 단절·불법주정차', hint: '보행 동선 정비' },
  junction: { name: '위험한 교차로', hint: '횡단시설·신호 검토' },
  other: { name: '기타', hint: '' },
  appeal: { name: '환승 판정 이의', hint: '수동 검토' },
};

export function renderReport(app, body) {
  const { map } = app;
  const draft = { cat: 'dark', note: '', lat: null, lon: null, photo: null };
  let filter = 'all', list = [], unsub = null;

  function draw() {
    clear(body);
    const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'rep-photo', hidden: true, onchange: e => readPhoto(e.target.files[0]) });
    const form = h('form.card', { onsubmit: submit },
      h('h3', null, '위험 제보'),
      h('div.scenarios', { role: 'radiogroup', 'aria-label': '제보 종류' }, Object.entries(REPORT_CATS).filter(([k]) => k !== 'appeal').map(([k, c]) => h('button.chip-btn', { type: 'button', role: 'radio', 'aria-checked': String(draft.cat === k), style: draft.cat === k ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : null, onclick: () => { draft.cat = k; draw(); } }, c.name))),
      h('div.row-between', null,
        h('span', null, draft.lat ? h('span', null, '위치 ', h('b.num', null, `${draft.lat.toFixed(5)}, ${draft.lon.toFixed(5)}`)) : h('span.muted', null, '위치를 지도에서 골라 주세요')),
        h('div.btn-row', null,
          h('button.btn.small', { type: 'button', onclick: () => map.setPickMode('report', p => { Object.assign(draft, p); draw(); }, '제보할 위치를 지도에서 누르세요') }, '지도에서 고르기'),
          state.trip?.plan?.pm ? h('button.btn.small.ghost', { type: 'button', onclick: () => { const c = state.trip.plan.pm.safe.coords; const m = c[Math.floor(c.length / 2)]; draft.lat = m[0]; draft.lon = m[1]; draw(); } }, '내 경로 중간') : null)),
      h('div.field', null, h('label', { for: 'rep-note' }, '설명 (선택)'), h('textarea.input', { id: 'rep-note', rows: 2, placeholder: '예: 가로등이 꺼져 있어요', oninput: e => { draft.note = e.target.value; } }, draft.note)),
      h('label.photo-drop', { for: 'rep-photo', style: { padding: '10px' } }, draft.photo ? h('img', { src: draft.photo, alt: '제보 사진' }) : h('small', null, '사진 첨부 (선택)')), file,
      h('button.btn.primary', { type: 'submit', disabled: !draft.lat }, '제보 남기기'),
      h('small.muted', null, store.mode === 'shared' ? '팀이 함께 보는 공유 저장소에 기록됩니다.' : '이 브라우저에 저장됩니다.'));
    body.append(form);

    const shown = list.filter(r => r.cat && (filter === 'all' || r.cat === filter));
    body.append(h('div.card', null,
      h('div.row-between', null, h('h3', null, `제보 목록 ${shown.length}`),
        h('select.input', { id: 'rep-filter', style: { width: 'auto' }, onchange: e => { filter = e.target.value; draw(); } }, h('option', { value: 'all' }, '전체'), Object.entries(REPORT_CATS).map(([k, c]) => h('option', { value: k, selected: filter === k }, c.name)))),
      shown.length ? h('ul.list', null, shown.slice(0, 60).map(r => h('li', null, h('button.btn.ghost', { type: 'button', style: { width: '100%', textAlign: 'left' }, onclick: () => r.lat && map.flyTo(r.lat, r.lon, 17) },
        h('div.row-between', null, h('b', null, REPORT_CATS[r.cat]?.name || r.cat), h('small.muted', null, fmtDate(r.at))),
        r.note ? h('small', { style: { display: 'block', color: 'var(--ink-2)' } }, r.note) : null)))) : h('p.empty', null, '아직 제보가 없습니다. 위에서 첫 제보를 남겨 보세요.')));
  }
  function readPhoto(f) {
    if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => { const s = Math.min(1, 320 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); draft.photo = c.toDataURL('image/jpeg', 0.55); URL.revokeObjectURL(url); draw(); };
    img.src = url;
  }
  async function submit(e) {
    e.preventDefault(); if (!draft.lat) return;
    await store.add('reports', { cat: draft.cat, note: draft.note.trim().slice(0, 300), lat: +draft.lat.toFixed(6), lon: +draft.lon.toFixed(6), photo: draft.photo || null });
    toast('제보를 남겼습니다. 구간 재평가 자료로 쓰입니다.');
    Object.assign(draft, { note: '', photo: null }); draw();
  }
  unsub = store.subscribe('reports', l => { list = l; draw(); });
  return { refresh: draw, dispose: () => unsub?.() };
}

// Bootstrap: load data → map → tabs (시민 앱 / 정책 대시보드) → clock & night mode → layers → team feedback.
import { h, $, clear, toast, fmtClock, fmtDate } from './ui/dom.js';
import { state, set, on, isNight, prefs } from './state.js';
import { loadData } from './data.js';
import { store } from './store.js';
import { MapView } from './map/mapview.js';
import { renderRoute } from './ui/citizen/route.js';
import { renderHubs } from './ui/citizen/hubs.js';
import { renderRide } from './ui/citizen/ride.js';
import { renderReport, REPORT_CATS } from './ui/citizen/report.js';
import { renderHistory } from './ui/citizen/history.js';
import { renderVuln } from './ui/policy/vuln.js';
import { renderTypes } from './ui/policy/types.js';
import { renderSim } from './ui/policy/sim.js';
import { renderOps } from './ui/policy/ops.js';
import { renderMethod } from './ui/policy/method.js';

const TABS = {
  citizen: [['route', '길찾기', renderRoute], ['hubs', '거점', renderHubs], ['ride', '주행', renderRide], ['report', '제보', renderReport], ['history', '내 기록', renderHistory]],
  policy: [['vuln', '취약지도', renderVuln], ['types', '유형·정책', renderTypes], ['sim', '시뮬레이터', renderSim], ['ops', '운영 현황', renderOps], ['method', '데이터·방법', renderMethod]],
};
const TAB_LABEL = Object.fromEntries([...TABS.citizen, ...TABS.policy].map(([k, l]) => [k, l]));

let app, current = null;

async function boot() {
  const bar = $('#loading-text');
  try {
    state.minutes = prefs.get('minutes', state.minutes);
    state.mode = prefs.get('mode', 'citizen');
    const data = await loadData(p => { bar.textContent = `동대문구 데이터를 불러오는 중… ${Math.round(p * 100)}%`; });
    store.init();
    const map = new MapView($('#map'), data);
    app = { data, map, goTab, store };
    map.onHubClick = hb => { set({ selectedHub: hb.id }); if (state.mode !== 'citizen') setMode('citizen', false); goTab('hubs'); };
    map.onWalkMode = () => { if (state.mode === 'citizen') renderCitizenLegend(); };
    $('#loading').hidden = true;
    wireTop(); wireLayers(); wireFeedback();
    store.subscribe('reports', list => map.showReports(list.filter(r => r.cat), r => { map.map.openPopup(popupFor(r), [r.lat, r.lon]); }));
    store.onMode(mode => { $('#feedback-store-note').textContent = mode === 'local' ? '이 기기에만 저장됩니다' : '팀원 모두에게 보입니다'; current?.refresh?.(); });
    applyClock();
    setMode(state.mode, false);
    const hash = location.hash.slice(1);
    if (TAB_LABEL[hash]) { setMode(TABS.policy.some(t => t[0] === hash) ? 'policy' : 'citizen', false); goTab(hash); }
  } catch (e) {
    console.error(e);
    bar.textContent = `데이터를 불러오지 못했습니다: ${e.message} — 로컬에서는 'npm run serve'로 열어 주세요 (파일을 직접 열면 브라우저가 데이터 읽기를 막습니다).`;
  }
}

function popupFor(r) {
  return h('div', null, h('b', null, REPORT_CATS[r.cat]?.name || '제보'), h('div', { style: { fontSize: '12px', color: 'var(--muted)' } }, fmtDate(r.at)), r.note ? h('div', null, r.note) : null, r.photo ? h('img', { src: r.photo, alt: '제보 사진', style: { maxWidth: '200px', borderRadius: '6px', marginTop: '6px' } }) : null);
}

function setMode(mode, render = true) {
  state.mode = mode; prefs.set('mode', mode);
  $('#app').dataset.mode = mode;
  $('#mode-citizen').setAttribute('aria-selected', String(mode === 'citizen'));
  $('#mode-policy').setAttribute('aria-selected', String(mode === 'policy'));
  const tabs = $('#tabs'); clear(tabs);
  TABS[mode].forEach(([k, label]) => tabs.append(h('button', { role: 'tab', id: `tab-${k}`, 'aria-selected': String(state.tab[mode] === k), onclick: () => goTab(k) }, label)));
  // map layers that belong to each mode
  app.map.setPolicy(mode === 'policy');
  if (mode === 'citizen') { app.map.clearGrid(); clear($('#map-legend')); renderCitizenLegend(); }
  goTab(state.tab[mode]);
}

function goTab(k) {
  const mode = TABS.citizen.some(t => t[0] === k) ? 'citizen' : 'policy';
  if (mode !== state.mode) { setMode(mode); }
  state.tab[mode] = k;
  [...$('#tabs').children].forEach(b => b.setAttribute('aria-selected', String(b.id === `tab-${k}`)));
  current?.dispose?.();
  const body = $('#panel-body'); clear(body); body.scrollTop = 0;
  if (state.mode === 'citizen') { app.map.clearGrid(); renderCitizenLegend(); if (k !== 'route' && k !== 'ride' && state.trip?.plan) app.map.showPlan(state.trip.plan, state.trip.plan.profile && state.trip.plan.profile !== 'pm' ? 'walk' : 'pm'); }
  else app.map.clearRoute();
  const fn = TABS[mode].find(t => t[0] === k)[2];
  current = fn(app, body) || null;
  $('#feedback-where').textContent = `지금 화면: ${mode === 'citizen' ? '시민 앱' : '정책 대시보드'} › ${TAB_LABEL[k]}`;
}

// 지도 범례: 꼭 필요한 것만 한 덩어리로
function renderCitizenLegend() {
  const lg = $('#map-legend'); clear(lg);
  if (app.map.walkMode) {
    lg.append(h('div.legend', { style: { display: 'grid', gap: '4px' } },
      h('span', null, h('i', { style: { background: 'var(--accent)' } }), '추천 경로'),
      h('span', null, h('i', { style: { background: 'var(--y)', borderRadius: '50%' } }), '주의 지점 (경사·계단·비신호 횡단)')));
    return;
  }
  const night = isNight();
  lg.append(h('div.legend', { style: { display: 'grid', gap: '4px' } },
    h('span.grade.G', null, `권장 ${night ? 15 : 20} km/h`), h('span.grade.Y', null, `주의 ${night ? 10 : 15} km/h`), h('span.grade.R', null, '피하는 길'),
    night ? h('span', null, h('i', { style: { background: '#ffb547' } }), '밝은 길') : null));
}

// ── clock & night mode
function applyClock() {
  const night = isNight();
  $('#clock-text').textContent = fmtClock(state.minutes);
  $('#clock-mode').textContent = night ? '야간' : '주간';
  $('#clock-range').value = state.minutes; $('#clock-range-label').textContent = fmtClock(state.minutes);
  $('#night-auto').checked = state.nightAuto; $('#night-force').checked = state.nightForce;
  const changed = app.map.night !== night;
  app.map.setNight(night);
  if (state.mode === 'citizen') renderCitizenLegend();
  return changed;
}
function wireTop() {
  $('#mode-citizen').onclick = () => setMode('citizen');
  $('#mode-policy').onclick = () => setMode('policy');
  const pop = $('#clock-pop'), btn = $('#clock-btn');
  btn.onclick = () => { pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
  document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  let t;
  const update = (mins, now = false) => { state.minutes = mins; prefs.set('minutes', mins); applyClock(); clearTimeout(t); t = setTimeout(() => current?.refresh?.(), now ? 0 : 250); };
  $('#clock-range').oninput = e => update(+e.target.value);
  $('#clock-now').onclick = () => { const d = new Date(); update(d.getHours() * 60 + d.getMinutes(), true); };
  pop.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => update(+b.dataset.t, true); });
  $('#night-auto').onchange = e => { state.nightAuto = e.target.checked; update(state.minutes, true); };
  $('#night-force').onchange = e => { state.nightForce = e.target.checked; update(state.minutes, true); };
  on('clock', () => { prefs.set('minutes', state.minutes); applyClock(); });
}

// ── layers
function wireLayers() {
  const btn = $('#layers-btn'), pop = $('#layers-pop');
  const items = [['grades', '구간 등급'], ['hubs', '환승거점'], ['transit', '역·정류장'], ['taas', 'TAAS 사고다발지역'], ['crossings', '횡단보도 (신호/비신호)'], ['cctv', 'CCTV'], ['lights', '가로등·조명'], ['contours', '등고선'], ['reports', '시민 제보']];
  const draw = () => { clear(pop).append(...items.map(([k, l]) => h('label', { for: `ly-${k}` }, h('input', { type: 'checkbox', id: `ly-${k}`, checked: state.layers[k] !== false, onchange: e => { state.layers[k] = e.target.checked; prefs.set('layers', state.layers); app.map.setLayers(state.layers); } }), l))); };
  state.layers = { ...state.layers, ...prefs.get('layers', {}) };
  app.map.setLayers(state.layers);
  btn.onclick = () => { pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); if (!pop.hidden) draw(); };
}

// ── team feedback (shared when published as an artifact)
function wireFeedback() {
  const dr = $('#feedback-drawer');
  $('#feedback-btn').onclick = () => { dr.hidden = !dr.hidden; if (!dr.hidden) $('#feedback-text').focus(); };
  $('#feedback-close').onclick = () => { dr.hidden = true; };
  $('#feedback-form').onsubmit = async e => {
    e.preventDefault(); const t = $('#feedback-text'); const text = t.value.trim(); if (!text) return;
    await store.add('feedback', { text: text.slice(0, 1000), where: `${state.mode === 'citizen' ? '시민 앱' : '정책 대시보드'} › ${TAB_LABEL[state.tab[state.mode]]}`, minutes: state.minutes });
    t.value = ''; toast('피드백을 남겼습니다.');
  };
  store.subscribe('feedback', async list => {
    const ol = $('#feedback-list'); const names = await store.names(list.map(f => f.by).filter(Boolean));
    clear(ol).append(...(list.length ? list.map(f => h('li', null, h('div.meta', null, h('b', null, f.by ? names[f.by] || '팀원' : '나'), h('span', null, fmtDate(f.at)), h('span', null, f.where)), h('div', null, f.text))) : [h('li.empty', null, '아직 피드백이 없습니다.')]));
    const badge = $('#feedback-count'); badge.textContent = String(list.length); badge.hidden = !list.length;
  });
}

boot();

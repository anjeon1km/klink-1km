// Bootstrap: load data → map → tabs (시민 앱 / 정책 대시보드) → clock & night mode → layers → team feedback.
import { h, $, clear, toast, modal, fmtClock, fmtDate } from './ui/dom.js';
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
  applyFont(prefs.get('fontLevel', 0));
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
    wireTop(); wireFont(); wireLayers(); wireFeedback(); wireInstall();
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

// ── 글자 크기 (어르신용): 보통 → 크게 → 아주 크게 → 보통
const FONT_LEVELS = [{ zoom: 1, name: '보통' }, { zoom: 1.15, name: '크게' }, { zoom: 1.3, name: '아주 크게' }];
function applyFont(level) {
  const lv = FONT_LEVELS[level] ? level : 0;
  document.documentElement.style.setProperty('--ui-zoom', String(FONT_LEVELS[lv].zoom));
  $('#app').dataset.font = String(lv);
  const btn = $('#font-btn');
  btn.setAttribute('aria-pressed', String(lv > 0));
  btn.setAttribute('aria-label', `글자 크기: ${FONT_LEVELS[lv].name}. 누르면 ${FONT_LEVELS[(lv + 1) % FONT_LEVELS.length].name}(으)로 바뀝니다`);
  btn.title = `글자 크기: ${FONT_LEVELS[lv].name}`;
  return lv;
}
function wireFont() {
  let level = applyFont(prefs.get('fontLevel', 0));
  $('#font-btn').onclick = () => {
    level = applyFont((level + 1) % FONT_LEVELS.length); prefs.set('fontLevel', level);
    toast(`글자 크기: ${FONT_LEVELS[level].name}`);
    setTimeout(() => app.map.map.invalidateSize(), 50); // 넓어진 패널만큼 지도 크기 다시 계산
  };
}

// ── 앱 설치 (설치형 웹앱): manifest가 있는 공개 주소(GitHub Pages)에서만 — 팀 공유 링크(아티팩트)에서는 꺼짐
function wireInstall() {
  if (!document.querySelector('link[rel="manifest"]')) return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('서비스 워커 등록 실패', e));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone || prefs.get('installDismissed', false)) return;
  const bar = $('#install-bar');
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; bar.hidden = false; });
  window.addEventListener('appinstalled', () => { bar.hidden = true; toast('안키로를 설치했어요. 홈 화면에서 열 수 있어요.'); });
  if (ios) bar.hidden = false; // 아이폰·아이패드는 설치 창이 없어서 방법을 안내
  $('#install-close').onclick = () => { bar.hidden = true; prefs.set('installDismissed', true); };
  $('#install-go').onclick = async () => {
    if (deferred) { deferred.prompt(); const { outcome } = await deferred.userChoice; deferred = null; if (outcome === 'accepted') bar.hidden = true; return; }
    const steps = ios ? ['사파리 아래쪽의 공유 버튼(네모에 위 화살표)을 누르세요.', '목록에서 「홈 화면에 추가」를 누르세요.', '오른쪽 위 「추가」를 누르면 홈 화면에 안키로가 생겨요.']
      : ['크롬 오른쪽 위 메뉴(⋮)를 누르세요.', '「앱 설치」 또는 「홈 화면에 추가」를 누르세요.', '「설치」를 누르면 홈 화면에 안키로가 생겨요.'];
    modal([h('h3', null, '홈 화면에 안키로 추가'), h('ol', { style: { margin: '8px 0 0', paddingLeft: '20px', display: 'grid', gap: '6px', fontSize: '15px' } }, steps.map(t => h('li', null, t)))]);
  };
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

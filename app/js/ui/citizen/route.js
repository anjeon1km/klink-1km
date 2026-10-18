// 시민 앱 · 길찾기: 한 화면에 '추천 하나'만 크게. 다른 방법은 한 줄씩, 자세한 근거는 접어 둡니다.
// 이동 방식: PM 환승 · 걷기 · 휠체어 · 시각장애 · 경사 적게 (교통약자 보행 경로 + 음성 안내)
import { h, clear, fmtMin, fmtM, fmtN, fmtClock, gradeChip } from '../dom.js';
import { gradeBar } from '../charts.js';
import { state, set, hour, isNight } from '../../state.js';
import { searchPlaces, cellAt } from '../../data.js';
import { PARAMS } from '../../core/params.js';
import { TYPES } from '../../core/analysis.js';
import { store } from '../../store.js';
import { startGuide } from './guide.js';
import { stepTitle, stepCautions, alertsFor } from './steps.js';
import { ICON } from '../icons.js';

const SCENARIOS = [
  { id: 'A', label: '평일 아침 통학 · 회기역 → 캠퍼스 상부', time: 520, from: 'H1', to: 'H3', profile: 'pm' },
  { id: 'B', label: '평일 밤 귀가 · 회기역 → 이문동 주택가', time: 1390, from: 'H1', to: { lat: 37.59852, lon: 127.06402, label: '이문동 주택가 (이문로 일대)' }, profile: 'pm' },
  { id: 'R', label: '하교 · 캠퍼스 상부 → 회기역', time: 1050, from: 'H3', to: 'H1', profile: 'pm' },
  { id: 'W', label: '휠체어 · 회기역 → 경희의료원', time: 600, from: 'H1', to: 'H2', profile: 'wheelchair' },
  { id: 'W2', label: '휠체어 · 회기역 → 캠퍼스 상부 (급경사)', time: 600, from: 'H1', to: 'H3', profile: 'wheelchair' },
  { id: 'V', label: '시각장애 · 회기역 → 경희의료원', time: 600, from: 'H1', to: 'H2', profile: 'blind' },
];
export const PROFILES = [
  { key: 'pm', label: 'PM 환승', icon: 'scooter' },
  { key: 'general', label: '걷기', icon: 'walk' },
  { key: 'wheelchair', label: '휠체어', icon: 'wheelchair' },
  { key: 'blind', label: '시각장애', icon: 'cane' },
  { key: 'lowslope', label: '경사 적게', icon: 'slope' },
];

export function renderRoute(app, body) {
  const { data, map } = app;
  const place = p => (typeof p === 'string' ? { lat: data.pilot[p].lat, lon: data.pilot[p].lon, label: `${data.pilot[p].code} ${data.pilot[p].name}` } : p);
  const trip = state.trip || (state.trip = { from: place('H1'), to: place('H3'), choice: 'main', profile: 'pm' });
  trip.profile ??= 'pm';
  let unsub = null;

  const replan = (fit = false) => {
    if (!trip.from || !trip.to) return;
    trip.plan = data.planner.plan({ from: trip.from, to: trip.to, hour: hour(), forceNight: isNight(), profile: trip.profile });
    trip.choice = 'main';
    map.setWalkMode(trip.profile !== 'pm');
    showOnMap();
    map.setPins(trip.from, trip.to, (which, p) => { trip[which] = p; replan(); draw(); });
    if (fit) map.fitPlan(trip.plan);
  };
  const showOnMap = () => {
    const p = trip.plan; if (!p) return;
    const mode = trip.choice === 'main' ? (p.profile === 'pm' ? (p.pm ? 'pm' : 'walk') : 'walk') : trip.choice;
    map.showPlan(p, mode);
  };

  // ── 출발·도착 입력
  const odField = (which) => {
    const input = h('input.input.od-input', { id: `od-${which}`, value: trip[which]?.label || '', placeholder: which === 'from' ? '출발 (역·정류장·건물)' : '도착 (캠퍼스·동네)', autocomplete: 'off', 'aria-label': which === 'from' ? '출발지' : '목적지' });
    const list = h('ul.suggest-list', { role: 'listbox', hidden: true });
    const choose = it => { trip[which] = { lat: it.lat, lon: it.lon, label: it.label }; input.value = it.label; list.hidden = true; replan(true); draw(); };
    input.addEventListener('input', () => {
      const res = searchPlaces(data, input.value);
      clear(list).append(...res.map(it => h('li', { role: 'option', onmousedown: e => { e.preventDefault(); choose(it); } }, h('span', null, it.label), h('small.muted', null, it.kind))));
      list.hidden = !res.length;
    });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = searchPlaces(data, input.value)[0]; if (first) choose(first); } });
    const pickBtn = h('button.icon-btn', { type: 'button', title: '지도에서 고르기', 'aria-label': which === 'from' ? '지도에서 출발지 고르기' : '지도에서 목적지 고르기', onclick: () => map.setPickMode(which, p => { trip[which] = { ...p, label: '지도에서 고른 위치' }; replan(); draw(); }, which === 'from' ? '지도에서 출발지를 누르세요' : '지도에서 목적지를 누르세요'), html: ICON.pin });
    return [h('span.od-dot' + (which === 'to' ? '.to' : '')), h('div.suggest', null, input, list), pickBtn];
  };

  function draw() {
    clear(body);
    const p = trip.plan;
    body.append(h('section.block', null,
      h('div.od', null, ...odField('from'), ...odField('to')),
      h('div.row-between', null,
        h('select.input.select-quiet', { id: 'scenario', 'aria-label': '예시 경로', onchange: e => { const s = SCENARIOS.find(x => x.id === e.target.value); if (!s) return; set({ minutes: s.time }, 'clock'); trip.from = place(s.from); trip.to = place(s.to); trip.profile = s.profile; replan(true); draw(); } },
          h('option', { value: '' }, '예시 경로 고르기'), SCENARIOS.map(s => h('option', { value: s.id }, s.label))),
        h('button.btn.small.ghost', { type: 'button', onclick: () => { [trip.from, trip.to] = [trip.to, trip.from]; replan(true); draw(); }, title: '출발·도착 바꾸기' }, '⇅ 바꾸기'))));

    body.append(h('section.block', null,
      h('h3.block-title', null, '누가 이동하나요?'),
      h('div.profile-grid', { role: 'radiogroup', 'aria-label': '이동 방식' }, PROFILES.map(pr => h('button.profile', { type: 'button', role: 'radio', 'aria-checked': String(trip.profile === pr.key), onclick: () => { trip.profile = pr.key; replan(true); draw(); } },
        h('span.profile-ico', { html: ICON[pr.icon] }), h('span', null, pr.label))))));

    if (!p) { body.append(h('p.empty', null, '출발지와 목적지를 고르면 가장 알맞은 방법 하나를 추천해 드립니다.')); return; }
    if (p.night) body.append(nightStrip(p, data));
    body.append(p.profile === 'pm' ? pmHero(p, app) : walkHero(p, app, map));
    body.append(alternatives(p));
    body.append(moreDetails(p, data));
  }

  // ── 다른 방법: 한 줄씩
  function alternatives(p) {
    const rows = [];
    const row = (key, icon, label, min, sub, disabled) => h('button.alt-row', { type: 'button', disabled, 'aria-pressed': String(trip.choice === key), onclick: () => { trip.choice = trip.choice === key ? 'main' : key; showOnMap(); draw(); } },
      h('span.alt-ico', { html: ICON[icon] }), h('span.alt-label', null, label, sub ? h('small', null, sub) : null), h('span.alt-min', null, min == null ? '—' : `${Math.max(1, Math.round(min))}분`));
    if (p.bus) rows.push(row('bus', 'bus', `${p.bus.route.no}${/^\d/.test(p.bus.route.no) ? '번' : ''} ${p.bus.route.type === 'village' ? '마을버스' : '버스'}`, p.bus.running ? p.bus.total : null, p.bus.running ? `${p.bus.from.name}에서 타기` : `운행 종료 (막차 ${p.bus.lastText})`, !p.bus.running));
    if (p.profile === 'pm' && p.walk) rows.push(row('walk', 'walk', '걷기', p.walk.sec / 60, fmtM(p.walk.len)));
    if (p.profile !== 'pm' && p.walkGeneral && p.walk && Math.abs(p.walkGeneral.sec - p.walk.sec) > 30) rows.push(row('walkGeneral', 'walk', '일반 도보 경로', p.walkGeneral.sec / 60, '교통약자 조건 없이 가장 빠른 길'));
    if (p.taxi) rows.push(h('div.alt-row.static', null, h('span.alt-ico', { html: ICON.taxi }), h('span.alt-label', null, '택시', h('small', null, '호출 대기 포함 추정')), h('span.alt-min', null, `${Math.round(p.taxi.min)}분`)));
    if (trip.choice !== 'main') rows.push(h('button.link-btn', { type: 'button', onclick: () => { trip.choice = 'main'; showOnMap(); draw(); }, style: { justifySelf: 'start' } }, '← 추천 경로 다시 보기'));
    return rows.length ? h('section.block', null, h('h3.block-title', null, '다른 방법'), h('div.alt-list', null, rows)) : h('div');
  }

  unsub = store.subscribe('reports', list => { const n = data.planner.setHazards(list); if (trip.plan && trip.profile !== 'pm' && n) { replan(); draw(); } });
  if (!state.trip.plan) replan(true); else { map.setWalkMode(trip.profile !== 'pm'); showOnMap(); map.setPins(trip.from, trip.to, (which, p) => { trip[which] = p; replan(); draw(); }); }
  draw();
  return { refresh: () => { if (app.guiding) return; replan(); draw(); }, dispose: () => { unsub?.(); app.guiding = false; } };
}

// ── PM 추천 카드
function pmHero(p, app) {
  const pm = p.pm;
  if (!pm) {
    return h('section.hero.warn', null,
      h('div.hero-eyebrow', null, 'PM 경로 없음'),
      h('p.hero-line', null, p.pmBlocked),
      h('p.hero-sub', null, p.night ? '아래의 밝은 길 도보나 택시를 권해요.' : '아래의 걷기나 버스를 이용하세요.'));
  }
  const s = pm.safe; const tot = s.byGrade.G + s.byGrade.Y + s.byGrade.R || 1;
  const caution = s.byGrade.Y / tot > 0.6;
  const avoidedKinds = [pm.avoided.some(a => /사고다발/.test(a.reason)) && '사고다발', pm.avoided.some(a => /내리막|오르막/.test(a.reason)) && '급경사', pm.avoided.some(a => /횡단/.test(a.reason)) && '비신호 횡단'].filter(Boolean);
  const why = avoidedKinds.length ? `${avoidedKinds.join('·')} 구간을 피한 안전 경로예요.` : '적색 구간 없이 이어지는 안전 경로예요.';
  return h('section.hero', null,
    h('div.hero-eyebrow', null, '추천 · PM 환승'),
    h('div.hero-main', null, h('span.hero-min', null, Math.max(1, Math.round(pm.totalMin))), h('span.hero-unit', null, '분'),
      h('span.hero-meta', null, `${pm.startHub?.name || '출발지'}에서 대여`, h('br'), `${pm.endHub?.name || '목적지'}에 반납`)),
    gradeBar(s.byGrade),
    h('p.hero-line', null, caution ? '황색(주의) 구간이 많아요. 권장 속도로 천천히 가세요.' : why),
    pm.walkFirstNote ? h('p.hero-sub', null, pm.walkFirstNote) : null,
    h('div.hero-checks', null,
      h('span.check', null, `적색 ${s.byGrade.R ? fmtM(s.byGrade.R) : '없음'}`),
      h('span.check', null, `권장 ${p.night ? PARAMS.speed.night.G : PARAMS.speed.day.G} km/h`),
      pm.transferEligible ? h('span.check.good', null, '환승 혜택 대상') : h('span.check', null, '환승 혜택 없음')),
    h('button.btn.primary.big', { type: 'button', onclick: () => app.goTab('ride') }, '대여하러 가기'));
}

// ── 걷기·교통약자 추천 카드
function walkHero(p, app, map) {
  const w = p.walk; const pr = PROFILES.find(x => x.key === p.profile);
  if (!w) return h('section.hero.warn', null, h('div.hero-eyebrow', null, `${pr.label} 경로 없음`), h('p.hero-line', null, '조건에 맞는 길을 찾지 못했어요. 아래 버스나 택시를 이용하세요.'));
  const sm = w.summary;
  const checks = [];
  const al = alertsFor(w, p.profile); const steep = al.filter(a => a.kind === 'steep'); const unsig = al.filter(a => a.kind === 'crossUnsig');
  if (p.profile === 'wheelchair' || p.profile === 'lowslope') {
    checks.push(h('span.check' + (sm.stairs ? '' : '.good'), null, sm.stairs ? `계단 ${sm.stairs}곳` : '계단 없음'));
    checks.push(steep.length ? h('span.check', null, `급경사 ${steep.length}곳 미리 알림`) : h('span.check.good', null, `최대 경사 ${sm.maxSlope.toFixed(0)}%`));
  }
  if (p.profile === 'blind') {
    checks.push(h('span.check.good', null, `보도 ${Math.round(sm.sidewalkShare * 100)}%`));
    checks.push(h('span.check' + (unsig.length ? '' : '.good'), null, unsig.length ? `비신호 횡단 ${unsig.length}곳 미리 알림` : '비신호 횡단 없음'));
  }
  if (p.profile === 'general') checks.push(h('span.check', null, fmtM(w.len)));
  if (sm.blockedNear === 0 && data_hasHazards()) checks.push(h('span.check.good', null, '제보된 파손 구간 피함'));
  const line = {
    general: p.night ? '밝은 길을 우선한 도보 경로예요.' : '가장 빠른 도보 경로예요.',
    wheelchair: w.assist ? `휠체어로 혼자 가기 어려운 급경사(최대 ${Math.round(sm.maxSlope)}%)가 있어요. 동행이나 택시를 권하고, 급경사 50 m 앞에서 미리 알려 드려요.` : steep.length ? `피할 수 없는 급경사(1/12 초과)가 ${steep.length}곳, ${fmtM(steep.reduce((t, a) => t + a.len, 0))} 있어요. 50 m 앞에서 미리 알려 드려요.` : '계단과 1/12(8.3%)이 넘는 경사를 뺀 길이에요.',
    blind: unsig.length ? '보도와 신호 횡단보도 위주로 고른 길이에요. 신호등 없는 횡단보도는 30 m 앞에서 미리 알려 드려요.' : '보도와 신호 횡단보도 위주로 고른 길이에요. 음성으로 한 단계씩 안내해요.',
    lowslope: w.relaxed ? `가파른 구간이 ${fmtM(sm.steepM)} 있어요. 쉬어 가세요.` : '오르막·내리막이 가장 적은 길이에요.',
  }[p.profile];
  return h('section.hero' + (w.relaxed || steep.length && p.profile === 'wheelchair' ? '.warn' : ''), null,
    h('div.hero-eyebrow', null, `추천 · ${pr.label}`),
    h('div.hero-main', null, h('span.hero-min', null, Math.max(1, Math.round(w.sec / 60))), h('span.hero-unit', null, '분'), h('span.hero-meta', null, fmtM(w.len), h('br'), `안내 ${w.steps.length}단계`)),
    h('p.hero-line', null, line),
    h('div.hero-checks', null, checks.slice(0, 3)),
    h('button.btn.primary.big', { type: 'button', onclick: () => startGuide(app, w, p) }, h('span', { html: ICON.speaker }), ' 음성 안내 시작'));
  function data_hasHazards() { return app.data.planner.blocked?.size > 0 && (p.profile === 'wheelchair' || p.profile === 'blind'); }
}

// ── 야간: 한 줄 띠 (펼치면 자세히)
function nightStrip(p, data) {
  const r01 = data.planner.routeBy.get('동대문01');
  const h24 = p.hour < 4 ? p.hour + 24 : p.hour;
  const ended = r01 && r01.last != null && h24 >= r01.last;
  return h('details.night-strip', null,
    h('summary', null, h('span.pill.night', null, '야간'), ' 밝고 CCTV 있는 길만 안내해요', ended ? h('span.pill.ended', null, '마을버스 끝남') : null),
    h('p', null, `야간 안심구간(조명 + CCTV)과 A·B급 거점 주변만 PM 경로에 씁니다. 권장 속도는 녹색 ${PARAMS.speed.night.G}, 황색 ${PARAMS.speed.night.Y} km/h입니다.${ended ? ` 동대문01 마을버스는 ${String((r01.last - 1) % 24).padStart(2, '0')}시대에 운행이 끝났어요.` : ''}`));
}

// ── 자세히 (접힘)
function moreDetails(p, data) {
  const parts = [];
  if (p.profile === 'pm' && p.pm) {
    const pm = p.pm, s = pm.safe;
    parts.push(h('details.more', null, h('summary', null, `구간별 안내 ${s.segs.length + 2}단계`),
      h('ol.seg-list', null,
        pm.walkIn ? h('li', null, h('span.seg-ico.W', null, '도'), h('div.seg-main', null, h('b', null, `${pm.startHub?.name || '대여 위치'}까지 걷기`)), h('div.seg-right', null, fmtMin(pm.walkIn.sec / 60))) : null,
        ...s.segs.map(sg => h('li', null, h('span.seg-ico.' + sg.grade, null, { G: '녹', Y: '황', R: '적' }[sg.grade] || ''), h('div.seg-main', null, h('b', null, sg.name), sg.reasons.length ? h('small', null, sg.reasons.slice(0, 2).join(' · ')) : null), h('div.seg-right', null, fmtM(sg.len), h('br'), `${sg.speed} km/h`))),
        h('li', null, h('span.seg-ico.H', null, 'P'), h('div.seg-main', null, h('b', null, `${pm.endHub?.name || '도착 위치'}에 반납`), h('small', null, `거점 반경 ${PARAMS.transfer.hubRadiusM} m 안, 바닥 표시가 보이게 사진 1장`)), h('div.seg-right', null, '')),
        pm.walkOut ? h('li', null, h('span.seg-ico.W', null, '도'), h('div.seg-main', null, h('b', null, '목적지까지 걷기')), h('div.seg-right', null, fmtMin(pm.walkOut.sec / 60))) : null)));
    const why = [];
    if (pm.avoided.length) why.push(h('ul.list', null, pm.avoided.map(a => h('li', null, gradeChip(a.grade), ' ', a.reason))));
    if (pm.fast && Math.round(pm.fast.len) !== Math.round(s.len)) why.push(h('p', null, `가장 빠른 길(지도의 회색 점선)보다 ${Math.max(0, Math.round(pm.totalMin - pm.fastMin))}분 더 걸리지만 위험한 구간을 덜 지나요.`));
    why.push(h('p.muted', null, `최대 오르막 ${s.maxUp.toFixed(0)}% · 내리막 ${Math.abs(s.maxDown).toFixed(0)}% · 택시 대신 타면 CO₂ 약 ${fmtN(pm.co2VsTaxi)} g 감축`));
    parts.push(h('details.more', null, h('summary', null, '이 길을 고른 이유'), ...why));
  }
  if (p.profile !== 'pm' && p.walk) {
    const w = p.walk, sm = w.summary;
    parts.push(h('details.more', null, h('summary', null, `단계별 안내 ${w.steps.length}단계`), h('ol.step-list', null, w.steps.map((st, i) => h('li', null, h('b', null, stepTitle(st, i)), stepCautions(st).length ? h('small', null, stepCautions(st).join(' · ')) : null)))));
    parts.push(h('details.more', null, h('summary', null, '이 길에 대해'),
      h('dl.kv', null,
        h('dt', null, '계단'), h('dd', null, sm.stairs ? `${sm.stairs}곳` : '없음'),
        h('dt', null, '경사 5% 넘는 구간'), h('dd', null, sm.steepM ? fmtM(sm.steepM) : '없음'),
        h('dt', null, '보도 있는 길 / 보차혼용'), h('dd', null, `${Math.round(sm.sidewalkShare * 100)}% / ${Math.round(sm.sharedShare * 100)}%`),
        h('dt', null, '횡단보도 (신호 / 비신호)'), h('dd', null, `${sm.crossSig} / ${sm.crossUnsig}`),
        p.night ? [h('dt', null, '밝은 길 비율'), h('dd', null, `${Math.round(w.litShare * 100)}%`)] : null),
      p.walkGeneral && p.profile !== 'general' ? h('p.muted', null, `일반 도보(${fmtMin(p.walkGeneral.sec / 60)})보다 ${Math.max(0, Math.round((w.sec - p.walkGeneral.sec) / 60))}분 더 걸려요.`) : null,
      h('p.muted', null, '보도 유무는 OSM 태그와 도로 위계로 추정했어요. 점자블록·음향신호기·턱낮춤 위치 자료를 넣으면 더 정확해져요.')));
  }
  const c = cellAt(data, p.to.lat, p.to.lon);
  if (c && !c.excluded) {
    const type = p.night ? c.typeNight : c.type;
    parts.push(h('details.more', null, h('summary', null, '목적지 동네 진단'),
      h('p', null, `${c.dong} · ${TYPES[type].name}`), h('p.muted', null, `역까지 걸어서 ${Math.round(c.tStation)}분 · 이 유형에 맞는 정책: ${TYPES[type].policy.join(', ')}`)));
  }
  return h('section.block.more-block', null, h('h3.block-title', null, '자세히'), parts);
}


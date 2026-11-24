// 시민 앱 · 주행: 출발 전 안전 확인(헬멧, 야간 점검) → 대여 → 주행 중 안내(다음 구간 등급·권장 속도, 음성) → 반납 인증(반경 15 m + 사진) → 환승 판정 카드.
// 실제 GPS 대신 경로를 따라 움직이는 시뮬레이션으로 시연합니다 (재생 속도 조절 가능).
import { h, clear, fmtMin, fmtM, fmtClock, gradeChip, toast, modal } from '../dom.js';
import { state, hour, isNight } from '../../state.js';
import { PARAMS } from '../../core/params.js';
import { judge, LEVEL } from '../../core/transfer.js';
import { linkCoords, metres } from '../../core/graph.js';
import { store } from '../../store.js';
import { demoAvailability } from './hubs.js';

const GRADE_WORD = { G: '녹색', Y: '황색', R: '적색' };
let sim = null; // survives tab switches
let ui = null;  // the ride tab currently on screen (null when another tab is open)

function say(text) {
  if (!sim?.voice || !('speechSynthesis' in window)) return;
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* voice unavailable */ }
}
const buzz = p => { try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(p); } catch { /* not supported */ } };

export function renderRide(app, body) {
  const { data, map } = app;
  const plan = state.trip?.plan;
  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const clockDate = mins => new Date(dayStart().getTime() + mins * 60000);

  function draw() {
    clear(body);
    if (!plan?.pm) {
      body.append(h('div.card', null, h('h3', null, 'PM 경로를 먼저 고르세요'), h('p', null, '길찾기에서 「PM 환승」을 고르면 여기서 대여부터 반납·환승 판정까지 해 볼 수 있어요. 걷기·휠체어·시각장애 경로는 길찾기의 「음성 안내 시작」을 누르세요.'), h('div.btn-row', null, h('button.btn.primary', { type: 'button', onclick: () => app.goTab('route') }, '길찾기로'))));
      return;
    }
    if (!sim || sim.planRef !== plan) { if (sim?.timer) clearInterval(sim.timer); map.setRider(null); map.showRadius(null); sim = newSim(plan); }
    ({ ready: drawReady, riding: drawRiding, returning: drawReturning, judged: drawJudged })[sim.phase]();
  }

  function newSim(p) {
    const steps = p.pm.safe.steps.map(s => ({ ...s, coords: (c => (s.dir === 1 ? c : c.slice().reverse()))(linkCoords(data.network, s.link)) }));
    let t = 0; steps.forEach(s => { s.t0 = t; s.dur = s.len / (s.speed / 3.6); t += s.dur; });
    return { planRef: p, phase: 'ready', steps, totalSec: t, direction: 'toPm', mult: 8, voice: false, speeding: false, contact: '', shareOn: false, notes: [], photo: null, parkOffset: 0, tagMin: state.minutes, appeal: false, linked: true, helmet: null, helmetPhoto: null };
  }

  // ── 1. ready
  function drawReady() {
    const pm = plan.pm, night = plan.night;
    const av = pm.startHub ? demoAvailability(pm.startHub, hour()) : null;
    body.append(h('section.hero', null,
      h('div.hero-eyebrow', null, night ? '대여 준비 · 야간' : '대여 준비'),
      h('div.hero-main', null, h('span.hero-min', null, Math.max(1, Math.round(pm.safe.sec / 60))), h('span.hero-unit', null, '분 주행'),
        h('span.hero-meta', null, fmtM(pm.safe.len), h('br'), `권장 ${night ? 15 : 20} km/h`)),
      h('p.hero-line', null, h('b', null, pm.startHub?.name || '출발지 주변'), '에서 빌려 ', h('b', null, pm.endHub?.name || '목적지 주변'), '에 반납'),
      av ? h('div.hero-checks', null, h('span.check', null, `기기 ${av.used}대`), h('span.check', null, `빈 자리 ${av.free}`)) : null,
      h('button.btn.primary.big', { type: 'button', onclick: start }, '안전 확인 후 대여하기')));
    body.append(h('details.more', null, h('summary', null, '시연 설정'),
      h('div.stack', null,
        h('div.field', null, h('label', { for: 'ride-dir' }, '환승 방향'),
          h('select.input', { id: 'ride-dir', onchange: e => { sim.direction = e.target.value; } },
            h('option', { value: 'toPm', selected: sim.direction === 'toPm' }, '대중교통에서 내려 PM으로 (하차 태그 → 대여)'),
            h('option', { value: 'toTransit', selected: sim.direction === 'toTransit' }, 'PM에서 대중교통으로 (반납 → 승차 태그)'))),
        h('div.field', null, h('label', { for: 'ride-tag' }, sim.direction === 'toPm' ? '하차 태그 시각' : '출발 시각'),
          h('input.input', { id: 'ride-tag', type: 'time', value: fmtClock(sim.tagMin), onchange: e => { const [a, b] = e.target.value.split(':').map(Number); sim.tagMin = a * 60 + b; } })),
        h('label.check-row', { for: 'ride-voice' }, h('input', { type: 'checkbox', id: 'ride-voice', checked: sim.voice, onchange: e => { sim.voice = e.target.checked; if (sim.voice) say('음성 안내를 켰습니다.'); } }), '음성 안내'),
        h('label.check-row', { for: 'ride-linked' }, h('input', { type: 'checkbox', id: 'ride-linked', checked: sim.linked, onchange: e => { sim.linked = e.target.checked; } }), '교통카드·업체 계정 연동됨'),
        h('label.check-row', { for: 'ride-speed' }, h('input', { type: 'checkbox', id: 'ride-speed', checked: sim.speeding, onchange: e => { sim.speeding = e.target.checked; } }), '과속 상황 만들기'),
        h('div.field', null, h('label', { for: 'ride-mult' }, '재생 속도'),
          h('select.input', { id: 'ride-mult', onchange: e => { sim.mult = +e.target.value; } }, [4, 8, 16, 32].map(v => h('option', { value: v, selected: sim.mult === v }, `×${v}`)))))));
    body.append(h('p.muted', { style: { fontSize: '13px' } }, '대여·결제는 업체 앱에서 하고, 이 앱은 안내와 환승 판정만 합니다.'));
  }

  async function start() {
    if (!(await safetyCheck())) return;
    sim.phase = 'riding'; sim.t = 0; sim.idx = 0; sim.lastGrade = null; sim.overSec = 0;
    sim.rentMin = sim.tagMin + (plan.pm.walkIn ? plan.pm.walkIn.sec / 60 : 0) + 1;
    if (sim.contact && sim.shareOn) sim.notes.push(`${fmtClock(sim.rentMin)} ${sim.contact}님에게 출발 알림 (예상 도착 ${fmtClock(sim.rentMin + sim.totalSec / 60 + 1)}) — 시연: 실제 발송 없음`);
    say(`${plan.pm.endHub?.name || '목적지'}까지 안내를 시작합니다.`);
    sim.timer = setInterval(tick, 200);
    draw();
  }

  // 출발 전 안전 확인 (학회 피드백: PM 이용이 늘수록 안전장비 착용을 앱에서 확인) — 낮·밤 모두, 밤에는 야간 점검을 더함
  async function safetyCheck() {
    const shared = plan.pm.startHub?.grade === 'A'; // A급 역 거점에는 공유 헬멧 보관함 (정책안 3장)
    let choice = sim.helmet, photo = sim.helmetPhoto;
    const box = h('div.stack');
    const file = h('input', { type: 'file', accept: 'image/*', capture: 'user', id: 'helmet-photo', hidden: true, onchange: e => shrinkPhoto(e.target.files[0], url => { photo = url; paint(); }) });
    const opt = (key, label, sub) => h('label.choice-row', { for: `helmet-${key}` },
      h('input', { type: 'radio', name: 'helmet', id: `helmet-${key}`, checked: choice === key, onchange: () => { choice = key; paint(); } }),
      h('span', null, h('b', null, label), sub ? h('small', null, sub) : null));
    const paint = () => clear(box).append(...[
      opt('personal', '내 헬멧을 썼어요', `쓴 모습을 한 장 찍으면 마일리지 ${PARAMS.transfer.benefit.helmetMileage}M`),
      shared ? opt('shared', '거점 공유 헬멧을 빌렸어요', `${plan.pm.startHub.name} 보관함`) : null,
      opt('none', '헬멧이 없어요'),
      choice === 'personal' ? h('label.photo-drop', { for: 'helmet-photo' }, photo ? h('img', { src: photo, alt: '헬멧 착용 사진 미리보기' }) : h('span', null, '헬멧을 쓴 모습이 보이게 찍어 주세요'), h('small.muted', null, photo ? '다시 찍기' : '사진 찍기 / 선택 (건너뛰면 마일리지 없이 출발)')) : null,
      choice === 'none' ? h('p.note.warn', null, `PM 운전자는 안전모를 써야 해요 (도로교통법 제50조, 범칙금 2만 원). ${shared ? '이 거점의 공유 헬멧을 빌리거나' : '가까운 역 거점(A급)의 공유 헬멧을 빌리거나'} 걷기·버스를 이용해 주세요.`) : null].filter(Boolean));
    paint();
    const parts = [h('h3', null, '출발 전 안전 확인'), h('h4', { style: { margin: '4px 0 0' } }, '헬멧을 썼나요?'), box, file];
    let contact, share;
    if (plan.night) {
      contact = h('input.input', { id: 'night-contact', placeholder: '이름 (예: 엄마)', value: sim.contact });
      share = h('input', { type: 'checkbox', id: 'night-share', checked: sim.shareOn });
      const dev = plan.pm.startHub ? demoAvailability(plan.pm.startHub, hour()).rows.filter(r => r.count) : [];
      parts.push(h('h4', { style: { margin: '8px 0 0' } }, '야간 점검'),
        h('ul.check-list', null,
          h('li.ok', null, `전조등·후미등: ${dev.filter(d => d.lightOk).map(d => d.vendor).join(', ') || '정상 기기 없음'} 정상${dev.some(d => !d.lightOk) ? ` · ${dev.filter(d => !d.lightOk).map(d => d.vendor).join(', ')}는 점검 필요로 추천에서 뺐습니다` : ''} (시연 값)`),
          h('li.ok', null, '음주 상태에서 PM을 운전하면 도로교통법 위반입니다. 술을 마셨다면 도보나 택시를 이용하세요.'),
          h('li.ok', null, `야간 권장 속도: 녹색 ${PARAMS.speed.night.G} km/h, 황색 ${PARAMS.speed.night.Y} km/h`)),
        h('div.field', null, h('label', { for: 'night-contact' }, '도착 알림 받을 사람 (선택)'), contact),
        h('label.check-row', { for: 'night-share' }, share, '이번 주행 동안만 위치 공유하기 (언제든 끌 수 있음)'));
    }
    const res = await modal(parts, [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '확인하고 대여', primary: true }]);
    if (res !== 'ok') return false;
    if (!choice) { toast('헬멧을 썼는지 먼저 골라 주세요'); return safetyCheck(); }
    sim.helmet = choice === 'personal' && !photo ? 'self' : choice; sim.helmetPhoto = choice === 'personal' ? photo : null;
    if (plan.night) { sim.contact = contact.value.trim(); sim.shareOn = share.checked; }
    return true;
  }
  function shrinkPhoto(f, done) {
    if (!f) return;
    const img = new Image(); const url = URL.createObjectURL(f);
    img.onload = () => {
      const s = Math.min(1, 360 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); done(c.toDataURL('image/jpeg', 0.6));
    };
    img.src = url;
  }

  // ── 2. riding
  function tick() {
    if (!sim || sim.phase !== 'riding') return;
    sim.t += 0.2 * sim.mult;
    while (sim.idx < sim.steps.length - 1 && sim.t > sim.steps[sim.idx].t0 + sim.steps[sim.idx].dur) sim.idx++;
    const st = sim.steps[sim.idx];
    if (sim.lastGrade !== st.grade) {
      const nm = st.grade === 'Y' ? `황색 구간입니다. 시속 ${st.speed}킬로미터로 줄이세요.` : st.grade === 'G' ? `녹색 구간, 시속 ${st.speed}킬로미터.` : '적색 구간입니다. 내려서 끌고 가세요.';
      if (sim.lastGrade) { say(nm); if (st.grade !== 'G') buzz([120, 80, 120]); }
      sim.lastGrade = st.grade;
    }
    if (sim.speeding && st.grade !== 'G') sim.overSec += 0.2 * sim.mult;
    // position
    const f = Math.min(1, (sim.t - st.t0) / st.dur); const pos = along(st.coords, f);
    map.setRider(pos);
    if (sim.t >= sim.totalSec) { clearInterval(sim.timer); sim.phase = 'returning'; sim.returnMin = sim.rentMin + sim.totalSec / 60; say('반납 거점에 도착했습니다. 바닥 표시 안에 세우고 사진을 찍어 주세요.'); map.showRadius(plan.pm.endHub, PARAMS.transfer.hubRadiusM); ui?.draw(); return; }
    ui?.updateHero();
  }
  function along(coords, f) {
    let tot = 0; const seg = []; for (let i = 1; i < coords.length; i++) { const d = metres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]); seg.push(d); tot += d; }
    let target = tot * f; for (let i = 0; i < seg.length; i++) { if (target <= seg[i]) { const t = seg[i] ? target / seg[i] : 0; return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t]; } target -= seg[i]; }
    return coords[coords.length - 1];
  }
  let heroEls = null;
  function drawRiding() {
    heroEls = { grade: h('div.next-grade'), speed: h('div.speed'), sub: h('div.sub'), meter: h('span'), next: h('div.sub'), clock: h('div.sub') };
    body.append(h('div.ride-hero', null,
      h('div.row-between', null, h('span', { style: { fontSize: '12px', color: '#9aa6b4' } }, '지금 구간'), heroEls.clock),
      heroEls.grade, heroEls.sub,
      h('div.row-between', { style: { alignItems: 'flex-end' } }, h('div', null, h('div', { style: { fontSize: '12px', color: '#9aa6b4' } }, '현재 속도'), heroEls.speed), heroEls.next),
      h('div.meter', null, heroEls.meter)));
    body.append(h('div.btn-row', null,
      h('button.btn', { type: 'button', onclick: () => { sim.voice = !sim.voice; toast(sim.voice ? '음성 안내 켬' : '음성 안내 끔'); } }, '음성 켜기/끄기'),
      sim.contact && sim.shareOn ? h('button.btn', { type: 'button', onclick: delayDemo }, '지연 상황 시연') : null,
      h('button.btn.ghost', { type: 'button', onclick: () => { clearInterval(sim.timer); sim.t = sim.totalSec; tick(); } }, '도착으로 건너뛰기')));
    if (sim.notes.length) body.append(h('div.card.soft', null, h('h4', null, '알림 기록 (시연)'), h('ul.list', null, sim.notes.map(n => h('li', null, h('small', null, n))))));
    body.append(h('small.muted', null, '화면을 보지 않아도 되도록 황색·적색 진입 때 음성과 진동으로 알려 줍니다.'));
    updateHero();
  }
  function updateHero() {
    if (!heroEls || sim.phase !== 'riding') return;
    const st = sim.steps[sim.idx]; const night = plan.night;
    let nextIdx = sim.idx + 1; while (nextIdx < sim.steps.length && sim.steps[nextIdx].grade === st.grade) nextIdx++;
    const nxt = sim.steps[nextIdx];
    const distToNext = nxt ? nxt.t0 > sim.t ? sim.steps.slice(sim.idx, nextIdx).reduce((a, s) => a + s.len, 0) - (sim.t - st.t0) / st.dur * st.len : 0 : null;
    const v = sim.speeding && st.grade !== 'G' ? st.speed + 6 : st.speed - 1 + Math.round(Math.sin(sim.t / 7) * 1.5);
    heroEls.grade.textContent = `${GRADE_WORD[st.grade]} · 권장 ${st.speed} km/h`;
    heroEls.grade.style.color = st.grade === 'G' ? '#5fd35f' : st.grade === 'Y' ? '#ffc94a' : '#ff7a7a';
    const name = data.network.links.name[st.link] >= 0 ? data.network.names[data.network.links.name[st.link]] : '이름 없는 길';
    heroEls.sub.textContent = `${name}${night ? ' · 야간 모드' : ''}${sim.helmet === 'none' ? ' · 헬멧 없음 — 천천히' : ''}`;
    clear(heroEls.speed).append(String(v), h('small', null, 'km/h'));
    heroEls.speed.style.color = v > st.speed ? '#ff7a7a' : '#eef2f6';
    heroEls.next.textContent = nxt ? `${Math.max(0, Math.round(distToNext))} m 뒤 ${GRADE_WORD[nxt.grade]} 구간` : '곧 도착';
    heroEls.meter.style.width = `${Math.min(100, sim.t / sim.totalSec * 100)}%`;
    heroEls.clock.textContent = `남은 시간 ${fmtMin((sim.totalSec - sim.t) / 60)}`;
  }
  async function delayDemo() {
    const r = await modal([h('h3', null, '예상보다 10분 늦어지고 있어요'), h('p', null, '괜찮으신가요? 응답이 없으면 지정한 사람에게 알립니다.')], [{ key: 'no', label: '응답하지 않기 (시연)' }, { key: 'ok', label: '괜찮아요', primary: true }]);
    sim.notes.push(r === 'ok' ? '본인 확인 응답 — 추가 알림 없음' : `응답 없음 — ${sim.contact}님에게 지연 알림 (시연: 실제 발송 없음)`);
    draw();
  }

  // ── 3. returning: radius + photo
  function drawReturning() {
    const hub = plan.pm.endHub;
    const pos = parkPos();
    map.setRider(pos);
    const d = hub ? metres(pos[0], pos[1], hub.lat, hub.lon) : Infinity;
    const file = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'ride-photo', hidden: true, onchange: e => readPhoto(e.target.files[0]) });
    body.append(h('div.card', null,
      h('h3', null, '반납 인증'),
      hub ? h('p', null, h('b', null, hub.name), ` 거점 반경 ${PARAMS.transfer.hubRadiusM} m 안에 세우세요. 지금 위치는 거점 중심에서 `, h('b', { style: { color: d <= PARAMS.transfer.hubRadiusM ? 'var(--g)' : 'var(--r)' } }, `${Math.round(d)} m`), '입니다.') : h('p.note.warn', null, '목적지 주변에 환승거점이 없어 일반 반납으로 처리됩니다.'),
      hub ? h('div.btn-row', null,
        h('button.btn.small', { type: 'button', onclick: () => { sim.parkOffset = 0; draw(); } }, '거점 안에 세우기'),
        h('button.btn.small', { type: 'button', onclick: () => { sim.parkOffset = 37; draw(); } }, '거점 밖 37 m에 세우기 (시연)')) : null,
      h('label.photo-drop', { for: 'ride-photo' }, sim.photo ? h('img', { src: sim.photo, alt: '반납 사진 미리보기' }) : h('span', null, '거점 바닥 표시가 보이게 찍어 주세요'), h('small.muted', null, sim.photo ? '다시 찍기' : '사진 찍기 / 선택')),
      file,
      h('small.muted', null, '시연본은 사진 인식 모델 대신 촬영 여부와 촬영 시각만 확인합니다. 확장 단계에서 바닥 표시 인식(주차면 안, 점자블록·출입구 방해 없음)을 붙입니다.'),
      h('button.btn.primary', { type: 'button', onclick: finish }, '반납 완료')));
  }
  function parkPos() {
    const hub = plan.pm.endHub; const last = sim.steps[sim.steps.length - 1].coords.slice(-1)[0];
    if (!hub) return last;
    const off = sim.parkOffset / 111000; return [hub.lat + off * 0.6 + 0.00003, hub.lon + off * 0.8 / Math.cos(hub.lat * Math.PI / 180)];
  }
  function readPhoto(f) { shrinkPhoto(f, url => { sim.photo = url; sim.photoMin = sim.returnMin; draw(); }); }

  async function finish() {
    const pm = plan.pm; const pos = parkPos();
    const today = store.list('rides').filter(r => r.at?.slice(0, 10) === new Date().toISOString().slice(0, 10) && ['basic', 'safe', 'night'].includes(r.level) && (!store.me() || r.by === store.me() || r.local)).length;
    const nearStationM = Math.min(...data.transit.stations.flatMap(s => s.entrances.map(e => metres(pos[0], pos[1], e.lat, e.lon))));
    const trip = {
      direction: sim.direction, tagTime: sim.direction === 'toPm' ? clockDate(sim.tagMin) : null,
      rentTime: clockDate(sim.rentMin), returnTime: clockDate(sim.returnMin),
      rentPos: pm.startHub ? { lat: pm.startHub.lat, lon: pm.startHub.lon } : plan.from, returnPos: { lat: pos[0], lon: pos[1] },
      rentHub: pm.startHub, returnHub: pm.endHub, photo: !!sim.photo, photoTime: sim.photo ? clockDate(sim.returnMin) : null,
      redLinks: pm.safe.steps.filter(s => s.grade === 'R').length, overSpeedShare: sim.overSec / Math.max(1, sim.totalSec), rideM: pm.safe.len, todayCount: today,
      linked: sim.linked, helmet: sim.helmet, nearStationM,
    };
    sim.trip = trip; sim.result = judge(trip); sim.phase = 'judged';
    map.showRadius(null); say(`${sim.result.levelName}${sim.result.won ? `, ${sim.result.won}원 혜택` : ''}`);
    await save();
    draw();
  }
  async function save() {
    const r = sim.result, pm = plan.pm;
    sim.savedId = await store.add('rides', {
      level: r.level, won: r.won, mileage: r.mileage, night: plan.night, nightBenefit: !!r.night, direction: r.direction, atHub: !r.unmet.some(u => /거점 밖|환승거점이 아닌/.test(u)),
      from: pm.startHub?.id || null, to: pm.endHub?.id || null, km: Math.round(pm.safe.len) / 1000,
      links: pm.safe.steps.map(s => s.link), red: sim.trip.redLinks, unmet: r.unmet, hourOfDay: hour(), helmet: sim.helmet,
    });
  }

  // ── 4. judged
  function drawJudged() {
    const r = sim.result;
    const card = h('div.verdict.' + r.level, null,
      h('small', null, '환승 판정'),
      h('div.v-level', null, r.levelName),
      r.night ? h('span.pill.night', null, '야간 특례 — 심야 할증 면제') : null,
      ...(r.notes || []).map(n => h('div.note.warn', null, n)),
      r.benefits.length ? h('div.v-amount', null, [r.won ? `${r.won.toLocaleString()}원 면제` : null, r.mileage ? `마일리지 ${r.mileage}M` : null].filter(Boolean).join(' + ')) : null,
      r.benefits.length ? h('ul.list', null, r.benefits.map(b => h('li', null, `${b.label} ${b.value.toLocaleString()}${b.unit}`))) : null,
      r.unmet.length ? h('p', { style: { fontWeight: 600 } }, r.unmet[0]) : null,
      r.tips.length ? h('p', { style: { fontSize: '14px' } }, r.tips[0]) : null,
      h('details.more', null, h('summary', null, `판정 근거 ${r.met.length + r.unmet.length}가지`), h('ul.check-list', null, r.met.map(m => h('li.ok', null, m)), r.unmet.map(m => h('li.no', null, m)))));
    body.append(card);
    if (r.level === 'pending') body.append(h('button.btn.primary', { type: 'button', onclick: async () => { sim.trip.tagTime = new Date(sim.trip.returnTime.getTime() + 6 * 60000); sim.result = judge(sim.trip); await save(); draw(); } }, '6분 뒤 지하철 승차 태그 (시연)'));
    body.append(h('div.btn-row', null,
      r.level !== 'none' && r.level !== 'pending' ? null : h('button.btn', { type: 'button', onclick: async () => { sim.appeal = true; await store.add('reports', { cat: 'appeal', note: `환승 판정 이의 제기: ${r.unmet.join(', ')}`, lat: plan.pm.endHub?.lat ?? plan.to.lat, lon: plan.pm.endHub?.lon ?? plan.to.lon }); toast('이의 제기를 접수했습니다. GPS 오차 등을 수동으로 검토합니다.'); } }, '이의 제기'),
      r.level === 'basic' ? h('button.btn', { type: 'button', onclick: async () => { sim.appeal = true; await store.add('reports', { cat: 'appeal', note: `환승 판정 이의 제기 (안전 환승 요청): ${r.unmet.join(', ')}`, lat: plan.pm.endHub?.lat, lon: plan.pm.endHub?.lon }); toast('이의 제기를 접수했습니다. 수동 검토 후 결과를 알려 드립니다.'); } }, '이의 제기') : null,
      h('button.btn.primary', { type: 'button', onclick: () => { sim = null; map.setRider(null); app.goTab('route'); } }, '새 경로')));
    body.append(h('div.card.soft', null,
      h('h4', null, '이번 이동은 PM이 없었다면 무엇으로 했을까요?'),
      h('small.muted', null, '답하면 기록 탭에서 탄소 감축량을 추정합니다. 답하지 않으면 추정하지 않습니다.'),
      h('div.btn-row', null, [['car', '택시·승용차'], ['transit', '버스·지하철'], ['active', '걸었을 것']].map(([k, l]) => h('button.btn.small', { type: 'button', onclick: async () => { await store.add('rides', { kind: 'replace', ref: sim.savedId, replaced: k, km: Math.round(plan.pm.safe.len) / 1000 }); toast('기록했습니다.'); } }, l)))));
    if (plan.night) body.append(h('div.card.soft', null, h('h4', null, '어두웠던 곳이 있었나요?'),
      h('button.btn', { type: 'button', onclick: async () => { const mid = plan.pm.safe.coords[Math.floor(plan.pm.safe.coords.length / 2)]; await store.add('reports', { cat: 'dark', note: '야간 주행 후 한 번 누르기 제보', lat: mid[0], lon: mid[1] }); toast('어두운 길 제보를 남겼습니다. 구청 조명 보강 목록과 구간 재평가에 반영됩니다.'); } }, '네, 경로 중간이 어두웠어요')));
  }

  ui = { draw, updateHero };
  draw();
  return { refresh: () => { if (sim?.phase !== 'riding') draw(); }, dispose: () => { ui = null; heroEls = null; } };
}

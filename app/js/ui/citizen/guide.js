// 음성 안내 (걷기·교통약자): 한 번에 한 단계만 크게 보여 주고 읽어 줍니다.
// 경로를 따라가며 신호등 없는 횡단보도·계단은 30 m 앞, 피할 수 없는 급경사는 50 m 앞에서 음성과 진동으로 미리 알립니다.
// 큰 버튼 세 개(이전 · 다시 듣기 · 다음). '자동으로 따라가기'는 실제 GPS 대신 경로를 따라 움직이는 시연입니다.
import { h, clear, fmtM, toast } from '../dom.js';
import { stepTitle, stepCautions, alertsFor, alertLabel, alertAdvice, alertSentence } from './steps.js';
import { ICON } from '../icons.js';
import { metres } from '../../core/graph.js';

const PROFILE_NAME = { general: '걷기', wheelchair: '휠체어', blind: '시각장애', lowslope: '경사 적게' };
const BUZZ = { crossUnsig: [200, 100, 200, 100, 200], crossSig: [120], stairs: [300, 120, 300], steep: [500, 150, 500] };
const SPEED = { wheelchair: 3.6, blind: 3.6, lowslope: 4 }; // km/h, 시연 이동 속도

export function startGuide(app, walk, plan) {
  const { map } = app;
  const body = document.getElementById('panel-body');
  const steps = walk.steps;
  const profile = plan.profile;
  const alerts = alertsFor(walk, profile);
  const total = walk.pathLen ?? steps.reduce((a, s) => a + s.len, 0);

  // 경로선(출발·도착 연결선을 뺀 부분)과 그 위의 누적 거리 — 위치(m) → 지도 좌표
  const line = walk.coords.length > 3 ? walk.coords.slice(1, -1) : walk.coords;
  const cum = [0];
  for (let k = 1; k < line.length; k++) cum.push(cum[k - 1] + metres(line[k - 1][0], line[k - 1][1], line[k][0], line[k][1]));
  const scale = cum[cum.length - 1] > 0 ? total / cum[cum.length - 1] : 1;
  const pointAt = d => {
    const t = d / scale; let k = 1;
    while (k < cum.length - 1 && cum[k] < t) k++;
    const f = cum[k] > cum[k - 1] ? Math.min(1, Math.max(0, (t - cum[k - 1]) / (cum[k] - cum[k - 1]))) : 0;
    return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * f, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * f];
  };
  const stepAt = d => { if (d >= total - 1) return steps.length; let i = 0; while (i < steps.length - 1 && steps[i + 1].startDist <= d + 0.5) i++; return i; };

  const g = { d: 0, i: 0, auto: false, timer: null, voice: 'speechSynthesis' in window, fired: new Set(), banner: -1 };
  app.guiding = true;
  const refs = {};
  const voiceKo = () => { try { return speechSynthesis.getVoices().find(v => /ko/i.test(v.lang)); } catch { return null; } };

  function speak(text, interrupt = true) {
    if (!g.voice || !text) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/ m\b/g, '미터').replace(/%/g, '퍼센트').replace(/ — /g, '. '));
      u.lang = 'ko-KR'; u.rate = 0.95; const v = voiceKo(); if (v) u.voice = v; speechSynthesis.speak(u);
    } catch { g.voice = false; }
  }
  const buzz = p => { if (!navigator.userActivation?.hasBeenActive) return; try { navigator.vibrate?.(p); } catch { /* not supported */ } };

  // 이 단계 안에 있는 미리 알림 지점
  const inStep = i => { const st = steps[i]; if (!st) return []; const end = st.startDist + st.len; return alerts.map((a, k) => ({ a, k })).filter(({ a }) => a.dist >= st.startDist - 5 && a.dist < end); };
  // 단계 문장 외에 덧붙일 주의 (알림 지점과 겹치는 것은 뺌)
  const extraCautions = i => {
    const st = steps[i]; const hasSteep = inStep(i).some(({ a }) => a.kind === 'steep');
    return stepCautions(st).filter(c => !/횡단보도|계단/.test(c) && !(hasSteep && /오르막|내리막/.test(c)));
  };
  // 단계 문장: 단계 시작 30 m 안의 알림은 지금 함께 읽고, 그 뒤의 알림은 가까워지면 다시 알린다고 말함
  const sentence = i => {
    if (i >= steps.length) return '목적지에 도착했습니다. 안내를 마칩니다.';
    const st = steps[i]; const parts = [`${stepTitle(st, i)} 가세요.`];
    for (const { a, k } of inStep(i)) {
      if (g.fired.has(k)) continue;
      const ahead = Math.max(0, a.dist - Math.max(g.d, st.startDist));
      if (ahead <= a.lead) { parts.push(alertSentence(a, ahead, profile)); g.fired.add(k); }
      else parts.push(a.kind === 'steep' ? `이 구간 중간에 ${a.slope > 0 ? '오르막' : '내리막'} 급경사가 있어요. 가까워지면 알려 드릴게요.` : `이 구간 중간에 ${alertLabel(a)}${a.kind === 'stairs' ? '이' : '가'} 있어요. 가까워지면 알려 드릴게요.`);
    }
    const ex = extraCautions(i); if (ex.length) parts.push(ex.join('. ') + '.');
    return parts.join(' ');
  };
  const intro = () => {
    const n = kind => alerts.filter(a => a.kind === kind).length;
    const bits = [];
    if (n('steep')) bits.push(String(profile).startsWith('wheelchair') ? `이 길에는 피할 수 없는 급경사가 ${n('steep')}곳 있습니다. 50미터 앞에서 미리 알려 드릴게요.` : `경사가 급한 곳 ${n('steep')}곳은 50미터 앞에서 알려 드릴게요.`);
    if (n('crossUnsig')) bits.push(`신호등 없는 횡단보도 ${n('crossUnsig')}곳은 30미터 앞에서 미리 알려 드릴게요.`);
    return bits.join(' ');
  };

  // 단계 이동(이전·다음 버튼): 그 단계 시작으로 옮기고, 아직 지나지 않은 알림은 다시 알릴 수 있게 함
  const go = (i, prefix = '') => {
    stop();
    g.i = Math.max(0, Math.min(steps.length, i));
    g.d = g.i < steps.length ? steps[g.i].startDist : total;
    g.fired = new Set(alerts.map((a, k) => (a.dist < g.d - 1 ? k : -1)).filter(k => k >= 0));
    g.banner = -1;
    map.setRider(pointAt(g.d));
    const near = inStep(g.i).find(({ a, k }) => !g.fired.has(k) && a.dist - g.d <= a.lead);
    const text = sentence(g.i); speak(prefix ? `${prefix} ${text}` : text);
    if (near) { g.banner = near.k; buzz(BUZZ[near.a.kind]); }
    draw();
  };
  const stop = () => { clearInterval(g.timer); g.timer = null; g.auto = false; };
  const exit = () => { stop(); app.guiding = false; try { speechSynthesis.cancel(); } catch { /* none */ } map.setRider(null); app.goTab('route'); };

  // 시연: 경로를 따라 ×8 속도로 이동 — 실제 앱에서는 이 자리에 휴대폰 GPS 위치(경로에 맞춘 거리)가 들어갑니다
  const tick = () => {
    g.d = Math.min(total, g.d + (SPEED[profile] || 4.8) / 3.6 * 8 * 0.5);
    map.setRider(pointAt(g.d));
    let redraw = false;
    const ni = stepAt(g.d);
    if (ni !== g.i) { g.i = ni; speak(sentence(ni)); redraw = true; }
    alerts.forEach((a, k) => {
      if (g.fired.has(k) || g.d < a.dist - a.lead) return;
      g.fired.add(k); g.banner = k; redraw = true;
      speak(alertSentence(a, a.dist - g.d, profile), false);
      buzz(BUZZ[a.kind]);
    });
    const b = alerts[g.banner];
    if (b && g.d > b.dist + (b.len || 0) + 10) { g.banner = -1; redraw = true; }
    if (g.d >= total) { stop(); redraw = true; }
    if (redraw) draw(); else update();
  };
  const toggleAuto = () => {
    if (g.auto) { stop(); draw(); return; }
    if (g.d >= total) go(0);
    g.auto = true; g.timer = setInterval(tick, 500); draw();
  };

  // 매 틱에는 거리 글자만 바꾸고, 단계·알림이 바뀔 때만 다시 그림 (버튼 포커스 유지)
  function update() {
    if (refs.left) refs.left.textContent = `남은 거리 ${fmtM(Math.max(0, total - g.d))}`;
    const b = alerts[g.banner];
    if (refs.bannerDist && b) refs.bannerDist.textContent = b.dist - g.d > 3 ? `${Math.round((b.dist - g.d) / 5) * 5} m 앞` : '지금';
    const nx = nextAlert();
    if (refs.upcoming) refs.upcoming.textContent = nx ? `다음 알림: ${alertLabel(nx)} · ${fmtM(Math.max(0, nx.dist - g.d))} 앞` : '';
  }
  const nextAlert = () => alerts.find((a, k) => !g.fired.has(k) && a.dist >= g.d);

  function draw() {
    clear(body);
    const done = g.i >= steps.length; const st = steps[g.i]; const next = steps[g.i + 1];
    const here = done ? [] : inStep(g.i).filter(({ k }) => k !== g.banner);
    const ex = done ? [] : extraCautions(g.i);
    const b = alerts[g.banner];
    const counts = ['steep', 'crossUnsig'].map(kind => [kind, alerts.filter(a => a.kind === kind).length]).filter(([, n]) => n);
    refs.left = h('div.guide-left', null);
    refs.bannerDist = h('span.guide-alert-dist', null);
    refs.upcoming = h('p.guide-next', null);
    body.append(...[
      h('div.row-between', null, h('span.pill.accent', null, `음성 안내 · ${PROFILE_NAME[String(profile).replace(/Relaxed|Steep/, '')] || '걷기'}`), h('button.btn.small', { type: 'button', onclick: exit }, '끝내기')),
      b ? h('section.guide-alert.' + b.kind, { role: 'alert' },
        h('div.guide-alert-head', null, refs.bannerDist, h('span', null, '미리 알림')),
        h('div.guide-alert-title', null, alertLabel(b)),
        h('div.guide-alert-advice', null, alertAdvice(b, profile))) : null,
      h('section.guide-card' + (here.length || ex.length ? '.caution' : ''), { 'aria-live': 'polite' },
        h('div.guide-count', null, done ? '도착' : `${g.i + 1} / ${steps.length}단계`),
        h('div.guide-title', null, done ? '목적지에 도착했어요' : stepTitle(st, g.i)),
        here.length || ex.length ? h('ul.guide-cautions', null, // 가까운 두 곳만 — 나머지는 가까워지면 알림
          here.slice(0, 2).map(({ a }) => h('li', null, `${alertLabel(a)} — ${Math.max(0, Math.round((a.dist - Math.max(g.d, st.startDist)) / 10) * 10)} m 뒤`)),
          here.length > 2 ? h('li', null, `그 밖 ${here.length - 2}곳은 가까워지면 알려 드려요`) : null,
          ex.slice(0, 2).map(c => h('li', null, c))) : null,
        done ? null : refs.left),
      h('div.guide-controls', null,
        h('button.guide-btn', { type: 'button', onclick: () => go(g.i - 1), disabled: g.i === 0, 'aria-label': '이전 단계' }, h('span', { html: ICON.prev }), '이전'),
        h('button.guide-btn.main', { type: 'button', onclick: () => speak(b ? alertSentence(b, b.dist - g.d, profile) : sentence(g.i)), 'aria-label': '다시 듣기' }, h('span', { html: ICON.repeat }), '다시 듣기'),
        h('button.guide-btn', { type: 'button', onclick: () => go(g.i + 1), disabled: done, 'aria-label': '다음 단계' }, h('span', { html: ICON.next }), '다음')),
      next ? h('p.guide-next', null, '다음 단계: ', stepTitle(next, g.i + 1)) : null,
      refs.upcoming,
      h('button.btn.ghost', { type: 'button', onclick: toggleAuto }, h('span', { html: g.auto ? ICON.pause : ICON.play }), g.auto ? ' 자동 따라가기 멈춤' : ' 자동으로 따라가기 (시연)'),
      g.i === 0 && counts.length ? h('p.muted', { style: { fontSize: '13px' } }, '미리 알려 드릴 곳: ', counts.map(([kind, n]) => `${kind === 'steep' ? '급경사' : '신호등 없는 횡단보도'} ${n}곳`).join(' · ')) : null,
      g.voice ? null : h('p.note.warn', null, '이 브라우저에서는 음성 읽기를 쓸 수 없어 글자로 안내합니다.'),
      h('p.muted', { style: { fontSize: '12.5px' } }, profile === 'blind' ? '실제 사용 때는 휴대폰 GPS 위치로 단계가 넘어가고, 화면을 보지 않아도 되도록 미리 알림을 진동과 음성으로 줍니다.' : '실제 사용 때는 휴대폰 GPS 위치로 단계가 넘어가고 미리 알림이 울립니다.'),
    ].filter(Boolean));
    update();
  }

  map.flyTo(steps[0]?.at[0] ?? walk.coords[0][0], steps[0]?.at[1] ?? walk.coords[0][1], 17);
  if (!g.voice) toast('음성 읽기를 쓸 수 없어 글자로 안내합니다.');
  go(0, intro());
}

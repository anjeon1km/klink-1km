// 음성 안내 (걷기·교통약자): 한 번에 한 단계만 크게 보여 주고 읽어 줍니다.
// 큰 버튼 세 개(이전 · 다시 듣기 · 다음), 위험 단계에서는 진동, '자동으로 따라가기'는 시연용 이동 재생입니다.
import { h, clear, fmtM, toast } from '../dom.js';
import { stepTitle, stepCautions } from './steps.js';
import { ICON } from '../icons.js';
import { metres } from '../../core/graph.js';

const PROFILE_NAME = { general: '걷기', wheelchair: '휠체어', blind: '시각장애', lowslope: '경사 적게' };

export function startGuide(app, walk, plan) {
  const { map } = app;
  const body = document.getElementById('panel-body');
  const steps = walk.steps;
  const g = { i: 0, auto: false, timer: null, voice: 'speechSynthesis' in window };
  app.guiding = true;
  const voiceKo = () => { try { return speechSynthesis.getVoices().find(v => /ko/i.test(v.lang)); } catch { return null; } };

  function speak(text) {
    if (!g.voice) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 0.95; const v = voiceKo(); if (v) u.voice = v; speechSynthesis.speak(u); }
    catch { g.voice = false; }
  }
  const sentence = i => {
    if (i >= steps.length) return '목적지에 도착했습니다. 안내를 마칩니다.';
    const st = steps[i]; const c = stepCautions(st);
    return `${stepTitle(st, i)} 가세요. ${c.length ? c.join('. ') + '.' : ''}`.replace(/ m/g, '미터').replace(/%/g, '퍼센트').replace(/ — /g, '. ');
  };
  const go = i => {
    g.i = Math.max(0, Math.min(steps.length, i));
    const st = steps[g.i];
    map.setRider(st ? st.at : walk.coords[walk.coords.length - 1]);
    if (st && stepCautions(st).length && navigator.userActivation?.hasBeenActive) { try { navigator.vibrate?.([150, 80, 150]); } catch { /* not supported */ } }
    speak(sentence(g.i)); draw();
  };
  const stop = () => { clearInterval(g.timer); g.timer = null; g.auto = false; };
  const exit = () => { stop(); app.guiding = false; try { speechSynthesis.cancel(); } catch { /* none */ } map.setRider(null); app.goTab('route'); };

  // Demo: walk along at ×8 speed, moving to the next step when its distance is covered
  const toggleAuto = () => {
    if (g.auto) { stop(); draw(); return; }
    g.auto = true; let walked = 0; const kmh = { wheelchair: 3.6, blind: 3.6, lowslope: 4 }[plan.profile] || 4.8;
    g.timer = setInterval(() => {
      if (g.i >= steps.length) { stop(); draw(); return; }
      const st = steps[g.i]; walked += kmh / 3.6 * 8 * 0.5;
      const f = Math.min(1, walked / st.len);
      map.setRider([st.at[0] + (st.end[0] - st.at[0]) * f, st.at[1] + (st.end[1] - st.at[1]) * f]);
      if (walked >= st.len) { walked = 0; go(g.i + 1); }
    }, 500);
    draw();
  };

  function draw() {
    clear(body);
    const done = g.i >= steps.length; const st = steps[g.i]; const next = steps[g.i + 1];
    const left = steps.slice(g.i).reduce((a, s) => a + s.len, 0);
    const cautions = st ? stepCautions(st) : [];
    body.append(...[
      h('div.row-between', null, h('span.pill.accent', null, `음성 안내 · ${PROFILE_NAME[plan.profile] || '걷기'}`), h('button.btn.small', { type: 'button', onclick: exit }, '끝내기')),
      h('section.guide-card' + (cautions.length ? '.caution' : ''), { 'aria-live': 'polite' },
        h('div.guide-count', null, done ? '도착' : `${g.i + 1} / ${steps.length}단계`),
        h('div.guide-title', null, done ? '목적지에 도착했어요' : stepTitle(st, g.i)),
        cautions.length ? h('ul.guide-cautions', null, cautions.map(c => h('li', null, c))) : null,
        done ? null : h('div.guide-left', null, `남은 거리 ${fmtM(left)}`)),
      h('div.guide-controls', null,
        h('button.guide-btn', { type: 'button', onclick: () => go(g.i - 1), disabled: g.i === 0, 'aria-label': '이전 단계' }, h('span', { html: ICON.prev }), '이전'),
        h('button.guide-btn.main', { type: 'button', onclick: () => speak(sentence(g.i)), 'aria-label': '다시 듣기' }, h('span', { html: ICON.repeat }), '다시 듣기'),
        h('button.guide-btn', { type: 'button', onclick: () => go(g.i + 1), disabled: done, 'aria-label': '다음 단계' }, h('span', { html: ICON.next }), '다음')),
      next ? h('p.guide-next', null, '다음: ', stepTitle(next, g.i + 1)) : null,
      h('button.btn.ghost', { type: 'button', onclick: toggleAuto }, h('span', { html: g.auto ? ICON.pause : ICON.play }), g.auto ? ' 자동 따라가기 멈춤' : ' 자동으로 따라가기 (시연)'),
      g.voice ? null : h('p.note.warn', null, '이 브라우저에서는 음성 읽기를 쓸 수 없어 글자로 안내합니다.'),
      h('p.muted', { style: { fontSize: '12.5px' } }, plan.profile === 'blind' ? '실제 사용 때는 휴대폰 GPS로 단계가 자동으로 넘어가고, 화면을 보지 않아도 되도록 진동과 음성으로 알립니다.' : '실제 사용 때는 휴대폰 GPS로 단계가 자동으로 넘어갑니다.')].filter(Boolean));
  }

  map.flyTo(steps[0]?.at[0] ?? walk.coords[0][0], steps[0]?.at[1] ?? walk.coords[0][1], 17);
  if (!g.voice) toast('음성 읽기를 쓸 수 없어 글자로 안내합니다.');
  go(0);
}
export { metres };

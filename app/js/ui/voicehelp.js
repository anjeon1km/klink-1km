// 음성 도움 (화면 읽어주기) — 학회 피드백: 시각장애인이 앱 안에서 어디에 어떤 버튼이 있는지 알 수 있게.
// 켜면 ① 버튼·탭·선택지를 한 번 누르면 이름과 상태를 읽고, 6초 안에 한 번 더 누르면 실행합니다.
//      ② 화면(탭)이 바뀌면 위에서부터 무엇이 있는지 읽어 줍니다. ③ 키보드로 옮겨 다녀도 이름을 읽습니다.
// 휴대폰 화면읽기(TalkBack·VoiceOver)를 쓰는 분은 끈 채로 쓰면 됩니다 — 버튼마다 이름(aria-label)이 달려 있습니다.
import { prefs } from '../state.js';

let on = false, armed = null, armedAt = 0, passUntil = 0, pointerAt = 0;
const ARM_MS = 6000;
const CLICKABLE = 'button, [role="tab"], [role="radio"], a[href], summary, label.check-row, label.choice-row, label.photo-drop, input[type="checkbox"], input[type="radio"]';
const TYPABLE = 'input:not([type]), input[type="text"], input[type="search"], input[type="time"], input[type="range"], textarea, select';

export const voiceHelpOn = () => on;

export function speak(text) {
  if (!text || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; u.rate = 1; speechSynthesis.speak(u); } catch { /* voice unavailable */ }
}

export function setVoiceHelp(v, { announce = true } = {}) {
  on = !!v; prefs.set('voiceHelp', on);
  document.documentElement.dataset.voiceHelp = on ? '1' : '';
  const box = document.getElementById('vh-toggle'); if (box) box.checked = on;
  if (announce) speak(on ? `음성 도움을 켰습니다. 버튼을 한 번 누르면 이름을 읽고, 한 번 더 누르면 실행합니다. ${describeScreen()}` : '음성 도움을 껐습니다.');
}

export function initVoiceHelp() {
  document.addEventListener('pointerdown', () => { pointerAt = Date.now(); }, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', e => {
    if (!on) return;
    const el = e.target;
    if (el.matches?.(TYPABLE)) speak(describe(el));
    else if (Date.now() - pointerAt > 600 && el.matches?.(CLICKABLE)) speak(describe(el)); // 키보드로 옮겨 온 경우만
  });
  setVoiceHelp(prefs.get('voiceHelp', false), { announce: false });
}

function onClick(e) {
  if (!on || !e.isTrusted) return;
  const now = Date.now();
  if (now < passUntil) return; // 두 번째 누름이 만든 후속 클릭(라벨 → 체크 상자 등)은 그대로 통과
  const el = e.target.closest?.(CLICKABLE);
  if (!el || el.disabled) return;
  if (armed === el && now - armedAt < ARM_MS) { armed = null; passUntil = now + 400; return; }
  e.preventDefault(); e.stopPropagation();
  armed?.classList.remove('vh-armed');
  armed = el; armedAt = now; el.classList.add('vh-armed');
  setTimeout(() => el.classList.remove('vh-armed'), ARM_MS);
  speak(`${describe(el)}. 한 번 더 누르면 ${actionWord(el)}.`);
}

const clean = t => String(t || '').replace(/[⇅◎✕←→↑↓…✓]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
function nameOf(el) {
  const aria = el.getAttribute('aria-label'); if (aria) return clean(aria);
  if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l && !l.contains(el)) return clean(l.textContent); }
  return clean(el.textContent) || clean(el.title) || clean(el.placeholder);
}
function inputOf(el) { return el.matches('input') ? el : el.querySelector('input') || (el.htmlFor && document.getElementById(el.htmlFor)); }
function stateOf(el) {
  const role = el.getAttribute('role');
  if (role === 'tab') return `탭${el.getAttribute('aria-selected') === 'true' ? ', 지금 화면' : ''}`;
  if (role === 'radio') return `선택지${el.getAttribute('aria-checked') === 'true' ? ', 선택됨' : ''}`;
  if (el.tagName === 'SUMMARY') return `펼치기 단추, ${el.parentElement?.open ? '펼쳐져 있음' : '접혀 있음'}`;
  if (el.matches('label, input')) {
    const i = inputOf(el);
    if (i?.type === 'checkbox') return `체크 상자, ${i.checked ? '켜짐' : '꺼짐'}`;
    if (i?.type === 'radio') return `선택지${i.checked ? ', 선택됨' : ''}`;
    if (i?.type === 'file') return '사진 찍기 단추';
  }
  if (el.tagName === 'A') return '링크';
  return `버튼${el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true' ? ', 선택됨' : ''}`;
}
function actionWord(el) {
  if (el.getAttribute('role') === 'tab') return '이 화면으로 갑니다';
  if (el.tagName === 'SUMMARY') return el.parentElement?.open ? '접습니다' : '펼칩니다';
  const i = el.matches('label, input') ? inputOf(el) : null;
  if (i?.type === 'checkbox') return i.checked ? '끕니다' : '켭니다';
  if (i?.type === 'radio' || el.getAttribute('role') === 'radio') return '고릅니다';
  if (i?.type === 'file') return '카메라를 엽니다';
  return '실행합니다';
}
function describe(el) {
  if (el.matches(TYPABLE)) {
    const v = el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent : el.value;
    return `${nameOf(el)}, ${el.tagName === 'SELECT' ? '목록' : el.type === 'range' ? '조절 막대' : '입력칸'}${v ? `, 지금 ${clean(v)}` : ', 비어 있음'}`;
  }
  return `${nameOf(el)}, ${stateOf(el)}`;
}

// 지금 화면을 위에서부터 짧게 소개 (탭이 바뀔 때, 「이 화면 설명 듣기」를 누를 때)
export function describeScreen() {
  const app = document.getElementById('app'); if (!app) return '';
  const mode = app.dataset.mode === 'policy' ? '정책 대시보드' : '시민 앱';
  const tabs = [...document.querySelectorAll('#tabs [role="tab"]')].filter(t => t.offsetParent);
  const tab = tabs.find(t => t.getAttribute('aria-selected') === 'true');
  const body = document.getElementById('panel-body');
  const parts = [`${mode}, ${clean(tab?.textContent)} 화면입니다.`,
    `맨 위에는 보기 설정, 시각, 피드백 단추가 있고, 그 아래 탭이 ${tabs.length}개 있습니다.`,
    `지도는 화면 ${window.innerWidth <= 860 ? '위쪽' : '오른쪽'}에 있습니다. 내용은 위에서부터:`];
  const seen = new Set(); const items = [];
  body?.querySelectorAll('h3, input.od-input, .quick-dest, .profile-grid, .hero-eyebrow, .hero-main, .hero-line, .btn.primary, .alt-list, .more-block').forEach(el => {
    if (!el.offsetParent || items.length >= 14 || [...seen].some(s => s.contains(el))) return;
    if (el.matches('h3') && el.parentElement?.querySelector('.alt-list')) return; // 「다른 방법 N가지」로 한 번만
    let t = '';
    if (el.matches('input')) t = describe(el);
    else if (el.matches('.quick-dest')) { t = `자주 가는 곳 단추 ${el.querySelectorAll('button').length}개`; seen.add(el); }
    else if (el.matches('.profile-grid')) { const c = el.querySelector('[aria-checked="true"]'); t = `이동 방식 ${el.children.length}가지, 지금은 ${clean(c?.textContent)}`; seen.add(el); }
    else if (el.matches('.alt-list')) { t = `다른 방법 ${el.querySelectorAll('.alt-row').length}가지`; seen.add(el); }
    else if (el.matches('.more-block')) { t = `자세히 보기 ${el.querySelectorAll('summary').length}개`; seen.add(el); }
    else if (el.matches('.btn')) t = `${nameOf(el)} 버튼`;
    else t = clean(el.innerText);
    if (t) items.push(t);
  });
  return [...parts, ...items.map(t => t.replace(/[.?!]$/, '') + '.')].join(' ');
}

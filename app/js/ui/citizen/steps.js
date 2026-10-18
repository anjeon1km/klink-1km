// 음성·단계 안내 문장 — 길찾기 화면과 음성 안내가 같이 씁니다 (조사 '으로/로', '을/를' 자동 선택).
export const batchim = w => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };
const ro = w => (batchim(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 8 ? '으로' : '로');
const eul = w => (batchim(w) ? '을' : '를');
export function stepTitle(st, i) {
  const d = Math.max(10, Math.round(st.len / 10) * 10);
  if (i === 0) return `${st.name}${ro(st.name)} 출발해 ${d} m`;
  if (st.turnText === '직진') return `${st.name}${eul(st.name)} 따라 ${d} m 직진`;
  if (st.turnText === '유턴') return `되돌아서 ${st.name} ${d} m`;
  return `${st.turnText}으로 돌아 ${st.name} ${d} m`;
}
// 미리 알림 (router.alertsAlong): 어떤 이용자에게 무엇을 알릴지
const ALERT_KINDS = {
  blind: ['crossUnsig', 'crossSig', 'stairs', 'steep'],
  wheelchair: ['steep', 'crossUnsig'],
  lowslope: ['steep', 'stairs'],
  general: ['crossUnsig', 'stairs', 'steep'],
};
export const alertsFor = (walk, profile) => (walk.alerts || []).filter(a => (ALERT_KINDS[String(profile).replace(/Relaxed|Steep/, '')] || ALERT_KINDS.general).includes(a.kind));
export function alertLabel(a) {
  const n = a.count > 1 ? ' (연달아)' : '';
  if (a.kind === 'crossUnsig') return `신호등 없는 횡단보도${n}`;
  if (a.kind === 'crossSig') return `신호등 있는 횡단보도${n}`;
  if (a.kind === 'stairs') return '계단';
  return `${a.slope > 0 ? '오르막' : '내리막'} ${Math.round(Math.abs(a.slope))}% · ${Math.max(10, Math.round(a.len / 10) * 10)} m`;
}
export function alertAdvice(a, profile) {
  if (a.kind === 'crossUnsig') return '멈춰서 차 소리를 확인하고 건너세요';
  if (a.kind === 'crossSig') return '신호를 기다렸다가 건너세요';
  if (a.kind === 'stairs') return '난간을 잡고 천천히 가세요';
  if (String(profile).startsWith('wheelchair')) return a.slope > 0 ? '피할 수 없는 급경사예요. 도움이 필요하면 멈춰서 요청하세요' : '피할 수 없는 급경사예요. 속도를 줄이고 브레이크를 잡으세요';
  return a.slope > 0 ? '천천히 오르세요' : '미끄러지지 않게 천천히 내려가세요';
}
// "30미터 앞, 신호등 없는 횡단보도입니다. 멈춰서 차 소리를 확인하고 건너세요."
export function alertSentence(a, ahead, profile) {
  const where = ahead >= 5 ? `${Math.round(ahead / 5) * 5}미터 앞, ` : '지금 ';
  const what = a.count > 1 && a.kind !== 'steep' ? `${alertLabel(a).replace(' (연달아)', '')}가 연달아 있습니다` : a.kind === 'steep' ? `${a.slope > 0 ? '오르막' : '내리막'} 경사 ${Math.round(Math.abs(a.slope))}퍼센트가 ${Math.max(10, Math.round(a.len / 10) * 10)}미터 이어집니다` : `${alertLabel(a)}입니다`;
  return `${where}${what}. ${alertAdvice(a, profile)}.`;
}
export function stepCautions(st) {
  const out = [];
  if (st.crossSig) out.push('신호등 있는 횡단보도');
  if (st.crossUnsig) out.push('신호등 없는 횡단보도 — 차 소리 확인');
  if (st.stairs) out.push('계단');
  if (st.maxUp >= 5) out.push(`오르막 ${Math.round(st.maxUp)}%`);
  if (st.maxDown <= -5) out.push(`내리막 ${Math.round(-st.maxDown)}%`);
  if (st.sharedM > st.len * 0.5) out.push('보도 없는 길 — 가장자리로');
  return out;
}

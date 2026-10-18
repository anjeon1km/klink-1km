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

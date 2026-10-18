// 환승구간(링크) 등급과 비용 — 정책안 3장 '환승구간 등급' 표와 앱안 3장 '안전 경로 엔진'을 코드로 옮겼습니다.
// 링크 비용식: C_e = L_e / v_e × (1 + w_s·S_e + w_a·A_e + w_x·X_e + w_n·N_e),  적색이면 C_e = ∞ (경로에서 제외)
import { PARAMS } from './params.js';

export const CLS = { MOTORROAD: 0, PRIMARY: 1, SECONDARY: 2, TERTIARY: 3, RESIDENTIAL: 4, SERVICE: 5, CYCLEWAY: 6, FOOTWAY: 7, STEPS: 8 };
export const CLS_NAME = ['자동차전용도로', '간선도로', '보조간선', '집산도로', '생활도로', '이면·단지도로', '자전거도로', '보행로', '계단'];
export const F = { PM: 1, WALK: 2, ONEWAY: 4, BRIDGE: 8, TUNNEL: 16, CYCLELANE: 32, LIT_YES: 64, LIT_NO: 128, PARK: 256, CAMPUS: 512, MIXED: 1024, STATION: 2048, SIDEWALK: 4096, SHARED: 8192, ROUGH: 16384 };
export const GRADE_NAME = { G: '녹색', Y: '황색', R: '적색', X: 'PM 통행 불가' };
const RANK = { G: 0, Y: 1, R: 2 };
const byRank = ['G', 'Y', 'R'];
const cc = (net, i) => (net.links.cc ? net.links.cc[i] : 0);

// signed gradient (%) when travelling in direction dir (1 = a→b, -1 = b→a)
export const dirSlope = (net, i, dir) => net.links.g[i] * dir;

// 0..1 scores used in the cost formula
export function scores(net, i, dir, night) {
  const P = PARAMS.grade; const L = net.links;
  const s = dirSlope(net, i, dir);
  const S = s < 0 ? Math.min(1, -s / P.downRed) : Math.min(1, s / P.upRed);
  const A = L.acc[i];
  const X = Math.min(1, L.x[i] / P.crossYellowPer100m);
  const N = night ? Math.min(1, (1 - L.lt[i]) + (cc(net, i) ? 0 : 0.3)) : 0;
  return { S, A, X, N, s };
}

// Daytime grade from measured conditions (no policy overrides)
function measuredGrade(net, i, dir, ctx) {
  const L = net.links; const P = PARAMS.grade;
  const s = dirSlope(net, i, dir);
  if (s < -P.downRed || s > P.upRed || ctx.hotspots?.has(i)) return 'R';
  if (s <= -P.downYellow || s >= P.upYellow || L.x[i] >= P.crossYellowPer100m || L.acc[i] >= P.riskYellow) return 'Y';
  if (P.mixedTrafficYellow && (L.flags[i] & F.MIXED)) return 'Y';
  return 'G';
}

// 야간 안심 환승구간: 조도 충족 + CCTV(구간 안) + 낮 기준 녹색·황색
export function isNightSafeLink(net, i, dir = 1, ctx = {}) {
  return net.links.lt[i] >= PARAMS.grade.lightSafe && cc(net, i) > 0 && measuredGrade(net, i, dir, ctx) !== 'R';
}

// Grade for PM riding in a direction. ctx: { night, overrides?: Map(link → {corridor, day:{f,b}, night:{f,b}}), hotspots?: Set(link) }
export function linkGrade(net, i, dir, ctx = {}) {
  const L = net.links;
  if (!(L.flags[i] & F.PM)) return 'X';
  if (dir === -1 && (L.flags[i] & F.ONEWAY)) return 'X';
  // 시범구간 고시 등급(정책안 3장: 데이터 산정 → 현장 확인 → 심의 → 구청장 고시)이 있으면 그 등급을 따른다
  const ov = ctx.overrides?.get(i);
  const d = ov?.[ctx.night ? 'night' : 'day']?.[dir === 1 ? 'f' : 'b'];
  if (d) return d;
  let g = measuredGrade(net, i, dir, ctx);
  if (ctx.night && !isNightSafeLink(net, i, dir, ctx)) g = byRank[Math.min(2, RANK[g] + 1)]; // 야간 안심구간이 아니면 한 단계 상향
  return g;
}

// Human-readable reasons, used for "왜 이 구간을 피했나요?" explanations
export function linkReasons(net, i, dir, ctx = {}) {
  const L = net.links; const P = PARAMS.grade; const out = [];
  if (!(L.flags[i] & F.PM)) {
    const c = L.cls[i];
    out.push(c === CLS.MOTORROAD ? '자동차전용도로 — PM 통행 금지' : c === CLS.STEPS ? '계단' : '보행자 전용·보도뿐인 길 — 도로교통법상 PM 보도 통행 금지');
    return out;
  }
  if (dir === -1 && (L.flags[i] & F.ONEWAY)) { out.push('일방통행 역방향'); return out; }
  const s = dirSlope(net, i, dir);
  if (s < -P.downRed) out.push(`내리막 ${(-s).toFixed(1)}% (기준 ${P.downRed}% 초과)`);
  else if (s > P.upRed) out.push(`오르막 ${s.toFixed(1)}% (기준 ${P.upRed}% 초과)`);
  else if (s <= -P.downYellow) out.push(`내리막 ${(-s).toFixed(1)}%`);
  else if (s >= P.upYellow) out.push(`오르막 ${s.toFixed(1)}%`);
  if (ctx.hotspots?.has(i)) out.push('사고다발지점 반경 50 m');
  if (L.x[i] >= P.crossYellowPer100m) out.push(`100 m 안 비신호 횡단보도 ${L.x[i]}곳`);
  if (P.mixedTrafficYellow && (L.flags[i] & F.MIXED)) out.push('버스·차량 혼용 차도');
  if (L.acc[i] >= P.riskYellow) out.push(`${net.accidentSource === 'taas' ? '사고 이력' : '교차로·정류장 상충'} 위험 ${(L.acc[i] * 100).toFixed(0)}점`);
  if (ctx.night && !isNightSafeLink(net, i, dir, ctx)) out.push(`야간 안심구간 아님 (조명 ${Math.round(L.lt[i] * 100)}점 · CCTV ${cc(net, i)}대)`);
  const ov = ctx.overrides?.get(i);
  if (ov) { const d = ov[ctx.night ? 'night' : 'day']?.[dir === 1 ? 'f' : 'b']; if (d) out.unshift(`시범구간 ${ov.corridor} 고시 등급 ${GRADE_NAME[d]}`); }
  return out;
}

// 권장 속도: 등급별 속도에 안전속도구역(역 거점 100 m 15 km/h, 캠퍼스·병원 앞 10 km/h)을 겹쳐 낮은 값
export function speedFor(grade, night, net = null, i = -1) {
  const S = PARAMS.speed; const t = night ? S.night : S.day;
  let v = t[grade] ?? t.R;
  if (net && i >= 0) {
    const f = net.links.flags[i];
    if (f & F.STATION) v = Math.min(v, S.stationZone);
    if (f & F.CAMPUS) v = Math.min(v, S.campusZone);
  }
  return v;
}

// Travel cost in seconds-equivalent for the 'safe' PM profile. Returns Infinity for red / not rideable.
export function safeCost(net, i, dir, ctx) {
  const g = linkGrade(net, i, dir, ctx);
  if (g === 'X' || g === 'R') return Infinity;
  const { S, A, X, N } = scores(net, i, dir, ctx.night);
  const w = ctx.weights || PARAMS.weights;
  const v = speedFor(g, ctx.night, net, i) / 3.6;
  return net.links.len[i] / v * (1 + w.s * S + w.a * A + w.x * X + w.n * N);
}

// 'fast' PM profile: legal PM links only, red allowed, no risk penalty (used for the comparison line)
export function fastCost(net, i, dir, ctx) {
  const g = linkGrade(net, i, dir, ctx);
  if (g === 'X') return Infinity;
  return net.links.len[i] / (PARAMS.speed.day.G / 3.6);
}

// ── 보행 경로 프로필 (교통약자 포함)
// 장애인등편의법 시행규칙: 보도 기울기 1/18(5.6%) 이하, 경사로 1/12(8.3%) 이하. 휠체어는 8%를 넘는 길과 계단을 뺍니다.
export const WALK_PROFILES = {
  general: { name: '걷기', kmh: 4.8 },
  wheelchair: { name: '휠체어', kmh: 3.6, maxSlope: 8, slopeFrom: 3, slopeW: 0.35, noSteps: true, noRough: true, unsigW: 0.6, sharedW: 0.3, blockReports: true },
  blind: { name: '시각장애', kmh: 3.6, slopeFrom: 6, slopeW: 0.1, stepsW: 2, roughW: 1, unsigW: 1.5, sharedW: 0.8, pathW: 0.5, blockReports: true },
  lowslope: { name: '경사 적게', kmh: 4.0, maxSlope: 12, slopeFrom: 3, slopeW: 0.3, stepsW: 2 },
};
// 기준을 지키는 길이 없을 때 쓰는 완화 프로필 (가장 완만한 길 + 경고)
WALK_PROFILES.wheelchairRelaxed = { ...WALK_PROFILES.wheelchair, name: '휠체어 (완화)', maxSlope: 16, slopeW: 0.8 };
WALK_PROFILES.lowslopeRelaxed = { ...WALK_PROFILES.lowslope, name: '경사 적게 (완화)', maxSlope: null, slopeW: 0.6 };

// Tobler hiking function scaled so flat ground = base km/h
export function walkSpeed(slopePct, kmh = PARAMS.walkKmh) {
  const s = slopePct / 100;
  return kmh / 3.6 * Math.exp(-3.5 * Math.abs(s + 0.05)) / Math.exp(-3.5 * 0.05);
}
// ctx: { night, preferLit, profile: key of WALK_PROFILES, blocked: Set(link) — 시민이 제보한 보도 파손·단절 }
export function walkCost(net, i, dir, ctx = {}) {
  const L = net.links; const f = L.flags[i];
  if (!(f & F.WALK)) return Infinity;
  const P = WALK_PROFILES[ctx.profile] || WALK_PROFILES.general;
  const s = dirSlope(net, i, dir), as = Math.abs(s);
  if (P.maxSlope && as > P.maxSlope) return Infinity;
  if (P.noSteps && L.cls[i] === CLS.STEPS) return Infinity;
  if (P.noRough && (f & F.ROUGH)) return Infinity;
  if (ctx.blocked?.has(i) && P.blockReports) return Infinity;
  let t = L.len[i] / walkSpeed(s, P.kmh);
  let pen = 0;
  if (L.cls[i] === CLS.STEPS) pen += P.stepsW ?? 0.6;
  if (P.slopeW && as > P.slopeFrom) pen += P.slopeW * (as - P.slopeFrom);
  if (P.unsigW) pen += P.unsigW * Math.min(1, L.x[i] / 2);
  if (P.sharedW && (f & F.SHARED)) pen += P.sharedW;
  if (P.roughW && (f & F.ROUGH)) pen += P.roughW;
  if (P.pathW && L.cls[i] === CLS.FOOTWAY && !(f & F.SIDEWALK)) pen += P.pathW;
  if (ctx.blocked?.has(i)) pen += 3;
  if (ctx.night && ctx.preferLit) pen += 1.5 * (1 - L.lt[i]) + (cc(net, i) ? 0 : 0.3);
  return t * (1 + pen);
}
// Real walking seconds for a link (no preference penalties) — used for displayed times
export function walkSeconds(net, i, dir, profile = 'general') {
  const P = WALK_PROFILES[profile] || WALK_PROFILES.general;
  return net.links.len[i] / walkSpeed(dirSlope(net, i, dir), P.kmh) * (net.links.cls[i] === CLS.STEPS ? 1.6 : 1);
}

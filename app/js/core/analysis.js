// 지역 유형 분류(K-Link 1km 4장), TAI×PUI 4유형(정책제안서 표7), K-means 군집, 정책 시뮬레이터, 탄소 산식.
import { PARAMS } from './params.js';

export const TYPES = {
  E: { name: 'E형 종합취약형', short: '종합취약', rule: '접근성·안전·서비스 공백이 동시에 높음', policy: ['우선개선지역 지정', '복합정책·예산 집중', '야간 DRT + 안전시설 + 환승거점 동시 투입'] },
  B: { name: 'B형 PM 의존형', short: 'PM 의존', rule: '접근성 부족·PM 이용·사고위험이 모두 높음', policy: ['저탄소 환승거점', '안전한 마지막 1km 지정', '야간 DRT', 'PM–대중교통 통합요금'] },
  C: { name: 'C형 대중교통 고립형', short: '대중교통 고립', rule: '대중교통 접근성이 낮고 PM 이용도 낮음', policy: ['수요응답형 교통(DRT)', '마을버스 노선 조정', '공공셔틀·계층형 모빌리티 허브'] },
  A: { name: 'A형 연결-위험형', short: '연결-위험', rule: '접근성은 양호하나 PM·보행 위험이 높음', policy: ['보호도로·조명·횡단시설', '속도저감', '위험구간 PM 자동감속(지오펜싱)'] },
  D: { name: 'D형 탄소전환형', short: '탄소전환', rule: '자동차·택시 대체 가능성이 높고 PM–대중교통 연결이 가능', policy: ['환승할인', '주차·반납존', '공공 MaaS', '자동차 대체 캠페인'] },
  N: { name: '기본관리', short: '기본', rule: '두드러진 취약요인 없음', policy: ['정기 재평가', '시민 제보 모니터링'] },
  P: { name: '녹지·비거주', short: '녹지', rule: '공원·산지 위주로 생활권 도로가 거의 없음 (순위 산정 제외)', policy: ['산책로 보행 안전', 'PM 진입 제한'] },
};
export const TYPE_ORDER = ['E', 'B', 'C', 'A', 'D', 'N', 'P'];

// comp: {A,R,D,C} 0–100 percentiles within the district; puiPct: PM/bike use percentile
export function classifyCell(comp, puiPct) {
  const { high, mid, low } = PARAMS.typeCut;
  if (comp.A >= high && comp.R >= high && comp.D >= high) return 'E';
  if (comp.A >= mid && puiPct >= 60 && comp.R >= mid) return 'B';
  if (comp.A >= high && puiPct < 40) return 'C';
  if (comp.A < mid && comp.R >= high) return 'A';
  if (comp.C >= high && comp.A < high) return 'D';
  return 'N';
}

export const QUADS = {
  I: { name: 'Ⅰ 연계형', rule: 'TAI 높음 · PUI 높음', policy: '역 주변 모빌리티 허브, PM 전용 주차구역, 보행 안전' },
  II: { name: 'Ⅱ PM 의존형', rule: 'TAI 낮음 · PUI 높음', policy: 'PM 공식 연계수단 지정, 환승할인, 공익 운영구역' },
  III: { name: 'Ⅲ 이중 취약형', rule: 'TAI 낮음 · PUI 낮음', policy: 'DRT 최우선 투입, 노선 조정, 교통약자 맞춤 서비스' },
  IV: { name: 'Ⅳ 대중교통 충분형', rule: 'TAI 높음 · PUI 낮음', policy: '보행 우선, 킥보드 없는 거리 등 공간 관리' },
};
export function quadrant(taiPct, puiPct) {
  const hiT = taiPct >= 50, hiP = puiPct >= 50;
  return hiT && hiP ? 'I' : !hiT && hiP ? 'II' : !hiT && !hiP ? 'III' : 'IV';
}

// Deterministic k-means++ (seeded LCG) — the same input always gives the same clusters.
export function kmeans(rows, k, seed = 1, iters = 60) {
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const d2 = (a, b) => a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0);
  const cents = [rows[Math.floor(rnd() * rows.length)].slice()];
  while (cents.length < k) {
    const dd = rows.map(r => Math.min(...cents.map(c => d2(r, c)))); const tot = dd.reduce((a, b) => a + b, 0);
    let t = rnd() * tot, i = 0; while (i < rows.length - 1 && (t -= dd[i]) > 0) i++;
    cents.push(rows[i].slice());
  }
  let labels = new Array(rows.length).fill(0);
  for (let it = 0; it < iters; it++) {
    const nl = rows.map(r => { let b = 0, bd = Infinity; cents.forEach((c, j) => { const v = d2(r, c); if (v < bd) { bd = v; b = j; } }); return b; });
    const changed = nl.some((v, i) => v !== labels[i]); labels = nl;
    for (let j = 0; j < k; j++) { const m = rows.filter((_, i) => labels[i] === j); if (m.length) cents[j] = m[0].map((_, d) => m.reduce((a, r) => a + r[d], 0) / m.length); }
    if (!changed && it > 0) break;
  }
  // order clusters by mean of first+second dims (access deficit + risk) so labels are stable & meaningful
  const order = cents.map((c, j) => [c[0] + c[1] + c[2] * 0.5, j]).sort((a, b) => b[0] - a[0]).map(o => o[1]);
  const remap = new Map(order.map((j, i) => [j, i]));
  return { labels: labels.map(l => remap.get(l)), centroids: order.map(j => cents[j]) };
}

// ── 탄소 (정책제안서 Ⅱ-6): 순감축(g/인·km) = Σ(대체수단 비중 × 배출계수) − PM 배출계수
export function netSavingPerKm(replace = PARAMS.carbon.replace, efPm = PARAMS.carbon.ef.pmNow) {
  const ef = PARAMS.carbon.ef;
  return replace.car * ef.car + replace.transit * ef.bus - efPm;
}
export const breakEvenCarShare = (transit = 0.10, efPm = PARAMS.carbon.ef.pmNow) => (efPm - transit * PARAMS.carbon.ef.bus) / PARAMS.carbon.ef.car;

// ── 정책 시뮬레이터: 개입별 구성지표 변화 (가정치 — 시범사업 전후 비교로 보정)
export const INTERVENTIONS = {
  hub: { name: '저탄소 환승거점 설치', desc: 'PM 주차·충전·정보 거점 → 역 접근권역 확대(PM 10분 권역 3.7배)', effect: { A: -0.25, C: +0.10 } },
  light: { name: '야간 조명·CCTV 보강', desc: '조명 점수 미달 구간을 안심구간으로 전환', effect: { Rn: -0.30, R: -0.05 } },
  crossing: { name: '횡단시설·신호 개선', desc: '비신호 횡단보도 신호화, 교차로 시야 확보', effect: { R: -0.15, Rn: -0.10 } },
  geofence: { name: '위험구간 PM 자동감속', desc: '적색·황색 구간 지오펜싱 감속 (20→15/10 km/h)', effect: { R: -0.15, Rn: -0.15 } },
  drt: { name: '야간 DRT·마을버스 연장', desc: '막차 이후 수요응답형 셔틀, 마을버스 막차 연장', effect: { D: -0.40, An: -0.20 } },
  fare: { name: 'PM–대중교통 통합요금', desc: '역·정류장 250 m 연계 통행 환승할인 → 승용차 대체율 상승', effect: { C: -0.05, carShare: +0.13 } },
};

export function simulate(cell, picks) {
  const W = PARAMS.ptvi; const c = { ...cell.comp }, n = { ...cell.compN };
  let carShare = PARAMS.carbon.replace.car;
  for (const k of picks) {
    const e = INTERVENTIONS[k].effect;
    if (e.A) { c.A *= 1 + e.A; n.A *= 1 + e.A; }
    if (e.An) n.A *= 1 + e.An;
    if (e.R) c.R *= 1 + e.R;
    if (e.Rn) n.R *= 1 + e.Rn;
    if (e.D) { c.D *= 1 + e.D; n.D *= 1 + e.D; }
    if (e.C) { c.C *= 1 + e.C; n.C *= 1 + e.C; }
    if (e.carShare) carShare += e.carShare;
  }
  const ptvi = W.A * c.A + W.R * c.R + W.D * c.D + W.C * c.C;
  const nightTvi = W.A * n.A + W.R * n.R + W.D * n.D + W.C * n.C;
  return { comp: c, compN: n, ptvi, nightTvi, carShare };
}

// annual CO2 change (t) for a number of PM trips/day under a car-substitution share
export function annualCo2(tripsPerDay, carShare, efPm = PARAMS.carbon.ef.pmNow, km = PARAMS.carbon.pmAvgKm) {
  const rep = { car: carShare, transit: PARAMS.carbon.replace.transit };
  return netSavingPerKm(rep, efPm) * km * tripsPerDay * 365 / 1e6;
}

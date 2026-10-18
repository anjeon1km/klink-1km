// PM 연계환승 인정·할인 판정 — 정책안 4장(인정 요건·할인 단계)과 6장(야간 특례), 앱안 4장(반납 인증·부정 이용 방지).
// 인정 요건(모두 충족): ① 시간 — 하차 태그 후 30분 안 대여 / 반납 후 30분 안 승차 태그 ② 장소 — 출발·반납 중 한 곳 이상이
// A·B급 환승거점 ③ 거리·시간 상한 — PM 구간 2 km·20분 이하 ④ 계정 연동 ⑤ 1일 4회 한도.
// 할인: 기본(잠금해제료 면제) → 안전(+ 주행요금 마일리지: 적색 미통과·속도 준수·정위치 주차) → 야간(22~01시, 야간 안심거점: + 심야 할증 면제)
import { PARAMS } from './params.js';
import { metres } from './graph.js';

export const LEVEL = {
  none: { name: '환승 미인정', short: '미인정' },
  pending: { name: '환승 대기', short: '대기' },
  basic: { name: '기본 환승', short: '기본' },
  safe: { name: '안전 환승', short: '안전' },
};

const minutes = (a, b) => (b - a) / 60000;
const ABHub = h => h && (h.grade === 'A' || h.grade === 'B');

/**
 * trip = {
 *   direction: 'toPm' (대중교통 하차 → PM) | 'toTransit' (PM → 대중교통 승차),
 *   tagTime: Date|null, rentTime, returnTime: Date, rentPos, returnPos: {lat, lon},
 *   rentHub, returnHub: hub|null, photo: boolean, photoTime: Date|null,
 *   redLinks: number, overSpeedShare: 0..1, rideM: number, todayCount: number, tagUsed: boolean,
 *   linked: boolean (교통카드·업체 계정 연동), helmet: boolean (공유 헬멧 인증), nearStationM: number|null
 * }
 */
export function judge(trip) {
  const T = PARAMS.transfer, B = T.benefit;
  const met = [], unmet = [], tips = [], notes = [];
  const hubDist = (pos, hub) => (hub ? metres(pos.lat, pos.lon, hub.lat, hub.lon) : Infinity);
  const dRent = hubDist(trip.rentPos, trip.rentHub), dRet = hubDist(trip.returnPos, trip.returnHub);
  const atRent = dRent <= 50 && trip.rentHub, atRet = dRet <= T.hubRadiusM && trip.returnHub;
  const durMin = minutes(trip.rentTime, trip.returnTime);
  const hour = trip.returnTime.getHours();
  const fail = (reason, tip) => result('none', met, [...unmet, reason], tip ? [tip] : tips);

  // 비거점 반납 경고 (역 반경 300 m 안이면 업체 추가요금)
  if (!atRet && trip.nearStationM != null && trip.nearStationM <= T.stationNoHubM) notes.push(`역 반경 ${T.stationNoHubM} m 안 비거점 반납 — 업체 추가요금 대상`);

  // ── 부정 이용 방지 (앱안 4장)
  if (trip.rentHub && trip.returnHub && trip.rentHub.id === trip.returnHub.id && (trip.rideM < T.minTripM || durMin < T.minTripMin)) return fail('같은 거점에서 빌려 곧바로 같은 거점에 반납 (300 m·2분 미만)', '다른 거점까지 이동한 통행만 환승으로 인정됩니다.');
  if (trip.tagUsed) return fail('이 교통카드 태그는 이미 다른 PM 이용과 연결됨');
  // ── ⑤ 1일 4회
  if (trip.todayCount >= T.dailyLimit) return fail(`하루 인정 한도 ${T.dailyLimit}회 초과`, '내일 다시 환승 혜택을 받을 수 있습니다.');
  // ── ④ 계정 연동
  if (trip.linked === false) return fail('교통카드와 PM 업체 계정이 연동되지 않음', '앱에서 교통카드·업체 계정을 연결하면 자동으로 판정합니다.');
  met.push('교통카드·업체 계정 연동');
  // ── ③ 거리·시간 상한
  if (trip.rideM > T.maxRideM || durMin > T.maxRideMin) return fail(`PM 구간 ${(trip.rideM / 1000).toFixed(1)} km·${Math.round(durMin)}분 — 상한 ${T.maxRideM / 1000} km·${T.maxRideMin}분 초과`, '연계 통행만 지원합니다. 긴 이동은 대중교통을 이용하세요.');
  met.push(`PM 구간 ${(trip.rideM / 1000).toFixed(1)} km·${Math.max(1, Math.round(durMin))}분 (상한 2 km·20분 이내)`);
  // ── 01~05시 심야: 심야버스 정류장 거점에서만 인정 (정책안 6장)
  if (T.lateNightHours.includes(hour) && !((atRent && trip.rentHub.nightBus) || (atRet && trip.returnHub.nightBus))) return fail('01~05시 심야에는 심야버스 정류장 거점에서만 인정', '지하철 운행이 끝난 시간에는 심야버스와 이어지는 거점을 이용하세요.');
  // ── ① 시간
  if (trip.direction === 'toTransit' && !trip.tagTime) return result('pending', [...met, `${trip.returnHub ? trip.returnHub.name : '반납 위치'}에 반납 완료`], unmet, [`반납 후 ${T.windowMin}분 안에 버스·지하철을 타면 혜택이 사후 적립됩니다.`]);
  const gap = trip.direction === 'toPm' ? minutes(trip.tagTime, trip.rentTime) : minutes(trip.returnTime, trip.tagTime);
  if (gap < 0 || gap > T.windowMin) return fail(trip.direction === 'toPm' ? `하차 태그 후 ${Math.round(gap)}분 뒤 대여 (기준 ${T.windowMin}분 이내)` : `반납 후 ${Math.round(gap)}분 뒤 승차 (기준 ${T.windowMin}분 이내)`, '환승은 태그 전후 30분 안에 이어진 이동만 인정됩니다.');
  met.push(trip.direction === 'toPm' ? `하차 태그 ${Math.round(gap)}분 뒤 대여` : `반납 ${Math.round(gap)}분 뒤 승차 태그`);
  // ── 거점 반납 (비인정: 거점 밖 반납 — 역 앞 방치를 막는 요건)
  if (!atRet) return fail(isFinite(dRet) ? `반납 위치가 거점 밖 ${Math.round(dRet - T.hubRadiusM)} m (반경 ${T.hubRadiusM} m 기준)` : '환승거점이 아닌 곳에 반납', '가장 가까운 거점 바닥 표시 안으로 옮겨 반납하세요. GPS 오차라면 이의 제기를 누르세요.');
  met.push(`${trip.returnHub.name} 반경 ${T.hubRadiusM} m 안 반납`);
  // ── ② 장소: 출발·반납 중 한 곳 이상 A·B급 거점
  const abRent = atRent && ABHub(trip.rentHub), abRet = atRet && ABHub(trip.returnHub);
  if (!abRent && !abRet) return fail('출발·반납 모두 A·B급 환승거점이 아님 (C급 보조거점끼리는 미인정)', 'A·B급 환승거점(역 출구·대학·병원 입구)에서 빌리거나 반납하세요.');
  met.push(abRent ? `${trip.rentHub.name}(${trip.rentHub.grade}급)에서 대여` : `${trip.returnHub.name}(${trip.returnHub.grade}급) 거점 이용`);
  let level = 'basic';

  // ── 안전: 적색 미통과 + 속도구역 준수 + 정위치 주차(바닥 표시가 보이는 앱 촬영 사진)
  const photoOk = trip.photo && (!trip.photoTime || Math.abs(minutes(trip.returnTime, trip.photoTime)) <= 5);
  const checks = [
    [trip.redLinks === 0, '적색 구간 통과 없음', `적색 구간 ${trip.redLinks}곳 통과 — 환승은 인정, 안전 보너스 없음`],
    [(trip.overSpeedShare || 0) <= 0.1, '안전속도구역 준수', `권장속도 초과 주행 ${Math.round((trip.overSpeedShare || 0) * 100)}%`],
    [photoOk, '정위치 주차 사진 확인 (앱에서 촬영, 시각 일치)', '반납 사진 없음 또는 촬영 시각 불일치'],
  ];
  checks.forEach(([ok, good, bad]) => (ok ? met : unmet).push(ok ? good : bad));
  if (checks.every(c => c[0])) level = 'safe';
  else tips.push('적색 구간을 피하고 권장 속도로 달린 뒤 거점 바닥 표시 안에 세우고 사진을 찍으면 안전 환승(주행요금 마일리지)을 받습니다.');

  // ── 야간 특례: 22~01시 + 야간 안심거점 출발·도착
  const nightHub = (abRent && trip.rentHub.nightSafe) || (abRet && trip.returnHub.nightSafe);
  let night = false;
  if (T.nightHours.includes(hour)) {
    if (nightHub) { night = true; met.push('22~01시 야간 안심거점 이용 — 심야 할증 면제'); }
    else unmet.push('22~01시지만 야간 안심거점에서 출발·도착하지 않음');
  }
  if (trip.helmet && level === 'safe') met.push('공유 헬멧 착용 인증');
  return result(level, met, unmet, tips, night);

  function result(lv, m, u, t, nightFlag = false) {
    const benefits = [];
    if (lv === 'basic' || lv === 'safe') benefits.push({ label: '잠금해제료 면제', value: B.unlockFee, unit: '원' });
    if (lv === 'safe') benefits.push({ label: '주행요금 마일리지', value: B.safeMileage, unit: 'M' });
    if (lv === 'safe' && trip.helmet) benefits.push({ label: '헬멧 인증 마일리지', value: B.helmetMileage, unit: 'M' });
    if (nightFlag && (lv === 'basic' || lv === 'safe')) benefits.push({ label: '심야 할증 면제', value: B.nightSurcharge, unit: '원' });
    const won = benefits.filter(b => b.unit === '원').reduce((a, b) => a + b.value, 0);
    const mileage = benefits.filter(b => b.unit === 'M').reduce((a, b) => a + b.value, 0);
    const levelName = (nightFlag && lv !== 'none' && lv !== 'pending' ? '야간 ' : '') + LEVEL[lv].name;
    return { level: lv, night: nightFlag, levelName, met: m, unmet: u, tips: t, notes, benefits, won, mileage, at: new Date().toISOString(), direction: trip.direction };
  }
}

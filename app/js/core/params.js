// 모든 기준값·가중치·가정치를 한곳에 모은 파일입니다. 파이프라인(Node)과 앱(브라우저)이 같은 값을 씁니다.
// 근거: 「PM 대중교통 환승제도 편입 정책 개발안」(정책안) 3~6장, 「안전한 1km 환승 앱 개발안」(앱안) 3~5장.
// '가정'으로 적힌 값은 교수 자문·시범운영으로 보정해야 하는 초기값입니다.

export const PARAMS = {
  // ── 환승구간 등급 (정책안 3장 표: 가장 나쁜 항목을 따름) ─────────────────────
  grade: {
    downYellow: 5,         // % 내리막 5~8% 황색
    downRed: 8,            // % 내리막 8% 초과가 30 m 이상 이어지면 적색
    upYellow: 8,           // % 오르막 8~15% 황색
    upRed: 15,             // % 오르막 15% 초과 적색
    slopeWindow: 30,       // m — 경사는 최소 30 m 구간 평균
    crossYellowPer100m: 2, // 비신호 횡단보도 100 m당 2곳 이상 황색
    riskYellow: 0.5,       // 위험 점수(사고 이력 또는 대리지표) 0.5 이상 황색
    mixedTrafficYellow: true, // 버스·차량 혼용 차도(자전거도로·차로 없는 간선·보조간선·집산도로) 황색
    lightSafe: 0.7,        // 조명 점수 0.7 이상 = 조도 기준 충족 (보안등 자료 연동 전에는 추정)
    cctvRadius: 100,       // m — 구간 안 CCTV (야간 안심구간 요건 ②)
  },
  // 야간 안심 환승구간 = ① 조도 충족 ② CCTV 또는 비상벨 ③ 낮 기준 녹색·황색. 못 채우면 야간에 한 단계 상향.
  speed: { // km/h — 정책안 5장 안전속도구역
    day: { G: 20, Y: 15, R: 10 },
    night: { G: 15, Y: 10, R: 10 }, // 야간은 한 단계 낮게
    stationZone: 15,   // 역 거점 반경 100 m
    campusZone: 10,    // 캠퍼스·병원 앞 보행 밀집
    stationZoneM: 100,
  },
  weights: { s: 1, a: 1, x: 1, n: 1 }, // 링크 비용식 가중치 w_s, w_a, w_x, w_n (초깃값 1)
  night: { start: 22, end: 5 },        // 야간 모드 자동 전환 시각

  // ── 이동 속도 ─────────────────────────────────────────────────────────
  walkKmh: 4.8,      // 평지 보행속도 (PTAL 기준, 정책제안서)
  pmAvgKmh: 13.5,    // 서울 전동킥보드 평균 주행속도 (권준현·이수기 2025)
  pmUnlockMin: 1.5,  // 대여·잠금해제 소요 (가정)
  pmParkMin: 0.5,    // 반납·사진 촬영 소요 (가정)
  busKmh: 15,        // 마을버스 운행속도 (가정, 정차 포함)

  // ── 대중교통 접근성 지수 TAI (PTAL 변형, 정책제안서 Ⅰ-2) ─────────────────
  tai: {
    busRadius: 640, railRadius: 960, // m (도보 네트워크 거리)
    reliability: { bus: 2.0, rail: 0.75 }, // 분, PTAL 신뢰도 가산
    headway: { // 분 — 노선유형별 주간 배차 (가정: 실시간 API 연동 전)
      trunk: 8, branch: 10, village: 8, express: 15, night: 30, circular: 10,
      line1: 5, line2: 5, line2b: 10, line4: 5, line5: 6, line6: 7, line7: 5, gyeongui: 12, suinbundang: 15, gyeongchun: 20, ui: 6,
    },
    lateFactor: 1.6, // 22~24시 배차 배율 (가정)
    railLastHour: 24.5, // 지하철 막차 기준 시각 (00:30, 가정 — 회기역 00~01시 승차 실적과 부합)
  },

  // ── PTVI (K-Link 1km 3.1) ───────────────────────────────────────────
  ptvi: { A: 0.30, R: 0.30, D: 0.20, C: 0.20 },
  typeCut: { high: 66.7, mid: 50, low: 33.3 },

  // ── 환승 인정·할인 (정책안 4장, 6장) ─────────────────────────────────
  transfer: {
    windowMin: 30,        // 대중교통 태그 전후 30분 (티머니GO 환승 마일리지와 같은 기준)
    hubRadiusM: 15,       // 거점 GPS 반경 15 m + 반납 사진
    maxRideM: 2000, maxRideMin: 20, // PM 구간 2 km·20분 이하 (서울 평균 1.01 km·5분, 1.5 km 미만 76.3%)
    minTripM: 300, minTripMin: 2,   // 같은 거점 단거리 왕복 제외 (앱안 4장)
    dailyLimit: 4,        // 1일 4회
    stationNoHubM: 300,   // 역 반경 300 m 안 비거점 반납 → 업체 추가요금
    nightHours: [22, 23, 0],      // 22~01시 야간 환승 (심야 할증 면제)
    lateNightHours: [1, 2, 3, 4], // 01~05시: 심야버스 정류장 거점에서만 인정
    benefit: { // 원·마일리지 — 정책안 4장 제안값
      unlockFee: 600,       // 기본: 잠금해제료 면제 (업체 기본료 약 500~800원)
      safeMileage: 500,     // 안전: 주행요금 일부 마일리지 (최대 500원)
      nightSurcharge: 300,  // 야간: 심야 할증 면제 (예: 카카오 T +300원, 지쿠 +400원, 일레클 최대 1,500원)
      helmetMileage: 100,   // 공유 헬멧 착용 인증 시 추가 (정책안 5장, 금액은 가정)
    },
  },

  // ── 시범사업 예산 (정책안 4장, 가정) ─────────────────────────────────
  pilot: { dailyRecognized: [100, 150], avgBenefit: 800, semesterDays: 110, guShare: 0.5 },

  // ── 탄소 (정책제안서 표6, Hollingsworth 2019 → g/인·km) ────────────────
  carbon: {
    ef: { pmNow: 125.5, pmImproved: 67.2, car: 257.2, bus: 51.0 },
    // 비유럽 도시 메타분석 대체비율(Fearnley & Veisten 2025): 승용차·택시 37%, 대중교통 10%, 도보·자전거 53%
    replace: { car: 0.37, transit: 0.10, active: 0.53 },
    replaceVulnerable: { car: 0.50, transit: 0.10, active: 0.40 }, // 교통취약지역 가정
    pmAvgKm: 1.01,
  },
};

// 22시~05시 → 야간
export const isNightHour = h => h >= PARAMS.night.start || h < PARAMS.night.end;

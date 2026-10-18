// 정책 대시보드 · 데이터·방법: 출처, 등급 기준, 분석 절차, 산식, 통계·AI 모형, 조례안과 앱 기능, 한계.
import { h, clear, fmtN } from '../dom.js';
import { barList } from '../charts.js';
import { PARAMS } from '../../core/params.js';
import { store } from '../../store.js';

export function renderMethod(app, body) {
  const { data } = app; const m = data.meta, S = m.sources || {}, md = data.models || {};
  clear(body);
  const ok = (cond, yes, no) => (cond ? ['사용', yes] : ['연동 필요', no]);
  const src = [
    ['도로망·정류장·역 출구', 'OpenStreetMap (Overpass API)', `도로 링크 ${fmtN(m.counts.links)}개, 거점 후보`, ...ok(true, '')],
    ['수치지도 등고선·표고점 1:5,000', '국토지리정보원', '10 m 격자 고도 → 링크 경사(30 m 구간 평균)', ...ok(true, '')],
    ['신호등·횡단보도 위치 (2023.05)', '서울특별시', '비신호 횡단보도 밀도, 신호 여부', ...ok(true, '')],
    ['TAAS 자전거 교통사고 다발지역 (2022–24)', '도로교통공단 (data.go.kr Open API)', '사고다발지점 반경 50 m 적색', ...ok(m.accidentSource === 'taas', `${(data.layers.taas || []).length}곳`, '교차로·정류장 상충 대리지표')],
    ['CCTV 정보 (동대문구)', '동대문구청 · 전국CCTV표준데이터', '야간 안심구간 요건 ②, 야간 안심거점', ...ok(S.cctv, `${fmtN(m.counts.cctv)}곳 ${fmtN(m.counts.cctvCameras)}대`, '')],
    ['서울시 가로등 위치', '서울특별시', '조명 점수 (간선·교량·지하차도)', ...ok(true, '')],
    ['보안등 위치', '전국보안등정보표준데이터', '생활도로 조명 점수', ...ok(S.securityLights, '', '동대문구 행 없음 — 도로위계로 추정')],
    ['격자 인구 100 m (2024)', '통계청 SGIS', '생활권 판정, C(수요), 취약 인구', ...ok(S.population, `동대문구 ${fmtN(m.counts.population)}명`, '')],
    [`따릉이 대여소별 OD (${m.bikePeriod.from}–${m.bikePeriod.to})`, '서울 열린데이터광장', '공유모빌리티 이용강도 PUI, 야간 비중', ...ok(true, '')],
    ['따릉이 대여소 마스터', '서울 열린데이터광장', '대여소 ID → 좌표 (대여소별 실측 PUI)', ...ok(S.bikeMaster, '', '행정동 배분')],
    ['지하철 역별 시간대 승하차', '서울 열린데이터광장', '역별 야간 하차, 막차 시간대', ...ok(S.subwayStations > 1, `${S.subwayStations}개 역`, '회기역만')],
    ['버스 노선·정류장별 시간대 승하차 (2022.05) · 동대문01 일별 (2026)', '서울 열린데이터광장', '노선 운행 시간대·막차, 마을버스 수요', ...ok(true, '')],
    ['PM 교통사고 합성데이터 (2,232건)', '도로교통공단', '사고 심각도 GLM, 야간 위험 배율', ...ok(S.pmAccidents, '', '')],
    ['TAGO 공유 PM 실시간 위치', '국토교통부', '거점별 가용 기기', '연동 필요', '현재 시연 값'],
  ];
  body.append(h('div.card', null, h('h3', null, '데이터 출처'),
    h('div.table-wrap', null, h('table.tbl', null, h('thead', null, h('tr', null, ['데이터', '제공', '쓰임', '상태'].map(t => h('th', null, t)))),
      h('tbody', null, src.map(r => h('tr', null,
        h('td', { style: { whiteSpace: 'normal', minWidth: '150px' } }, r[0]), h('td', { style: { whiteSpace: 'normal', minWidth: '100px' } }, r[1]), h('td', { style: { whiteSpace: 'normal', minWidth: '120px' } }, r[2]),
        h('td', { style: { whiteSpace: 'normal', minWidth: '110px', color: r[3] === '사용' ? 'var(--g)' : 'var(--r)' } }, r[3], r[4] ? h('small', { style: { display: 'block', color: 'var(--muted)' } }, r[4]) : null))))))));

  // 등급 기준 (정책안 3장)
  const g = PARAMS.grade, sp = PARAMS.speed;
  const crit = [
    ['내리막 경사', `${g.downYellow}% 미만`, `${g.downYellow}~${g.downRed}%`, `${g.downRed}% 초과 30 m 이상`],
    ['오르막 경사', `${g.upYellow}% 미만`, `${g.upYellow}~${g.upRed}%`, `${g.upRed}% 초과`],
    ['주행 공간', '자전거도로·생활도로 가장자리', '버스·차량 혼용 차도', '보행자 전용·보도뿐인 길'],
    ['횡단보도', '신호 횡단 위주', `비신호 100 m당 ${g.crossYellowPer100m}곳 이상`, '보호구역 내 비신호 (자료 연동 필요)'],
    ['사고 이력', '없음', '대리지표 위험 0.5 이상', 'TAAS 사고다발지점 50 m'],
    ['야간', '—', '—', '야간 안심구간(조명+CCTV) 아니면 한 단계 상향'],
    ['권장 속도', `${sp.day.G} km/h (야간 ${sp.night.G})`, `${sp.day.Y} km/h (야간 ${sp.night.Y})`, `경로 제외, 불가피하면 ${sp.day.R}`],
  ];
  body.append(h('div.card', null, h('h3', null, '환승구간 등급 기준 (정책안 3장)'),
    h('div.table-wrap', null, h('table.tbl', null, h('thead', null, h('tr', null, ['기준', '녹색', '황색', '적색'].map(t => h('th', null, t)))),
      h('tbody', null, crit.map(r => h('tr', null, r.map((v, i) => h('td', { style: { whiteSpace: 'normal', minWidth: i ? '90px' : '70px' } }, v))))))),
    h('small.muted', null, `한 구간은 가장 나쁜 항목의 등급을 따릅니다. 안전속도구역: 역 출구 ${sp.stationZoneM} m 안 ${sp.stationZone} km/h, 캠퍼스·병원 앞 ${sp.campusZone} km/h. 시범구간 C1~C3는 정책안이 고시한 등급을 그대로 씁니다.`)));

  // 통계·AI 모형
  if (md.severityGlm) {
    const gl = md.severityGlm;
    body.append(h('div.card', null, h('h3', null, 'PM 사고 심각도 모형 (로지스틱 GLM)'),
      h('small.muted', null, `${gl.source} · ${gl.note}. 결과: ${gl.outcome}. 기준범주: ${gl.reference}. n = ${fmtN(gl.n)}, 기저율 ${Math.round(gl.base * 100)}%, AUC ${gl.auc}.`),
      h('div.table-wrap', null, h('table.tbl', null, h('thead', null, h('tr', null, ['변수', '오즈비', '95% 신뢰구간', 'p'].map(t => h('th', null, t)))),
        h('tbody', null, gl.coef.slice(1).map(c => h('tr', null, h('td', null, c.name), h('td.n', { style: { color: c.p < 0.05 ? (c.or > 1 ? 'var(--r)' : 'var(--g)') : 'inherit', fontWeight: c.p < 0.05 ? 700 : 400 } }, c.or.toFixed(2)), h('td.n', null, `${c.lo.toFixed(2)}–${c.hi.toFixed(2)}`), h('td.n', null, c.p < 0.001 ? '<0.001' : c.p.toFixed(3))))))),
      h('small.muted', null, '오즈비가 1보다 크면 사망·중상 사고가 될 가능성이 높다는 뜻입니다 (굵게 = 5% 유의). 합성데이터라 실제 사고와 1:1로 대응하지 않으며, 원자료 확보 시 같은 코드로 다시 적합합니다 (app/js/core/glm.js).')));
  }
  if (md.nightRisk) {
    body.append(h('div.card', null, h('h3', null, '이용량 대비 사고 배율 (시간대)'),
      h('p', null, `야간(22~06시)은 사고의 ${Math.round(md.nightRisk.accShare * 100)}%를 차지하지만 이용은 ${Math.round(md.nightRisk.useShare * 100)}%뿐입니다. 이용 1회당 사고 비중이 낮보다 약 `, h('b', null, `${md.nightRisk.ratio}배`), ' 높습니다.'),
      barList({ items: md.riskByBand.map(b => ({ label: b.band, value: b.ratio, note: `사고 ${Math.round(b.accShare * 100)}% · 이용 ${Math.round(b.useShare * 100)}%`, color: b.ratio > 1.2 ? 'var(--cat-2)' : 'var(--seq-4)' })), fmt: v => `${v.toFixed(2)}배` }),
      h('small.muted', null, md.nightRisk.note + '. 야간 속도 한 단계 하향과 야간 비용 가중치 w_n의 근거로 씁니다.')));
  }

  const steps = [
    ['데이터 결합', 'OSM 도로망을 교차점에서 자르고 50 m 이하 링크로 나눈 뒤, 경사·횡단보도·조명·CCTV·TAAS 사고다발지역을 붙입니다.'],
    ['접근성 수치화', '250 m 격자 중심에서 경사를 반영한 보행시간(Tobler 함수)으로 역·정류장까지 가고, PTAL 방식 TAI를 주간·22~24시·심야로 계산합니다.'],
    ['취약지역 도출', 'A(접근성 부족)·R(위험)·D(서비스 공백)·C(저탄소 전환 잠재력: 이용·인구·1 km 대역)를 동대문구 안 백분위로 바꿔 PTVI와 NIGHT-TVI를 냅니다.'],
    ['AI 유형화', '규칙 기반 A~E 유형과 K-means 군집을 함께 보고, TAI×PUI 4유형과 교차 확인합니다. 사고 심각도는 로지스틱 GLM으로 봅니다.'],
    ['정책 실험', '환승거점·조명·횡단시설·감속·DRT·통합요금 조합의 지수·탄소·예산 변화를 시뮬레이터로 비교합니다.'],
  ];
  body.append(h('div.card', null, h('h3', null, '분석 절차 (K-Link 1km 2.2)'), h('ol', { style: { margin: 0, paddingLeft: '18px', display: 'grid', gap: '6px' } }, steps.map(([a, b]) => h('li', null, h('b', null, a), ' — ', b)))));

  body.append(h('div.card', null, h('h3', null, '산식'),
    h('div.stack', null,
      h('div', null, h('b', null, '링크 비용 '), h('code', null, 'Cₑ = Lₑ / vₑ × (1 + w_s·S + w_a·A + w_x·X + w_n·N),  적색이면 ∞')),
      h('small.muted', null, `S: 내리막 ${g.downRed}%·오르막 ${g.upRed}%에서 1 · A: 사고·상충 위험 0~1 · X: 100 m당 비신호 횡단 ${g.crossYellowPer100m}곳에서 1 · N: 야간에만 (1 − 조명점수) + CCTV 없으면 0.3`),
      h('div', null, h('b', null, 'PTVI '), h('code', null, `= ${PARAMS.ptvi.A}A + ${PARAMS.ptvi.R}R + ${PARAMS.ptvi.D}D + ${PARAMS.ptvi.C}C`)),
      h('div', null, h('b', null, 'TAI '), h('code', null, 'Σ수단 [max EDF + 0.5 Σ나머지 EDF],  EDF = 30 / (보행분 + 배차/2 + 신뢰도)')),
      h('div', null, h('b', null, '탄소 '), h('code', null, 'ΔCO₂ = Σ(대체비중 × 배출계수) − PM 배출계수'), h('small.muted', null, ` · 승용차 ${PARAMS.carbon.ef.car}, 버스 ${PARAMS.carbon.ef.bus}, PM ${PARAMS.carbon.ef.pmNow} g/인·km`)),
      h('div', null, h('b', null, '환승 인정 '), `태그 전후 ${PARAMS.transfer.windowMin}분 · 출발 또는 반납이 A·B급 거점 · PM ${PARAMS.transfer.maxRideM / 1000} km·${PARAMS.transfer.maxRideMin}분 이하 · 계정 연동 · 하루 ${PARAMS.transfer.dailyLimit}회`))));

  // 조례안 조항 ↔ 앱 기능 (정책안 7장)
  const law = [
    ['제5조 환승거점의 지정', '거점 탭 — A·B·C급, 야간 안심거점, H1~H4'],
    ['제6조 환승구간의 등급', '구간 등급 지도·경로의 적색 제외, 운영 현황의 적색 구간 점검 목록'],
    ['제7조 연계환승 지원', '주행·반납 탭의 환승 판정 카드 (기본·안전·야간 혜택)'],
    ['제8조 안전속도구역', '권장 속도 안내 (녹 20·황 15·역 100 m 15·캠퍼스 10 km/h), 주행 중 감속 알림'],
    ['제9조 야간 안전', '22시 야간 모드: 야간 안심구간만 경로, 막차 알림, 도착 알림'],
    ['제10조 자료 제공', '운영 현황 — 개인을 알아볼 수 없는 구간·거점 단위 집계'],
    ['제12조 평가 및 공개', '시범사업 성과 지표, 정책 시뮬레이터, 이 데이터·방법 화면'],
  ];
  body.append(h('div.card', null, h('h3', null, '조례안과 앱 기능'),
    h('small.muted', null, '「서울특별시 동대문구 개인형 이동장치 대중교통 연계환승 및 안전 증진에 관한 조례(안)」(정책안 7장)의 조항을 앱이 어떻게 실행하는지 보여 줍니다.'),
    h('ul.list', null, law.map(([a, b]) => h('li', null, h('b', null, a), h('small', { style: { display: 'block', color: 'var(--ink-2)' } }, b))))));

  body.append(h('div.card', null, h('h3', null, '한계와 보완 계획'),
    h('ul', { style: { margin: 0, paddingLeft: '18px', display: 'grid', gap: '4px' } },
      h('li', null, 'PM 이용량은 따릉이 OD로 대신합니다. 등록 대여사업자의 격자 집계 OD가 공개되면 그대로 바꿔 끼울 수 있게 만들었습니다.'),
      h('li', null, `TAAS는 자전거 사고다발지역(${(data.layers.taas || []).length}곳)만 연동되어, '최근 3년 사고 1건 이상 → 황색' 기준은 개별 사고 좌표가 있어야 완전히 적용됩니다.`),
      h('li', null, '생활도로 조명은 도로 위계로 추정합니다 (보안등 표준데이터에 동대문구 행이 없음). 보안등 위치를 넣으면 야간 안심구간이 실측으로 바뀝니다.'),
      h('li', null, '어린이·노인 보호구역 내 비신호 횡단(적색) 기준은 보호구역 자료를 넣어야 적용됩니다.'),
      h('li', null, '지수는 동대문구 안 상대 순위입니다. 전국 비교에는 전국 격자 분위수로 다시 표준화해야 합니다.'),
      h('li', null, 'PM 이용과 접근성의 관계는 인과가 아닙니다. 대학가·상업지·시간대 차이를 통제해 해석합니다.'))));

  body.append(h('div.card.soft', null, h('h3', null, '이 빌드'),
    h('dl.kv', null,
      h('dt', null, '데이터 생성'), h('dd', null, new Date(m.builtAt).toLocaleString('ko-KR')),
      h('dt', null, '도로 링크 · 노드'), h('dd', null, `${fmtN(m.counts.links)} · ${fmtN(m.counts.nodes)}`),
      h('dt', null, '격자 · 거점'), h('dd', null, `${m.counts.cells} · ${m.counts.hubs}`),
      h('dt', null, '횡단보도 · 조명점 · CCTV'), h('dd', null, `${fmtN(m.counts.crosswalks)} · ${fmtN(m.counts.lights)} · ${fmtN(m.counts.cctv || 0)}`),
      h('dt', null, '저장소'), h('dd', null, store.mode === 'local' ? '이 브라우저' : '팀 공유')),
    h('small.muted', null, '재현: npm install → npm run all (원본 데이터 필요) 또는 npm run build (추출본만으로). 자세한 내용은 README.md.')));
  return { refresh: () => renderMethod(app, body) };
}

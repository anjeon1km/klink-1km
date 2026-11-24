// 정책 대시보드 · 재정·협력: 학회 중간발표 피드백 2·7·8에 대한 답.
//  ② 마을버스 적자·환승 손실과 부딪히지 않는가 → 시간대 겹침(이 앱의 승하차 자료)과 별도 재원 설계
//  ⑧ 따릉이처럼 시 예산이 드는가, PM이 적자를 보완할 수 있는가 → 재원 분담 계산기와 따릉이 비교
//  ⑦ 민간 PM이 대중교통으로 인정받는 절차 → 민관 협력 단계
// 외부 수치는 출처를 함께 적고, 이 앱 자료로 계산한 값과 구분합니다.
import { h, clear, fmtN } from '../dom.js';
import { hourlyChart } from '../charts.js';
import { PARAMS } from '../../core/params.js';

// 외부 자료 (보도·공식 자료, 2025~2026 확인)
const EXT = {
  villageSubsidy: { y2025: 412, y2026: 500, src: 'SBS Biz, 2025.12 「서울 마을버스 환승 탈퇴 논란 마무리…재정지원 500억으로 확대」', url: 'https://biz.sbs.co.kr/amp/article/20000279857' },
  villageClaim: { lossPerYear: 1000, src: '뉴시스, 2025.5 (마을버스조합 주장: 환승 손실 연평균 약 1,000억 원)', url: 'https://www.newsis.com/view/NISX20250525_0003189021' },
  bikeDeficit: { y2023: 109, y2024: 127, src: '더팩트 「따릉이의 그늘…3년 연속 100억 적자」 (서울시설공단 자료: 2023년 109억, 2024년 127억 원)', url: 'https://news.tf.co.kr/read/life/2241109.htm' },
  bikeDeficitOld: { y2017: 68, y2019: 113, src: '뉴스토마토 「달리면 달릴수록 적자 ‘따릉이’」 (최기상 의원실 자료: 2017년 68억, 2019년 113억 원)', url: 'https://newstomato.com/ReadNews.aspx?no=1005537' },
  bikeTrips2024: { trips: 4385, src: '서울시 교통 누리집: 2024년 따릉이 이용 4,385만여 건', url: 'https://news.seoul.go.kr/traffic/archives/515711' },
  helmetFine: { won: 20000, src: '정책브리핑, 2021.5.13 개인형 이동장치 안전모 미착용 범칙금 2만 원', url: 'https://www.korea.kr/news/policyNewsView.do?newsId=148887244' },
  climateCard: { src: '서울시 교통 누리집: 기후동행카드 월 6만 2천 원(따릉이 미포함)·6만 5천 원(포함)', url: 'https://news.seoul.go.kr/traffic/archives/510651' },
};
// 따릉이 이용 1건당 공공 부담(추정): 2024년 운영 적자 127억 원 ÷ 2024년 이용 4,385만 건 ≈ 290원
const BIKE_PUBLIC_PER_TRIP = EXT.bikeDeficit.y2024 * 1e8 / (EXT.bikeTrips2024.trips * 1e4); // 원

export function renderFinance(app, body) {
  const { data, map } = app;
  const s = { daily: 125, avg: PARAMS.pilot.avgBenefit, pubShare: PARAMS.pilot.guShare, days: PARAMS.pilot.semesterDays };

  function draw() {
    clear(body);
    map.clearGrid?.();
    body.append(villageCard(data), budgetCard(), bikeCard(data), coopCard(), sourcesCard());
  }

  // ② 마을버스와 겹치는가: 회기역 하차(지하철) vs 동대문01 승차, 시간대별 하루 대비 비중
  function villageCard(d) {
    const hoegi = d.transit.stations.find(x => x.name === '회기')?.ridership;
    const r01 = d.transit.routes.find(r => r.no === '동대문01');
    const share = a => { const t = a.reduce((x, y) => x + y, 0) || 1; return a.map(v => v / t * 100); };
    const parts = [h('h3', null, '마을버스와 겹치지 않게 — 보완형 설계'),
      h('p', null, '서울 마을버스는 환승 손실 보전을 두고 2025년 환승제 탈퇴까지 거론됐고, 서울시는 재정지원을 ',
        h('b', null, `${EXT.villageSubsidy.y2025}억 원(2025) → ${EXT.villageSubsidy.y2026}억 원(2026)`), '으로 늘려 합의했습니다. PM 환승 혜택이 마을버스 몫을 깎으면 같은 갈등이 커집니다.')];
    if (hoegi && r01?.hourly) {
      const off = share(hoegi.off), bus = share(r01.hourly);
      const noBus = r01.hourly.map((v, i) => (v === 0 ? i : -1)).filter(i => i >= 0);
      const offNoBus = noBus.reduce((a, i) => a + hoegi.off[i], 0), offTot = hoegi.off.reduce((a, v) => a + v, 0);
      const late = [22, 23, 0].reduce((a, i) => a + hoegi.off[i], 0);
      parts.push(hourlyChart({ series: [{ name: '회기역 하차 (지하철)', values: off, color: '#eb6834' }, { name: '동대문01 승차 (마을버스)', values: bus, color: '#2a78d6' }], unit: '%', title: '시간대별 하루 대비 비중' }),
        h('dl.kv', null,
          h('dt', null, '동대문01 승차가 없는 시간'), h('dd', null, `${noBus.length}시간 (${Math.min(...noBus.filter(i => i >= 12).concat(24)) % 24}시~다음날 ${r01.first}시)`),
          h('dt', null, '그 시간 회기역 하차'), h('dd', null, `월 ${fmtN(offNoBus)}명 (${fmtN(offNoBus / offTot * 100, 1)}%)`),
          h('dt', null, '22~01시 회기역 하차'), h('dd', null, `월 ${fmtN(late)}명 (${fmtN(late / offTot * 100, 1)}%)`)),
        h('small.muted', null, `회기역 ${hoegi.month.slice(0, 4)}.${hoegi.month.slice(4)} 지하철 승하차, 동대문01 월 승차 ${fmtN(r01.monthOn)}명 (서울 열린데이터광장). 막차 무렵에는 마을버스 승차가 줄고 지하철 하차는 이어집니다.`));
    }
    parts.push(h('h4', null, '안키로의 설계 원칙'),
      h('ol.list', null,
        h('li', null, h('b', null, '재원 분리: '), '혜택은 기존 수도권 통합환승 정산(운송기관 사이 수입 배분)에 넣지 않고, 구 예산과 PM 사업자 분담금으로 따로 지급합니다(마일리지 사후 적립). 마을버스가 받는 환승 배분액은 그대로입니다.'),
        h('li', null, h('b', null, '겹치면 마을버스 먼저: '), '마을버스가 다니고 걸리는 시간이 3분 안쪽으로 비슷하면 길찾기 추천 카드에 마을버스를 함께 보여 줍니다(시민 앱에 반영).'),
        h('li', null, h('b', null, '빈 시간·빈 곳 중심: '), '야간 특례 혜택은 마을버스가 끊긴 22~01시, 노선이 닿지 않는 오르막·골목(기숙사·캠퍼스 상부)에 집중합니다.'),
        h('li', null, h('b', null, '갈아타는 손님 보태기: '), 'PM → 버스·지하철 방향(반납 후 30분 안 승차)도 환승으로 인정해, 정류장까지 오는 손님을 늘립니다.')));
    return h('div.card', null, parts);
  }

  // ⑧ 재원 분담: 누가 얼마를 내는가
  function budgetCard() {
    const pub = s.daily * s.avg * s.pubShare * s.days, op = s.daily * s.avg * (1 - s.pubShare) * s.days;
    const perTrip = s.avg * s.pubShare;
    const yearPub = pub / s.days * 250; // 평일 250일 환산 (가정)
    const bar = (label, v, max, color) => h('div', { style: { display: 'grid', gridTemplateColumns: '112px 1fr auto', gap: '8px', alignItems: 'center', fontSize: '12.5px' } },
      h('span', null, label), h('span.track', { style: { height: '10px', background: 'var(--panel-2)', borderRadius: '999px', overflow: 'hidden' } }, h('span', { style: { display: 'block', height: '100%', width: `${Math.min(100, v / max * 100)}%`, background: color, borderRadius: '999px' } })), h('b.num', null, `${fmtN(v)}원`));
    return h('div.card', null,
      h('h3', null, '재원 분담 계산기'),
      h('div.field', null, h('label', { for: 'fin-daily' }, `하루 환승 인정 ${s.daily}건`), h('input', { type: 'range', id: 'fin-daily', min: 50, max: 400, step: 5, value: s.daily, oninput: e => { s.daily = +e.target.value; draw(); } })),
      h('div.field', null, h('label', { for: 'fin-avg' }, `1건 평균 혜택 ${s.avg.toLocaleString()}원`), h('input', { type: 'range', id: 'fin-avg', min: 400, max: 1500, step: 50, value: s.avg, oninput: e => { s.avg = +e.target.value; draw(); } })),
      h('div.field', null, h('label', { for: 'fin-share' }, `공공(구·시) 분담 ${Math.round(s.pubShare * 100)}% · PM 사업자 ${Math.round((1 - s.pubShare) * 100)}%`), h('input', { type: 'range', id: 'fin-share', min: 0, max: 1, step: 0.05, value: s.pubShare, oninput: e => { s.pubShare = +e.target.value; draw(); } })),
      h('dl.kv', null,
        h('dt', null, `시범 1학기(${s.days}일) 공공 부담`), h('dd', null, h('b', null, `${fmtN(pub / 1e4)}만 원`)),
        h('dt', null, '같은 기간 사업자 부담'), h('dd', null, `${fmtN(op / 1e4)}만 원`),
        h('dt', null, '1년(평일 250일) 공공 부담'), h('dd', null, `${fmtN(yearPub / 1e4)}만 원`),
        h('dt', null, '마을버스 재정지원(2026) 대비'), h('dd', null, `${fmtN(yearPub / (EXT.villageSubsidy.y2026 * 1e8) * 100, 2)}%`),
        h('dt', null, '따릉이 수준이 되는 공공 분담'), h('dd', null, `${Math.min(100, Math.round(BIKE_PUBLIC_PER_TRIP / s.avg * 100))}% 이하`)),
      h('h4', null, '이용 1건당 공공 부담'),
      h('div.stack', null,
        bar('PM 환승 (이 설정)', perTrip, Math.max(perTrip, BIKE_PUBLIC_PER_TRIP), 'var(--accent)'),
        bar('따릉이 (2024 추정)', BIKE_PUBLIC_PER_TRIP, Math.max(perTrip, BIKE_PUBLIC_PER_TRIP), '#2a78d6')),
      h('small.muted', null, `PM 기기·충전·재배치는 사업자 몫이라 공공은 혜택 분담분만 냅니다. 따릉이는 2024년 운영 적자 ${EXT.bikeDeficit.y2024}억 원을 그해 이용 ${fmtN(EXT.bikeTrips2024.trips)}만 건으로 나눈 값입니다. 공공 분담을 50%로 두면 PM 환승 1건의 공공 부담이 따릉이보다 큽니다 — 따릉이 수준에 맞추려면 사업자 분담을 늘리거나 혜택을 줄여야 합니다. 거점 시설비(바닥 표시·조명·CCTV)는 별도이며, 사업자가 내는 거점 이용료로 충당하는 안을 함께 검토합니다.`));
  }

  // ⑧ 따릉이와 무엇이 다른가
  function bikeCard(d) {
    const fact = k => d.models?.pilotFacts?.find(f => f.key === k)?.value;
    const hoegiBike = fact('회기동 따릉이'), z1 = fact('표고 H1 회기역 1번 출구'), z3 = fact('표고 H3 캠퍼스 상부 (평화의전당 일대)');
    const rows = [
      ['기기·운영비', '서울시 (공공 소유)', '민간 사업자'],
      ['공공 부담', `운영 적자 ${EXT.bikeDeficitOld.y2017}억(2017) → ${EXT.bikeDeficitOld.y2019}억(2019) → ${EXT.bikeDeficit.y2024}억(2024)`, '환승 혜택 분담분 (위 계산기)'],
      ['잘 맞는 곳', '평지·하천변, 중거리', z1 != null && z3 != null ? `오르막 (회기역 ${fmtN(z1)} m → 캠퍼스 상부 ${fmtN(z3)} m), 심야 1 km` : '오르막·심야 1 km'],
      ['회기동 현황', hoegiBike || '—', '시범 거점 H1~H5'],
    ];
    return h('div.card', null,
      h('h3', null, '따릉이와 무엇이 다른가'),
      h('div.table-wrap', null, h('table.tbl', null,
        h('thead', null, h('tr', null, ['', '따릉이', 'PM 환승 (안키로)'].map(t => h('th', null, t)))),
        h('tbody', null, rows.map(r => h('tr', null, h('td', null, h('b', null, r[0])), h('td', { style: { whiteSpace: 'normal' } }, r[1]), h('td', { style: { whiteSpace: 'normal' } }, r[2])))))),
      h('p', null, 'PM 환승이 따릉이 적자를 직접 메우지는 못합니다. 대신 따릉이가 약한 오르막·심야 구간을 민간 기기로 채우므로, 그곳에 따릉이 대여소를 늘리거나 전기 따릉이를 배치하는 공공 비용 없이 공백을 메울 수 있습니다. 시범 뒤 ',
        h('b', null, '이용 1건당 공공 부담'), '을 따릉이와 견줘 확대 여부를 정합니다.'));
  }

  // ⑦ 민관 협력: 민간 PM을 대중교통 환승에 넣는 순서
  function coopCard() {
    const steps = [
      ['① 협약 (시범 1학기)', '동대문구 · PM 사업자 · 경희대', '사업자: 잠금해제료 면제분 분담, 기기 점검·공유 헬멧 비치, 대여·반납 기록 제공 / 학교: 기숙사·캠퍼스 거점 부지 / 구: 거점 바닥 표시·조명'],
      ['② 정산 연결', '교통카드 정산사 · 사업자', '교통카드 태그 시각과 PM 대여·반납 시각을 30분 기준으로 맞춰 보고(이 앱의 판정 규칙), 혜택은 마일리지로 사후 지급 — 기존 환승 정산 구조는 바꾸지 않음'],
      ['③ 평가·공개', '구 · 시민', '안전 환승 비율, 거점 반납률, 헬멧 인증률, 이용 1건당 공공 부담, 마을버스 승차 변화를 운영 현황 탭처럼 공개'],
      ['④ 제도화', '서울시 · 시의회', '현행 대중교통법의 대중교통수단에는 PM이 없으므로, 먼저 서울시 PM 조례에 「대중교통 연계 이용 지원」 근거를 두고, 기후동행카드가 따릉이를 포함한 요금제를 둔 것처럼 통합 이용권 편입을 검토'],
    ];
    return h('div.card', null,
      h('h3', null, '민간 PM을 환승에 넣는 순서 — 민관 협력'),
      h('ol.seg-list', null, steps.map(([t, who, what]) => h('li', null, h('div.seg-main', null, h('b', null, t), h('small', null, who), h('p', { style: { margin: '4px 0 0', fontSize: '13px' } }, what))))),
      h('p.note', null, `사업자 참여 조건: 헬멧 비치·착용 인증(미착용 범칙금 ${fmtN(EXT.helmetFine.won)}원), 야간 전조등 점검, 거점 밖 반납 추가요금, 데이터 공유. 조건을 지키는 사업자만 환승 혜택 대상 기기로 지정합니다.`));
  }

  function sourcesCard() {
    return h('details.more', null, h('summary', null, '출처'),
      h('ul.list', null, Object.values(EXT).map(e => h('li', null, h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.src)))),
      h('small.muted', null, '외부 수치는 보도 기준이며 확정 결산과 다를 수 있습니다. 시간대 그래프와 회기동 따릉이·표고 값은 이 앱의 원자료로 계산했습니다.'));
  }

  draw();
  return { refresh: draw, dispose: () => {} };
}

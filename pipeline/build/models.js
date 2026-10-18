// 통계·AI 분석 결과 (app/data/models.json)
//  1) PM 사고 심각도 GLM: 도로교통공단 PM 교통사고 합성데이터(전국 2,232건) — 사망·중상 여부 ~ 시간대 + 연령 + 사고유형 + 성별
//  2) 시간대별 '이용 대비 사고' 배율: 사고 시간대 분포 ÷ 동대문구 따릉이 대여 시간대 분포 (노출 보정)
//  3) 시범구간 현황: 정책안 1장의 회기역–경희대 수치를 이 데이터로 다시 계산
import { fitLogit } from '../../app/js/core/glm.js';
import { dist, pointInRing, round } from '../lib/geo.js';
import { F } from '../../app/js/core/grading.js';

export function buildModels({ pmAcc, bike, transit, net, hubs, crosswalks, pedSignals, osm }) {
  const out = {};
  if (pmAcc) {
    const rows = pmAcc.rows.filter(r => r.age !== '불명' && r.sex !== '기타불명');
    const bandStart = r => +r.band.slice(0, 2);
    const ageLo = r => +r.age.slice(0, 2);
    const feats = r => {
      const h = bandStart(r), a = ageLo(r);
      return [1,
        (h >= 22 || h < 6) ? 1 : 0,          // 야간 22~06시
        (h >= 18 && h < 22) ? 1 : 0,         // 저녁 18~22시
        a < 20 ? 1 : 0,                       // 10대
        a >= 40 && a < 65 ? 1 : 0,            // 40~64세
        a >= 65 ? 1 : 0,                      // 65세 이상
        /^차대사람/.test(r.type) ? 1 : 0,     // 보행자와 충돌
        /^차량단독/.test(r.type) ? 1 : 0,     // 단독 사고(전도·이탈)
        r.sex === '남' ? 1 : 0];
    };
    const names = ['절편', '야간 22~06시', '저녁 18~22시', '10대', '40~64세', '65세 이상', '차대사람 사고', '차량단독 사고', '남성'];
    const X = rows.map(feats), y = rows.map(r => (r.dead + r.serious > 0 ? 1 : 0));
    const fit = fitLogit(X, y, names);
    out.severityGlm = {
      source: pmAcc.source, note: pmAcc.note, outcome: '사망 또는 중상자 1명 이상', reference: '주간(06~18시) · 20~39세 · 차대차 · 여성',
      n: fit.n, base: round(fit.base, 3), auc: round(fit.auc, 3), iterations: fit.iterations,
      coef: fit.coef.map(c => ({ name: c.name, b: round(c.b, 3), or: round(c.or, 2), lo: round(c.lo, 2), hi: round(c.hi, 2), p: round(c.p, 4) })),
    };
    // night share & severity by period
    const per = { 주간: [0, 0], 저녁: [0, 0], 야간: [0, 0] };
    pmAcc.rows.forEach(r => { const h = bandStart(r); const k = (h >= 22 || h < 6) ? '야간' : h >= 18 ? '저녁' : '주간'; per[k][0]++; if (r.dead + r.serious > 0) per[k][1]++; });
    out.severityByPeriod = Object.entries(per).map(([k, [n, s]]) => ({ period: k, n, share: round(n / pmAcc.rows.length, 3), severeRate: round(s / n, 3) }));
    // accident share by 2 h band vs bike-use share by 2 h band (exposure proxy)
    const accBand = Array(12).fill(0); pmAcc.rows.forEach(r => { accBand[Math.floor(bandStart(r) / 2)]++; });
    const useHour = Array(24).fill(0); bike.dongs.forEach(d => d.depWd.forEach((v, h) => { useHour[h] += v * 5 + d.depWe[h] * 2; }));
    const useBand = Array.from({ length: 12 }, (_, b) => useHour[2 * b] + useHour[2 * b + 1]);
    const ta = accBand.reduce((a, b) => a + b, 0), tu = useBand.reduce((a, b) => a + b, 0);
    out.riskByBand = accBand.map((a, b) => ({ band: `${String(2 * b).padStart(2, '0')}–${String(2 * b + 2).padStart(2, '0')}시`, accShare: round(a / ta, 3), useShare: round(useBand[b] / tu, 3), ratio: round((a / ta) / Math.max(1e-6, useBand[b] / tu), 2) }));
    const nightIdx = [11, 0, 1, 2]; // 22–24, 00–02, 02–04, 04–06
    const nA = nightIdx.reduce((s, b) => s + accBand[b], 0) / ta, nU = nightIdx.reduce((s, b) => s + useBand[b], 0) / tu;
    out.nightRisk = { accShare: round(nA, 3), useShare: round(nU, 3), ratio: round(nA / nU, 2), note: '사고는 전국 PM 합성데이터, 이용은 동대문구 따릉이 대여(평일 5 : 주말 2 가중) — 수단과 지역이 달라 배율은 방향을 보는 참고값' };
    out.ddmAccidents = pmAcc.rows.filter(r => r.region.includes('동대문')).length;
  }

  // ── 시범구간 현황 (정책안 1장 수치 재계산)
  const facts = [];
  const v01 = transit.village.find(v => v.route === '동대문01');
  if (v01) facts.push({ key: '동대문01 하루 승차', value: Math.round(v01.stops.reduce((a, s) => a + s.perDayOn, 0)), unit: '명', note: `${v01.from}–${v01.to} 일평균(주말 포함)`, doc: '평일 약 1만 700명' });
  const r01 = transit.routes.find(r => r.no === '동대문01');
  if (r01) {
    const tot = r01.hourly.reduce((a, b) => a + b, 0);
    facts.push({ key: '동대문01 08시대 승차 비중', value: round(r01.hourly[8] / tot * 100, 1), unit: '%', note: '2022년 5월', doc: '16%' });
    facts.push({ key: '동대문01 23시 이후 승차', value: r01.hourly[23] + r01.hourly[0] + r01.hourly[1], unit: '명/월', note: '2022년 5월', doc: '0명' });
  }
  const hg = transit.stations.find(s => s.name === '회기')?.ridership;
  if (hg) { const tot = hg.off.reduce((a, b) => a + b, 0), night = hg.off[22] + hg.off[23] + hg.off[0]; facts.push({ key: '회기역 22시 이후 하차', value: night, unit: '명/월', note: `${hg.month} · 하루의 ${round(night / tot * 100, 1)}%`, doc: '월 약 8만 6천 명 (10.7%)' }); }
  const pilot = Object.fromEntries(hubs.hubs.filter(h => h.code).map(h => [h.code, h]));
  ['H1', 'H2', 'H3'].forEach(c => { if (pilot[c]) facts.push({ key: `표고 ${c} ${pilot[c].name}`, value: round(net.nodes.z[pilot[c].node], 1), unit: 'm', note: '수치지도 등고선·표고점 10 m 격자', doc: { H1: '약 21 m', H2: '약 42 m', H3: '약 66 m' }[c] }); });
  const khu = osm.elements.find(e => e.tags?.amenity === 'university' && /경희대학교/.test(e.tags?.name || '') && e.geometry);
  if (khu) {
    const ring = khu.geometry.map(g => [g.lat, g.lon]); const L = net.links; const gs = [];
    for (let i = 0; i < L.a.length; i++) { if (!(L.flags[i] & F.PM)) continue; const la = (net.nodes.lat[L.a[i]] + net.nodes.lat[L.b[i]]) / 2, lo = (net.nodes.lon[L.a[i]] + net.nodes.lon[L.b[i]]) / 2; if (pointInRing(la, lo, ring)) gs.push(Math.abs(L.g[i])); }
    gs.sort((a, b) => a - b);
    if (gs.length) facts.push({ key: '경희대 캠퍼스 도로 경사', value: `${gs[Math.floor(gs.length / 2)]}% · 상위 10% ${gs[Math.floor(gs.length * 0.9)]}%`, unit: '', note: `PM 통행 가능 링크 ${gs.length}개 (중앙값 · 90백분위)`, doc: '중앙값 8.3%, 상위 10% 15.7%' });
  }
  const hd = bike.dongs.find(d => d.name === '회기동');
  if (hd) facts.push({ key: '회기동 따릉이', value: `대여소 ${hd.odStations}곳 · 평일 하루 ${Math.round(hd.depWd.reduce((a, b) => a + b, 0))}건`, unit: '', note: `14개 동 중 평일 대여 ${1 + bike.dongs.filter(d => d.depWd.reduce((a, b) => a + b, 0) < hd.depWd.reduce((a, b) => a + b, 0)).length}번째로 적음`, doc: '대여소 2곳, 평일 출발 114건, 최하위' });
  const axis = hubs.corridors.filter(c => c.id === 'C1' || c.id === 'C2').flatMap(c => c.links);
  if (axis.length) {
    const pts = axis.flatMap(l => [[net.nodes.lat[net.links.a[l]], net.nodes.lon[net.links.a[l]]], [net.nodes.lat[net.links.b[l]], net.nodes.lon[net.links.b[l]]]]);
    const nearAxis = p => pts.some(q => dist(q, [p.lat, p.lon]) < 100);
    facts.push({ key: '회기역~정문 축 100 m 안', value: `횡단보도 ${crosswalks.filter(nearAxis).length}곳 · 보행등 ${pedSignals.filter(nearAxis).length}개`, unit: '', note: '서울시 횡단보도·보행등 위치 (2023.05)', doc: '횡단보도 24곳 대 보행등 13곳' });
  }
  out.pilotFacts = facts;
  return out;
}

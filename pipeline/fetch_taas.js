// (선택) TAAS 교통사고 다발지역 → data/extract/accidents.json
// 공공데이터포털(data.go.kr)에서 도로교통공단 다발지역 Open API 활용신청 후 받은 일반 인증키(Decoding)를 환경변수로 넣고 실행합니다.
// 키는 파일에 저장하지 마세요.
//   PowerShell:  $env:DATA_GO_KR_KEY="발급받은키"; npm run fetch:taas; npm run build
// searchYearCd는 AccidentHazard_CodeList.xlsx의 데이터셋 코드(예: 25년 자전거 2026114)입니다. 코드로 결과가 없으면 연도(2022 등)로 다시 묻습니다.
// 같은 지점이 여러 해에 나오면 가장 최근 것 하나만 남깁니다.
import { P, writeJson } from './lib/io.js';

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) { console.error('DATA_GO_KR_KEY 환경변수가 필요합니다.'); process.exit(1); }
const SIDO = '11', GUGUN = '230'; // 서울특별시 동대문구 (코드표 Gugun 시트)
const SETS = [
  // [이름, 서비스 경로, [ [표시 연도, searchYearCd 코드, 대체 연도] ... ] ]
  ['자전거', 'frequentzoneBicycle/getRestFrequentzoneBicycle', [['2025', '2026114', '2025'], ['2024', '2025081', '2024'], ['2023', '2024046', '2023'], ['2022', '2023016', '2022']]],
];
const FIELDS = { lat: 'la_crd', lon: 'lo_crd', count: 'occrrnc_cnt', name: 'spot_nm', casualties: 'caslt_cnt', deaths: 'dth_dnv_cnt', serious: 'se_dnv_cnt' };

async function ask(path, code) {
  const q = new URLSearchParams({ serviceKey: KEY, searchYearCd: code, siDo: SIDO, guGun: GUGUN, type: 'json', numOfRows: '100', pageNo: '1' });
  const r = await fetch(`https://apis.data.go.kr/B552061/${path}?${q}`);
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`); }
  return [].concat(j?.items?.item || j?.response?.body?.items?.item || []);
}

const bySpot = new Map();
for (const [kind, path, years] of SETS) for (const [year, code, plain] of years) {
  try {
    let items = await ask(path, code);
    if (!items.length) items = await ask(path, plain);
    for (const it of items) {
      const lat = +it[FIELDS.lat], lon = +it[FIELDS.lon]; if (!lat || !lon) continue;
      const key = `${kind}:${lat.toFixed(4)},${lon.toFixed(4)}`;
      if (bySpot.has(key) && bySpot.get(key).year >= year) continue;
      bySpot.set(key, { lat, lon, weight: +it[FIELDS.count] || 1, hotspot: true, kind, year, name: it[FIELDS.name] || '', casualties: +it[FIELDS.casualties] || 0, deaths: +it[FIELDS.deaths] || 0, serious: +it[FIELDS.serious] || 0 });
    }
    console.log(`  ${kind} ${year}: ${items.length}곳`);
  } catch (e) { console.log(`  ${kind} ${year}: 실패 — ${e.message}`); }
}
const points = [...bySpot.values()];
if (!points.length) { console.log('받은 지점이 없어 기존 accidents.json을 그대로 둡니다.'); process.exit(0); }
writeJson(P('data', 'extract', 'accidents.json'), { source: '도로교통공단 TAAS 교통사고 다발지역 (data.go.kr Open API, 서울 동대문구)', points });
console.log(`${points.length}곳 저장. 다음 단계: npm run build`);

// GitHub Actions에서 15분마다 실행: 서울 열린데이터광장 '서울시 공공자전거 실시간 대여정보'(bikeList)에서
// 동대문구 일대 대여소만 골라 app/live/bike.json으로 저장합니다. (서울 API는 http 전용이라 공개 사이트에서 직접 부를 수 없음)
// 인증키는 저장소 비밀값 SEOUL_API_KEY에서만 읽고, 파일·로그에 남기지 않습니다.
//   node tools/fetch_live.js [출력 폴더]      (기본: app/live)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'app', 'live'));
const KEY = process.env.SEOUL_API_KEY;
if (!KEY) { console.log('SEOUL_API_KEY가 없어 따릉이 실시간 정보를 건너뜁니다.'); process.exit(0); }

// 동대문구 대여소(앱 데이터) + 구 경계 바깥 300 m 여유
const bike = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'data', 'bike.json'), 'utf8'));
const refs = new Set(bike.stations.map(s => s.ref).filter(Boolean));
const lats = bike.stations.map(s => s.lat), lons = bike.stations.map(s => s.lon);
const box = { s: Math.min(...lats) - 0.003, n: Math.max(...lats) + 0.003, w: Math.min(...lons) - 0.0035, e: Math.max(...lons) + 0.0035 };

const rows = [];
const PAGE = +process.env.LIVE_PAGE || 1000; // 시험할 때만 줄임
for (let start = 1; start <= 6000; start += PAGE) {
  const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(KEY)}/json/bikeList/${start}/${start + PAGE - 1}/`;
  let json;
  try { json = await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json(); }
  catch (e) { console.warn(`요청 실패 (${start}~): ${e.message}`); break; }
  const res = json.rentBikeStatus;
  if (!res || res.RESULT?.CODE !== 'INFO-000') { console.warn('응답 오류:', (res?.RESULT || json.RESULT)?.MESSAGE || '알 수 없음'); break; }
  rows.push(...res.row);
  if (res.row.length < PAGE) break;
}
const stations = rows
  .map(r => ({ id: r.stationId, name: r.stationName, lat: +r.stationLatitude, lon: +r.stationLongitude, bikes: +r.parkingBikeTotCnt, racks: +r.rackTotCnt }))
  .filter(s => refs.has(s.id) || (s.lat >= box.s && s.lat <= box.n && s.lon >= box.w && s.lon <= box.e));

if (!stations.length) { console.warn(`동대문구 대여소를 찾지 못했습니다 (전체 ${rows.length}곳 수신). 파일을 만들지 않습니다.`); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'bike.json'), JSON.stringify({ at: new Date().toISOString(), source: '서울 열린데이터광장 · 서울시 공공자전거 실시간 대여정보', stations }));
console.log(`따릉이 실시간: 전체 ${rows.length}곳 중 동대문구 일대 ${stations.length}곳 저장 → ${path.relative(ROOT, OUT)}/bike.json`);

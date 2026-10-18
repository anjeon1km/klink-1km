// Step 2 — Extract the Dongdaemun-gu slice of each raw public dataset into small files under data/extract/.
// Only this step needs the large original files (see config/sources.example.json).
// Usage: node pipeline/02_extract_raw.js [dem] [crosswalks] [lights] [bus] [subway] [bike] [cctv] [securitylights] [bikemaster] [population] [pmacc]   (no args = all)
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import * as shapefile from 'shapefile';
import iconv from 'iconv-lite';
import { P, loadSources, streamCsv, writeJson, readJson, readZipEntries } from './lib/io.js';
import { fromKorea1985, toKorea1985, fromKorea2000, fromKorea5179, toXY, relationRings, bboxOf, expandBbox, inBbox, round, simplify, pointInRing, LAT0, LON0 } from './lib/geo.js';

export const DDM_DONGS = ['용신동', '제기동', '전농1동', '전농2동', '답십리1동', '답십리2동', '장안1동', '장안2동', '청량리동', '회기동', '휘경1동', '휘경2동', '이문1동', '이문2동'];
const NEIGHBOR_GU = ['동대문구', '성북구', '중랑구', '성동구', '광진구', '종로구'];
// 2026 public holidays inside the bike-data window (추석 연휴)
const HOLIDAYS = new Set(['20260924', '20260925', '20260926']);

const SRC = loadSources();
console.log('Raw sources from', path.relative(P(), SRC._file));
const osm = readJson(P('data', 'raw', 'osm_ddm.json'));
const guRel = osm.elements.find(e => e.type === 'relation' && e.tags?.name === '동대문구' && e.tags?.admin_level === '6');
const RINGS = relationRings(guRel);
const AOI = expandBbox(bboxOf(RINGS), 800); // area of interest: district + 800 m
console.log('AOI', JSON.stringify(Object.fromEntries(Object.entries(AOI).map(([k, v]) => [k, round(v, 4)]))));

const want = process.argv.slice(2);
const run = k => want.length === 0 || want.includes(k);

// ---------------------------------------------------------------- DEM from 1:5,000 contours + spot heights
async function readShapes(base) {
  const src = await shapefile.open(base + '.shp', base + '.dbf', { encoding: 'euc-kr' });
  const out = [];
  for (let r = await src.read(); !r.done; r = await src.read()) out.push(r.value);
  return out;
}

async function buildDem() {
  console.log('[dem] reading contours and spot heights');
  // AOI corners in EPSG:5174 for a cheap pre-filter
  const c = [[AOI.s, AOI.w], [AOI.n, AOI.e], [AOI.s, AOI.e], [AOI.n, AOI.w]].map(([la, lo]) => toKorea1985(la, lo));
  const X0 = Math.min(...c.map(p => p[0])) - 50, X1 = Math.max(...c.map(p => p[0])) + 50;
  const Y0 = Math.min(...c.map(p => p[1])) - 50, Y1 = Math.max(...c.map(p => p[1])) + 50;
  const inK = (x, y) => x >= X0 && x <= X1 && y >= Y0 && y <= Y1;

  const sets = [];
  for (let s = 0; s < SRC.contours.length; s++) {
    const pts = []; const lines = [];
    for (const f of await readShapes(SRC.contours[s])) {
      const z = +f.properties.CONT || +f.properties.HEIGHT; if (!isFinite(z)) continue;
      const parts = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
      for (const part of parts) {
        if (!part.some(([x, y]) => inK(x, y))) continue;
        // densify every 5 m
        const ll = [];
        for (let i = 0; i < part.length; i++) {
          const [x, y] = part[i];
          if (i > 0) {
            const [px, py] = part[i - 1]; const d = Math.hypot(x - px, y - py); const n = Math.floor(d / 5);
            for (let k = 1; k < n; k++) { const t = k / n; const qx = px + (x - px) * t, qy = py + (y - py) * t; if (inK(qx, qy)) pts.push([qx, qy, z]); }
          }
          if (inK(x, y)) pts.push([x, y, z]);
          ll.push(fromKorea1985(x, y));
        }
        if (s === 0 && z % 10 === 0) lines.push({ z, pts: ll });
      }
    }
    for (const f of await readShapes(SRC.spotHeights[s])) {
      const [x, y] = f.geometry.coordinates; const z = +f.properties.HEIGHT || +f.properties.NUME;
      if (inK(x, y) && isFinite(z) && z > -5 && z < 900) pts.push([x, y, z]);
    }
    console.log(`  set ${s}: ${pts.length} elevation points`);
    sets.push({ pts, lines });
  }

  // Convert to local XY; set 0 (newest) is primary, set 1 only fills gaps farther than 40 m from any primary point.
  const toLocal = ([x, y, z]) => { const [la, lo] = fromKorea1985(x, y); const [lx, ly] = toXY(la, lo); return [lx, ly, z]; };
  const primary = sets[0].pts.map(toLocal);
  const H = 40; const occ = new Set(primary.map(([x, y]) => Math.floor(x / H) + ':' + Math.floor(y / H)));
  const fill = (sets[1]?.pts || []).map(toLocal).filter(([x, y]) => !occ.has(Math.floor(x / H) + ':' + Math.floor(y / H)));
  const pts = primary.concat(fill);
  console.log(`  merged: ${primary.length} primary + ${fill.length} gap-fill points`);

  // Spatial hash
  const HC = 50; const hash = new Map();
  pts.forEach((p, i) => { const k = Math.floor(p[0] / HC) + ':' + Math.floor(p[1] / HC); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i); });

  const [ax0, ay0] = toXY(AOI.s, AOI.w), [ax1, ay1] = toXY(AOI.n, AOI.e);
  const CELL = 10; const nx = Math.ceil((ax1 - ax0) / CELL), ny = Math.ceil((ay1 - ay0) / CELL);
  const grid = new Float32Array(nx * ny);
  console.log(`  interpolating ${nx}×${ny} grid (${CELL} m) with quadrant IDW`);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = ax0 + (i + 0.5) * CELL, y = ay0 + (j + 0.5) * CELL;
    // nearest 2 points per quadrant within 200 m → removes the bias towards a single contour line
    const quad = [[], [], [], []];
    const gx = Math.floor(x / HC), gy = Math.floor(y / HC);
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r && r > 1) continue;
        const arr = hash.get((gx + dx) + ':' + (gy + dy)); if (!arr) continue;
        for (const idx of arr) {
          const p = pts[idx]; const ddx = p[0] - x, ddy = p[1] - y; const d2 = ddx * ddx + ddy * ddy;
          const q = (ddx >= 0 ? 0 : 1) + (ddy >= 0 ? 0 : 2);
          quad[q].push([d2, p[2]]);
        }
      }
      if (r >= 2 && quad.every(q => q.length >= 2)) break;
    }
    let ws = 0, zs = 0, exact = null;
    for (const q of quad) {
      q.sort((a, b) => a[0] - b[0]);
      for (const [d2, z] of q.slice(0, 2)) { if (d2 < 0.25) exact = z; const w = 1 / d2; ws += w; zs += w * z; }
    }
    grid[j * nx + i] = exact ?? (ws ? zs / ws : NaN);
  }
  // fill NaN with neighbour mean, then 3×3 smoothing to soften contour terracing
  const sm = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const v = grid[jj * nx + ii]; if (isFinite(v)) { s += v; n++; }
    }
    sm[j * nx + i] = n ? s / n : 20;
  }
  const i16 = new Int16Array(nx * ny); for (let k = 0; k < sm.length; k++) i16[k] = Math.round(sm[k] * 10);
  let zmin = Infinity, zmax = -Infinity; sm.forEach(v => { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); });
  console.log(`  elevation range ${zmin.toFixed(1)}–${zmax.toFixed(1)} m`);
  writeJson(P('data', 'extract', 'dem.json'), {
    note: '국토지리정보원 1:5,000 수치지도 등고선·표고점(EPSG:5174) → 10 m 격자 (사분면 IDW + 3×3 평활). 값 단위 0.1 m.',
    frame: { lat0: LAT0, lon0: LON0 }, x0: ax0, y0: ay0, cell: CELL, nx, ny, zmin, zmax,
    data: Buffer.from(i16.buffer).toString('base64'),
  });

  // contour lines for the basemap (10 m interval), clipped to AOI, simplified
  const contours = [];
  for (const l of sets[0].lines) {
    let cur = [];
    for (const p of l.pts) { if (inBbox(p[0], p[1], AOI)) cur.push(p); else { if (cur.length > 1) contours.push({ z: l.z, pts: cur }); cur = []; } }
    if (cur.length > 1) contours.push({ z: l.z, pts: cur });
  }
  writeJson(P('data', 'extract', 'contours.json'), contours.map(c => ({ z: c.z, p: simplify(c.pts, 4).map(([a, b]) => [round(a, 5), round(b, 5)]) })).filter(c => c.p.length > 1));
}

// ---------------------------------------------------------------- crosswalks and pedestrian signals (EPSG:5186)
function crosswalks() {
  console.log('[crosswalks] reading workbook');
  const wb = XLSX.readFile(SRC.crosswalks);
  const sheet = name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
    const h = rows.findIndex(r => r[0] === '순번');
    const head = rows[h]; const ix = k => head.indexOf(k);
    return rows.slice(h + 1).filter(r => r[ix('X좌표')]).map(r => {
      const [lat, lon] = fromKorea2000(+r[ix('X좌표')], +r[ix('Y좌표')]);
      return { r, lat, lon, ix };
    }).filter(o => inBbox(o.lat, o.lon, AOI));
  };
  const cw = sheet('횡단보도').map(({ r, lat, lon, ix }) => ({ id: r[ix('관리번호')], gu: r[ix('자치구')], kind: r[ix('횡단보도종류')], junction: r[ix('교차로명')] === '-' ? '' : r[ix('교차로명')], road: r[ix('도로구분')], lat: round(lat), lon: round(lon) }));
  const ps = sheet('보행등').map(({ r, lat, lon, ix }) => ({ id: r[ix('보행등관리번호')], gu: r[ix('자치구')], lat: round(lat), lon: round(lon) }));
  console.log(`  crosswalks ${cw.length}, pedestrian signal heads ${ps.length}`);
  writeJson(P('data', 'extract', 'crosswalks.json'), { source: '서울특별시 자치구별 신호등 및 횡단보도 위치 및 현황 (2023.05.30)', crosswalks: cw, pedSignals: ps });
}

// ---------------------------------------------------------------- streetlights (Seoul-managed, arterial)
async function lights() {
  console.log('[lights] streetlights');
  const out = [];
  await streamCsv(SRC.streetlights, r => { const lat = +r[1], lon = +r[2]; if (inBbox(lat, lon, AOI)) out.push({ id: r[0], lat: round(lat), lon: round(lon) }); });
  console.log(`  ${out.length} lights in AOI`);
  writeJson(P('data', 'extract', 'streetlights.json'), { source: '서울시 가로등 위치 정보 (서울시 관리 가로등: 간선도로·교량·지하차도 위주)', lights: out });
}

// ---------------------------------------------------------------- bus ridership
const ars5 = v => String(v).trim().padStart(5, '0');
async function bus() {
  console.log('[bus] hourly boardings by route and stop (2022.05)');
  const rows = [];
  await streamCsv(SRC.busHourly, (r, h) => {
    const gu = r[h.indexOf('버스정류장 위치(자치구)')];
    if (!NEIGHBOR_GU.includes(gu)) return;
    const on = [], off = [];
    for (let k = 0; k < 24; k++) { on.push(+r[7 + 2 * k] || 0); off.push(+r[8 + 2 * k] || 0); }
    rows.push({ route: r[1], routeName: r[2], stdId: r[3], ars: ars5(r[4]), name: r[5], gu, on, off });
  });
  console.log(`  ${rows.length} route-stop rows in ${NEIGHBOR_GU.join('/')}`);
  writeJson(P('data', 'extract', 'bus_hourly_2022.json'), { source: '서울특별시 버스노선별 정류장별 시간대별 승하차 인원 정보 (2022년 5월, 월합계)', month: '2022-05', rows });

  console.log('[bus] daily boardings (recent)');
  const daily = {};
  const dates = new Set();
  await streamCsv(SRC.busDaily, r => {
    const key = r[1] + '|' + ars5(r[4]) + '|' + r[5];
    dates.add(r[0]);
    if (!daily[key]) daily[key] = { route: r[1], routeName: r[2], stdId: r[3], ars: ars5(r[4]), name: r[5], on: 0, off: 0, days: 0 };
    daily[key].on += +r[6] || 0; daily[key].off += +r[7] || 0; daily[key].days++;
  });
  const d = [...dates].sort();
  writeJson(P('data', 'extract', 'bus_daily_recent.json'), { source: '서울시 버스노선별 정류장별 승하차 인원 정보 (일별)', from: d[0], to: d[d.length - 1], days: d.length, stops: Object.values(daily) });
}

// ---------------------------------------------------------------- subway hourly (all stations near 동대문구, last 13 months)
async function subway() {
  console.log('[subway] station hourly boardings —', path.basename(SRC.subwayHourly || '(없음)'));
  if (!SRC.subwayHourly) return;
  const near = new Set(osm.elements.filter(e => e.tags?.railway === 'station' && e.lat && inBbox(e.lat, e.lon, AOI)).map(e => e.tags.name.replace(/역$/, '')));
  const stName = s => s.replace(/\(.*\)$/, '').replace(/역$/, '').trim();
  const rows = [];
  await streamCsv(SRC.subwayHourly, (r, h) => {
    if (!near.has(stName(r[2]))) return;
    const slots = {};
    h.forEach((name, i) => {
      const m = name.match(/^(\d{2})시-(\d{2})시\s*(승차|하차)/); if (!m) return;
      const hr = +m[1] % 24; if (!slots[hr]) slots[hr] = [0, 0];
      slots[hr][m[3] === '승차' ? 0 : 1] += +r[i] || 0;
    });
    const on = Array.from({ length: 24 }, (_, k) => slots[k]?.[0] || 0), off = Array.from({ length: 24 }, (_, k) => slots[k]?.[1] || 0);
    rows.push({ month: r[0], line: r[1], station: stName(r[2]), on, off });
  });
  // keep one row per month/line/station (the file repeats some months); last 13 months per station keeps the trend short
  const uniq = new Map(); rows.forEach(r => uniq.set(r.month + r.line + r.station, r));
  const months = [...new Set([...uniq.values()].map(r => r.month))].sort();
  const keepFrom = months[Math.max(0, months.length - 13)];
  const all = [...uniq.values()].filter(r => r.month >= keepFrom).sort((a, b) => a.month.localeCompare(b.month));
  console.log(`  ${all.length} station-month rows; stations: ${[...new Set(all.map(r => r.line + ' ' + r.station))].join(', ')}`);
  writeJson(P('data', 'extract', 'subway_hourly.json'), { source: '서울시 지하철 호선별 역별 시간대별 승하차 인원 정보 (월별)', rows: all });
}

// ---------------------------------------------------------------- CCTV (동대문구 개방표준, WGS84)
async function cctv() {
  console.log('[cctv]', SRC.cctv ? path.basename(SRC.cctv) : '(없음)'); if (!SRC.cctv) return;
  const out = [];
  await streamCsv(SRC.cctv, (r, h) => {
    const lat = +r[h.indexOf('WGS84위도')], lon = +r[h.indexOf('WGS84경도')];
    if (!lat || !lon || !inBbox(lat, lon, AOI)) return;
    out.push({ lat: round(lat), lon: round(lon), n: +r[h.indexOf('카메라대수')] || 1, purpose: r[h.indexOf('설치목적구분')] });
  });
  const purposes = {}; out.forEach(c => { purposes[c.purpose] = (purposes[c.purpose] || 0) + c.n; });
  console.log(`  ${out.length} sites, ${out.reduce((a, c) => a + c.n, 0)} cameras`, JSON.stringify(purposes));
  writeJson(P('data', 'extract', 'cctv.json'), { source: 'CCTV정보_서울동대문구 (전국CCTV표준데이터, 동대문구청)', sites: out });
}

// ---------------------------------------------------------------- 보안등 (전국보안등정보표준데이터 — 좌표가 있는 AOI 행만)
async function securityLights() {
  console.log('[security lights]', SRC.securityLights ? path.basename(SRC.securityLights) : '(없음)'); if (!SRC.securityLights) return;
  const out = []; const providers = {};
  await streamCsv(SRC.securityLights, (r, h) => {
    const lat = +r[h.indexOf('위도')], lon = +r[h.indexOf('경도')];
    if (!lat || !lon || !inBbox(lat, lon, AOI)) return;
    out.push({ lat: round(lat), lon: round(lon), n: +r[h.indexOf('설치개수')] || 1 });
    const p = r[h.indexOf('제공기관명')]; providers[p] = (providers[p] || 0) + 1;
  });
  console.log(`  ${out.length} security-light points in AOI`, JSON.stringify(providers));
  writeJson(P('data', 'extract', 'security_lights.json'), { source: '전국보안등정보표준데이터', lights: out });
}

// ---------------------------------------------------------------- 따릉이 대여소 마스터 (ST-ID → 좌표)
async function bikeMaster() {
  console.log('[bike master]', SRC.bikeMaster ? path.basename(SRC.bikeMaster) : '(없음)'); if (!SRC.bikeMaster) return;
  const out = [];
  await streamCsv(SRC.bikeMaster, r => {
    const lat = +r[3], lon = +r[4];
    if (!lat || !lon || !inBbox(lat, lon, AOI)) return;
    out.push({ id: r[0], addr: [r[1], r[2]].filter(Boolean).join(' '), lat: round(lat), lon: round(lon) });
  });
  console.log(`  ${out.length} stations with coordinates in AOI`);
  writeJson(P('data', 'extract', 'bike_master.json'), { source: '서울시 공공자전거 따릉이 대여소 마스터 정보', stations: out });
}

// ---------------------------------------------------------------- 100 m 격자 인구 (SGIS, 국가지점번호 '다사' 격자)
// 격자코드 = 100 km 문자 2자 + 동향 3자리 + 북향 3자리 (100 m 단위). '다' = X 900,000 m, '사' = Y 1,900,000 m (EPSG:5179).
async function population() {
  console.log('[population]', SRC.population ? path.basename(SRC.population) : '(없음)'); if (!SRC.population) return;
  const entry = readZipEntries(SRC.population).find(e => /\.csv$/i.test(e.name));
  const text = iconv.decode(entry.read(), 'cp949');
  const X0 = { 가: 700000, 나: 800000, 다: 900000, 라: 1000000, 마: 1100000, 바: 1200000, 사: 1300000 };
  const Y0 = { 가: 1300000, 나: 1400000, 다: 1500000, 라: 1600000, 마: 1700000, 바: 1800000, 사: 1900000, 아: 2000000 };
  const out = []; let year = '';
  for (const line of text.split(/\r?\n/)) {
    const [y, code, item, val] = line.split(',');
    if (item !== 'to_in_001' || !code) continue;
    const m = code.match(/^(.)(.)(\d{3})(\d{3})$/); if (!m) continue;
    const x = X0[m[1]] + (+m[3]) * 100 + 50, yy = Y0[m[2]] + (+m[4]) * 100 + 50;
    const [lat, lon] = fromKorea5179(x, yy);
    if (!inBbox(lat, lon, AOI)) continue;
    out.push([round(lat), round(lon), +val || 0]); year = y;
  }
  const inDdm = out.filter(([a, b]) => RINGS.some(r => pointInRing(a, b, r))).reduce((s, c) => s + c[2], 0);
  console.log(`  ${out.length} 100 m cells in AOI; 동대문구 안 총인구 ${inDdm.toLocaleString()} (${year})`);
  writeJson(P('data', 'extract', 'population_100m.json'), { source: `통계청 SGIS 격자통계 ${year}년 총인구(to_in_001), 100 m 격자`, year, note: '5명 미만 격자는 SGIS 비식별 처리로 값이 보정되어 있을 수 있음', cells: out });
}

// ---------------------------------------------------------------- PM 교통사고 합성데이터 (도로교통공단, 전국 2,232건)
async function pmAccidents() {
  console.log('[pm accidents]', SRC.pmAccidents ? path.basename(SRC.pmAccidents) : '(없음)'); if (!SRC.pmAccidents) return;
  const rows = [];
  await streamCsv(SRC.pmAccidents, r => rows.push({ region: r[0], sex: r[1], age: r[2], band: r[3], type: r[4], dead: +r[5] || 0, serious: +r[6] || 0, minor: +r[7] || 0, reported: +r[8] || 0 }));
  console.log(`  ${rows.length} synthetic accident records (동대문구 ${rows.filter(r => r.region.includes('동대문')).length})`);
  writeJson(P('data', 'extract', 'pm_accidents_synth.json'), { source: '한국도로교통공단 개인형이동장치(PM) 교통사고 합성데이터 (2025.09.23)', note: '실제 사고와 1:1로 대응하지 않는 합성 데이터', rows });
}

// ---------------------------------------------------------------- 따릉이 OD (station × 5-min slot)
function csvFilesOf(entries) {
  const files = [];
  for (const e of entries) {
    if (!fs.existsSync(e)) { console.log('  (missing) ' + e); continue; }
    if (fs.statSync(e).isDirectory()) fs.readdirSync(e).filter(f => f.endsWith('.csv')).sort().forEach(f => files.push(path.join(e, f)));
    else files.push(e);
  }
  return files;
}
async function bike() {
  const files = csvFilesOf(SRC.bikeOd);
  console.log(`[bike] ${files.length} OD files`);
  const st = {}; const od = {}; const days = {}; const distHist = [0, 0, 0, 0, 0, 0]; const DH = [500, 1000, 1500, 2500, 5000, Infinity];
  const dongOf = name => name.split('_')[0];
  const S = (id, name) => (st[id] ??= { id, name, dong: dongOf(name), dep: { wd: Array(24).fill(0), we: Array(24).fill(0) }, arr: { wd: Array(24).fill(0), we: Array(24).fill(0) }, trips: 0, min: 0, dist: 0, toDdm: 0 });
  for (const f of files) {
    let n = 0;
    await streamCsv(f, r => {
      const [date, basis, slot, sId, sName, eId, eName, cnt, mins, meters] = r;
      const sd = dongOf(sName), ed = dongOf(eName);
      const sIn = DDM_DONGS.includes(sd), eIn = DDM_DONGS.includes(ed);
      if (!sIn && !eIn) return;
      const c = +cnt || 0; const hr = Math.floor((+slot) / 100);
      const dt = (HOLIDAYS.has(date) || [0, 6].includes(new Date(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6)).getDay())) ? 'we' : 'wd';
      days[date] ??= { type: dt, trips: 0 };
      if (basis === '출발시간') {
        n += c; days[date].trips += c;
        if (sIn) { const s = S(sId, sName); s.dep[dt][hr] += c; s.trips += c; s.min += +mins || 0; s.dist += +meters || 0; if (eIn) s.toDdm += c; }
        const k = sd + '>' + ed; const o = (od[k] ??= { from: sd, to: ed, trips: 0, night: 0, dist: 0, min: 0 });
        o.trips += c; o.dist += +meters || 0; o.min += +mins || 0; if (hr >= 22 || hr < 5) o.night += c;
        const avg = c ? (+meters || 0) / c : 0; distHist[DH.findIndex(b => avg < b)] += c;
      } else if (basis === '도착시간' && eIn) {
        S(eId, eName).arr[dt][hr] += c;
      }
    });
    console.log(`  ${path.basename(f)}: ${n} trips touching 동대문구`);
  }
  const dayList = Object.keys(days).sort();
  writeJson(P('data', 'extract', 'bike_od.json'), {
    source: '서울시 공공자전거(따릉이) 대여소별 대여·반납 승객수 (5분 단위 OD) — 사용자 제공 파일',
    days: dayList.map(d => ({ date: d, type: days[d].type, trips: days[d].trips })),
    distanceBins: { edges: [0, 500, 1000, 1500, 2500, 5000], counts: distHist },
    stations: Object.values(st), od: Object.values(od),
  });
}

if (run('cctv')) await cctv();
if (run('securitylights')) await securityLights();
if (run('bikemaster')) await bikeMaster();
if (run('population')) await population();
if (run('pmacc')) await pmAccidents();
if (run('dem')) await buildDem();
if (run('crosswalks')) crosswalks();
if (run('lights')) await lights();
if (run('bus')) await bus();
if (run('subway')) await subway();
if (run('bike')) await bike();
console.log('extract done');

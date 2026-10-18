// 공유 모빌리티 이용 강도(PUI) — 따릉이 대여·반납 OD를 행정동 단위로 집계하고, OSM 대여소 위치에 거치대 규모 비례로 배분.
// (OD 파일의 대여소명은 '행정동_번호'로 익명화되어 있어 좌표 대응표(OA-21235)가 없으면 동 단위가 정확한 최소 단위입니다.)
import { pointInRing, round } from '../lib/geo.js';

export function buildBike({ osm, clipRing, dongs, bikeOd, master = null }) {
  const DDM = dongs.filter(d => d.inDdm).map(d => d.name);
  // Effective day counts: a day whose file is cut off (e.g. 9/1 holds only part of the day) counts as the
  // fraction of a normal day it covers, so per-day averages are not diluted.
  const med = t => { const v = bikeOd.days.filter(d => d.type === t).map(d => d.trips).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] || 1; };
  const medWd = med('wd'), medWe = med('we');
  const eff = t => bikeOd.days.filter(d => d.type === t).reduce((a, d) => a + Math.min(1, d.trips / (t === 'wd' ? medWd : medWe)), 0);
  const nWd = eff('wd'), nWe = eff('we');

  const dongAgg = {};
  for (const d of DDM) dongAgg[d] = { name: d, odStations: 0, dep: { wd: Array(24).fill(0), we: Array(24).fill(0) }, arr: { wd: Array(24).fill(0), we: Array(24).fill(0) }, trips: 0, min: 0, dist: 0, toDdm: 0 };
  for (const s of bikeOd.stations) {
    const g = dongAgg[s.dong]; if (!g) continue;
    g.odStations++; g.trips += s.trips; g.min += s.min; g.dist += s.dist; g.toDdm += s.toDdm;
    for (const t of ['wd', 'we']) for (let h = 0; h < 24; h++) { g.dep[t][h] += s.dep[t][h]; g.arr[t][h] += s.arr[t][h]; }
  }
  const nightOf = arr => arr.reduce((a, v, h) => a + ((h >= 22 || h < 5) ? v : 0), 0);
  const dongOut = Object.values(dongAgg).map(g => {
    const depWd = g.dep.wd.map(v => round(v / nWd, 1)), depWe = g.dep.we.map(v => round(v / nWe, 1));
    const arrWd = g.arr.wd.map(v => round(v / nWd, 1)), arrWe = g.arr.we.map(v => round(v / nWe, 1));
    const totDep = g.dep.wd.reduce((a, b) => a + b, 0) + g.dep.we.reduce((a, b) => a + b, 0);
    return {
      name: g.name, odStations: g.odStations,
      tripsPerDay: round(g.trips / (nWd + nWe), 1),
      depWd, depWe, arrWd, arrWe,
      nightShare: round((nightOf(g.dep.wd) + nightOf(g.dep.we)) / Math.max(1, totDep), 3),
      avgDistM: Math.round(g.dist / Math.max(1, g.trips)), avgMin: round(g.min / Math.max(1, g.trips), 1),
      withinDdmShare: round(g.toDdm / Math.max(1, g.trips), 3),
    };
  });

  // Station positions. With the 대여소 마스터 (ST-ID → 좌표) every OD station gets its own measured trips;
  // without it, OSM docking stations share their 행정동 total in proportion to capacity.
  const dongAt = (la, lo) => dongs.find(d => d.rings.some(r => pointInRing(la, lo, r)))?.name || null;
  const days = nWd + nWe;
  let osmSt, stationSource;
  const byId = master ? new Map(master.map(m => [m.id, m])) : null;
  const matched = byId ? bikeOd.stations.filter(s => byId.has(s.id)) : [];
  if (byId && matched.length >= bikeOd.stations.length * 0.8) {
    stationSource = 'master';
    osmSt = matched.map(s => {
      const m = byId.get(s.id); const dep = [...s.dep.wd, ...s.dep.we]; const tot = dep.reduce((a, b) => a + b, 0) || 1;
      const night = s.dep.wd.concat(s.dep.we).reduce((a, v, k) => a + (((k % 24) >= 22 || (k % 24) < 5) ? v : 0), 0);
      return { name: m.addr.replace(/^서울특별시 동대문구 /, ''), ref: s.id, cap: null, lat: m.lat, lon: m.lon, dong: s.dong, estTripsPerDay: round(s.trips / days, 1), estNightShare: round(night / tot, 3), measured: true };
    });
    for (const d of dongOut) d.osmStations = osmSt.filter(s => s.dong === d.name).length;
  } else {
    stationSource = 'osm-capacity';
    osmSt = osm.elements.filter(e => e.tags?.amenity === 'bicycle_rental' && e.lat && pointInRing(e.lat, e.lon, clipRing))
      .map(e => ({ name: e.tags.name || '따릉이 대여소', ref: e.tags.ref || '', cap: +e.tags.capacity || 10, lat: round(e.lat), lon: round(e.lon), dong: dongAt(e.lat, e.lon) }));
    for (const d of dongOut) {
      const mine = osmSt.filter(s => s.dong === d.name); const capSum = mine.reduce((a, s) => a + s.cap, 0) || 1;
      mine.forEach(s => { s.estTripsPerDay = round(d.tripsPerDay * s.cap / capSum, 1); s.estNightShare = d.nightShare; });
      d.osmStations = mine.length;
    }
  }
  console.log(`  bike stations: ${osmSt.length} (${stationSource === 'master' ? '대여소 마스터 좌표로 실측 배정' : 'OSM 거치대 규모 비례 배분'})`);

  // dong → dong flows touching 동대문구
  const od = bikeOd.od.filter(o => o.trips > 0).map(o => ({ from: o.from, to: o.to, trips: o.trips, night: o.night, avgDistM: Math.round(o.dist / o.trips) }))
    .sort((a, b) => b.trips - a.trips);
  const totalTrips = od.reduce((a, o) => a + o.trips, 0), nightTrips = od.reduce((a, o) => a + o.night, 0);
  return {
    source: bikeOd.source, stationSource,
    period: { from: bikeOd.days[0].date, to: bikeOd.days[bikeOd.days.length - 1].date, files: bikeOd.days.length, effectiveDays: round(days, 1), weekdays: round(nWd, 1), weekendHolidays: round(nWe, 1) },
    daily: bikeOd.days,
    totals: { tripsPerDay: round(totalTrips / days, 1), nightShare: round(nightTrips / totalTrips, 3) },
    distanceBins: bikeOd.distanceBins,
    dongs: dongOut, stations: osmSt, odTop: od.slice(0, 60),
  };
}

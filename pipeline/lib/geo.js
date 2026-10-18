// Geometry helpers shared by the pipeline. All app outputs are WGS84 (lat, lon).
// Distances use a local equirectangular projection centred on Dongdaemun-gu,
// which is accurate to well under 0.1% at district scale.
import proj4 from 'proj4';

// EPSG:5174 — Korean 1985 / Modified Central Belt (Bessel). Used by the 1:5,000 수치지도 contour/spot-height shapefiles.
proj4.defs('EPSG:5174', '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43');
// EPSG:5186 — Korea 2000 / Central Belt 2010 (GRS80). Used by the Seoul crosswalk / pedestrian-signal workbook.
proj4.defs('EPSG:5186', '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs');

const to5174 = proj4('EPSG:4326', 'EPSG:5174');
const from5174 = proj4('EPSG:5174', 'EPSG:4326');
const from5186 = proj4('EPSG:5186', 'EPSG:4326');
// EPSG:5179 — Korea 2000 / Unified CS (UTM-K). Used by the national point-number grid (SGIS 격자통계).
proj4.defs('EPSG:5179', '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs');
const from5179 = proj4('EPSG:5179', 'EPSG:4326');
export const fromKorea5179 = (x, y) => { const [lon, lat] = from5179.forward([x, y]); return [lat, lon]; };

export const fromKorea1985 = (x, y) => { const [lon, lat] = from5174.forward([x, y]); return [lat, lon]; };
export const toKorea1985 = (lat, lon) => to5174.forward([lon, lat]);
export const fromKorea2000 = (x, y) => { const [lon, lat] = from5186.forward([x, y]); return [lat, lon]; };

// Local metric frame
export const LAT0 = 37.585, LON0 = 127.05;
const M_PER_DEG_LAT = 110950;
const M_PER_DEG_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);
export const toXY = (lat, lon) => [(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT];
export const toLatLon = (x, y) => [LAT0 + y / M_PER_DEG_LAT, LON0 + x / M_PER_DEG_LON];
export const dist = (a, b) => Math.hypot((a[1] - b[1]) * M_PER_DEG_LON, (a[0] - b[0]) * M_PER_DEG_LAT); // a,b = [lat,lon]

export const round = (v, d = 6) => { const f = 10 ** d; return Math.round(v * f) / f; };

export function polylineLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }

// Split a polyline ([lat,lon] points) into consecutive pieces no longer than maxLen metres,
// keeping original vertices and inserting interpolated cut points.
export function splitPolyline(pts, maxLen) {
  const total = polylineLength(pts);
  const n = Math.max(1, Math.ceil(total / maxLen - 1e-9));
  if (n === 1) return [pts];
  const step = total / n;
  const pieces = []; let cur = [pts[0]]; let acc = 0; let target = step;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]; const b = pts[i];
    let seg = dist(a, b);
    while (pieces.length < n - 1 && acc + seg >= target - 1e-6) {
      const t = (target - acc) / seg;
      const cut = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      cur.push(cut); pieces.push(cur); cur = [cut];
      seg -= (target - acc); acc = target; a = cut; target += step;
    }
    acc += seg; cur.push(b);
  }
  pieces.push(cur);
  return pieces;
}

// Douglas–Peucker simplification in metres.
export function simplify(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const xy = pts.map(p => toXY(p[0], p[1]));
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    const [x1, y1] = xy[s], [x2, y2] = xy[e];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1e-9;
    for (let i = s + 1; i < e; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i][0] - x1) * dx + (xy[i][1] - y1) * dy) / len2));
      const d = Math.hypot(xy[i][0] - (x1 + t * dx), xy[i][1] - (y1 + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function pointInRing(lat, lon, ring) { // ring: [[lat,lon],...]
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
export function pointInPolygon(lat, lon, rings) { // rings: outer rings (holes ignored — none in our boundaries)
  return rings.some(r => pointInRing(lat, lon, r));
}

// Distance from point p to segment ab (all [lat,lon]) in metres, plus the projection parameter t.
export function pointSegDist(p, a, b) {
  const [px, py] = toXY(p[0], p[1]), [ax, ay] = toXY(a[0], a[1]), [bx, by] = toXY(b[0], b[1]);
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

// Assemble closed rings from an OSM relation fetched with `out geom` (members carry geometry arrays).
export function relationRings(rel) {
  const segs = rel.members.filter(m => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry)
    .map(m => m.geometry.map(g => [g.lat, g.lon]));
  const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const rings = [];
  const pool = segs.slice();
  while (pool.length) {
    let ring = pool.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const endK = key(ring[ring.length - 1]);
      const i = pool.findIndex(s => key(s[0]) === endK || key(s[s.length - 1]) === endK);
      if (i < 0) break;
      let s = pool.splice(i, 1)[0];
      if (key(s[0]) !== endK) s = s.slice().reverse();
      ring = ring.concat(s.slice(1));
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

// Simple uniform-grid spatial index for points: items are {lat, lon, ...}.
export class PointIndex {
  constructor(items, cell = 60) {
    this.cell = cell; this.map = new Map(); this.items = items;
    items.forEach((it, i) => {
      const [x, y] = toXY(it.lat, it.lon);
      const k = Math.floor(x / cell) + ':' + Math.floor(y / cell);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    });
  }
  within(lat, lon, r) {
    const [x, y] = toXY(lat, lon);
    const c = this.cell, out = [];
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const arr = this.map.get(gx + ':' + gy); if (!arr) continue;
      for (const i of arr) { const it = this.items[i]; const d = dist([lat, lon], [it.lat, it.lon]); if (d <= r) out.push({ item: it, d, i }); }
    }
    return out.sort((a, b) => a.d - b.d);
  }
  nearest(lat, lon, maxR = 2000) {
    for (let r = this.cell; r <= maxR; r *= 2) { const w = this.within(lat, lon, r); if (w.length) return w[0]; }
    return null;
  }
}

export function bboxOf(rings) {
  let s = 90, n = -90, w = 180, e = -180;
  rings.forEach(r => r.forEach(([la, lo]) => { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }));
  return { s, n, w, e };
}
export function expandBbox(b, m) {
  const dLat = m / M_PER_DEG_LAT, dLon = m / M_PER_DEG_LON;
  return { s: b.s - dLat, n: b.n + dLat, w: b.w - dLon, e: b.e + dLon };
}
export const inBbox = (lat, lon, b) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;

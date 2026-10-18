/* global L */
// Map: self-drawn vector basemap (no tile server — works offline and inside the artifact sandbox),
// road grades, hubs, transit, grid choropleth, routes, reports and the ride marker.
import { VectorCanvas } from './vcanvas.js';
import { linkCoords, metres } from '../core/graph.js';
import { F, CLS, linkGrade, linkReasons, GRADE_NAME, CLS_NAME, speedFor } from '../core/grading.js';
import { PARAMS } from '../core/params.js';
import { h, fmtM } from '../ui/dom.js';

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const NIGHT_MAP = { land: '#10141a', road: '#262c34', roadCase: '#0b0e12', major: '#30343a', majorCase: '#0b0e12', water: '#0f2131', park: '#122018', campus: '#1b1a24', rail: '#4f565f', contour: 'rgba(200,190,170,.10)', label: '#a7b0bc', district: '#ffb547', dong: 'rgba(255,181,71,.25)' };
const RANK = { G: 0, Y: 1, R: 2, X: -1 };

export class MapView {
  constructor(el, data) {
    this.data = data; this.net = data.network; this.night = false; this.layers = {};
    const bb = this.districtBounds();
    this.map = L.map(el, { zoomControl: true, attributionControl: true, zoomSnap: 0.5, minZoom: 12.5, maxZoom: 19, maxBounds: bb.pad(0.6), preferCanvas: true });
    this.map.attributionControl.setPrefix(false).addAttribution('© OpenStreetMap contributors · 국토지리정보원 수치지도 · 서울 열린데이터광장');
    for (const [name, z] of [['basePane', 200], ['netPane', 360], ['gridPane', 380], ['routePane', 450], ['hubPane', 620]]) this.map.createPane(name).style.zIndex = z;
    this.map.getPane('basePane').style.pointerEvents = 'none'; this.map.getPane('netPane').style.pointerEvents = 'none';
    this.map.fitBounds(bb, { padding: [10, 10] });
    this.prepLinks();
    this.base = new VectorCanvas((ctx, v) => this.drawBase(ctx, v), { pane: 'basePane' }).addTo(this.map);
    this.netLayer = new VectorCanvas((ctx, v) => this.drawNet(ctx, v), { pane: 'netPane' }).addTo(this.map);
    this.gridRenderer = L.canvas({ pane: 'gridPane', padding: 0.3 });
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.hubLayer = L.layerGroup().addTo(this.map);
    this.transitLayer = L.layerGroup().addTo(this.map);
    this.gridLayer = L.layerGroup().addTo(this.map);
    this.reportLayer = L.layerGroup().addTo(this.map);
    this.pinLayer = L.layerGroup().addTo(this.map);
    this.map.on('zoomend', () => this.refreshZoomDependent());
    this.map.on('click', e => this.onClick(e));
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.redraw());
    this.buildTransit(); this.buildHubs();
  }

  districtBounds() { const pts = this.data.base.district.flat(); return L.latLngBounds(pts.map(p => [p[0], p[1]])); }

  // ── precomputed geometry & grades
  prepLinks() {
    const L_ = this.net.links, n = L_.a.length;
    this.lk = new Array(n);
    for (let i = 0; i < n; i++) {
      const pts = linkCoords(this.net, i);
      let s = 90, nn = -90, w = 180, e = -180; for (const [a, b] of pts) { s = Math.min(s, a); nn = Math.max(nn, a); w = Math.min(w, b); e = Math.max(e, b); }
      this.lk[i] = { pts, s, n: nn, w, e };
    }
    // order: minor first so major roads paint on top
    this.order = [...Array(n).keys()].sort((a, b) => (L_.cls[b] === CLS.MOTORROAD ? 0.5 : L_.cls[b]) - (L_.cls[a] === CLS.MOTORROAD ? 0.5 : L_.cls[a]));
    // link index for hit testing (≈50 m cells)
    this.lkGrid = new Map();
    for (let i = 0; i < n; i++) { const p = this.lk[i].pts[Math.floor(this.lk[i].pts.length / 2)]; const k = Math.floor(p[0] / 0.00045) + ':' + Math.floor(p[1] / 0.00057); if (!this.lkGrid.has(k)) this.lkGrid.set(k, []); this.lkGrid.get(k).push(i); }
    this.recomputeGrades();
  }
  recomputeGrades(useOverrides = true) {
    const n = this.net.links.a.length; const planner = this.data.planner;
    const ctxD = { night: false, overrides: useOverrides ? planner.overrides : null, hotspots: planner.hotspots };
    const ctxN = { ...ctxD, night: true };
    this.gDay = new Array(n); this.gNight = new Array(n);
    const worst = (i, ctx) => { const a = linkGrade(this.net, i, 1, ctx), b = linkGrade(this.net, i, -1, ctx); return RANK[a] >= RANK[b] ? a : b; };
    for (let i = 0; i < n; i++) { if (!(this.net.links.flags[i] & F.PM)) { this.gDay[i] = this.gNight[i] = 'X'; continue; } this.gDay[i] = worst(i, ctxD); this.gNight[i] = worst(i, ctxN); }
  }

  get nightMap() { return this.night && !this.policy; }
  colors() {
    if (this.nightMap) return NIGHT_MAP;
    return { land: css('--map-land'), road: css('--map-road'), roadCase: css('--map-road-case'), major: css('--map-major'), majorCase: css('--map-major-case'), water: css('--map-water'), park: css('--map-park'), campus: css('--map-campus'), rail: css('--map-rail'), contour: css('--map-contour'), label: css('--map-label'), district: css('--map-district'), dong: css('--map-dong') };
  }

  // ── base: land, water, parks, campuses, contours, rail, labels, district mask
  drawBase(ctx, v) {
    const C = this.colors(), B = this.data.base, z = v.zoom;
    ctx.fillStyle = C.land; ctx.fillRect(0, 0, v.width, v.height);
    const poly = (ring) => { ring.forEach(([a, b], i) => { const [x, y] = v.project(a, b); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
    const line = (pts) => { pts.forEach(([a, b], i) => { const [x, y] = v.project(a, b); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    ctx.fillStyle = C.park; ctx.beginPath(); B.parks.forEach(p => poly(p.ring)); ctx.fill();
    ctx.fillStyle = C.campus; ctx.beginPath(); B.campuses.forEach(p => poly(p.ring)); ctx.fill();
    ctx.fillStyle = C.water; ctx.beginPath(); B.water.forEach(p => poly(p.ring)); ctx.fill();
    ctx.strokeStyle = C.water; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    B.rivers.forEach(r => { ctx.lineWidth = r.kind === 'river' ? Math.max(3, (z - 11) * 3) : Math.max(1.5, z - 12); ctx.beginPath(); line(r.pts); ctx.stroke(); });
    if (this.layers.contours !== false && z >= 13.5) {
      ctx.strokeStyle = C.contour; ctx.lineWidth = 1;
      ctx.beginPath(); B.contours.forEach(c => { if (c.z % 50 !== 0 && z < 15) return; line(c.p); }); ctx.stroke();
    }
    ctx.strokeStyle = C.rail; ctx.lineWidth = z >= 15 ? 3 : 2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); B.rail.forEach(r => line(r.pts)); ctx.stroke(); ctx.setLineDash([]);
  }

  // ── network: road casing/fill, grade overlay, night lighting glow, crossings, lamps, mask & labels
  drawNet(ctx, v) {
    const C = this.colors(), z = v.zoom, L_ = this.net.links, bnd = v.bounds;
    const vis = i => { const b = this.lk[i]; return !(b.n < bnd.s || b.s > bnd.n || b.e < bnd.w || b.w > bnd.e); };
    const path = i => { this.lk[i].pts.forEach(([a, b], k) => { const [x, y] = v.project(a, b); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    const wBy = cls => ({ 0: 5, 1: 5, 2: 4.2, 3: 3.4, 4: 2.4, 5: 1.6, 6: 1.6, 7: 1, 8: 1 })[cls] * Math.max(0.55, Math.pow(1.45, z - 15));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const showMinor = z >= 14;
    // casing
    for (const major of [false, true]) {
      ctx.beginPath(); ctx.strokeStyle = major ? C.majorCase : C.roadCase;
      let lw = 0;
      for (const i of this.order) {
        const c = L_.cls[i]; const isMajor = c <= CLS.SECONDARY; if (isMajor !== major) continue;
        if (!showMinor && c >= CLS.SERVICE) continue; if (c >= CLS.FOOTWAY || !vis(i)) continue;
        const w = wBy(c) + 1.6; if (w !== lw) { ctx.stroke(); ctx.beginPath(); ctx.lineWidth = w; lw = w; }
        path(i);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle = major ? C.major : C.road; lw = 0;
      for (const i of this.order) {
        const c = L_.cls[i]; const isMajor = c <= CLS.SECONDARY; if (isMajor !== major) continue;
        if (!showMinor && c >= CLS.SERVICE) continue; if (c >= CLS.FOOTWAY || !vis(i)) continue;
        const w = wBy(c); if (w !== lw) { ctx.stroke(); ctx.beginPath(); ctx.lineWidth = w; lw = w; }
        path(i);
      }
      ctx.stroke();
    }
    if (z >= 15.5) { // footpaths
      ctx.beginPath(); ctx.strokeStyle = C.label; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      for (let i = 0; i < L_.a.length; i++) if (L_.cls[i] >= CLS.FOOTWAY && vis(i)) path(i);
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // night lighting glow (citizen view only; the policy view keeps the map quiet under the grid)
    if (!this.policy && (this.night || this.layers.lights)) {
      ctx.save(); ctx.strokeStyle = '#ffb547';
      for (const [min, alpha, wMul] of [[0.7, 0.55, 3.2], [0.4, 0.18, 2.2]]) {
        ctx.beginPath(); ctx.globalAlpha = alpha; ctx.lineWidth = Math.max(2, 2.2 * Math.pow(1.35, z - 15)) * wMul;
        for (let i = 0; i < L_.a.length; i++) { const lt = L_.lt[i]; if (lt < min || (min === 0.4 && lt >= 0.7) || L_.cls[i] >= CLS.FOOTWAY || !vis(i)) continue; if (!showMinor && L_.cls[i] >= CLS.SERVICE) continue; path(i); }
        ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    // grades: color + line style (G solid, Y dashed, R dotted)
    if (this.layers.grades !== false && !this.policy && !this.walkMode) {
      const grades = this.night ? this.gNight : this.gDay;
      const lw = Math.max(1.4, 2.6 * Math.pow(1.3, z - 15));
      const styles = { G: [css('--g') || '#0ca30c', []], Y: [css('--y') || '#f2a90f', [lw * 2.6, lw * 1.6]], R: [css('--r') || '#d03b3b', [lw * 0.2, lw * 1.8]] };
      for (const g of ['G', 'Y', 'R']) {
        if (g === 'G' && z < 13.5) continue;
        const dim = this.routeActive ? 0.38 : 1; // let an active route stand out
        ctx.beginPath(); ctx.strokeStyle = styles[g][0]; ctx.lineWidth = g === 'R' ? lw * 1.35 : lw; ctx.setLineDash(styles[g][1]); ctx.globalAlpha = (g === 'G' ? (this.night ? 0.55 : 0.75) : 0.95) * dim;
        for (let i = 0; i < L_.a.length; i++) { if (grades[i] !== g || !vis(i)) continue; if (!showMinor && L_.cls[i] >= CLS.SERVICE) continue; path(i); }
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // crossings
    if (this.layers.crossings && z >= 15) {
      const r = Math.max(2.5, z - 12.5);
      for (const [a, b, s] of this.data.layers.crosswalks) {
        if (a < bnd.s || a > bnd.n || b < bnd.w || b > bnd.e) continue;
        const [x, y] = v.project(a, b); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        if (s) { ctx.fillStyle = css('--accent'); ctx.fill(); } else { ctx.strokeStyle = css('--r'); ctx.lineWidth = 2; ctx.stroke(); }
      }
    }
    if (this.layers.lights && z >= 14) {
      ctx.fillStyle = '#ffb547';
      for (const [a, b] of this.data.layers.lights) { if (a < bnd.s || a > bnd.n || b < bnd.w || b > bnd.e) continue; const [x, y] = v.project(a, b); ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
    }
    if (this.layers.cctv && z >= 14 && this.data.layers.cctv) { // CCTV: small squares
      ctx.fillStyle = this.nightMap ? '#9fd3ff' : '#1c5cab'; const s = Math.max(2.5, z - 12.5);
      for (const [a, b] of this.data.layers.cctv) { if (a < bnd.s || a > bnd.n || b < bnd.w || b > bnd.e) continue; const [x, y] = v.project(a, b); ctx.fillRect(x - s / 2, y - s / 2, s, s); }
    }
    if (this.layers.taas !== false && this.data.layers.taas?.length && !this.policy && !this.walkMode && z >= 14.5) { // TAAS 사고다발지역: 반경 50 m 원
      for (const [a, b, w] of this.data.layers.taas) {
        if (a < bnd.s || a > bnd.n || b < bnd.w || b > bnd.e) continue;
        const [x, y] = v.project(a, b); const r = 50 / (156543 * Math.cos(a * Math.PI / 180) / Math.pow(2, z));
        ctx.beginPath(); ctx.arc(x, y, Math.max(4, r), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(208,59,59,.14)'; ctx.fill(); ctx.strokeStyle = 'rgba(208,59,59,.85)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        if (z >= 15) { ctx.font = '700 11px "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = '#d03b3b'; ctx.textAlign = 'center'; ctx.fillText(`사고다발 ${w}건`, x, y - Math.max(4, r) - 4); }
      }
    }
    // dim everything outside 동대문구
    ctx.beginPath(); ctx.rect(0, 0, v.width, v.height);
    this.data.base.district.forEach(ring => ring.forEach(([a, b], k) => { const [x, y] = v.project(a, b); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }));
    ctx.fillStyle = this.nightMap ? 'rgba(6,8,11,.55)' : (css('--bg') ? hexA(css('--bg'), 0.55) : 'rgba(236,239,242,.55)'); ctx.fill('evenodd');
    // dong boundaries & district outline
    ctx.setLineDash([4, 4]); ctx.strokeStyle = C.dong; ctx.lineWidth = 1.2; ctx.beginPath();
    this.data.base.dongs.filter(d => d.inDdm).forEach(d => d.rings.forEach(r => r.forEach(([a, b], k) => { const [x, y] = v.project(a, b); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); })));
    ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = C.district; ctx.lineWidth = 2.2; ctx.beginPath();
    this.data.base.district.forEach(ring => { ring.forEach(([a, b], k) => { const [x, y] = v.project(a, b); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); });
    ctx.stroke();
    // labels
    const label = (txt, a, b, size, weight = 600, color = C.label) => {
      const [x, y] = v.project(a, b); ctx.font = `${weight} ${size}px "IBM Plex Sans KR", "Malgun Gothic", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5; ctx.strokeStyle = this.nightMap ? 'rgba(10,12,16,.9)' : hexA(C.land, 0.9); ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
    };
    if (z >= 12.5 && z < 16) this.data.base.dongs.filter(d => d.inDdm).forEach(d => label(d.name, d.c[0], d.c[1], z >= 14 ? 13 : 11.5, 700));
    if (z >= 15) this.data.base.campuses.filter(c => c.name && c.ring.length > 8).forEach(c => { const p = ringCenter(c.ring); label(c.name, p[0], p[1], 11.5, 500); });
  }

  redraw() { this.base.redraw(); this.netLayer.redraw(); }
  // 걷기·교통약자 모드에서는 PM 구간 등급 색을 숨겨 지도를 단순하게
  setWalkMode(on) { if (this.walkMode === on) return; this.walkMode = on; this.netLayer.redraw(); this.onWalkMode?.(on); }
  setPolicy(on) {
    if (this.policy === on) return;
    this.policy = on;
    this.toggle(this.pinLayer, !on); this.toggle(this.routeLayer, !on);
    this.toggle(this.hubLayer, !on && this.layers.hubs !== false); this.toggle(this.transitLayer, this.layers.transit !== false);
    document.getElementById('app').classList.toggle('is-night', this.night && !on);
    if (on) this.map.flyToBounds(this.districtBounds(), { padding: [10, 10], duration: 0.5 });
    this.redraw();
  }
  setNight(n) { if (this.night === n) return; this.night = n; document.getElementById('app').classList.toggle('is-night', n && !this.policy); this.redraw(); this.buildHubs(); }
  setLayers(layers) {
    this.layers = { ...layers };
    this.redraw();
    this.toggle(this.hubLayer, layers.hubs !== false && !this.policy); this.toggle(this.transitLayer, layers.transit !== false); this.toggle(this.reportLayer, layers.reports !== false);
    this.refreshZoomDependent();
  }
  toggle(layer, on) { if (on && !this.map.hasLayer(layer)) layer.addTo(this.map); if (!on && this.map.hasLayer(layer)) layer.remove(); }

  // ── hubs and transit markers
  buildHubs() {
    this.hubLayer.clearLayers(); this.hubMarkers = new Map();
    for (const hb of this.data.hubs.hubs) {
      const size = hb.code ? 30 : hb.grade === 'A' ? 22 : hb.grade === 'B' ? 18 : 12;
      const nightCls = this.night && hb.nightSafe ? ' night' : '';
      const icon = L.divIcon({ className: '', iconSize: [size, size], html: `<div class="hub-icon ${hb.grade}${nightCls}${hb.code ? ' pilot' : ''}" style="width:${size}px;height:${size}px">${hb.code || (hb.grade === 'C' ? '' : hb.grade)}</div>` });
      const m = L.marker([hb.lat, hb.lon], { icon, pane: 'hubPane', keyboard: false, title: hb.name, zIndexOffset: hb.code ? 1000 : hb.grade === 'A' ? 500 : 0 });
      m.on('click', e => { L.DomEvent.stopPropagation(e); this.onHubClick?.(hb); });
      m.hubGrade = hb.grade; m.isPilot = !!hb.code;
      this.hubMarkers.set(hb.id, m);
    }
    this.refreshZoomDependent();
  }
  buildTransit() {
    this.stationLabels = this.data.transit.stations.map(s => L.marker([s.lat, s.lon], { pane: 'hubPane', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div style="transform:translate(-50%,-150%);white-space:nowrap;font:700 12px var(--f-ui);color:var(--accent);background:var(--panel);border:1.5px solid var(--accent);border-radius:999px;padding:1px 8px;box-shadow:var(--shadow)">${esc(s.name)}역</div>` }) }));
    this.busMarkers = this.data.transit.busStops.map(b => L.circleMarker([b.lat, b.lon], { radius: 3.5, weight: 1.5, color: css('--accent'), fillColor: '#fff', fillOpacity: 1, pane: 'hubPane', renderer: this.gridRenderer }).bindTooltip(esc(`${b.name}${b.routes.length ? ' · ' + b.routes.slice(0, 6).join(', ') + (b.routes.length > 6 ? ' 외' : '') : ''}`), { className: 'lbl-tip', direction: 'top' }));
  }
  refreshZoomDependent() {
    const z = this.map.getZoom();
    if (this.hubMarkers) for (const m of this.hubMarkers.values()) {
      const show = this.layers.hubs !== false && (m.isPilot || m.hubGrade === 'A' || (m.hubGrade === 'B' && z >= 14) || (m.hubGrade === 'C' && z >= 15.5));
      if (show && !this.hubLayer.hasLayer(m)) this.hubLayer.addLayer(m); if (!show && this.hubLayer.hasLayer(m)) this.hubLayer.removeLayer(m);
    }
    if (this.stationLabels) {
      this.transitLayer.clearLayers();
      if (this.layers.transit !== false) {
        if (z >= 13.5) this.stationLabels.forEach(m => this.transitLayer.addLayer(m));
        if (z >= 16) this.busMarkers.forEach(m => this.transitLayer.addLayer(m));
      }
    }
  }

  // ── click: pick mode or link inspector
  setPickMode(kind, cb, hint) {
    this.pick = kind ? { kind, cb } : null;
    const el = document.getElementById('map-hint'); el.hidden = !kind; el.textContent = hint || '';
    this.map.getContainer().style.cursor = kind ? 'crosshair' : '';
  }
  onClick(e) {
    if (this.pick) { const p = this.pick; this.setPickMode(null); p.cb({ lat: e.latlng.lat, lon: e.latlng.lng }); return; }
    if (this.onMapClick?.(e) === true) return;
    const i = this.linkAt(e.latlng.lat, e.latlng.lng, e);
    if (i >= 0) this.showLinkPopup(i, e.latlng);
  }
  linkAt(lat, lon) {
    const tol = 18 * 156543 * Math.cos(lat * Math.PI / 180) / Math.pow(2, this.map.getZoom()); // ~18 px in metres
    let best = -1, bd = Infinity;
    const gi = Math.floor(lat / 0.00045), gj = Math.floor(lon / 0.00057);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) for (const i of this.lkGrid.get((gi + di) + ':' + (gj + dj)) || []) {
      const pts = this.lk[i].pts;
      for (let k = 1; k < pts.length; k++) { const d = segDist([lat, lon], pts[k - 1], pts[k]); if (d < bd) { bd = d; best = i; } }
    }
    return bd <= tol ? best : -1;
  }
  showLinkPopup(i, latlng) {
    const L_ = this.net.links, planner = this.data.planner;
    const ctx = { night: this.night, overrides: planner.overrides, hotspots: planner.hotspots };
    const name = L_.name[i] >= 0 ? this.net.names[L_.name[i]] : '이름 없는 길';
    const dirs = [1, -1].map(d => ({ d, g: linkGrade(this.net, i, d, ctx), r: linkReasons(this.net, i, d, ctx) }));
    const el = h('div', null,
      h('b', null, name), h('div', { style: { color: 'var(--muted)', fontSize: '12px' } }, `${CLS_NAME[L_.cls[i]]} · ${fmtM(L_.len[i])} · 경사 ${Math.abs(L_.g[i]).toFixed(1)}% · 조명 ${Math.round(L_.lt[i] * 100)}점 · CCTV ${L_.cc ? L_.cc[i] : 0}대`),
      ...dirs.map(o => h('div', { style: { marginTop: '6px' } }, h('span.grade.' + o.g, null, `${o.d === 1 ? '정방향' : '역방향'} ${GRADE_NAME[o.g]}`), o.g !== 'X' ? ` · 권장 ${speedFor(o.g, this.night, this.net, i)} km/h` : '',
        o.r.length ? h('div', { style: { fontSize: '12px', color: 'var(--ink-2)' } }, o.r.join(' · ')) : null)));
    L.popup({ maxWidth: 280 }).setLatLng(latlng).setContent(el).openOn(this.map);
  }

  // ── routes
  clearRoute() { this.routeLayer.clearLayers(); if (this.routeActive) { this.routeActive = false; this.netLayer.redraw(); } }
  showPlan(plan, choice = 'pm') {
    this.routeLayer.clearLayers();
    if (!this.routeActive) { this.routeActive = true; this.netLayer.redraw(); }
    const casing = (coords, w) => L.polyline(coords, { pane: 'routePane', color: this.night ? '#0b0e12' : '#ffffff', weight: w + 4, opacity: 0.95, interactive: false });
    const add = l => this.routeLayer.addLayer(l);
    const walkLine = coords => add(L.polyline(coords, { pane: 'routePane', color: css('--ink-2'), weight: 4, dashArray: '1 8', lineCap: 'round', opacity: 0.9, interactive: false }));
    if (choice === 'walkGeneral' && plan.walkGeneral) { add(casing(plan.walkGeneral.coords, 3)); walkLine(plan.walkGeneral.coords); return; }
    if (choice === 'walk' && plan.walk) {
      if (plan.profile && plan.profile !== 'pm') { // 교통약자·걷기 추천 경로: 굵은 실선 + 주의 지점
        add(casing(plan.walk.coords, 6));
        add(L.polyline(plan.walk.coords, { pane: 'routePane', color: css('--accent'), weight: 6, opacity: 1, interactive: false }));
        for (const st of plan.walk.steps || []) {
          const warn = st.stairs || st.crossUnsig || st.maxUp >= 5 || st.maxDown <= -5;
          if (!warn) continue;
          add(L.marker(st.at, { pane: 'hubPane', keyboard: false, interactive: false, icon: L.divIcon({ className: '', iconSize: [20, 20], html: '<div class="caution-pin">!</div>' }) }));
        }
        return;
      }
      add(casing(plan.walk.coords, 3)); walkLine(plan.walk.coords); return;
    }
    if (choice === 'bus' && plan.bus) {
      const b = plan.bus; add(L.polyline([[plan.from.lat, plan.from.lon], [b.from.lat, b.from.lon]], { pane: 'routePane', color: css('--ink-2'), weight: 4, dashArray: '1 8' }));
      add(L.polyline([[b.from.lat, b.from.lon], [b.to.lat, b.to.lon]], { pane: 'routePane', color: '#3a9b3a', weight: 6, opacity: 0.85 }));
      add(L.polyline([[b.to.lat, b.to.lon], [plan.to.lat, plan.to.lon]], { pane: 'routePane', color: css('--ink-2'), weight: 4, dashArray: '1 8' }));
      [b.from, b.to].forEach(s => add(L.circleMarker([s.lat, s.lon], { pane: 'routePane', radius: 6, color: '#3a9b3a', fillColor: '#fff', fillOpacity: 1, weight: 3 }).bindTooltip(esc(s.name), { className: 'lbl-tip', permanent: true, direction: 'top', offset: [0, -6] })));
      return;
    }
    const pm = plan.pm; if (!pm) return;
    if (pm.fast && pm.fast.len !== pm.safe.len) add(L.polyline(pm.fast.coords, { pane: 'routePane', color: css('--muted'), weight: 3, dashArray: '6 6', opacity: 0.85, interactive: false }).bindTooltip('가장 빠른 경로 (비교)', { className: 'lbl-tip', sticky: true }));
    if (pm.walkIn) walkLine(pm.walkIn.coords);
    if (pm.walkOut) walkLine(pm.walkOut.coords);
    add(casing(pm.safe.coords, 6));
    const w = 6, colors = { G: css('--g'), Y: css('--y'), R: css('--r'), X: css('--x') };
    for (const st of pm.safe.steps) {
      const c = linkCoords(this.net, st.link); const pts = st.dir === 1 ? c : c.slice().reverse();
      add(L.polyline(pts, { pane: 'routePane', color: colors[st.grade], weight: w, opacity: 1, lineCap: 'butt', dashArray: st.grade === 'Y' ? '10 6' : st.grade === 'R' ? '2 7' : null, interactive: false }));
    }
  }
  fitPlan(plan) {
    const pts = [[plan.from.lat, plan.from.lon], [plan.to.lat, plan.to.lon], ...(plan.pm?.safe.coords || []), ...(plan.walk?.coords || [])];
    this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
  }

  setPins(from, to, onDrag) {
    this.pinLayer.clearLayers();
    for (const [p, cls] of [[from, 'from'], [to, 'to']]) {
      if (!p) continue;
      const m = L.marker([p.lat, p.lon], { draggable: true, pane: 'hubPane', zIndexOffset: 2000, icon: L.divIcon({ className: '', iconSize: [16, 16], html: `<div class="pin ${cls}"></div>` }), title: cls === 'from' ? '출발지 (끌어서 이동)' : '목적지 (끌어서 이동)' });
      m.on('dragend', () => { const ll = m.getLatLng(); onDrag?.(cls, { lat: ll.lat, lon: ll.lng, label: '지도에서 선택한 위치' }); });
      this.pinLayer.addLayer(m);
    }
  }

  // ── ride marker
  setRider(latlng) {
    if (!latlng) { this.rider?.remove(); this.rider = null; return; }
    if (!this.rider) this.rider = L.marker(latlng, { pane: 'hubPane', zIndexOffset: 3000, interactive: false, icon: L.divIcon({ className: '', iconSize: [18, 18], html: '<div class="pin me"></div>' }) }).addTo(this.map);
    else this.rider.setLatLng(latlng);
  }
  showRadius(hub, radius) {
    this.radiusLayer?.remove();
    if (!hub) return;
    this.radiusLayer = L.layerGroup([
      L.circle([hub.lat, hub.lon], { radius, pane: 'routePane', color: css('--accent'), weight: 2, fillColor: css('--accent'), fillOpacity: 0.12 }),
      L.circle([hub.lat, hub.lon], { radius: 50, pane: 'routePane', color: css('--accent'), weight: 1, dashArray: '4 4', fill: false }),
    ]).addTo(this.map);
  }

  // ── grid choropleth
  showGrid(cells, colorOf, labelOf, onClick, selectedId) {
    this.gridLayer.clearLayers();
    const resolve = v => (v && v.startsWith('var(') ? css(v.slice(4, -1)) : v); // canvas cannot read CSS variables
    for (const c of cells) {
      const col = resolve(colorOf(c));
      const poly = L.polygon(c.corners, { renderer: this.gridRenderer, pane: 'gridPane', color: c.id === selectedId ? css('--ink') : (this.night ? '#0b0e12' : '#ffffff'), weight: c.id === selectedId ? 3 : 1, fillColor: col || 'transparent', fillOpacity: col ? 0.72 : 0, interactive: true });
      poly.on('click', e => { L.DomEvent.stopPropagation(e); onClick(c); });
      this.gridLayer.addLayer(poly);
      const lab = labelOf?.(c);
      if (lab && this.map.getZoom() >= 14) this.gridLayer.addLayer(L.marker([c.lat, c.lon], { pane: 'gridPane', interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [24, 14], html: `<div class="cell-label">${lab}</div>` }) }));
    }
  }
  clearGrid() { this.gridLayer.clearLayers(); }

  // ── reports
  showReports(list, onClick) {
    this.reportLayer.clearLayers();
    for (const r of list) {
      if (r.lat == null) continue;
      const m = L.marker([r.lat, r.lon], { pane: 'hubPane', icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 22], html: `<div class="report-icon"><span>!</span></div>` }) });
      m.on('click', e => { L.DomEvent.stopPropagation(e); onClick?.(r); });
      this.reportLayer.addLayer(m);
    }
  }
  flyTo(lat, lon, z = 16) { this.map.flyTo([lat, lon], Math.max(z, this.map.getZoom()), { duration: 0.6 }); }
}

function segDist(p, a, b) {
  const kx = 111320 * Math.cos(p[0] * Math.PI / 180), ky = 110950;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ringCenter = r =>[r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];
function hexA(hex, a) {
  const m = hex.match(/^#([0-9a-f]{6})$/i); if (!m) return hex;
  const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
export { metres };

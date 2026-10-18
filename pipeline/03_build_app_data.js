// Step 3 — Build everything the app loads (app/data/*.json) from data/raw (OSM) and data/extract (public data slices).
// Runs without the large original files, so teammates and reviewers can reproduce the app data from the repository.
import fs from 'fs';
import { P, readJson, writeJson, exists } from './lib/io.js';
import { relationRings, bboxOf, expandBbox, toXY, toLatLon, round } from './lib/geo.js';
import { loadDem } from './lib/dem.js';
import { buildDongs, buildBasemap, polyIndex } from './build/basemap.js';
import { buildNetwork } from './build/network.js';
import { buildTransit } from './build/transit.js';
import { buildBike } from './build/bike.js';
import { buildHubs } from './build/hubs.js';
import { buildGrid } from './build/grid.js';
import { buildModels } from './build/models.js';
import { PARAMS } from '../app/js/core/params.js';

const t0 = Date.now();
const osm = readJson(P('data', 'raw', 'osm_ddm.json'));
const osmDongs = readJson(P('data', 'raw', 'osm_dongs.json'));
const X = n => readJson(P('data', 'extract', n));

const guRel = osm.elements.find(e => e.type === 'relation' && e.tags?.name === '동대문구' && e.tags?.admin_level === '6');
const ringsDdm = relationRings(guRel);
const aoi = expandBbox(bboxOf(ringsDdm), 800);
// clip ring = district outline pushed out by ~400 m (approximated by scaling around the centroid)
const [cx, cy] = (() => { let x = 0, y = 0, n = 0; ringsDdm[0].forEach(([a, b]) => { const p = toXY(a, b); x += p[0]; y += p[1]; n++; }); return [x / n, y / n]; })();
const clipRing = ringsDdm[0].map(([a, b]) => { const [x, y] = toXY(a, b); const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1; return toLatLon(x + dx / d * 400, y + dy / d * 400); });

console.log('[dongs]'); const dongs = buildDongs(osmDongs, ringsDdm);
console.log(`  ${dongs.filter(d => d.inDdm).length} 행정동 in 동대문구: ${dongs.filter(d => d.inDdm).map(d => d.name).join(', ')}`);

const dem = loadDem(X('dem.json'));
const cw = X('crosswalks.json');
const lights = X('streetlights.json').lights;
const osmLamps = osm.elements.filter(e => e.tags?.highway === 'street_lamp' && e.lat).map(e => ({ lat: e.lat, lon: e.lon }));
const busStopsRaw = osm.elements.filter(e => e.tags?.highway === 'bus_stop' && e.lat).map(e => ({ lat: e.lat, lon: e.lon }));
const entrancesRaw = osm.elements.filter(e => e.tags?.railway === 'subway_entrance' && e.lat).map(e => ({ lat: e.lat, lon: e.lon }));
const parks = polyIndex(osm, t => t.leisure === 'park');
const campuses = polyIndex(osm, t => /university|college/.test(t.amenity || ''));
// Optional inputs (present when the files were provided) — each one replaces an estimate with measured data
const opt = n => (exists(P('data', 'extract', n)) ? X(n) : null);
const accidents = opt('accidents.json')?.points?.length ? opt('accidents.json').points : null; // TAAS (pipeline/fetch_taas.js)
const cctv = opt('cctv.json')?.sites || [];
const securityLights = opt('security_lights.json')?.lights || [];
const bikeMaster = opt('bike_master.json')?.stations || null;
const population = opt('population_100m.json');
const pmAcc = opt('pm_accidents_synth.json');
console.log('[network]', accidents ? `with ${accidents.length} TAAS accident points` : '(risk proxy — no TAAS accident file yet)', `· CCTV ${cctv.length} sites · 보안등 ${securityLights.length}`);
const net = buildNetwork({ osm, clipRing, dem, crosswalks: cw.crosswalks, pedSignals: cw.pedSignals, lights, osmLamps, securityLights, cctv, busStops: busStopsRaw, entrances: entrancesRaw, parks, campuses, accidents });

console.log('[transit]');
const transit = buildTransit({ osm, clipRing, ringsDdm, busHourly: X('bus_hourly_2022.json'), busDaily: X('bus_daily_recent.json'), subwayHourly: X('subway_hourly.json') });
console.log('[bike]');
const bike = buildBike({ osm, clipRing, dongs, bikeOd: X('bike_od.json'), master: bikeMaster });
console.log(`  ${bike.totals.tripsPerDay} trips/day touching 동대문구, night share ${(bike.totals.nightShare * 100).toFixed(1)}%`);
console.log('[hubs]');
const hubs = buildHubs({ net, transit, bike, osm, ringsDdm, cctv });
console.log('[grid]');
const grid = buildGrid({ net, transit, bike, ringsDdm, dongs, overrides: hubs.overrides, population: population?.cells || null });
console.log('[models]');
const models = buildModels({ pmAcc, bike, transit, net, hubs, crosswalks: cw.crosswalks, pedSignals: cw.pedSignals, osm });
if (models.severityGlm) console.log(`  severity GLM n=${models.severityGlm.n}, AUC ${models.severityGlm.auc}; night OR ${models.severityGlm.coef[1].or}; night risk ratio ${models.nightRisk.ratio}`);
models.pilotFacts.forEach(f => console.log(`  · ${f.key}: ${f.value}${f.unit} (정책안: ${f.doc})`));
console.log('[basemap]');
const base = buildBasemap({ osm, ringsDdm, dongs, contours: X('contours.json'), aoi });

// map layers for crossings / lights (only what the app draws)
const layers = {
  crosswalks: cw.crosswalks.filter(c => c.link != null).map(c => [round(c.lat, 6), round(c.lon, 6), c.signal ? 1 : 0]),
  lights: lights.map(l => [l.lat, l.lon]).concat(osmLamps.map(l => [round(l.lat), round(l.lon)]), securityLights.map(l => [l.lat, l.lon])),
  cctv: cctv.map(c => [c.lat, c.lon, c.n || 1]),
  taas: (accidents || []).map(a => [round(a.lat, 6), round(a.lon, 6), a.weight || 1, a.name || '', a.kind || '', a.year || '']),
};

const out = P('app', 'data');
writeJson(P('app', 'data', 'network.json'), { nodes: net.nodes, links: (({ way, ...l }) => l)(net.links), names: net.names, hotspots: net.hotspots, accidentSource: net.accidentSource });
writeJson(P('app', 'data', 'transit.json'), transit);
writeJson(P('app', 'data', 'bike.json'), bike);
writeJson(P('app', 'data', 'hubs.json'), hubs);
writeJson(P('app', 'data', 'grid.json'), grid);
writeJson(P('app', 'data', 'base.json'), base);
writeJson(P('app', 'data', 'layers.json'), layers);
writeJson(P('app', 'data', 'models.json'), models);
writeJson(P('app', 'data', 'meta.json'), {
  builtAt: new Date().toISOString(), area: '서울특별시 동대문구', params: PARAMS,
  counts: { nodes: net.nodes.lat.length, links: net.links.a.length, cells: grid.cells.length, hubs: hubs.hubs.length, busStops: transit.busStops.length, stations: transit.stations.length, crosswalks: layers.crosswalks.length, lights: layers.lights.length, cctv: cctv.length, cctvCameras: cctv.reduce((a, c) => a + (c.n || 1), 0), securityLights: securityLights.length, population: population ? Math.round(grid.cells.reduce((a, c) => a + (c.pop || 0), 0)) : null },
  accidentSource: net.accidentSource,
  sources: { cctv: cctv.length > 0, securityLights: securityLights.length > 0, bikeMaster: bike.stationSource === 'master', population: !!population, populationYear: population?.year || null, pmAccidents: !!pmAcc, subwayStations: [...new Set(transit.stations.filter(s => s.ridership).map(s => s.name))].length },
  bikePeriod: bike.period, busMonth: transit.busMonth,
}, true);
console.log(`build done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

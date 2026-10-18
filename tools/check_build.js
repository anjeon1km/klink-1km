// Sanity report on app/data — run after the build: node tools/check_build.js
import fs from 'fs';
import { linkGrade, F, CLS_NAME } from '../app/js/core/grading.js';
const J = f => JSON.parse(fs.readFileSync(new URL(`../app/data/${f}`, import.meta.url)));
const net = J('network.json'), hubs = J('hubs.json'), grid = J('grid.json'), transit = J('transit.json'), bike = J('bike.json');
const L = net.links;
const ov = new Map(Object.entries(hubs.overrides).map(([k, v]) => [+k, v]));
const tally = night => { const t = { G: 0, Y: 0, R: 0, X: 0 }; for (let i = 0; i < L.a.length; i++) if (L.flags[i] & F.PM) t[linkGrade(net, i, 1, { night, overrides: ov })] += L.len[i]; return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v / 1000).toFixed(1) + 'km'])); };
console.log('PM link length by grade (a→b), day:', tally(false), 'night:', tally(true));
const g = L.g.filter((_, i) => L.flags[i] & F.PM).map(Math.abs).sort((a, b) => a - b);
const q = p => g[Math.floor(p * (g.length - 1))];
console.log('|slope| % quantiles p50/p90/p97/p99/max:', q(0.5), q(0.9), q(0.97), q(0.99), g[g.length - 1]);
const cls = {}; L.cls.forEach((c, i) => { cls[CLS_NAME[c]] = (cls[CLS_NAME[c]] || 0) + L.len[i]; });
console.log('length by class (km):', Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, (v / 1000).toFixed(1)])));
const lt = L.lt.filter((_, i) => L.flags[i] & F.PM); console.log('PM links lit ≥0.7:', (lt.filter(v => v >= 0.7).length / lt.length * 100).toFixed(1) + '%', '<0.4:', (lt.filter(v => v < 0.4).length / lt.length * 100).toFixed(1) + '%');
console.log('pilot hubs:', hubs.hubs.filter(h => h.code).map(h => `${h.code} ${h.name} ${h.lat},${h.lon} node ${h.node} z=${net.nodes.z[h.node]}`).join(' | '));
for (const c of hubs.corridors) {
  let len = 0, rise = 0; c.links.forEach((l, k) => { len += L.len[l]; rise += L.g[l] * c.dirs[k] * L.len[l] / 100; });
  const gs = c.links.map((l, k) => (L.g[l] * c.dirs[k]).toFixed(1));
  console.log(`${c.id}: ${len.toFixed(0)} m, net rise ${rise.toFixed(1)} m, slopes ${gs.join(' ')}`);
}
const types = {}; grid.cells.forEach(c => { types[c.type] = (types[c.type] || 0) + 1; });
const typesN = {}; grid.cells.forEach(c => { typesN[c.typeNight] = (typesN[c.typeNight] || 0) + 1; });
const quads = {}; grid.cells.forEach(c => { quads[c.quad] = (quads[c.quad] || 0) + 1; });
console.log('types day', JSON.stringify(types), 'night', JSON.stringify(typesN), 'quadrants', JSON.stringify(quads));
const top = grid.cells.slice().sort((a, b) => b.ptvi - a.ptvi).slice(0, 8);
top.forEach(c => console.log(`  #${c.rank} ${c.dong} PTVI ${c.ptvi} NIGHT ${c.nightTvi} type ${c.type} comp ${JSON.stringify(c.comp)} tai ${c.taiDay}/${c.taiLate}/${c.taiDeep} tSt ${c.tStation} pui ${c.pui} lastBus ${c.lastBus}`));
const tai = grid.cells.map(c => c.taiDay).sort((a, b) => a - b); console.log('TAI day min/med/max', tai[0], tai[Math.floor(tai.length / 2)], tai[tai.length - 1]);
console.log('hoegi-ish cells:', grid.cells.filter(c => c.dong === '회기동').map(c => `${c.id} ptvi ${c.ptvi} type ${c.type} tSt ${c.tStation}`).join(' | '));
console.log('stations', transit.stations.map(s => `${s.name}(${s.lines.length}${s.inDdm ? '*' : ''})`).join(' '));
console.log('route types', JSON.stringify(transit.routes.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {})), 'night routes', transit.routes.filter(r => r.type === 'night').map(r => `${r.no}:${r.first}-${r.last}`).join(' '));
console.log('dongs bike', bike.dongs.map(d => `${d.name} ${d.tripsPerDay}/d night ${(d.nightShare * 100).toFixed(0)}% osm ${d.osmStations}`).join(' | '));
console.log('period', JSON.stringify(bike.period));

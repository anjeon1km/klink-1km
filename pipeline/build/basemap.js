// Vector basemap layers (no tile server needed): district & 행정동 boundaries, water, parks, campuses, rail, contours.
import { relationRings, simplify, round, inBbox, pointInRing, bboxOf } from '../lib/geo.js';

const R5 = pts => pts.map(([a, b]) => [round(a, 5), round(b, 5)]);
const ringBb = ring => { const b = bboxOf([ring]); return b; };

export function buildDongs(osmDongs, ringsDdm) {
  return osmDongs.elements.filter(e => e.type === 'relation' && e.tags?.admin_level === '8').map(e => {
    const rings = relationRings(e);
    let la = 0, lo = 0, n = 0; rings[0]?.forEach(p => { la += p[0]; lo += p[1]; n++; });
    const c = [la / n, lo / n];
    return { name: e.tags.name, rings, centroid: c, inDdm: ringsDdm.some(r => pointInRing(c[0], c[1], r)) };
  });
}

export function buildBasemap({ osm, ringsDdm, dongs, contours, aoi }) {
  const polysOf = pred => osm.elements.filter(e => e.type === 'way' && e.geometry && pred(e.tags || {}))
    .map(e => ({ name: e.tags.name || '', kind: e.tags.amenity || e.tags.leisure || e.tags.natural || '', ring: e.geometry.map(g => [g.lat, g.lon]) }))
    .filter(p => p.ring.some(([a, b]) => inBbox(a, b, aoi)));
  const relPolys = pred => osm.elements.filter(e => e.type === 'relation' && pred(e.tags || {}) && e.members)
    .flatMap(e => relationRings(e).map(ring => ({ name: e.tags.name || '', kind: e.tags.amenity || '', ring })));
  const parks = polysOf(t => t.leisure === 'park');
  const campuses = polysOf(t => /university|college|hospital|school/.test(t.amenity || '')).concat(relPolys(t => /university|hospital/.test(t.amenity || '')));
  const water = polysOf(t => t.natural === 'water');
  const rivers = osm.elements.filter(e => e.type === 'way' && /river|stream/.test(e.tags?.waterway || '') && e.geometry)
    .map(e => ({ name: e.tags.name || '', kind: e.tags.waterway, pts: e.geometry.map(g => [g.lat, g.lon]) }));
  const rail = osm.elements.filter(e => e.type === 'way' && /^(rail|subway)$/.test(e.tags?.railway || '') && e.geometry && !(e.tags.tunnel && e.tags.tunnel !== 'no'))
    .map(e => ({ kind: e.tags.railway, pts: e.geometry.map(g => [g.lat, g.lon]) }));
  return {
    district: ringsDdm.map(r => R5(simplify(r, 3))),
    dongs: dongs.map(d => ({ name: d.name, inDdm: d.inDdm, c: d.centroid.map(v => round(v, 5)), rings: d.rings.map(r => R5(simplify(r, 4))) })),
    parks: parks.map(p => ({ name: p.name, ring: R5(simplify(p.ring, 3)) })),
    campuses: campuses.map(p => ({ name: p.name, kind: p.kind, ring: R5(simplify(p.ring, 3)) })),
    water: water.map(p => ({ name: p.name, ring: R5(simplify(p.ring, 3)) })),
    rivers: rivers.map(r => ({ name: r.name, kind: r.kind, pts: R5(simplify(r.pts, 3)) })),
    rail: rail.map(r => ({ kind: r.kind, pts: R5(simplify(r.pts, 3)) })),
    contours,
  };
}

// polygons used by the network builder (bounding boxes for fast rejection)
export function polyIndex(osm, pred) {
  return osm.elements.filter(e => e.type === 'way' && e.geometry && pred(e.tags || {})).map(e => { const ring = e.geometry.map(g => [g.lat, g.lon]); return { ring, bb: ringBb(ring) }; });
}

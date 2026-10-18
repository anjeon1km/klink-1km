// Road graph utilities: adjacency, nearest-node lookup, Dijkstra (single/multi-source, bounded).
// net = { nodes: {lat[], lon[], z[]}, links: {a[], b[], len[], ...} }

const M_LAT = 110950, M_LON = 111320 * Math.cos(37.585 * Math.PI / 180);
export const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lat2 - lat1) * M_LAT, (lon2 - lon1) * M_LON);

export function buildAdjacency(net) {
  const n = net.nodes.lat.length, L = net.links;
  const deg = new Int32Array(n + 1);
  for (let i = 0; i < L.a.length; i++) { deg[L.a[i] + 1]++; deg[L.b[i] + 1]++; }
  for (let i = 1; i <= n; i++) deg[i] += deg[i - 1];
  const start = deg.slice(); const fill = deg.slice(0, n);
  const link = new Int32Array(L.a.length * 2), dir = new Int8Array(L.a.length * 2), to = new Int32Array(L.a.length * 2);
  for (let i = 0; i < L.a.length; i++) {
    let k = fill[L.a[i]]++; link[k] = i; dir[k] = 1; to[k] = L.b[i];
    k = fill[L.b[i]]++; link[k] = i; dir[k] = -1; to[k] = L.a[i];
  }
  net.adj = { start, link, dir, to };
  // spatial grid for nearest-node lookup (≈60 m cells)
  const cell = 60, grid = new Map();
  for (let v = 0; v < n; v++) {
    const k = Math.floor(net.nodes.lon[v] * M_LON / cell) + ':' + Math.floor(net.nodes.lat[v] * M_LAT / cell);
    if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v);
  }
  net.grid = { cell, map: grid };
  return net;
}

// Label connected components of the sub-graph formed by links with accept(link) true.
// Returns { label: Int32Array (−1 = not on sub-graph), main: label of the largest component }.
export function components(net, accept) {
  const n = net.nodes.lat.length; const { start, link, to } = net.adj;
  const label = new Int32Array(n).fill(-1); const sizes = [];
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0) continue;
    let has = false; for (let k = start[s]; k < start[s + 1]; k++) if (accept(link[k])) { has = true; break; }
    if (!has) continue;
    const id = sizes.length; let size = 0; const stack = [s]; label[s] = id;
    while (stack.length) {
      const u = stack.pop(); size++;
      for (let k = start[u]; k < start[u + 1]; k++) { if (!accept(link[k])) continue; const w = to[k]; if (label[w] < 0) { label[w] = id; stack.push(w); } }
    }
    sizes.push(size);
  }
  let main = 0; sizes.forEach((v, i) => { if (v > sizes[main]) main = i; });
  return { label, main };
}
// accept-function for nodes in the main component of a sub-graph
export function mainComponentAccept(net, linkAccept) {
  const { label, main } = components(net, linkAccept);
  return l => linkAccept(l) && label[net.links.a[l]] === main;
}

// nearest node whose incident links satisfy accept(linkIndex) (e.g. PM-rideable)
export function nearestNode(net, lat, lon, accept = null, maxR = 600) {
  const { cell, map } = net.grid; const gx = Math.floor(lon * M_LON / cell), gy = Math.floor(lat * M_LAT / cell);
  let best = -1, bestD = Infinity;
  for (let r = 0; r * cell <= maxR + cell; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const arr = map.get((gx + dx) + ':' + (gy + dy)); if (!arr) continue;
      for (const v of arr) {
        const d = metres(lat, lon, net.nodes.lat[v], net.nodes.lon[v]);
        if (d >= bestD) continue;
        if (accept) { const { start, link } = net.adj; let ok = false; for (let k = start[v]; k < start[v + 1]; k++) if (accept(link[k])) { ok = true; break; } if (!ok) continue; }
        best = v; bestD = d;
      }
    }
    if (best >= 0 && bestD <= r * cell) break;
  }
  return best >= 0 ? { node: best, d: bestD } : null;
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const topV = v[0], topK = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      while (true) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return [topK, topV];
  }
}

// Dijkstra. sources: [{node, cost}] ; cost(linkIndex, dir) → seconds (Infinity = blocked)
// opts.target: node to stop at; opts.maxCost: bound. Returns {dist: Float64Array, prevLink, prevDir}
export function dijkstra(net, sources, cost, opts = {}) {
  const n = net.nodes.lat.length; const { start, link, dir, to } = net.adj;
  const dist = new Float64Array(n).fill(Infinity), prevLink = new Int32Array(n).fill(-1), prevDir = new Int8Array(n);
  const h = new Heap();
  for (const s of sources) if (s.cost < dist[s.node]) { dist[s.node] = s.cost; h.push(s.cost, s.node); }
  const maxCost = opts.maxCost ?? Infinity;
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist[u]) continue;
    if (u === opts.target) break;
    if (d > maxCost) break;
    for (let k = start[u]; k < start[u + 1]; k++) {
      const c = cost(link[k], dir[k]); if (c === Infinity) continue;
      const nd = d + c, w = to[k];
      if (nd < dist[w]) { dist[w] = nd; prevLink[w] = link[k]; prevDir[w] = dir[k]; h.push(nd, w); }
    }
  }
  return { dist, prevLink, prevDir };
}

// Reconstruct link path ending at node t → [{link, dir}] from source to t
export function pathTo(net, res, t) {
  const out = []; let v = t; let guard = 0;
  while (res.prevLink[v] >= 0 && guard++ < 1e6) {
    const l = res.prevLink[v], d = res.prevDir[v];
    out.push({ link: l, dir: d });
    v = d === 1 ? net.links.a[l] : net.links.b[l];
  }
  return out.reverse();
}

// polyline of a path as [[lat,lon],...]
export function pathCoords(net, path) {
  const pts = [];
  for (const { link, dir } of path) {
    const seg = linkCoords(net, link);
    const s = dir === 1 ? seg : seg.slice().reverse();
    if (pts.length) s.shift();
    pts.push(...s);
  }
  return pts;
}
export function linkCoords(net, i) {
  const L = net.links, N = net.nodes;
  const a = L.a[i], b = L.b[i];
  const mid = L.geom?.[i] || [];
  return [[N.lat[a], N.lon[a]], ...mid, [N.lat[b], N.lon[b]]];
}

// Step 1 — Download OpenStreetMap data for Dongdaemun-gu (+ ~700 m margin) through the Overpass API.
// Output: data/raw/osm_ddm.json (roads, transit stops, bike stations, basemap features)
//         data/raw/osm_dongs.json (행정동 boundaries)
// Data © OpenStreetMap contributors, ODbL.
import fs from 'fs';
import { P } from './lib/io.js';

const BB = '37.548,127.010,37.615,127.090';
const QUERIES = {
  osm_ddm: `[out:json][timeout:180];
rel["name"="동대문구"]["admin_level"="6"];out geom;
(
  way["highway"](${BB});
  node["highway"="bus_stop"](${BB});
  node["railway"="station"](${BB});
  node["railway"="subway_entrance"](${BB});
  node["amenity"="bicycle_rental"](${BB});
  node["man_made"="surveillance"](${BB});
  node["highway"="street_lamp"](${BB});
  way["railway"~"rail|subway"](${BB});
  way["waterway"~"river|stream"](${BB});
  way["natural"="water"](${BB});
  way["leisure"="park"](${BB});
  way["amenity"~"university|hospital|school|college"](${BB});
  rel["amenity"~"university|hospital"](${BB});
);
out geom;`,
  osm_dongs: `[out:json][timeout:90];rel["boundary"="administrative"]["admin_level"="8"](37.565,127.03,37.605,127.075);out geom;`,
};
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function run(name, q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of MIRRORS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'k-link-1km-research/0.1 (student project)' } });
        const t = await r.text();
        if (!r.ok || t[0] !== '{') { console.log(`  ${name}: ${url} → HTTP ${r.status}, retrying`); continue; }
        fs.writeFileSync(P('data', 'raw', name + '.json'), t);
        console.log(`  ${name}: ${JSON.parse(t).elements.length} elements`);
        return;
      } catch (e) { console.log(`  ${name}: ${url} → ${e.message}`); }
    }
    await new Promise(r => setTimeout(r, 20000));
  }
  throw new Error(`Overpass download failed for ${name}. Try again later; the servers are often busy.`);
}

const force = process.argv.includes('--force');
for (const [name, q] of Object.entries(QUERIES)) {
  if (!force && fs.existsSync(P('data', 'raw', name + '.json'))) { console.log(`  ${name}: cached (use --force to refresh)`); continue; }
  await run(name, q);
}

// Packages app/ for publishing as a claude.ai artifact (dist/artifact/).
// The artifact host wraps the page in its own <html>/<head>/<body>, so index.html becomes a fragment;
// Leaflet's script comes from cdnjs (allowed CDN), everything else ships as files next to the page.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app'), OUT = path.join(ROOT, 'dist', 'artifact');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->')).trim();
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const page = [
  '<title>안키로 · 안전한 1키로</title>',
  fonts,
  '<link rel="stylesheet" href="vendor/leaflet.css">',
  '<link rel="stylesheet" href="css/app.css">',
  body,
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>',
  '<script type="module" src="js/main.js"></script>',
].join('\n');
fs.writeFileSync(path.join(OUT, 'index.html'), page);

const files = [];
const copy = (rel) => {
  const src = path.join(APP, rel), dst = path.join(OUT, rel);
  if (fs.statSync(src).isDirectory()) { for (const f of fs.readdirSync(src)) copy(path.join(rel, f)); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); files.push(rel.split(path.sep).join('/'));
};
['css', 'js', 'data', 'vendor/leaflet.css'].forEach(copy);
fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify(files, null, 1));
const size = files.reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`dist/artifact: index.html + ${files.length} files (${(size / 1024 / 1024).toFixed(1)} MB)`);

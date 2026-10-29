// 설치형 웹앱용: app/ 안의 모든 앱 파일 목록과 내용 해시를 app/sw.js에 써 넣습니다.
// 앱 파일(js·css·data·아이콘)을 바꾼 뒤 `npm run pwa`를 실행하면 휴대폰에 저장된 예전 파일이 새것으로 바뀝니다.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const SKIP = new Set(['sw.js']);
const files = [];
(function walk(rel) {
  for (const f of fs.readdirSync(path.join(APP, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${f.name}` : f.name;
    if (f.isDirectory()) walk(r);
    else if (!SKIP.has(r) && !/LICENSE|\.map$/.test(f.name)) files.push(r);
  }
})('');
files.sort();
const hash = crypto.createHash('sha1');
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(APP, f)));
const version = 'ankiro-' + hash.digest('hex').slice(0, 10);

const swPath = path.join(APP, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const list = ['./', ...files].map(f => `  '${f}',`).join('\n');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/\/\/ <precache>[\s\S]*?\/\/ <\/precache>/, `// <precache>\n${list}\n  // </precache>`);
fs.writeFileSync(swPath, sw);
const size = files.reduce((a, f) => a + fs.statSync(path.join(APP, f)).size, 0);
console.log(`sw.js: ${version}, ${files.length + 1} files (${(size / 1024 / 1024).toFixed(1)} MB) precached`);

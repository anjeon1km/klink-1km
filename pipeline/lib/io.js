// File helpers: project paths, raw-source config, CP949 CSV streaming, JSON output.
import fs from 'fs';
import os from 'os';
import zlib from 'zlib';
import path from 'path';
import readline from 'readline';
import iconv from 'iconv-lite';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const P = (...p) => path.join(ROOT, ...p);

// Raw data locations. Copy config/sources.example.json to config/sources.local.json and edit the paths.
export function loadSources() {
  const local = P('config', 'sources.local.json');
  const file = fs.existsSync(local) ? local : P('config', 'sources.example.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = cfg.rawRoot ? path.resolve(ROOT, cfg.rawRoot) : ROOT;
  const one = v => path.resolve(base, v.replace(/^~(?=[\\/])/, os.homedir()));
  const resolve = v => (Array.isArray(v) ? v.map(resolve) : one(v));
  const out = {};
  for (const [k, v] of Object.entries(cfg.files)) out[k] = resolve(v);
  // "anyOf": candidate locations for one file — the first that exists wins (e.g. 데이터 폴더, 다운로드 폴더)
  for (const [k, v] of Object.entries(cfg.anyOf || {})) out[k] = v.map(one).find(p => fs.existsSync(p)) || null;
  out._file = file;
  return out;
}

// Minimal ZIP reader (stored or deflated entries) — enough for public-data zip downloads.
export function readZipEntries(file) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22; while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP 끝 레코드를 찾지 못했습니다: ' + file);
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = iconv.decode(buf.subarray(p + 46, p + 46 + nlen), (buf.readUInt16LE(p + 8) & 0x800) ? 'utf8' : 'cp949');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    out.push({ name, read: () => (method === 0 ? data : zlib.inflateRawSync(data)) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function splitCsvLine(line) {
  if (line.indexOf('"') < 0) return line.split(',');
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Seoul open-data CSVs are CP949 (EUC-KR) without BOM. Detect a UTF-8 BOM just in case.
function detectEncoding(file) {
  const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(3); fs.readSync(fd, b, 0, 3, 0); fs.closeSync(fd);
  return (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) ? 'utf8' : 'cp949';
}

// Streams rows as arrays; onRow(row, header) is called for each data row.
export async function streamCsv(file, onRow) {
  const enc = detectEncoding(file);
  const input = fs.createReadStream(file).pipe(iconv.decodeStream(enc));
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let header = null, n = 0;
  for await (const raw of rl) {
    const line = raw.replace(/^﻿/, '');
    if (!line.trim()) continue;
    const row = splitCsvLine(line);
    if (!header) { header = row.map(s => s.trim()); continue; }
    n++; onRow(row, header);
  }
  return n;
}

export function writeJson(file, data, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const s = pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data);
  fs.writeFileSync(file, s);
  console.log(`  → ${path.relative(ROOT, file)} (${(s.length / 1024).toFixed(0)} KB)`);
}
export const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
export const exists = f => fs.existsSync(f);

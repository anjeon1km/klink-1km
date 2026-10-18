// Bilinear elevation lookup on the 10 m grid produced by 02_extract_raw.js (dem).
import { toXY } from './geo.js';

export function loadDem(j) {
  const buf = Buffer.from(j.data, 'base64');
  const z = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const { x0, y0, cell, nx, ny } = j;
  const v = (i, k) => z[Math.max(0, Math.min(ny - 1, k)) * nx + Math.max(0, Math.min(nx - 1, i))] / 10;
  return {
    ...j,
    at(lat, lon) {
      const [x, y] = toXY(lat, lon);
      const fx = (x - x0) / cell - 0.5, fy = (y - y0) / cell - 0.5;
      const i = Math.floor(fx), k = Math.floor(fy), tx = fx - i, ty = fy - k;
      return (v(i, k) * (1 - tx) + v(i + 1, k) * tx) * (1 - ty) + (v(i, k + 1) * (1 - tx) + v(i + 1, k + 1) * tx) * ty;
    },
  };
}

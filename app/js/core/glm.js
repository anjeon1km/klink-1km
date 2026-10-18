// Logistic regression (binomial GLM, logit link) fitted by IRLS — small, dependency-free, deterministic.
// fitLogit(X, y, names) → { coef: [{name, b, se, or, lo, hi, p}], n, iterations, deviance, auc }

function solve(A, b) { // Gaussian elimination with partial pivoting; returns x and the inverse of A
  const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)), b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let k = c; k < M[c].length; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let k = c; k < M[r].length; k++) M[r][k] -= f * M[c][k]; }
  }
  return { x: M.map(r => r[2 * n]), inv: M.map(r => r.slice(n, 2 * n)) };
}
const normCdf = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

export function fitLogit(X, y, names, maxIter = 50) {
  const n = X.length, p = X[0].length; let beta = new Array(p).fill(0); let inv = null, it = 0;
  for (; it < maxIter; it++) {
    const XtWX = Array.from({ length: p }, () => new Array(p).fill(0)), XtWz = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      const eta = X[i].reduce((s, v, j) => s + v * beta[j], 0), mu = 1 / (1 + Math.exp(-eta));
      const w = Math.max(1e-9, mu * (1 - mu)), z = eta + (y[i] - mu) / w;
      for (let a = 0; a < p; a++) { XtWz[a] += X[i][a] * w * z; for (let b = 0; b < p; b++) XtWX[a][b] += X[i][a] * w * X[i][b]; }
    }
    const s = solve(XtWX, XtWz); inv = s.inv;
    const diff = s.x.reduce((m, v, j) => Math.max(m, Math.abs(v - beta[j])), 0); beta = s.x;
    if (diff < 1e-8) break;
  }
  const mu = X.map(r => 1 / (1 + Math.exp(-r.reduce((s, v, j) => s + v * beta[j], 0))));
  const deviance = -2 * y.reduce((s, yi, i) => s + (yi ? Math.log(mu[i]) : Math.log(1 - mu[i])), 0);
  // AUC (Mann–Whitney) of in-sample predictions
  const pos = mu.filter((_, i) => y[i]), neg = mu.filter((_, i) => !y[i]); let wins = 0;
  for (const a of pos) for (const b of neg) wins += a > b ? 1 : a === b ? 0.5 : 0;
  const coef = beta.map((b, j) => { const se = Math.sqrt(Math.max(0, inv[j][j])); const z = se ? b / se : 0; return { name: names[j], b, se, or: Math.exp(b), lo: Math.exp(b - 1.96 * se), hi: Math.exp(b + 1.96 * se), p: 2 * (1 - normCdf(Math.abs(z))) }; });
  return { coef, n, iterations: it + 1, deviance, auc: pos.length && neg.length ? wins / (pos.length * neg.length) : null, base: y.reduce((a, b) => a + b, 0) / n };
}

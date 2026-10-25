export const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
export function covariance(a, b = a) {
  const ma = mean(a), mb = mean(b);
  return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1);
}
export function quantileSorted(a, p) {
  if (!a.length || p < 0 || p > 1) throw Error('Invalid quantile');
  const pos = (a.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
export function interval(a, absolute = false) {
  const sorted = Float64Array.from(a).sort();
  const raw = [quantileSorted(sorted, .025), quantileSorted(sorted, .975)];
  return { raw, display: absolute ? raw.map(x => Math.max(0, Math.min(1, x))) : raw };
}
// Wilson 95% interval and plug-in MCSE for a Monte Carlo event frequency.
export function monteCarlo(successes, n) {
  if (!Number.isInteger(n) || n < 1 || successes < 0 || successes > n) throw Error('Invalid Monte Carlo count');
  const p = successes / n, z = 1.959963984540054, z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return { successes, n, estimate: p, mcse: Math.sqrt(p * (1 - p) / n), wilson95: [center - half, center + half] };
}
export function boundarySupplement(successes, n) {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(successes) || successes < 0 || successes > n) throw Error('Invalid boundary denominator');
  if (successes === 0) return [0, -Math.expm1(Math.log(.025) / n)];
  if (successes === n) return [Math.exp(Math.log(.025) / n), 1];
  return null;
}
export function zeroHardViolationUpper(independentFamilies) {
  if (!Number.isInteger(independentFamilies) || independentFamilies < 1) throw Error('Require independent family opportunities');
  return -Math.expm1(Math.log(.05) / independentFamilies);
}
// Exact one-sided Clopper-Pearson upper bound, via binomial CDF inversion.
function binomialCDF(k, n, p) {
  if (p === 1) return k === n ? 1 : 0;
  const logs = []; let logChoose = 0;
  for (let i = 0; i <= k; i++) {
    if (i) logChoose += Math.log(n - i + 1) - Math.log(i);
    logs.push(logChoose + i * Math.log(p) + (n - i) * Math.log1p(-p));
  }
  const max = Math.max(...logs);
  return Math.exp(max) * logs.reduce((s, x) => s + Math.exp(x - max), 0);
}
export function errorRates(errors, independentN) {
  if (!Number.isInteger(errors) || !Number.isInteger(independentN) || errors < 0 || errors > independentN) throw Error('Invalid calibration denominator');
  if (!independentN) return { empirical: 1, upper: 1, doubledUpper: 1, unsupported: true };
  let lo = errors / independentN, hi = 1;
  if (errors === independentN) lo = 1;
  for (let i = 0; i < 64 && lo < hi; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCDF(errors, independentN, mid) > .05) lo = mid; else hi = mid;
  }
  return { empirical: errors / independentN, upper: hi, doubledUpper: Math.min(1, 2 * hi), unsupported: false };
}
export function integerBudget(eligibleKeys, rate) {
  if (!Number.isInteger(eligibleKeys) || eligibleKeys < 0 || !Number.isFinite(rate) || rate < 0) throw Error('Invalid error budget');
  return Math.min(eligibleKeys, Math.ceil(eligibleKeys * Math.min(1, rate)));
}

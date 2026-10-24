import { qualification } from './mechanical.mjs';
import { stable } from './adapters.mjs';
const and = values => values.includes(false) ? false : values.includes(null) ? null : true;
const bool = n => n === null ? null : Boolean(n);
const fraction = (n, d) => d ? n / d : null;
function metric(rows, truth, prediction) {
  let fp = 0, fn = 0, positive = 0, negative = 0, pending = 0;
  for (const r of rows) { const t = truth(r), p = prediction(r); t ? positive++ : negative++; if (p === null) pending++; else if (p && !t) fp++; else if (!p && t) fn++; }
  return { rows: rows.length, worlds: new Set(rows.map(r => r.world)).size, positive, negative, falseAccepts: fp, falseRejects: fn, pending,
    falseAcceptRate: fraction(fp, negative), falseRejectRate: fraction(fn, positive) };
}
// Descriptive Wilson 95% intervals; cluster reuse is explicitly not counted as
// extra independence. For agreement, keys (not applications) are the units.
function interval(k, n) {
  if (!n) return null;
  const z = 1.959963984540054, p = k / n, den = 1 + z * z / n, center = (p + z * z / (2 * n)) / den, radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
function agreement(pairs) {
  const a = {}, b = {}; let same = 0;
  for (const [x, y] of pairs) { const sx = stable(x), sy = stable(y); a[sx] = (a[sx] ?? 0) + 1; b[sy] = (b[sy] ?? 0) + 1; if (sx === sy) same++; }
  const n = pairs.length, observed = fraction(same, n), expected = n ? Object.keys(a).reduce((s, k) => s + a[k] * (b[k] ?? 0), 0) / n ** 2 : null;
  return { count: n, same, exactAgreement: observed, kappa: expected === null || expected === 1 ? null : (observed - expected) / (1 - expected), wilson95: interval(same, n) };
}
const threshold = (metric, fa, fr) => metric.pending ? 'pending' : metric.falseAccepts <= fa && metric.falseRejects <= fr ? 'pass' : 'fail';
export function calibrationGate(index, judgments) {
  if (index.version !== 'hr3-integration-v1' || !Array.isArray(index.bundles) || !Array.isArray(index.observations)) throw new Error('Invalid private index');
  const refs = new Map(index.bundles.map(b => [b.key, b]));
  const byKey = new Map(), sessions = new Set();
  for (const j of judgments) {
    const bundle = refs.get(j.key);
    if (!bundle || bundle.pass !== j.pass || j.payloadHash !== bundle.payloadHash) throw new Error('Unknown/stale pass payload');
    if (![1, 2, 3].includes(j.judge)) throw new Error('Judge must be 1, 2, or independent third 3');
    const m = j.execution;
    if (!m || m.requestedModel !== 'gpt-6.1-sol' || m.observedModel !== 'gpt-6.1-sol' || m.effort !== 'xhigh' ||
      m.command !== 'codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" --ignore-user-config --disable hooks' ||
      typeof m.session !== 'string' || !m.session || sessions.has(m.session) || m.nonAuthor !== true || m.isolated !== true || m.noPriorJudgments !== true) throw new Error('Invalid/non-independent execution provenance');
    sessions.add(m.session);
    const wanted = j.pass === 'support' ? ['R'] : ['C', 'O', 'R'];
    if (!j.verdict || stable(Object.keys(j.verdict).sort()) !== stable(wanted.slice().sort()) || Object.values(j.verdict).some(v => v !== true && v !== false && v !== null)) throw new Error('Invalid component vector');
    if (!Array.isArray(j.findings) || !Array.isArray(j.citations) || typeof j.rationale !== 'string' || !j.rationale.trim()) throw new Error('Structured findings/citations/rationale required');
    const records = byKey.get(j.key) ?? new Map();
    if (records.has(j.judge)) throw new Error('Duplicate judge/key'); records.set(j.judge, j); byKey.set(j.key, records);
  }
  const resolution = new Map(), unresolvedKeys = [], thirdReviews = [];
  for (const [key] of refs) {
    const js = byKey.get(key), a = js?.get(1), b = js?.get(2), c = js?.get(3);
    if (!a || !b) { unresolvedKeys.push(key); continue; }
    let vector;
    if (stable(a.verdict) === stable(b.verdict) && Object.values(a.verdict).every(v => v !== null)) {
      if (c) throw new Error('Unnecessary third judgment'); vector = a.verdict;
    } else { thirdReviews.push(key); vector = c?.verdict; }
    if (!vector || Object.values(vector).some(v => v === null)) unresolvedKeys.push(key);
    else resolution.set(key, vector);
  }
  const rows = index.observations.map(r => {
    const resolved = { C: bool(r.scores.C), O: bool(r.scores.O), R: bool(r.scores.R) };
    let causal = bool(r.causal.correctness), support = bool(r.causal.support);
    for (const ref of r.referrals) {
      const v = resolution.get(ref.key);
      if (!v) continue;
      if (ref.pass === 'support') support = v.R;
      else for (const c of ref.components) { if (c === 'R') causal = v.R; else resolved[c] = v[c]; }
    }
    resolved.R = and([causal, support]); resolved.J = and([resolved.C, resolved.O, resolved.R]);
    return { ...r, resolved, resolvedCausal: causal, resolvedSupport: support };
  });
  const pooled = rows.filter(r => r.set === 'pooled'), referrals = rows.filter(r => r.set === 'referral_candidates'), evidence = rows.filter(r => r.set === 'evidence_contrasts'), representation = rows.filter(r => r.set === 'representation_pairs');
  const q = qualification(rows), selected = new Set(Object.values(q.strata).flatMap(s => s.selected));
  const whole = rs => metric(rs, r => r.truth.equivalent, r => r.resolved.J);
  const component = (rs, c) => metric(rs, r => r.truth.components[c], r => r.resolved[c]);
  const pooledMetric = whole(pooled), pooledComponents = Object.fromEntries(['C', 'O', 'R'].map(c => [c, component(pooled, c)]));
  const genuineStrata = {};
  for (const c of ['C', 'O', 'R']) for (const l of ['en', 'zh-Hant', 'mixed']) for (const s of [null, 'terse', 'conversational', 'formal', 'operational']) {
    const rs = referrals.filter(r => selected.has(r.id) && r.designated.includes(c) && r.language === l && (!s || r.style === s) &&
      q.strata[`${c}/${l}/${r.style}/${r.truth.components[c] ? 'positive' : 'negative'}`].selected.includes(r.id));
    genuineStrata[`${c}/${l}/${s ?? 'all'}`] = component(rs, c);
  }
  const evidenceFinal = component(evidence, 'R'), evidenceSupport = metric(evidence, r => r.truth.causal_supported, r => r.resolvedSupport);
  const styles = Object.fromEntries(['terse', 'conversational', 'formal', 'operational'].map(s => [s, whole(representation.filter(r => r.style === s))]));
  const styleRates = Object.values(styles).map(m => fraction(m.falseAccepts + m.falseRejects, m.rows));
  const styleSpread = styleRates.every(v => v !== null) ? Math.max(...styleRates) - Math.min(...styleRates) : null;
  const agreements = {};
  for (const [name, setRows] of [['pooled', pooled], ['referral', referrals]]) {
    const keys = [...new Set(setRows.flatMap(r => r.referrals.map(f => f.key)))];
    const pairs = keys.filter(k => byKey.get(k)?.has(1) && byKey.get(k)?.has(2)).map(k => [byKey.get(k).get(1).verdict, byKey.get(k).get(2).verdict]);
    const worldGroups = new Map();
    for (const r of setRows) { const refsForRow = r.referrals; if (!refsForRow.length) continue;
      const w = worldGroups.get(r.world) ?? [];
      w.push(...refsForRow.map(f => f.key)); worldGroups.set(r.world, w);
    }
    const worldPairs = [];
    for (const keys of worldGroups.values()) { const ks = [...new Set(keys)].sort(); if (ks.every(k => byKey.get(k)?.has(1) && byKey.get(k)?.has(2))) worldPairs.push([ks.map(k => byKey.get(k).get(1).verdict), ks.map(k => byKey.get(k).get(2).verdict)]); }
    const vectorPairs = new Map(); let missingVectors = 0;
    for (const r of setRows.filter(r => r.referrals.length)) {
      if (!r.referrals.every(f => byKey.get(f.key)?.has(1) && byKey.get(f.key)?.has(2))) { missingVectors++; continue; }
      const vectors = [1, 2].map(judge => {
        const v = { C: bool(r.scores.C), O: bool(r.scores.O) };
        let causal = bool(r.causal.correctness), support = bool(r.causal.support);
        for (const ref of r.referrals) {
          const verdict = byKey.get(ref.key).get(judge).verdict;
          if (ref.pass === 'support') support = verdict.R;
          else for (const c of ref.components) { if (c === 'R') causal = verdict.R; else v[c] = verdict[c]; }
        }
        v.R = and([causal, support]); return v;
      });
      // Identical contextual pass-key combinations count once, while the
      // independent-world summary above discloses reuse across variants.
      const key = stable([r.referrals.map(f => f.key).sort(), r.scores, r.causal.correctness, r.causal.support]);
      vectorPairs.set(key, vectors);
    }
    agreements[name] = { expectedKeys: keys.length, keys: agreement(pairs), worlds: agreement(worldPairs), expectedWorlds: worldGroups.size,
      componentVectors: agreement([...vectorPairs.values()]), missingVectors };
  }
  const mechanicalFA = pooled.filter(r => !r.truth.equivalent && r.scores.J === 1).length, mechanicalFR = pooled.filter(r => r.truth.equivalent && r.scores.J === 0).length;
  const gates = {
    inputCompleteness: rows.length === 1984 && rows.every(r => r.valid) && pooled.length === 400 && referrals.length === 960 && evidence.length === 240 && representation.length === 384 ? 'pass' : 'fail',
    pooledMechanics: mechanicalFA === 0 && mechanicalFR <= 2 ? 'pass' : 'fail',
    genuineReferralQuotas: q.allQuotasMet ? 'pass' : 'fail',
    pooledPipeline: threshold(pooledMetric, 4, 10),
    pooledComponents: Object.values(pooledComponents).some(m => threshold(m, 1, 16) === 'fail') ? 'fail' : Object.values(pooledComponents).some(m => m.pending) ? 'pending' : 'pass',
    genuineReferrals: !q.allQuotasMet ? 'fail' : Object.entries(genuineStrata).some(([k, m]) => threshold(m, 1, k.endsWith('/all') ? 4 : 2) === 'fail') ? 'fail' : Object.values(genuineStrata).some(m => m.pending) ? 'pending' : 'pass',
    evidenceFinalR: threshold(evidenceFinal, 0, 2), evidenceSupportPanel: threshold(evidenceSupport, 0, 2),
    matchedStyles: Object.values(styles).some(m => m.pending) || styleSpread === null ? 'pending' : styleSpread <= 0.05 + 1e-12 ? 'pass' : 'fail',
    firstTwoAgreement: Object.values(agreements).some(a => a.keys.count < a.expectedKeys || a.missingVectors) ? 'pending' : Object.values(agreements).every(a => a.componentVectors.exactAgreement !== null && a.componentVectors.exactAgreement >= 0.95) ? 'pass' : 'fail',
    completion: unresolvedKeys.length || rows.some(r => Object.values(r.resolved).includes(null)) ? 'pending' : 'pass',
  };
  const passMetrics = {};
  for (const pass of ['correctness', 'support']) for (const c of pass === 'support' ? ['R'] : ['C', 'O', 'R']) {
    const rs = rows.filter(r => r.referrals.some(f => f.pass === pass));
    const truth = r => c === 'R' ? (pass === 'support' ? r.truth.causal_supported : r.truth.causal_correct) : r.truth.components[c];
    const prediction = r => { const ref = r.referrals.find(f => f.pass === pass); return resolution.get(ref.key)?.[c] ?? null; };
    const unique = new Map();
    for (const r of rs) {
      const key = r.referrals.find(f => f.pass === pass).key;
      if (unique.has(key) && truth(unique.get(key)) !== truth(r)) throw new Error('Conflicting truth labels for shared contextual key');
      unique.set(key, r);
    }
    const keys = metric([...unique.values()], truth, prediction);
    passMetrics[`${pass}/${c}`] = { applications: metric(rs, truth, prediction), independentKeys: { ...keys,
      falseAcceptWilson95: interval(keys.falseAccepts, keys.negative), falseRejectWilson95: interval(keys.falseRejects, keys.positive) } };
  }
  // Independent-world summary: a world is an error if any variant is wrong.
  function worldErrors(rs) {
    const groups = new Map(); for (const r of rs) { const g = groups.get(r.world) ?? []; g.push(r); groups.set(r.world, g); }
    const vals = [...groups.values()]; const bad = vals.filter(g => g.some(r => r.resolved.J !== null && r.resolved.J !== r.truth.equivalent)).length;
    return { worlds: vals.length, worldsWithAnyError: bad, pendingWorlds: vals.filter(g => g.some(r => r.resolved.J === null)).length, wilson95AnyError: interval(bad, vals.length) };
  }
  const breakdown = {};
  for (const r of representation) { const k = `${r.language}/${r.style}/${r.representation?.distortion_class}`; (breakdown[k] ??= []).push(r); }
  return { version: index.version, status: Object.values(gates).includes('fail') ? 'fail' : Object.values(gates).includes('pending') ? 'pending' : 'pass', gates,
    pooled: pooledMetric, pooledComponents, genuineStrata, qualification: q, evidence: { finalR: evidenceFinal, supportPanel: evidenceSupport },
    matchedStyles: { styles, errorSpread: styleSpread, classLanguageStyle: Object.fromEntries(Object.entries(breakdown).map(([k, rs]) => [k, whole(rs)])) }, agreements, passMetrics,
    independentWorlds: Object.fromEntries(['pooled', 'referral_candidates', 'evidence_contrasts', 'representation_pairs'].map(s => [s, worldErrors(rows.filter(r => r.set === s))])),
    thirdReviews, unresolvedKeys, judgmentRecords: judgments.length, resolvedKeys: resolution.size, propagatedMappings: 0,
    note: 'No generalized equivalence propagation. Wilson intervals use independent world/key summaries; variant error rates are descriptive. Gate covers §8 observed thresholds only; external resource and non-author audits remain separate.' };
}

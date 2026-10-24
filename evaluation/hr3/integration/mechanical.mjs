import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { adaptGenerator, adaptChallenge, restore, goldWitness, stable, hash } from './adapters.mjs';
import { score, validateGold } from '../scorer/scorer.mjs';
import { readJSONL, regenerate } from './reproduce.mjs';
import { fieldMapping } from './field-map.mjs';
const components = ['C', 'O', 'R', 'J'];
const count = (rows, key) => rows.reduce((a, r) => { const k = key(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
export function confusion(rows) {
  const cells = {};
  for (const r of rows) for (const component of components) {
    const truth = component === 'J' ? r.truth.equivalent : r.truth.components[component];
    const decision = r.scores[component] === null ? 'referred' : r.scores[component] === 1 ? 'mechanical_accept' : 'mechanical_reject';
    const key = `${r.set}/${component}/${r.language}/${r.style}/${truth ? 'positive' : 'negative'}`;
    cells[key] ??= { mechanical_accept: 0, mechanical_reject: 0, referred: 0 }; cells[key][decision]++;
  }
  return cells;
}
export function qualification(rows) {
  const strata = {};
  for (const c of ['C', 'O', 'R']) for (const l of ['en', 'zh-Hant', 'mixed']) for (const s of ['terse', 'conversational', 'formal', 'operational']) for (const sign of [true, false]) {
    const candidates = rows.filter(r => r.set === 'referral_candidates' && r.designated.includes(c) && r.language === l && r.style === s && r.truth.components[c] === sign);
    // Actual pass referrals, even if another component forces J=0. Keep frozen
    // input order and first 20; never use adjudication feedback for selection.
    const qualified = candidates.filter(r => r.referrals.some(f => f.components.includes(c)));
    strata[`${c}/${l}/${s}/${sign ? 'positive' : 'negative'}`] = { finalPending: candidates.filter(r => r.scores[c] === null).length, candidates: candidates.length, observed: qualified.length, required: 20, selected: qualified.slice(0, 20).map(r => r.id), met: qualified.length >= 20 };
  }
  return { definition: 'A designated component occurs in an actual scorer referral (correctness or support); final component/J may already be forced zero.', allQuotasMet: Object.values(strata).every(s => s.met), strataMet: Object.values(strata).filter(s => s.met).length, totalStrata: Object.keys(strata).length, observedDesignatedBundles: rows.filter(r => r.set === 'referral_candidates' && r.designated.some(c => r.referrals.some(f => f.components.includes(c)))).length, strata };
}
function leafPaths(v, path = '$', out = []) {
  if (v && typeof v === 'object' && Object.keys(v).length) for (const [k, x] of Object.entries(v)) leafPaths(x, `${path}/${k}`, out);
  else out.push(path);
  return out;
}
export async function mechanical(out) {
  await mkdir(out, { recursive: false });
  const data = await regenerate();
  const [families, goldRows, supportRows] = await Promise.all(['families', 'gold', 'support'].map(n => readJSONL(join(data.pilot, `${n}.jsonl`))));
  const failures = [], pilot = [], ledger = {}, audits = [], bundles = new Map(), observations = [];
  function audit(a, id) {
    if (!isDeepStrictEqual(restore(a), a.audit.source)) throw new Error(`Audit round trip failed ${id}`);
    for (const p of leafPaths(a.audit.source)) {
      const pattern = p.replace(/\/\d+(?=\/|$)/g, '/*');
      const k = `${a.audit.kind}:${pattern}`; ledger[k] = (ledger[k] ?? 0) + 1;
    }
    audits.push({ id, ...a.audit, scorerGoldHash: hash(a.gold), submissionHash: a.submission ? hash(a.submission) : null });
  }
  for (const family of families) {
    const gs = goldRows.filter(x => x.family_id === family.family_id), ss = supportRows.filter(x => x.family_id === family.family_id);
    if (gs.length !== 1 || ss.length !== 1) throw new Error('Non-unique pilot join');
    for (const cp of family.checkpoints) {
      const id = `${family.family_id}/${cp.batch}`;
      try {
        const a = adaptGenerator(family, gs[0], ss[0], cp.batch); audit(a, id); validateGold(a.gold);
        const result = score(a.gold, goldWitness(a.gold));
        const ok = components.every(c => result.scores[c] === 1);
        pilot.push({ id, schemaValid: true, scores: result.scores, ok });
        if (!ok) failures.push({ id, stage: 'self-score', result });
      } catch (e) { failures.push({ id, stage: 'adapter-or-validator', error: e.message }); pilot.push({ id, schemaValid: false, ok: false }); }
    }
  }
  const worlds = new Map((await readJSONL(join(data.challenge, 'worlds.jsonl'))).map(w => [w.id, w]));
  for (const file of ['pooled.jsonl', 'referral-candidates.jsonl', 'evidence-contrasts.jsonl', 'representation-pairs.jsonl']) for (const row of await readJSONL(join(data.challenge, file))) {
    try {
      const a = adaptChallenge(row, worlds.get(row.world_id)); audit(a, row.id);
      const result = score(a.gold, a.submission);
      for (const f of result.referrals) {
        const { key, components: requested, ...payload } = f;
        const existing = bundles.get(key);
        if (existing && stable(existing) !== stable(payload)) throw new Error('Referral key collision');
        bundles.set(key, payload);
      }
      observations.push({ id: row.id, set: row.set, world: row.world_id, language: row.language, style: row.style, designated: row.referral?.designated_components ?? [],
        truth: row.true_label, evidenceVariant: row.evidence_variant, representation: row.representation, scores: result.scores,
        causal: result.reason, valid: result.valid, errors: result.errors ?? [], referrals: result.referrals.map(({ key, pass, components }) => ({ key, pass, components })) });
    } catch (e) { failures.push({ id: row.id, stage: 'challenge-adapter-or-scorer', error: e.message }); }
  }
  const referred = observations.filter(r => r.referrals.length), q = qualification(observations);
  const pooled = observations.filter(r => r.set === 'pooled');
  const pooledFA = pooled.filter(r => !r.truth.equivalent && r.scores.J === 1).map(r => r.id);
  const pooledFR = pooled.filter(r => r.truth.equivalent && r.scores.J === 0).map(r => r.id);
  const summary = { version: 'hr3-integration-v1', adjudicationRun: false, verification: data.verification,
    pilot: { families: families.length, checkpoints: pilot.length, schemaValid: pilot.filter(r => r.schemaValid).length, fullCredit: pilot.filter(r => r.ok).length, failures: failures.filter(f => f.stage !== 'challenge-adapter-or-scorer') },
    challenge: { expected: 1984, scored: observations.length, valid: observations.filter(r => r.valid).length, worlds: new Set(observations.map(r => r.world)).size, failures: failures.filter(f => f.stage === 'challenge-adapter-or-scorer') },
    confusion: confusion(observations),
    population: { observations: referred.length, worlds: new Set(referred.map(r => r.world)).size, uniquePassKeys: bundles.size, passApplications: referred.reduce((n, r) => n + r.referrals.length, 0),
      bySet: count(referred, r => r.set), byLanguage: count(referred, r => r.language), byStyle: count(referred, r => r.style), bySetLanguageStyle: count(referred, r => `${r.set}/${r.language}/${r.style}`),
      byPass: count(referred.flatMap(r => r.referrals), r => r.pass), forcedJZero: referred.filter(r => r.scores.J === 0).length,
      modelDependentComponents: Object.fromEntries(components.map(c => [c, observations.filter(r => r.scores[c] === null).length])) },
    qualification: q, pooledMechanics: { falseAccepts: pooledFA.length, falseRejects: pooledFR.length, falseAcceptIDs: pooledFA, falseRejectIDs: pooledFR, referred: pooled.filter(r => r.scores.J === null).length, pass: observations.length === 1984 && pooledFA.length === 0 && pooledFR.length <= 2 },
    reconciliation: { adaptedCheckpoints: audits.length, sourceLeafPatterns: Object.keys(ledger).length, sourceLeavesAudited: Object.values(ledger).reduce((a, b) => a + b, 0), losslessSidecarRoundTrips: audits.length,
      defectCounts: count(audits.flatMap(a => a.defects.map(d => ({ kind: a.kind, code: d.code }))), d => `${d.kind}/${d.code}`) }, failures };
  const json = (name, v) => writeFile(join(out, name), JSON.stringify(v, null, 2) + '\n');
  const jsonl = (name, rows) => writeFile(join(out, name), rows.map(stable).join('\n') + (rows.length ? '\n' : ''));
  await json('summary.json', summary); await json('field-counts.json', Object.fromEntries(Object.entries(ledger).map(([key, count]) => { const colon = key.indexOf(':'); return [key, { count, ...fieldMapping(key.slice(0, colon), key.slice(colon + 1)) }]; })));  await json('pilot.json', pilot);
  await jsonl('observations.jsonl', observations); await jsonl('audit-private.jsonl', audits);
  await jsonl('failures.jsonl', failures);
  await mkdir(join(out, 'judge-input'));
  for (const [key, bundle] of bundles) await writeFile(join(out, 'judge-input', `${key}.json`), stable(bundle) + '\n');
  await json('private-index.json', { version: summary.version, pipeline: hash(data.verification), bundles: [...bundles].map(([key, payload]) => ({ key, pass: payload.pass, payloadHash: hash(payload) })), observations });
  return summary;
}

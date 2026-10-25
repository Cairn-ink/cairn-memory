import { ALLOCATIONS, TYPES, CONTRASTS } from './design.mjs';
import { validateData } from './bootstrap.mjs';

const components = ['C', 'O', 'R'];
const conjunction = a => a.includes(0) ? 0 : a.includes(null) ? null : 1;
// Input observation envelope is separate from the scorer: identity/allocation
// must come from the frozen manifest, never from a score or pilot inference.
// resolutions maps scorer pass keys to FINAL 0/1 verdicts, not repaired answers.
export function adaptScore(observation, resolutions = {}) {
  const { score, attempted, family, lineage, type, arm, checkpoint } = observation;
  if (attempted !== true) throw Error('Unexecuted observations cannot be zero-filled');
  if (!family || !lineage || !TYPES.includes(type) || !['T', 'U', 'O', 'P'].includes(arm) || ![2, 4].includes(checkpoint)) throw Error('Invalid observation identity');
  if (score?.version !== 'hr3-scorer-a4-v2' || score.keyVersion !== 'hr3-a4-slot-explanation-keys-v2') throw Error('Requires A-4 scorer version and key version');
  if (typeof score.valid !== 'boolean' || !Array.isArray(score.referrals) || !score.scores) throw Error('Malformed scorer result');
  for (const c of [...components, 'J']) if (![0, 1, null].includes(score.scores[c])) throw Error('Invalid C/O/R/J');
  if (score.scores.J !== conjunction(components.map(c => score.scores[c]))) throw Error('J must be family conjunction');
  const scores = { ...score.scores }, dependencies = [];
  for (const r of score.referrals) {
    if (!r.key || !r.parentRule || !['correctness', 'support'].includes(r.pass) || r.components?.length !== 1 || !components.includes(r.components[0])) throw Error('Invalid A-4 dependency key');
    dependencies.push({ key: r.key, parentRule: r.parentRule, component: r.components[0], pass: r.pass });
  }
  for (const c of components) if (scores[c] === null) {
    const bindings = dependencies.filter(d => d.component === c);
    if (!bindings.length || bindings.some(d => ![0, 1].includes(resolutions[d.key]))) throw Error(`Unresolved ${c} adjudication, including forced-J-zero referrals`);
    // R correctness/support are conjunctive; a mechanically known pass is 1
    // whenever R is pending and that pass has no referral.
    scores[c] = bindings.every(d => resolutions[d.key] === 1) ? 1 : 0;
  }
  // Even referrals whose result is already forced zero must be resolved.
  if (dependencies.some(d => ![0, 1].includes(resolutions[d.key]))) throw Error('Unresolved adjudication');
  scores.J = scores.C * scores.O * scores.R;
  const passes = { C: { correctness: scores.C }, O: { correctness: scores.O },
    R: { correctness: score.reason?.correctness ?? 1, support: score.reason?.support === 'not_applicable' ? 1 : score.reason?.support ?? scores.R } };
  for (const d of dependencies) passes[d.component][d.pass] = resolutions[d.key];
  return { family, lineage, type, arm, checkpoint, attempted: true, valid: score.valid, scores,
    passes, dependencies, mechanicallyForcedJZero: score.mechanicallyForcedJZero ?? score.scores.J === 0,
    reasonStratum: structuredClone(score.reasonStratum), provenance: { version: score.version, keyVersion: score.keyVersion, contract: score.contract, dictionary: score.dictionary } };
}
// Applications are frozen externally for propagated mappings as well as direct
// referrals: {family,arm,checkpoint,key,component,pass}. No row-number identity.
export function propagateJudgments(records, verdicts, applications = records.flatMap(r => r.dependencies.map(d => ({ ...d, family: r.family, arm: r.arm, checkpoint: r.checkpoint })))) {
  const result = structuredClone(records), index = new Map(result.map(r => [JSON.stringify([r.family, r.arm, r.checkpoint]), r]));
  const boundPasses = new Set();
  for (const a of applications) {
    const r = index.get(JSON.stringify([a.family, a.arm, a.checkpoint])), value = verdicts.get(a.key);
    if (!r || ![0, 1].includes(value) || !components.includes(a.component) || !['correctness', 'support'].includes(a.pass) || (a.pass === 'support' && a.component !== 'R')) throw Error('Invalid shared-key application');
    const identity = JSON.stringify([a.family, a.arm, a.checkpoint, a.component, a.pass]);
    if (boundPasses.has(identity)) throw Error('Multiple keys for one component/pass');
    boundPasses.add(identity);
    r.passes[a.component][a.pass] = value;
  }
  for (const r of result) {
    for (const c of components) r.scores[c] = Object.values(r.passes[c]).every(v => v === 1) ? 1 : 0;
    r.scores.J = r.scores.C * r.scores.O * r.scores.R;
  }
  return result;
}
export function scoreVectors(records, { split, planned, estimands = CONTRASTS, checkpoint = 4 }) {
  const a = ALLOCATIONS[split];
  if (!a || planned.length !== a.lineages) throw Error('Missing frozen planned allocation');
  for (const type of TYPES) {
    const group = planned.filter(l => l.type === type);
    if (group.length !== a.perType || group.filter(l => l.multihop).length !== a.multiPerType) throw Error('Frozen type/multihop allocation mismatch');
  }
  const familyIDs = planned.flatMap(l => l.families ?? []);
  if (familyIDs.length !== a.lineages * a.m || new Set(familyIDs).size !== familyIDs.length || new Set(planned.map(l => l.id)).size !== planned.length) throw Error('Missing/duplicate planned family/lineage');
  const selected = records.filter(r => r.checkpoint === checkpoint), joined = new Map();
  const plannedByFamily = new Map(planned.flatMap(l => l.families.map(f => [f, l])));
  for (const r of selected) {
    const l = plannedByFamily.get(r.family), key = JSON.stringify([r.family, r.arm]);
    if (!l || r.lineage !== l.id || r.type !== l.type || joined.has(key)) throw Error('Unknown/misjoined/duplicate observation');
    if (r.attempted !== true || components.some(c => ![0, 1].includes(r.scores[c])) || r.scores.J !== r.scores.C * r.scores.O * r.scores.R) throw Error('Unfinalized score vector');
    joined.set(key, r);
  }
  const eligible = (l, e) => (!e.type || e.type === l.type) && (!e.multihop || l.multihop);
  const denominators = estimands.map(e => planned.filter(l => eligible(l, e)).length);
  const data = { names: estimands.map(e => e.name), lineages: planned.map(l => {
    if (l.families.length !== a.m) throw Error('Frozen lineage multiplicity mismatch');
    return { id: l.id, type: l.type, weights: estimands.map((e, j) => eligible(l, e) ? 1 / denominators[j] : 0),
      values: l.families.map(f => estimands.map(e => {
        if (!eligible(l, e)) return 0;
        const get = arm => { const r = joined.get(JSON.stringify([f, arm])); if (!r) throw Error('Missing attempted arm/checkpoint'); return r.scores[e.component]; };
        return get(e.arm) - (e.minus ? get(e.minus) : 0);
      })) };
  }) };
  return validateData(data);
}
export const absoluteEstimands = (arm = 'P', type) => [...components, 'J'].map(component => ({ name: `${component}(${arm})${type ? '/' + type : ''}`, component, arm, type }));

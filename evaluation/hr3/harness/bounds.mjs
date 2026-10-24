import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractionDiagnostics } from './extraction-diagnostics.mjs';
import { canonical, hash, fail } from './common.mjs';

export const LABEL = 'Uncalibrated engineering pilot — mechanical score bounds; no adjudication.';
const ARMS = ['U', 'T', 'O', 'P'];
const TYPES = ['correction', 'reversal', 'refinement', 'scope_change', 'expiry'];
const COMPONENTS = ['C', 'O', 'R', 'J'];
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const unique = values => [...new Set(values)].sort();
const sum = values => values.reduce((a, b) => a + b, 0);
const check = (condition, message) => { if (!condition) fail('bound_report:' + message); };

export function componentBound(score) {
  check(score === 0 || score === 1 || score === null, 'invalid_component_state');
  return score === null ? [0, 1] : [score, score];
}
export function scoreBounds(scores) {
  const result = Object.fromEntries(['C', 'O', 'R'].map(c => [c, componentBound(scores[c])]));
  result.J = [0, 1].map(endpoint => result.C[endpoint] * result.O[endpoint] * result.R[endpoint]);
  if (Object.hasOwn(scores, 'J')) check(canonical(componentBound(scores.J)) === canonical(result.J), 'inconsistent_joint_score');
  return result;
}

// Capture these at execution time. A later report must not relabel historical
// observations with hashes of whatever happens to be installed when it runs.
export function frozenArtifacts(inputs) {
  const artifacts = {};
  const add = (name, path) => { const bytes = readFileSync(path); artifacts[name] = { sha256: hash(bytes), bytes: bytes.length }; };
  add('generator/freeze.json', new URL('../generator/freeze.json', import.meta.url));
  add('generator/pilot/manifest.json', join(inputs, 'manifest.json'));
  for (const name of ['protocol-v0.3.4.md', 'errata.md']) add('protocol/' + name, new URL('../protocol/' + name, import.meta.url));
  for (const dir of ['scorer', 'harness']) {
    const root = new URL('../' + dir + '/', import.meta.url);
    for (const name of readdirSync(root).filter(n => /\.(mjs|json)$/.test(n)).sort()) add(dir + '/' + name, new URL(name, root));
  }
  return artifacts;
}

function referralCounts(rows) {
  const passes = {};
  for (const pass of ['correctness', 'support']) {
    const applications = rows.flatMap(r => r.referrals.filter(f => f.pass === pass));
    const keys = unique(applications.map(f => f.key));
    passes[pass] = { applications: applications.length, uniqueKeys: keys.length,
      propagatedApplications: applications.length - keys.length,
      componentApplications: Object.fromEntries(['C', 'O', 'R'].map(c => [c, applications.filter(f => f.components.includes(c)).length])) };
  }
  return { observations: rows.filter(r => r.referrals.length).length, ...passes };
}

export function buildBoundReport({ families, observations, metadata }) {
  check(families.length === 60 && new Set(families.map(f => f.family_id)).size === 60, 'requires_fixed_60_family_pilot');
  const familyMap = new Map(families.map(f => [f.family_id, f]));
  const lineages = unique(families.map(f => f.lineage_id));
  check(lineages.length === 30 && TYPES.every(t => families.filter(f => f.change_type === t).length === 12), 'frozen_allocation');
  for (const l of lineages) {
    const members = families.filter(f => f.lineage_id === l);
    check(members.length === 2 && new Set(members.map(f => f.change_type)).size === 1, 'frozen_lineage_allocation');
  }
  check(TYPES.every(t => unique(families.filter(f => f.change_type === t).map(f => f.lineage_id)).length === 6), 'frozen_type_lineages');
  const seen = new Set(), keys = new Map();
  const perFamily = observations.map(o => {
    const f = familyMap.get(o.family), id = `${o.family}/${o.arm}/${o.batch}`;
    check(f && ARMS.includes(o.arm) && [2, 4].includes(o.batch) && f.checkpoints.some(c => c.batch === o.batch), 'unknown_observation');
    check(!seen.has(id), 'duplicate_observation'); seen.add(id);
    check(typeof o.valid === 'boolean' && Array.isArray(o.referrals), 'invalid_observation');
    const bounds = scoreBounds(o.scores);
    if (!o.valid) check(COMPONENTS.every(c => o.scores[c] === 0), 'failed_attempt_must_remain_scored_zero');
    for (const r of o.referrals) {
      check(['correctness', 'support'].includes(r.pass) && typeof r.key === 'string' && r.key.length > 0 && Array.isArray(r.components) && r.components.length > 0 && r.components.every(c => ['C', 'O', 'R'].includes(c)), 'invalid_referral');
      check(r.pass !== 'support' || canonical(r.components) === '["R"]', 'invalid_support_referral');
      const signature = canonical({pass:r.pass, components:r.components});
      check(!keys.has(r.key) || keys.get(r.key) === signature, 'referral_key_collision'); keys.set(r.key, signature);
    }
    return { family:o.family, lineage:f.lineage_id, changeType:f.change_type, arm:o.arm,
      checkpoint:o.batch === 2 ? 'intermediate' : 'final', batch:o.batch, validCompletion:o.valid,
      bounds, referrals:o.referrals.map(({key, pass, components}) => ({key, pass, components})) };
  }).sort((a, b) => `${a.family}/${a.arm}/${a.batch}`.localeCompare(`${b.family}/${b.arm}/${b.batch}`, 'en'));
  const tables = [];
  for (const arm of ARMS) for (const batch of [2, 4]) for (const type of ['overall', ...TYPES]) {
    const planned = families.filter(f => type === 'overall' || f.change_type === type);
    const rows = perFamily.filter(r => r.arm === arm && r.batch === batch && (type === 'overall' || r.changeType === type));
    const represented = unique(rows.map(r => r.lineage));
    const lineageWeight = type === 'overall' ? 1 / 30 : 1 / 6;
    const representedWeight = represented.length * lineageWeight;
    const weights = represented.map(lineage => {
      const attempted = rows.filter(r => r.lineage === lineage).length;
      return { lineage, plannedFamilies:2, attemptedFamilies:attempted, frozenLineageWeight:lineageWeight,
        appliedFamilyWeight:lineageWeight / attempted / representedWeight };
    });
    // All frozen pilot lineage weights are equal within each reported group.
    // Average lineage means directly to avoid accumulated roundoff at 0/1.
    const aggregate = value => represented.length ? sum(represented.map(lineage => {
      const members = rows.filter(r => r.lineage === lineage);
      return sum(members.map(value)) / members.length;
    })) / represented.length : null;
    const rates = Object.fromEntries(COMPONENTS.map(c => {
      const counts = { determinedCorrect:0, determinedIncorrect:0, unresolved:0 };
      for (const r of rows) counts[r.bounds[c][0] === 1 ? 'determinedCorrect' : r.bounds[c][1] === 0 ? 'determinedIncorrect' : 'unresolved']++;
      const bound = rows.length ? [0, 1].map(e => aggregate(r => r.bounds[c][e])) : null;
      return [c, { bound, counts, denominator:rows.length }];
    }));
    const share = selected => ({ numerator:selected.length, denominator:rows.length, share:rows.length ? selected.length / rows.length : null,
      weightedShare:rows.length ? aggregate(r => selected.includes(r) ? 1 : 0) : null });
    const missing = planned.filter(f => !seen.has(`${f.family_id}/${arm}/${batch}`)).map(f => f.family_id).sort();
    tables.push({ arm, productQualification:arm === 'P' ? 'P: the pinned product under the frozen public-operation agent and shared research extraction' : null,
      checkpoint:batch === 2 ? 'intermediate' : 'final', batch, changeType:type,
      cohortLabel:metadata?.stageStatus?.complete === true && rows.length === planned.length ? 'completed-pilot cohort' : 'partial observed cohort; not completed-pilot bounds',
      denominators:{planned:planned.length, attempted:rows.length, validCompletion:rows.filter(r => r.validCompletion).length,
        failedAttempt:rows.filter(r => !r.validCompletion).length, unexecuted:missing.length},
      familiesRepresented:unique(rows.map(r => r.family)), lineagesRepresented:represented, unexecutedFamilies:missing,
      weights:{ frozenLineageWeight:lineageWeight, plannedWeight:1, representedWeight,
        interpretation:represented.length === planned.length / 2 ? 'frozen-weight lineage means of attempted families' : 'conditional on represented lineages; frozen weights normalized by representedWeight; incomplete design',
        applied:weights }, rates, outstandingReferrals:referralCounts(rows),
      jointUnresolved:share(rows.filter(r => r.bounds.J[0] !== r.bounds.J[1])),
      anyReferredComponent:share(rows.filter(r => r.referrals.length)) });
  }
  return { version:'hr3-a1-bounds-v2', label:LABEL, stage:'pilot', adjudication:false,
    stageStatus:metadata?.stageStatus ?? {complete:false,stopReason:null},
    continuationApproval:false,
    interpretation:'Conservative score bounds conditional on frozen mechanical decisions; not certified factual-accuracy bounds, not confidence intervals; endpoints need not be jointly attainable.',
    samplingConfidenceIntervals:'deferred under A-1', use:'Descriptive engineering pilot only; cannot produce an Advance/Keep decision or enter development/test estimates.',
    aggregation:'J endpoints are products within each family/arm/checkpoint, then frozen-weight lineage means. Aggregate component rates are never multiplied. Failed attempts stay scored; unexecuted cases are listed and excluded from observed denominators.',
    referralCounting:'Outstanding pass applications are counted independently of score uncertainty. propagatedApplications = applications - uniqueKeys within the reported group; unique keys are deduplicated again globally, never summed across tables.',
    pipelineStageDiagnostics:metadata?.pipelineStageDiagnostics??{stage:'extraction',armIndependent:true,available:false,table:[],totals:null},
    metadata, denominators:{planned:480, attempted:perFamily.length, validCompletion:perFamily.filter(r => r.validCompletion).length,
      failedAttempt:perFamily.filter(r => !r.validCompletion).length, unexecuted:480-perFamily.length,
      plannedFamilies:60, plannedLineages:30, representedFamilies:unique(perFamily.map(r => r.family)).length, representedLineages:unique(perFamily.map(r => r.lineage)).length},
    outstandingReferrals:referralCounts(perFamily), tables, perFamily };
}

export function writeBoundReport({ stageDirectory, inputs, out }) {
  const run = readJSON(join(stageDirectory, 'run.json')), summary = readJSON(join(stageDirectory, 'summary.json'));
  check(run.stage === 'pilot' && summary.stage === 'pilot' && typeof summary.complete === 'boolean', 'pilot_stage_required');
  check(run.frozenArtifacts && run.frozenArtifacts['protocol/errata.md'], 'execution_time_hashes_required');
  // Verify stopped/incomplete or completed artifacts before deriving anything, including the scores.
  const manifestBytes = readFileSync(join(stageDirectory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  for (const [name, entry] of Object.entries(manifest.files)) {
    check(!name.startsWith('/') && !name.split('/').includes('..'), 'invalid_artifact_path');
    const bytes = readFileSync(join(stageDirectory, name));
    check(bytes.length === entry.bytes && hash(bytes) === entry.sha256, 'stage_artifact_hash_mismatch:' + name);
  }
  for (const name of ['run.json', 'summary.json', 'scored.jsonl', 'ledger.jsonl']) check(Object.hasOwn(manifest.files, name), 'missing_stage_artifact:' + name);
  check(hash(readFileSync(join(inputs, 'manifest.json'))) === run.frozenArtifacts['generator/pilot/manifest.json'].sha256, 'input_manifest_mismatch');
  const inputManifest = readJSON(join(inputs, 'manifest.json'));
  for (const [name, entry] of Object.entries(inputManifest.hashes)) {
    check(!name.startsWith('/') && !name.split('/').includes('..'), 'invalid_input_path');
    const bytes = readFileSync(join(inputs, name));check(bytes.length === entry.bytes && hash(bytes) === entry.sha256, 'input_hash_mismatch:' + name);
  }
  check(inputManifest.split === 'pilot' && inputManifest.seed === 'hr3-worlds-v1', 'input_split_or_seed');
  const jsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const families = jsonl(join(inputs, 'families.jsonl')), observations = jsonl(join(stageDirectory, 'scored.jsonl'));
  check(canonical(run.families) === canonical(families.map(f => f.family_id)), 'stage_family_plan');
  check(summary.attempted === observations.length, 'summary_denominator_mismatch');
  check(typeof run.offline === 'boolean' && Number.isSafeInteger(summary.ledger.total) && summary.ledger.total >= 0, 'spend_metadata');
  check(observations.every(o => o.version === 'hr3-scorer-v1' && o.protocol === 'v0.3.4'), 'scorer_version');
  const billing = verifiedBilling(jsonl(join(stageDirectory, 'ledger.jsonl')));
  check(billing.total === summary.ledger.total && canonical(billing.unsettled) === canonical(summary.ledger.unsettled) && billing.stopped === summary.ledger.stopped, 'ledger_summary_mismatch');
  const failure = Object.hasOwn(manifest.files,'failure.json') ? readJSON(join(stageDirectory,'failure.json')) : null;
  const stageStatus = {complete:summary.complete, stopReason:billing.stopped ?? failure?.reason ?? null,
    observedCohort:summary.complete && observations.length === 480 ? 'completed-pilot cohort' : 'partial observed cohort; not completed-pilot bounds'};
  const metadata = { protocol:'v0.3.4', errata:run.protocol?.includes('A-3')?'revised E-1; E-2/A-1/A-2/A-3 (2026-10-25)':'revised E-1 and A-1 (2026-10-25); E-2', scorer:'hr3-scorer-v1',
    offline:run.offline, stageStatus,
    actualSpendUSD:run.offline ? 0 : billing.unsettled.length ? null : billing.settled / 1e9,
    actualSpendKnown:run.offline || billing.unsettled.length === 0,
    settledSpendUSD:run.offline ? 0 : billing.settled / 1e9,
    settledLedgerChargeUSD:billing.settled / 1e9,
    outstandingReservations:{count:billing.unsettled.length, ids:billing.unsettled, reservedUSD:billing.outstanding / 1e9},
    ledgerChargeUSD:billing.total / 1e9,
    ledgerChargeInterpretation:run.offline ? 'simulated fake usage/reservations; actual spend is zero' : 'settled charges plus outstanding reservation ceilings; unknown final billing is not actual spend',
    frozenArtifacts:run.frozenArtifacts, completedStageManifestSHA256:hash(manifestBytes),
    reportModuleSHA256:hash(readFileSync(new URL('./bounds.mjs', import.meta.url))) };
  if(run.protocol?.includes('A-3'))check(Object.hasOwn(manifest.files,'extraction-summary.json'),'missing_extraction_diagnostics');
  const extractionRows=Object.hasOwn(manifest.files,'extraction-summary.json')?readJSON(join(stageDirectory,'extraction-summary.json')):null;
  if(extractionRows){
    metadata.pipelineStageDiagnostics=extractionDiagnostics(extractionRows);
    if(run.protocol?.includes('A-3')){
      check(metadata.pipelineStageDiagnostics.available,'missing_extraction_diagnostics');
      check(canonical(metadata.pipelineStageDiagnostics)===canonical(summary.pipelineStageDiagnostics),'extraction_diagnostics_mismatch');
    }
  }
  const report = buildBoundReport({families, observations, metadata});
  writeFileSync(out, canonical(report) + '\n', {flag:'wx', mode:0o600});
  return report;
}


export function verifiedBilling(events) {
  check(events.length > 0 && events[0].type === 'configuration', 'ledger_configuration_required');
  let prior = '', stopped = null, settled = 0;
  const reservations = new Map(), settlements = new Set();
  for (const event of events) {
    const {digest,...data} = event;
    check(data.prior === prior && hash(data) === digest, 'ledger_hash_chain'); prior = digest;
    if (event.type === 'reserve') {
      check(!reservations.has(event.id) && Number.isSafeInteger(event.reserved) && event.reserved >= 0, 'ledger_reservation');
      reservations.set(event.id,event.reserved);
    } else if (event.type === 'settle') {
      check(reservations.has(event.id) && !settlements.has(event.id) && Number.isSafeInteger(event.charged) && event.charged >= 0 && event.charged <= reservations.get(event.id), 'ledger_settlement');
      settlements.add(event.id); settled += event.charged;
    } else if (event.type === 'stop') stopped = event.reason;
    else check(['configuration','failure'].includes(event.type), 'ledger_event_type');
  }
  const unsettled = [...reservations.keys()].filter(id => !settlements.has(id));
  const outstanding = sum(unsettled.map(id => reservations.get(id)));
  check(Number.isSafeInteger(settled + outstanding), 'ledger_total_overflow');
  return {settled, outstanding, total:settled + outstanding, unsettled, stopped};
}

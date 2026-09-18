// Offline merge of completed public pilot run directories into one paired report.
// No session, no ledger, no key, no network: every input is a private artifact
// written by runPublicPilot and is re-read with the runner's own file checks.
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { aggregateOfficialScores } from '../longmemeval/official-scoring.mjs';
import { deepFreeze, isPlainObject, validString } from '../longmemeval/validation.mjs';
import {
  canonical,
  caseBlockedReason,
  fail,
  openPrivateDirectory,
  PUBLIC_PILOT_INTERPRETATION,
  PUBLIC_PILOT_LIMITATIONS,
  PUBLIC_PILOT_SCHEMA_VERSION,
  readPrivateJson,
  resolveDirectory,
  sealPrivateDirectory,
  sumStageTotals,
  writePrivateJson,
} from './public-pilot.mjs';

const RUN_FILES = ['manifest', 'checkpoint', 'aggregate', 'report'];
const CASE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const COST_FIELDS = ['reservedMicroUsd', 'knownActualMicroUsd', 'unknownCostRequests', 'requests'];
const LATENCY_FIELDS = ['generationMs', 'scoringMs', 'totalMs'];

// Totals are integer counts and micro-USD; a non-integer field is a tampered
// artifact, never a zero to sum silently.
const numeric = (value) => (Number.isSafeInteger(value) ? value : fail('invalid_artifact'));

async function loadRun(directory) {
  let entry;
  try { entry = await lstat(directory); } catch { return fail('run_incomplete'); }
  let resolved;
  try { resolved = await realpath(directory); } catch { return fail('unsafe_source'); }
  if (!entry.isDirectory() || entry.isSymbolicLink() || resolved !== directory) fail('unsafe_source');
  const files = {};
  for (const name of RUN_FILES) {
    const value = await readPrivateJson(path.join(directory, `${name}.json`), 'invalid_artifact');
    if (value === null) fail('run_incomplete');
    files[name] = value;
  }
  const { manifest, checkpoint, aggregate, report } = files;
  if (!isPlainObject(manifest) || manifest.schemaVersion !== PUBLIC_PILOT_SCHEMA_VERSION
    || !isPlainObject(manifest.pilot) || !validString(manifest.pilot.manifestSha256)
    || !isPlainObject(checkpoint) || checkpoint.schemaVersion !== PUBLIC_PILOT_SCHEMA_VERSION
    || !isPlainObject(aggregate) || aggregate.schemaVersion !== PUBLIC_PILOT_SCHEMA_VERSION
    || !isPlainObject(report) || report.schemaVersion !== PUBLIC_PILOT_SCHEMA_VERSION
    || report.kind === 'merged' || !validString(report.generatedAt)
    || !Array.isArray(report.caseIds) || !Array.isArray(report.cases)
    || report.cases.length !== report.caseIds.length
    || !isPlainObject(report.summary) || !isPlainObject(report.cost) || !isPlainObject(report.cost.byStage)
    || !isPlainObject(report.latency) || !isPlainObject(report.truncation)
    || !isPlainObject(report.models) || !isPlainObject(report.pilot)) fail('invalid_artifact');
  for (const [index, item] of report.cases.entries()) {
    if (!isPlainObject(item) || item.questionId !== report.caseIds[index] || !CASE_ID.test(item.questionId)
      || !validString(item.sourceQuestionId) || !validString(item.questionType)
      || !isPlainObject(item.generation) || !isPlainObject(item.scoring)) fail('invalid_artifact');
  }
  return { directory, manifest, checkpoint, aggregate, report };
}

export async function mergePublicPilotRuns(options) {
  if (!isPlainObject(options) || Object.keys(options).length !== 2
    || !Object.hasOwn(options, 'directories') || !Object.hasOwn(options, 'output')) fail('invalid_options');
  const { directories } = options;
  if (!Array.isArray(directories) || directories.length < 1
    || directories.some((item) => !validString(item))) fail('invalid_options');
  const sources = directories.map((item) => resolveDirectory(item, 'unsafe_source'));
  if (new Set(sources).size !== sources.length) fail('merge_overlap');
  const output = resolveDirectory(options.output, 'unsafe_output');
  if (sources.includes(output)) fail('unsafe_output');

  const runs = [];
  for (const directory of sources) runs.push(await loadRun(directory));
  const [first] = runs;
  for (const run of runs.slice(1)) {
    if (run.manifest.pilot.manifestSha256 !== first.manifest.pilot.manifestSha256
      || canonical(run.manifest.stages) !== canonical(first.manifest.stages)
      || canonical(run.report.models) !== canonical(first.report.models)
      || canonical(run.manifest.limits) !== canonical(first.manifest.limits)
      || run.manifest.judgeTimeoutMs !== first.manifest.judgeTimeoutMs
      || run.manifest.receiptExcerptBoundUtf16 !== first.manifest.receiptExcerptBoundUtf16) fail('merge_mismatch');
  }
  const caseIds = new Set();
  for (const run of runs) {
    for (const id of run.report.caseIds) {
      if (caseIds.has(id)) fail('merge_overlap');
      caseIds.add(id);
    }
  }

  const roster = [];
  const records = [];
  const cases = [];
  for (const run of runs) {
    for (const item of run.report.cases) {
      roster.push({ questionId: item.questionId, sourceQuestionId: item.sourceQuestionId,
        questionType: item.questionType });
      if (item.scoring.status === 'completed') {
        const scoring = await readPrivateJson(path.join(run.directory, 'cases', item.questionId, 'scoring.json'),
          'invalid_artifact');
        if (!isPlainObject(scoring) || !isPlainObject(scoring.score)) fail('run_incomplete');
        records.push(scoring.score);
      }
      cases.push(item);
    }
  }
  const official = aggregateOfficialScores({ roster, records });

  const cost = { byStage: {}, reservedMicroUsd: 0, knownActualMicroUsd: 0, unknownCostRequests: 0, requests: 0,
    ledger: null };
  const latency = { generationMs: 0, scoringMs: 0, totalMs: 0 };
  const truncation = {};
  let callbackFailures = 0;
  for (const run of runs) {
    sumStageTotals(cost.byStage, run.report.cost.byStage);
    for (const key of COST_FIELDS) cost[key] += numeric(run.report.cost[key]);
    for (const key of LATENCY_FIELDS) latency[key] += numeric(run.report.latency[key]);
    for (const [key, value] of Object.entries(run.report.truncation)) truncation[key] = (truncation[key] ?? 0) + numeric(value);
    callbackFailures += numeric(run.report.summary.progressCallbackFailures);
  }
  const summary = {
    fixedN: cases.length,
    generated: cases.filter((item) => item.generation.status === 'completed').length,
    generationFailed: cases.filter((item) => item.generation.status === 'failed').length,
    generationBlocked: cases.filter((item) => item.generation.status === 'blocked').length,
    scored: cases.filter((item) => item.scoring.status === 'completed').length,
    blockedReasons: Object.fromEntries(cases.map(caseBlockedReason).filter(Boolean)
      .reduce((map, reason) => map.set(reason, (map.get(reason) ?? 0) + 1), new Map())),
    halted: runs.some((run) => run.report.summary.halted === true),
    progressCallbackFailures: callbackFailures,
  };

  await openPrivateDirectory(output, 'unsafe_output');
  let entries;
  try { entries = await readdir(output); } catch { return fail('unsafe_output'); }
  if (entries.length !== 0) fail('output_not_empty');
  await sealPrivateDirectory(output, 'unsafe_output');
  const merged = {
    schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, kind: 'merged', generatedAt: new Date().toISOString(),
    interpretation: PUBLIC_PILOT_INTERPRETATION, operator: null, pilot: first.report.pilot, caseIds: [...caseIds],
    models: first.report.models, limits: first.manifest.limits, judgeTimeoutMs: first.manifest.judgeTimeoutMs,
    caps: null, receiptExcerptBoundUtf16: first.manifest.receiptExcerptBoundUtf16,
    limitations: PUBLIC_PILOT_LIMITATIONS, summary, official, cost, latency, truncation, cases,
    sources: runs.map((run) => ({ directory: path.basename(run.directory), generatedAt: run.report.generatedAt,
      caseIds: run.report.caseIds, caps: run.report.caps ?? null, operator: run.report.operator ?? null,
      halted: run.report.summary.halted === true })),
  };
  await writePrivateJson(path.join(output, 'report.json'), merged);
  return deepFreeze(JSON.parse(JSON.stringify(merged)));
}

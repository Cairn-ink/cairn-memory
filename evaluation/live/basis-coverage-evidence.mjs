import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { getBasisCoveragePins, BASIS_COVERAGE_LIMITS } from './basis-coverage-pilot.mjs';

const FIXTURE = 'f930f4e6f15cc0c6c6ab8935aeb069a91c862d56fa372b7f6383c5f43ac654fa';
const RUBRIC = '6ecdd2fdb881d22e6293f3ce2335f09f9843da7fcfd662e7f5808df9e7184fca';
const ID = 'basis-coverage-pilot-v1';
const CASES = ['battery-stylus-zh', 'different-actors', 'considering-career-zh', 'unadopted-advice',
  'stale-report-zh', 'explicit-replacement', 'temporary-scope-zh', 'explicit-confirmation'];
const HALT_CODES = new Set(['unexpected_accounting', 'attempt_limit', 'request_rejected',
  'transport_failed', 'read_only_request', 'operator_halted', 'guard_pin_or_persistence_failed']);
const fixtureBytes = readFileSync(new URL('./basis-coverage-fixture.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('invalid_basis_coverage_evidence'); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key))
  .map(key => [key, value[key]]));
const safeText = (value, maximum = 200) => {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > maximum
    || /(?:\/tmp\/|\/home\/|\/Users\/|\/workspace\/|[A-Za-z]:\\|Bearer\s|\[REDACTED)/iu.test(value)
    || redactSecrets(value) !== value) fail();
  return value;
};
const scalar = (value, kind) => {
  if (kind === 'index' && integer(value)) return value;
  if (kind === 'text' && typeof value === 'string') return safeText(value);
  return { invalidType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value };
};
const shape = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const boundedFields = (value, fields) => {
  if (!record(value)) return { invalidShape: shape(value) };
  const projected = Object.fromEntries(fields.filter(([key]) => Object.hasOwn(value, key))
    .map(([key, kind]) => [key, scalar(value[key], kind)]));
  if (Object.keys(value).some(key => !fields.some(([known]) => known === key))) projected.unexpectedFields = true;
  return projected;
};

function proposal(stage) {
  const generated = stage.requests.filter(request => request.route === '/responses');
  if (!generated.length) return { state: 'not_generated' };
  if (generated.length !== 1) fail();
  const request = generated[0];
  if (request.outputStatus === 'malformed') return { state: 'malformed_json' };
  if (request.outputStatus === 'not_generation' || request.outputStatus === undefined) return { state: 'unavailable' };
  if (request.outputStatus !== 'parsed') fail();
  const output = request.output;
  if (!record(output)) return { state: 'parsed_invalid_shape', shape: shape(output) };
  if (!Array.isArray(output.units) || !Array.isArray(output.links)) return {
    state: 'parsed_invalid_shape', unitsShape: shape(output.units), linksShape: shape(output.links) };
  if (output.units.length > 8 || output.links.length > 10) fail();
  const units = output.units.map(value => boundedFields(value,
    [['memory', 'index'], ['receipt', 'index'], ['quote', 'text'], ['role', 'text']]));
  const links = output.links.map(value => boundedFields(value,
    [['from', 'index'], ['to', 'index'], ['relation', 'text']]));
  return { state: 'parsed', units, links,
    ...(Object.keys(output).some(key => !['units', 'links'].includes(key)) ? { unexpectedFields: true } : {}) };
}

function compiled(value, caseIndex, stageName) {
  if (value === null) return null;
  if (!record(value) || !Array.isArray(value.units) || !Array.isArray(value.links)
    || value.units.length > 8 || value.links.length > 10) fail();
  const units = value.units.map((unit, index) => {
    const source = stageName === 'local-0' ? 0 : stageName === 'local-1' ? 1
      : unit.memoryId === 'synthetic-0' ? 0 : unit.memoryId === 'synthetic-1' ? 1 : -1;
    if (source < 0 || unit.memoryId !== `synthetic-${source}` || unit.receiptId !== `synthetic-receipt-${source}`
      || unit.revision !== 1 || unit.index !== index
      || !['decision', 'premise', 'update'].includes(unit.role)
      || unit.interpretationStatus !== 'model-proposed'
      || !record(unit.anchor) || !integer(unit.anchor.start) || !integer(unit.anchor.end)
      || unit.anchor.end <= unit.anchor.start) fail();
    const excerpt = fixture.cases[caseIndex].memories[source].excerpt;
    const text = safeText(unit.anchor.text);
    if (excerpt.slice(unit.anchor.start, unit.anchor.end) !== text) fail();
    return { index, source, requestMemory: stageName === 'global' ? source : 0,
      receipt: 0, role: unit.role, anchor: { start: unit.anchor.start, end: unit.anchor.end, text },
      interpretationStatus: unit.interpretationStatus };
  });
  const links = value.links.map(link => {
    if (!integer(link.from) || !integer(link.to) || link.from >= units.length || link.to >= units.length
      || !['supports-decision', 'challenges-current-basis'].includes(link.relation)
      || link.interpretationStatus !== 'model-proposed') fail();
    return pick(link, ['from', 'to', 'relation', 'interpretationStatus']);
  });
  return { units, links };
}

function wire(value) {
  if (value === undefined) return null;
  const fields = ['countRequests', 'generationRequests', 'pricedGenerations', 'inputTokens', 'outputTokens',
    'estimatedGenerationMicroUsd', 'countRequestCost'];
  if (!exact(value, fields) || !fields.slice(0, 6).every(key => typeof value[key] === 'number'
    && Number.isFinite(value[key]) && value[key] >= 0)
    || !['unknown_without_usage', 'none'].includes(value.countRequestCost)) fail();
  return pick(value, fields);
}
function wireFromRequests(requests) {
  const generation = requests.filter(item => item.route === '/responses');
  const count = requests.filter(item => item.route === '/responses/input_tokens');
  if (count.length + generation.length !== requests.length) fail();
  const usages = generation.map(item => {
    try { return JSON.parse(item.responseText).usage; } catch { return null; }
  }).filter(value => integer(value?.input_tokens) && integer(value?.output_tokens));
  const inputTokens = usages.reduce((sum, value) => sum + value.input_tokens, 0);
  const outputTokens = usages.reduce((sum, value) => sum + value.output_tokens, 0);
  return { countRequests: count.length, generationRequests: generation.length,
    pricedGenerations: usages.length, inputTokens, outputTokens,
    estimatedGenerationMicroUsd: inputTokens * 0.25 + outputTokens * 1.2,
    countRequestCost: count.length ? 'unknown_without_usage' : 'none' };
}
function budget(value) {
  if (value === null) return null;
  const fields = ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd', 'unknownCostRequests',
    'unsettled', 'limitMicroUsd', 'requestCap', 'state'];
  if (!exact(value, fields) || !fields.slice(0, 7).every(key => integer(value[key]))
    || !['open', 'closed'].includes(value.state)) fail();
  return pick(value, fields);
}
function stageView(stage, caseIndex, arm, position) {
  const name = arm === 'coverage' ? ['local-0', 'local-1', 'global'][position] : 'global';
  if (!record(stage) || stage.name !== name || !['not_run', 'running', 'failed', 'raw_invalid',
    'compiled_empty', 'compiled'].includes(stage.status) || !Array.isArray(stage.requests)
    || stage.requests.length > 2 || !(stage.durationMs === null || integer(stage.durationMs))) fail();
  if (stage.requests.some(request => !record(request) || !integer(request.sequence))) fail();
  const raw = proposal(stage), result = compiled(stage.compiled, caseIndex, name);
  const compiledStatus = ['compiled', 'compiled_empty'].includes(stage.status);
  if ((stage.status === 'not_run' && (stage.requests.length || stage.durationMs !== null || result !== null))
    || (compiledStatus && (result === null || raw.state !== 'parsed' || stage.requests.length !== 2
      || stage.requests[0].route !== '/responses/input_tokens' || stage.requests[1].route !== '/responses'))
    || (stage.status === 'compiled_empty' && (result.units.length || result.links.length))
    || (stage.status === 'raw_invalid' && result !== null)) fail();
  const error = stage.error === null ? null : safeText(stage.error, 80);
  const derivedWire = wireFromRequests(stage.requests);
  return { name, status: stage.status, durationMs: stage.durationMs, error,
    requestSourceIndices: name === 'global' ? [0, 1] : [name === 'local-0' ? 0 : 1],
    requestCount: stage.requests.length, wire: derivedWire, proposal: raw, compiled: result };
}

/** Closed synthetic projection; no I/O beyond the public frozen fixture/pin read, no scoring or writes. */
export function exportBasisCoverageEvidence(report, { sourceHead, rawReportSha256 } = {}) {
  if (!record(report) || report.id !== ID || report.version !== 1 || report.offline !== false
    || report.ingestion !== fixture.ingestion || report.semanticReviewRequired !== true
    || report.model !== 'gpt-5.6-luna' || report.reasoning !== 'none'
    || report.comparison !== 'workflow-cost-quality; not equal-compute or held-out'
    || !['completed', 'completed_with_failures', 'halted'].includes(report.status)
    || !equal(report.limits, BASIS_COVERAGE_LIMITS) || !Array.isArray(report.slots) || report.slots.length !== 16
    || sha(fixtureBytes) !== FIXTURE || report.pins?.['evaluation/live/basis-coverage-fixture.json'] !== FIXTURE
    || report.pins?.['evaluation/live/basis-coverage-rubric.json'] !== RUBRIC
    || !equal(report.pins, getBasisCoveragePins())
    || typeof sourceHead !== 'string' || !/^[a-f0-9]{40}$/u.test(sourceHead)
    || typeof rawReportSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(rawReportSha256)) fail();
  const slots = report.slots.map((slot, index) => {
    const caseIndex = Math.floor(index / 2), arm = caseIndex % 2
      ? index % 2 ? 'baseline' : 'coverage' : index % 2 ? 'coverage' : 'baseline';
    if (!record(slot) || slot.caseId !== CASES[caseIndex] || slot.arm !== arm
      || !['not_run', 'failed', 'completed'].includes(slot.status)
      || !(slot.durationMs === null || integer(slot.durationMs))
      || !Array.isArray(slot.stages) || slot.stages.length !== (arm === 'coverage' ? 3 : 1)) fail();
    const derivedStages = slot.stages.map((value, position) => stageView(value, caseIndex, arm, position));
    const stages = derivedStages.map(value => value.status);
    if ((slot.status === 'completed' && stages.some(value => !['compiled', 'compiled_empty'].includes(value)))
      || (slot.status === 'not_run' && (slot.durationMs !== null || stages.some(value => value !== 'not_run')))
      || (slot.status === 'failed' && !stages.some(value => ['failed', 'raw_invalid'].includes(value)))) fail();
    const derivedWire = wireFromRequests(slot.stages.flatMap(value => value.requests));
    if (slot.wire !== undefined && !equal(wire(slot.wire), derivedWire)) fail();
    return { caseId: slot.caseId, arm, status: slot.status, durationMs: slot.durationMs,
      wire: derivedWire, stages: derivedStages };
  });
  const derivedWire = wireFromRequests(report.slots.flatMap(slot => slot.stages.flatMap(value => value.requests)));
  if (!equal(wire(report.wire), derivedWire)) fail();
  if (report.attempt !== null && (!record(report.attempt) || !integer(report.attempt.requests)
    || !integer(report.attempt.reservedMicroUsd)
    || !(report.attempt.halted === null || HALT_CODES.has(report.attempt.halted)))) fail();
  const result = { version: 1, id: ID, status: report.status, sourceHead, rawReportSha256,
    semanticReview: 'required-not-inferred', comparison: report.comparison,
    model: report.model, reasoning: report.reasoning, fixtureSha256: FIXTURE, rubricSha256: RUBRIC,
    sourcePins: report.pins, limits: BASIS_COVERAGE_LIMITS,
    budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter),
    attempt: report.attempt === null ? null : { requests: report.attempt.requests,
      reservedMicroUsd: report.attempt.reservedMicroUsd, halted: report.attempt.halted !== null },
    wire: derivedWire, slots };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s|\[REDACTED/iu.test(encoded)) fail();
  return JSON.parse(encoded);
}

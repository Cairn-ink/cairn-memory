// Synthetic fault seams only. This child must never accept an operator ledger.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readdirSync } from 'node:fs';

const [mode, configText, attemptId] = process.argv.slice(2);
assert.ok(['rename-open', 'foreign-post-work', 'fail-before-commit',
  'fail-after-commit', 'callback-sql-mutation', 'old-guards-v2'].includes(mode));
const config = JSON.parse(configText);
assert.match(config.directory, /^\/tmp\/cairn-bound-embedding-/u);
if (mode === 'old-guards-v2') {
  // No model work is exercised. The stub makes budget CI independent of the
  // optional adapter install while proving actual guard factory schema fences.
  registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'tiktoken') return { url: 'data:text/javascript,'
      + 'export function get_encoding(){return {encode(){throw Error("tokenizer used")}}}',
    shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  const ledgerApi = await import('../index.mjs');
  const guards = await import('../request-guard.mjs');
  const { experimentPolicy } = await import('../../live/session.mjs');
  const { benchmarkStagePolicy } = await import('../../live/public-pilot.mjs');
  const root = path.dirname(config.directory);
  const policy = experimentPolicy();
  const stages = benchmarkStagePolicy();
  let physical = 0;
  const fetchImpl = () => { physical += 1; throw Error('forbidden synthetic transport'); };
  const migrate = (ledger) => {
    const prior = ledgerApi.inspectExperimentBudgetForEmbeddingUpgrade(ledger);
    ledgerApi.upgradeExperimentBudgetForEmbeddings({ ...ledger,
      expectedCheckpoint: { requestCount: prior.requestCount,
        reservedMicroUsd: prior.reservedMicroUsd }, expectedHistorySha256: prior.historySha256 });
  };
  const normal = { directory: path.join(root, 'old-guard-normal'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 40 };
  ledgerApi.createExperimentBudget(normal).close();
  guards.createExperimentRequestGuard({ ledger: normal, policy, fetchImpl }).close();
  const benchmark = guards.authorizeBenchmarkExtension({ ledger: normal, policy,
    authorizationId: 'synthetic-benchmark', stages });
  const schedule = [{ phase: 'generation', caseId: 'case-a' },
    { phase: 'scoring', caseId: 'case-a' }];
  const caseCapability = guards.authorizeCaseDeadlineCapability({ ledger: normal, policy,
    benchmarkExtension: benchmark, authorizationId: 'synthetic-case', executionId: 'case-exec',
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, schedule });
  migrate(normal);
  const generic = { ledger: normal, policy, fetchImpl };
  const calls = [
    ['baseline', () => guards.createExperimentRequestGuard(generic)],
    ['extended', () => guards.createExtendedExperimentRequestGuard({ ...generic, extension: {} })],
    ['reconciliation', () => guards.createReconciliationExperimentRequestGuard({ ...generic,
      extension: {}, reconciliationExtension: {} })],
    ['qualification', () => guards.createQualificationExperimentRequestGuard({ ...generic,
      qualificationExtension: {} })],
    ['candidate', () => guards.createCandidateQualificationExperimentRequestGuard({ ...generic,
      candidateQualificationExtension: {} })],
    ['checklist', () => guards.createChecklistSelectionExperimentRequestGuard({ ...generic,
      checklistSelectionExtension: {} })],
    ['rationale', () => guards.createRationaleExperimentRequestGuard({ ...generic,
      rationaleExtension: {} })],
    ['rationale-models', () => guards.createRationaleModelsExperimentRequestGuard({ ...generic,
      rationaleModelsExtension: {} })],
    ['basis-models', () => guards.createBasisModelsExperimentRequestGuard({ ...generic,
      basisModelsExtension: {} })],
    ['benchmark', () => guards.createBenchmarkExperimentRequestGuard({ ...generic,
      benchmarkExtension: benchmark })],
    ['case-deadline', () => guards.createCaseDeadlineExperimentRequestGuard({ ...generic,
      benchmarkExtension: benchmark, caseDeadlineCapability: caseCapability })],
  ];
  const pairBase = { directory: path.join(root, 'old-guard-pair'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  ledgerApi.createExperimentBudget(pairBase).close();
  guards.createExperimentRequestGuard({ ledger: pairBase, policy, fetchImpl }).close();
  const pairBenchmark = guards.authorizeBenchmarkExtension({ ledger: pairBase, policy,
    authorizationId: 'pair-benchmark', stages });
  const allowance = guards.authorizeBenchmarkRequestAllowance({ oldLedger: pairBase, policy,
    benchmarkExtension: pairBenchmark, authorizationId: 'pair-allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const expandedRequests = { ...pairBase, requestCap: 20 };
  const pairParent = guards.authorizeBenchmarkBudgetExtension({ oldLedger: expandedRequests,
    policy, requestAllowance: allowance, authorizationId: 'pair-parent',
    newLimitMicroUsd: 100_000_000, newRequestCap: 40,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const pairLedger = { ...expandedRequests, limitMicroUsd: 100_000_000, requestCap: 40 };
  const questionId = `lme-case-${'a'.repeat(64)}`;
  const armOrder = ['qualified-prefix', 'indexed-windows'];
  const digest = value => createHash('sha256').update(value).digest('hex');
  const roster = [{ questionId, protocolDigest: 'b'.repeat(64), armOrder,
    arms: armOrder.map(name => ({ name,
      scopeId: `lme-case-${digest(JSON.stringify(['cairn.lme.source-pair.scope.v1',
        [questionId, name]]))}` })) }];
  const oldOptions = { ledger: pairLedger, policy, benchmarkExtension: pairParent,
    authorizationId: 'pair-old', executionId: 'pair-old-exec',
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, roster };
  const oldPair = guards.authorizeQualifiedSourcePairCapability(oldOptions);
  const adaptiveContext = { qualificationInputProfile: 'adaptive-text-catalog-v1',
    runtimeArtifactSha256: 'c'.repeat(64), adapterConfigurationSha256: 'd'.repeat(64),
    experimentDigest: guards.deriveAdaptiveQualifiedSourcePairExperimentDigest({
      qualificationInputProfile: 'adaptive-text-catalog-v1', runtimeArtifactSha256: 'c'.repeat(64),
      adapterConfigurationSha256: 'd'.repeat(64), roster }) };
  const adaptiveOptions = { ...oldOptions, authorizationId: 'pair-adaptive',
    executionId: 'pair-adaptive-exec', adaptiveContext };
  const adaptivePair = guards.authorizeAdaptiveQualifiedSourcePairCapability(adaptiveOptions);
  migrate(pairLedger);
  calls.push(['qualified-pair', () => guards.createQualifiedSourcePairExperimentRequestGuard({
    ledger: pairLedger, policy, benchmarkExtension: pairParent,
    qualifiedSourcePairCapability: oldPair, fetchImpl })]);
  calls.push(['adaptive-pair', () => guards.createAdaptiveQualifiedSourcePairExperimentRequestGuard({
    ledger: pairLedger, policy, benchmarkExtension: pairParent,
    adaptiveQualifiedSourcePairCapability: adaptivePair, fetchImpl })]);
  const observed = {};
  for (const [name, run] of calls) {
    try { const guard = run(); guard.close(); observed[name] = 'unexpected-success'; }
    catch (error) { observed[name] = error.code ?? 'unexpected'; }
  }
  const claimsAbsent = [normal.directory, pairLedger.directory]
    .every(directory => readdirSync(directory).every(name => !name.endsWith('.claim.json')));
  process.stdout.write(`${JSON.stringify({ observed, claimsAbsent, physical,
    normalCount: ledgerApi.inspectEmbeddingExperimentBudgetSnapshot(normal).requestCount,
    pairCount: ledgerApi.inspectEmbeddingExperimentBudgetSnapshot(pairLedger).requestCount })}\n`);
  process.exit(0);
}
const replacements = {
  'rename-open': [
    "export function openBoundEmbeddingExperimentBudget(options) {\n  const data = ownData(options, ['configuration', 'authorize']);\n  const config = detachedEmbeddingConfiguration(data.configuration);\n  const authorize = data.authorize;\n  if (typeof authorize !== 'function') fail('invalid_options');\n  const identity = inspectTransitionLocation(config);\n  const db = constructExistingWritableDatabase(config.filename);",
    "export function openBoundEmbeddingExperimentBudget(options) {\n  const data = ownData(options, ['configuration', 'authorize']);\n  const config = detachedEmbeddingConfiguration(data.configuration);\n  const authorize = data.authorize;\n  if (typeof authorize !== 'function') fail('invalid_options');\n  const identity = inspectTransitionLocation(config);\n  syntheticRenameSync(config.filename, config.filename + '.moved');\n  const db = constructExistingWritableDatabase(config.filename);",
  ],
  'foreign-post-work': [
    '        const after = readValidatedState(db, version, embeddingBound);',
    "        db.exec('UPDATE attempts SET rowid = 21 WHERE rowid = 1');\n        const after = readValidatedState(db, version, embeddingBound);",
  ],
};
if (replacements[mode]) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/evaluation/experiment-budget/index.mjs')) return loaded;
  const source = String(loaded.source);
  const [target, replacement] = replacements[mode];
  assert.equal(source.split(target).length, 2, `unique synthetic seam ${mode}`);
  const imports = mode === 'rename-open'
    ? "import { renameSync as syntheticRenameSync } from 'node:fs';\n" : '';
  return { ...loaded, source: `${imports}${source.replace(target, replacement)}` };
} });

const { openBoundEmbeddingExperimentBudget } = await import('../index.mjs');
if (mode === 'callback-sql-mutation') {
  const original = DatabaseSync.prototype.exec;
  let active;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === 'BEGIN IMMEDIATE') active = this;
    return original.call(this, sql);
  };
  try {
    openBoundEmbeddingExperimentBudget({ configuration: config, authorize() {
      active.prepare('UPDATE attempts SET rowid = 21 WHERE rowid = 1').run();
    } });
    process.stdout.write('unexpected-success\n');
  } catch (error) { process.stdout.write(`${error.code ?? 'unexpected'}\n`); }
  finally { DatabaseSync.prototype.exec = original; }
  process.exit(0);
}
if (mode === 'rename-open') {
  try { openBoundEmbeddingExperimentBudget({ configuration: config, authorize() {} }); }
  catch (error) { process.stdout.write(`${error.code ?? 'unexpected'}\n`); process.exit(0); }
  process.stdout.write('unexpected-success\n');
  process.exit(1);
}
const handle = openBoundEmbeddingExperimentBudget({ configuration: config, authorize() {} });
if (mode.startsWith('fail-')) {
  const original = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql === 'COMMIT') {
      DatabaseSync.prototype.exec = original;
      if (mode === 'fail-before-commit') throw new Error('synthetic before COMMIT');
      original.call(this, sql);
      throw new Error('synthetic after COMMIT');
    }
    return original.call(this, sql);
  };
}
let first;
try { handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 7 }); }
catch (error) { first = error.code; }
let second;
try { handle.getState(); } catch (error) { second = error.code; }
process.stdout.write(`${JSON.stringify({ first, second })}\n`);

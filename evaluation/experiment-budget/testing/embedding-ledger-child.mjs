// Synthetic child only: actual SQLite transaction/crash behavior, never a real ledger.
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [mode, configText, requestText] = process.argv.slice(2);
assert.ok(['upgrade', 'reserve-crash', 'crash-before-commit', 'crash-after-commit',
  'kill-before-commit', 'kill-after-commit', 'fail-copy', 'legacy-reserve',
  'chmod-after-begin', 'rename-upgrade-open', 'rename-reopen-open'].includes(mode));
const config = JSON.parse(configText);
// This child may mutate SQLite or process state; only its own generated test
// directory is admissible, and upgrade request text cannot name another one.
assert.deepEqual(Object.keys(config).sort(),
  ['directory', 'runId', 'limitMicroUsd', 'requestCap'].sort());
assert.equal(typeof config.directory, 'string');
assert.equal(path.isAbsolute(config.directory), true);
assert.equal(config.directory, path.resolve(config.directory));
const root = path.dirname(config.directory);
assert.equal(path.dirname(root), realpathSync(tmpdir()));
assert.match(path.basename(root), /^cairn-embedding-ledger-[A-Za-z0-9]{6}$/u);
assert.equal(path.basename(config.directory), 'budget');
assert.equal(realpathSync(root), root);
assert.equal(realpathSync(config.directory), config.directory);
assert.equal(lstatSync(root).isDirectory(), true);
assert.equal(lstatSync(config.directory).isDirectory(), true);
assert.equal(lstatSync(root).isSymbolicLink(), false);
assert.equal(lstatSync(config.directory).isSymbolicLink(), false);
if (mode !== 'reserve-crash' && mode !== 'legacy-reserve') {
  const request = JSON.parse(requestText);
  assert.deepEqual(Object.keys(request).sort(),
    ['directory', 'runId', 'limitMicroUsd', 'requestCap',
      'expectedCheckpoint', 'expectedHistorySha256'].sort());
  for (const key of ['directory', 'runId', 'limitMicroUsd', 'requestCap']) {
    assert.equal(request[key], config[key]);
  }
}

const replacements = {
  'crash-before-commit': [
    '    db.exec(`PRAGMA user_version = ${EMBEDDING_SCHEMA_VERSION}`);\n    const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);',
    '    db.exec(`PRAGMA user_version = ${EMBEDDING_SCHEMA_VERSION}`);\n    process.exit(66);\n    const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);',
  ],
  'kill-before-commit': [
    '    db.exec(`PRAGMA user_version = ${EMBEDDING_SCHEMA_VERSION}`);\n    const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);',
    "    db.exec(`PRAGMA user_version = ${EMBEDDING_SCHEMA_VERSION}`);\n    process.kill(process.pid, 'SIGKILL');\n    const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);",
  ],
  'crash-after-commit': [
    "      db.exec('COMMIT');\n      return result;",
    "      db.exec('COMMIT');\n      process.exit(67);\n      return result;",
  ],
  'kill-after-commit': [
    "      db.exec('COMMIT');\n      return result;",
    "      db.exec('COMMIT');\n      process.kill(process.pid, 'SIGKILL');\n      return result;",
  ],
  'fail-copy': [
    "    db.exec('DROP TABLE attempts_legacy');",
    "    db.exec('DROP TABLE attempts_legacy');\n    throw new Error('synthetic post-copy failure');",
  ],
  'chmod-after-begin': [
    "  return closeAfter(db, () => withTransaction(db, 'write', () => {",
    "  return closeAfter(db, () => withTransaction(db, 'write', () => {\n      chmodSync(config.filename, 0o644);",
  ],
  'rename-upgrade-open': [
    "  const identity = inspectTransitionLocation(config);\n  const db = constructExistingWritableDatabase(config.filename);\n  return closeAfter(db, () => withTransaction(db, 'write', () => {",
    "  const identity = inspectTransitionLocation(config);\n  syntheticRenameSync(config.filename, config.filename + '.moved');\n  const db = constructExistingWritableDatabase(config.filename);\n  return closeAfter(db, () => withTransaction(db, 'write', () => {",
  ],
  'rename-reopen-open': [
    "  const db = constructExistingWritableDatabase(config.filename);\n  try {\n    withTransaction(db, 'read', () => {\n      inspectTransitionLocation(config, identity);\n      const state = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);",
    "  syntheticRenameSync(config.filename, config.filename + '.moved');\n  const db = constructExistingWritableDatabase(config.filename);\n  try {\n    withTransaction(db, 'read', () => {\n      inspectTransitionLocation(config, identity);\n      const state = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);",
  ],
};
if (replacements[mode]) {
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith('/evaluation/experiment-budget/index.mjs')) return loaded;
    const source = String(loaded.source);
    const [target, replacement] = replacements[mode];
    assert.equal(source.split(target).length, 2, `unique fault seam for ${mode}`);
    const imports = mode === 'chmod-after-begin' ? "import { chmodSync } from 'node:fs';\n"
      : mode.startsWith('rename-') ? "import { renameSync as syntheticRenameSync } from 'node:fs';\n" : '';
    return { ...loaded, source: `${imports}${source.replace(target, replacement)}` };
  } });
}

const { reopenEmbeddingExperimentBudget, reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } =
  await import('../index.mjs');
if (mode === 'reserve-crash') {
  const ledger = reopenEmbeddingExperimentBudget(config);
  ledger.reserve({ attemptId: requestText, channel: 'host-embedding', reservedMicroUsd: 7 });
  process.exit(0);
}
try {
  if (mode === 'legacy-reserve') {
    const ledger = reopenExperimentBudget(config);
    try {
      ledger.reserve({ attemptId: JSON.parse(requestText), channel: 'host-completion', reservedMicroUsd: 7 });
    } finally {
      ledger.close();
    }
    process.stdout.write('reserved\n');
    process.exit(0);
  }
  if (mode === 'rename-reopen-open') {
    const ledger = reopenEmbeddingExperimentBudget(config);
    ledger.close();
    process.stdout.write('reopened\n');
    process.exit(0);
  }
  const result = upgradeExperimentBudgetForEmbeddings(JSON.parse(requestText));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stdout.write(`${error?.code ?? error?.message}\n`);
  process.exitCode = error?.code ? 2 : 3;
} finally {
  if (mode === 'chmod-after-begin') {
    chmodSync(path.join(config.directory, 'experiment-budget.sqlite'), 0o600);
  }
}

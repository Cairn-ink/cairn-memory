// Synthetic child only: actual SQLite transaction/crash behavior, never a real ledger.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';

const [mode, configText, requestText] = process.argv.slice(2);
assert.ok(['upgrade', 'reserve-crash', 'crash-before-commit', 'crash-after-commit',
  'kill-before-commit', 'kill-after-commit', 'fail-copy', 'legacy-reserve',
  'chmod-after-begin', 'rename-upgrade-open', 'rename-reopen-open'].includes(mode));
const config = JSON.parse(configText);

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

// Synthetic child only: actual SQLite transaction/crash behavior, never a real ledger.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const [mode, configText, requestText] = process.argv.slice(2);
assert.ok(['upgrade', 'reserve-crash', 'crash-before-commit', 'crash-after-commit',
  'kill-before-commit', 'kill-after-commit', 'fail-copy', 'legacy-reserve'].includes(mode));
const config = JSON.parse(configText);

const replacements = {
  'crash-before-commit': [
    '      const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION);',
    '      process.exit(66);\n      const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION);',
  ],
  'kill-before-commit': [
    '      const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION);',
    "      process.kill(process.pid, 'SIGKILL');\n      const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION);",
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
    "      db.exec('DROP TABLE attempts_legacy');",
    "      db.exec('DROP TABLE attempts_legacy');\n      throw new Error('synthetic post-copy failure');",
  ],
};
if (replacements[mode]) {
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith('/evaluation/experiment-budget/index.mjs')) return loaded;
    const source = String(loaded.source);
    const [target, replacement] = replacements[mode];
    assert.equal(source.split(target).length, 2, `unique fault seam for ${mode}`);
    return { ...loaded, source: source.replace(target, replacement) };
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
  const result = upgradeExperimentBudgetForEmbeddings(JSON.parse(requestText));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  process.stdout.write(`${error?.code ?? error?.message}\n`);
  process.exitCode = error?.code ? 2 : 3;
}

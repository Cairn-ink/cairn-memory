import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createExperimentBudget, reopenExperimentBudget } from './index.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'cairn-experiment-budget-example-'));
const configuration = {
  directory: path.join(root, 'ledger'),
  runId: randomUUID(),
  limitMicroUsd: 1_000_000,
  requestCap: 6,
};

const first = createExperimentBudget(configuration);
const completedAttemptId = randomUUID();
first.reserve({
  attemptId: completedAttemptId,
  channel: 'host-completion',
  reservedMicroUsd: 400_000,
});
first.recordOutcome({
  attemptId: completedAttemptId,
  outcome: 'succeeded',
  actualMicroUsd: 275_000,
});
first.close();

const reopened = reopenExperimentBudget(configuration);
const unresolvedAttemptId = randomUUID();
reopened.reserve({
  attemptId: unresolvedAttemptId,
  channel: 'cairn-generation',
  reservedMicroUsd: 200_000,
});
const state = reopened.getState();
reopened.close();

process.stdout.write(`${JSON.stringify({
  synthetic: true,
  ledgerDirectory: configuration.directory,
  note: 'The unresolved amount remains reserved. This ledger does not intercept network requests.',
  state,
}, null, 2)}\n`);

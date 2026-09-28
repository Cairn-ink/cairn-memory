// Launch ledger. The orchestrator is its only writer: it records every host
// launch before the process starts, and a Codex thread binding as soon as the
// process it launched reports one. Hooks, workers, analysis and cleanup only
// read it, and never add ownership from hook input.
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ledgerPath = root => join(root, 'ledger.json');

export function readLedger(root) {
  return JSON.parse(readFileSync(ledgerPath(root), 'utf8'));
}

/** Readers treat a missing or unreadable ledger as owning nothing. */
export function tryReadLedger(root) {
  try { return readLedger(root); } catch { return null; }
}

/** Atomic replace, so concurrent readers never parse a partial ledger. */
export function writeLedger(root, ledger) {
  const path = ledgerPath(root);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

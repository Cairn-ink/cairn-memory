import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentSafetyObservations } from './content-safety-observations.mjs';
import { classifyCardBodySafetyV1 } from './content-safety-classifier.mjs';

const refused = () => ({ ok: false, error: { code: 'content_safety_preflight_refused', retryable: false } });
const defaults = Object.freeze({ scanRows: 250000, scanBytes: 128 * 1024 * 1024, deadlineMs: 30000, fileBytes: 1024 * 1024 * 1024 });
function files(path, maxBytes, timeout) {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./content-safety-files-child.mjs', import.meta.url))], {
    input: JSON.stringify({ path, maxBytes }), encoding: 'utf8', env: {}, timeout, maxBuffer: 8192,
  });
  if (child.error || child.status !== 0 || child.signal) throw Error();
  const value = JSON.parse(child.stdout);
  if (!Array.isArray(value) || value.length !== 4 || !value[0].present) throw Error();
  return value;
}

/** Counts only. All failures replace the entire report with one generic code.
 * Supported installed-cell providers can be added at the observation admission
 * seam later; S3 admits only first-install physical 18/23/33, with no safety DDL.
 * Budgets cap all examined rows, materialized bytes, file bytes and elapsed time.
 */
export async function preflightContentSafetyV1({ path, budget = {} } = {}) {
  let db;
  try {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') ||
        !budget || Object.keys(budget).some(key => !Object.hasOwn(defaults, key))) throw Error();
    const limits = { ...defaults, ...budget };
    if (Object.entries(limits).some(([key, value]) => !Number.isSafeInteger(value) || value < 1 || value > defaults[key])) throw Error();
    const deadline = performance.now() + limits.deadlineMs;
    const check = () => { if (performance.now() >= deadline) throw Error(); };
    const remaining = () => { check(); return Math.max(1, Math.ceil(deadline - performance.now())); };
    const before = files(path, limits.fileBytes, remaining());
    // Immutable reads never create/touch SHM or recover a journal. They are safe
    // only after quiescent checkpoint/close: do not silently ignore retained WAL.
    if (before.slice(1, 3).some(file => file.present && file.size !== '0')) throw Error();
    const [{ DatabaseSync }, { readTransaction }] = await Promise.all([import('node:sqlite'), import('./database.mjs')]);
    check();
    const uri = pathToFileURL(path); uri.searchParams.set('mode', 'ro'); uri.searchParams.set('immutable', '1');
    db = new DatabaseSync(uri.href, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0');
    const report = readTransaction(db, () => {
      const snapshot = contentSafetyObservations(db, limits, check);
      const counts = { complete: 0, unknown: 0, knownSuppressed: 0 };
      const owners = { complete: new Set(), unknown: new Set(), knownSuppressed: new Set() }, affected = new Set();
      for (const observation of snapshot.observations) {
        check();
        const status = classifyCardBodySafetyV1(observation).status;
        const key = status === 'known-suppressed' ? 'knownSuppressed' : status;
        counts[key]++;
        owners[key].add(observation.body.identity.ownerId);
        if (key !== 'complete') affected.add(observation.body.identity.ownerId);
      }
      if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== snapshot.observations.length) throw Error();
      return { enumerated: snapshot.observations.length, ...counts,
        // Episode-derived receipts removed by Raw deletion count as unknown;
        // the complete count is unaffected.
        knownSuppressedScope: 'single-producer-v1',
        owners: Object.fromEntries(Object.entries(owners).map(([key, set]) => [key, set.size])),
        ownersAffected: affected.size, mode: 'first-install', schemaBase: snapshot.schemaBase, unchangedFiles: true };
    });
    db.close(); db = undefined;
    const after = files(path, limits.fileBytes, remaining());
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error();
    check();
    return report;
  } catch { return refused(); }
  finally { try { db?.close(); } catch { /* Refusal already replaces all data. */ } }
}

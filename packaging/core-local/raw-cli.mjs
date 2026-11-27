import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { assertActiveAuthority, managedGeneration } from './daemon-authority.mjs';
import { truncateWal } from './wal-checkpoint.mjs';

const help = `Cairn Memory — local Raw conversation commands

Usage:
  cairn-memory raw list --db ABS --owner ID [--project ID]
  cairn-memory raw delete --db ABS --owner ID [--project ID] --conversation ID [--yes]

List and delete print metadata only. Delete is a dry run unless --yes is supplied.
See docs/raw-local-journal.md for deletion and retention details.`;

const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 200 &&
  value.trim() === value && !/^-/u.test(value) && !/[\x00-\x1f\x7f]/u.test(value);
const invalid = () => Object.assign(new Error(), { code: 'invalid_raw_arguments' });

function parse([operation, ...args]) {
  if (operation !== 'list' && operation !== 'delete') throw invalid();
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (values.has(flag)) throw invalid();
    if (flag === '--yes' && operation === 'delete') { values.set(flag, true); continue; }
    const value = args[++index];
    if ((!['--db', '--owner', '--project'].includes(flag) && !(operation === 'delete' && flag === '--conversation')) ||
        !value || value.startsWith('--')) throw invalid();
    values.set(flag, value);
  }
  const database = values.get('--db'), owner = values.get('--owner'), project = values.get('--project');
  const id = values.get('--conversation');
  if (!database || !isAbsolute(database) || database.includes('\0') || !identifier(owner) ||
      (project !== undefined && !identifier(project)) ||
      (operation === 'delete' && (!identifier(id) || /[*?%\[\]]/u.test(id)))) throw invalid();
  return { options: { database, owner, project }, id, deleting: values.has('--yes') };
}

function notFound(id, emit) {
  emit({ ok: false, error: { code: 'conversation_not_found', retryable: false,
    ...(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(id) &&
      { message: 'Conversation not found. Run raw list for the current IDs.' }) } });
  return 1;
}

async function operate({ options, id, deleting }, emit) {
  const { database, owner, project } = options;
  const scope = { owner, namespace: project === undefined ? 'personal\0' : 'project\0' + project };
  const generation = managedGeneration();
  const deadline = performance.now() + 600000;
  let rows;
  for (;;) {
    try {
      const store = await assertActiveAuthority(generation, options);
      if (id !== undefined && !/^raw-[0-9a-f]{64}$/u.test(id)) return notFound(id, emit);
      if (!rows) {
        const { openStorage } = await import('./adapter-slot.mjs');
        const runtime = await openStorage(database);
        try {
          const current = await assertActiveAuthority(generation, options);
          if (current.dev !== store.dev || current.ino !== store.ino) throw new Error('store_changed');
          const { raw, uow } = runtime.storage;
          rows = await uow.run(owner, { readOnly: !deleting, pauseLock: deleting }, async tx => {
            const found = await raw.conversations(tx, scope, id);
            if (deleting && found.length) await raw.deleteConversation(tx, scope, found[0]);
            return found;
          });
        } finally { await runtime.close(); }
      }
      // The daemon can keep its handles. Truncate after commit, and after
      // closing this operator's adapter, so old WAL frames cannot survive success.
      if (deleting) await truncateWal(database);
      break;
    } catch (error) {
      if (!deleting || (error.code !== 'storage_busy' &&
          !(error.code === 'ERR_SQLITE_ERROR' && [5, 6].includes(error.errcode & 255)))) throw error;
      if (performance.now() >= deadline) {
        process.stderr.write('rerun the same command to continue\n');
        emit({ ok: false, error: { code: 'storage_busy', retryable: true } });
        return 3;
      }
      process.stderr.write('storage busy; waiting to retry\n');
      await delay(250);
    }
  }
  if (id === undefined) {
    for (const { sessionId, ...metadata } of rows) emit(metadata);
    return 0;
  }
  if (!rows.length) return notFound(id, emit);
  const { sessionId, ...metadata } = rows[0];
  emit({ ok: true, dryRun: !deleting, ...metadata, conversationId: id,
    revision: metadata.messageCount + Number(deleting), forgottenMemories: 0, retainedMemories: 0,
    removedReceipts: 0, invalidatedEpisodes: 0, ...(deleting && { actionId: randomUUID(), effectCount: 1 }) });
  return 0;
}

export async function runRaw(args) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(help + '\n'); return; }
  const emit = row => process.stdout.write(JSON.stringify(row) + '\n');
  try { process.exitCode = await operate(parse(args), emit); }
  catch (error) {
    const code = error.code === 'invalid_raw_arguments' ? error.code : 'raw_command_failed';
    emit({ ok: false, error: { code, retryable: false } });
    process.exitCode = code === 'invalid_raw_arguments' ? 2 : 1;
  }
}

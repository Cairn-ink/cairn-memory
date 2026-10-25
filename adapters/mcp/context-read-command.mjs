import { parseContextRefresh } from './context-read-configuration.mjs';
import { createContextReadAccess } from './context-read-access.mjs';
import { prepareContextEmbedding, contextEmbeddingPort, localCheckConfiguration } from './context-read-provider.mjs';
import { pinStoreFile, storeIdentity, storeFenceOption } from '../../core/store-fence.mjs';

/** Static dependencies stay SQLite-free; syntax checks do no opening or key lookup. */
export async function contextCommand(args, env = process.env) {
  let core, access, pin, embedding;
  try {
    const config = parseContextRefresh(args);
    if (config.check) {
      console.log(JSON.stringify({ ok: true, mode: 'configuration-check', contextRead: 'context-read-v1',
        preset: config.provider.provider === 'local' ? 'rrf-k60-d12' : 'rrf-k10', provider: config.provider,
        ...localCheckConfiguration(config.provider), modelKeyInspected: false, databaseOpened: false, providerContacted: false }));
      return;
    }
    embedding = await prepareContextEmbedding(config.provider, env);
    const [{ openMemoryCore }, { readTransaction }, { DatabaseSync }] = await Promise.all([
      import('../../core/contract.mjs'), import('../../core/database.mjs'), import('node:sqlite')]);
    pin = pinStoreFile(config.path);
    const reader = new DatabaseSync(config.path, { readOnly: true }); let identity;
    try { identity = readTransaction(reader, () => storeIdentity(reader)); pin.check(); } finally { reader.close(); }
    access = createContextReadAccess(config.namespace, false, { refresh: true });
    core = openMemoryCore({ path: config.path, storeFence: storeFenceOption({ version: 'store-fence-v1', ...pin.identity, ...identity }),
      contextRead: { ...access.configuration, ...contextEmbeddingPort(embedding) } });
    const result = await access.call(core, 'refreshContextIndex', { readSet: access.readSet, types: config.types, intent: config.intent, budget: config.budget });
    console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const selected = [5,6].includes(Number(error?.errcode)&255) ? 'storage_busy' : error?.code === 'method_not_found' ? 'database_not_found' : error?.code;
    const code = ['invalid_input', 'invalid_mcp_configuration', 'database_not_found', 'unsafe_database_file', 'unsupported_database', 'storage_busy'].includes(selected) ? selected : 'invalid_input';
    console.log(JSON.stringify({ ok: false, error: { code, retryable: code === 'storage_busy' } })); process.exitCode = 1;
  } finally { try { access?.revoke(); core?.close(); pin?.close(); } finally { await embedding?.close?.(); } }
}

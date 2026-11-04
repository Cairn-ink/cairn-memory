import { migrateContentSafety } from '../../core/content-safety-migration.mjs';

/** SQLite-free at link time, including the installed CLI import closure. */
export async function safetyMigrateCommand(args) {
  try {
    if (args[0] !== 'migrate') throw Error('invalid_input');
    const values = new Map(); let quiescent = false;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--quiescent' && !quiescent) { quiescent = true; continue; }
      if (!['--db','--backup','--store-id','--base'].includes(args[i]) || values.has(args[i]) ||
          !args[i + 1] || args[i + 1].startsWith('--')) throw Error('invalid_input');
      values.set(args[i], args[++i]);
    }
    if (!quiescent || values.size !== 4 || !['18','23','33'].includes(values.get('--base'))) throw Error('invalid_input');
    const value = await migrateContentSafety({ path: values.get('--db'), backupPath: values.get('--backup'),
      expected: { storeId: values.get('--store-id'), base: Number(values.get('--base')) },
      quiescence: { admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true } });
    console.log(JSON.stringify({ ok: true, value }));
  } catch (error) {
    const code = ['invalid_input','invalid_path','unsafe_database_file','unsupported_database'].includes(error.code ?? error.message)
      ? error.code ?? error.message : 'storage_error';
    console.log(JSON.stringify({ ok: false, error: { code, admissionsRemainClosed: true } }));
    process.exitCode = 1;
  }
}

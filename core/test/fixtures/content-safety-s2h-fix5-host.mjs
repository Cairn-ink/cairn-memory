import { DatabaseSync, StatementSync } from 'node:sqlite';
import { MemoryStoreError } from '../../validation.mjs';
import { createContextReadHost as baseHost } from '../../testing/context-product-index-host.mjs';

export async function createContextReadHost(c) {
  const control = new Int32Array(c.fix5Control), connections = new WeakMap();
  const prepare = DatabaseSync.prototype.prepare, get = StatementSync.prototype.get;
  // Obtain the engine's actual native BUSY error on a separate fixture database.
  // The canonical guard remains undisturbed; only its final epoch SELECT fails.
  const writer = new DatabaseSync(c.fix5FaultPath), reader = new DatabaseSync(c.fix5FaultPath);
  writer.exec('CREATE TABLE probe(value); BEGIN EXCLUSIVE');
  let busy;
  try { reader.prepare('SELECT * FROM probe').all(); }
  catch (error) { busy = error; }
  finally { writer.exec('ROLLBACK'); reader.close(); writer.close(); }
  if (busy?.code !== 'ERR_SQLITE_ERROR' || (busy.errcode & 255) !== 5) throw Error('native BUSY fixture failed');
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = Reflect.apply(prepare, this, [sql]); connections.set(statement, this); return statement;
  };
  StatementSync.prototype.get = function(...args) {
    const mode = Atomics.load(control, 0);
    if (mode && this.sourceSQL === 'SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?' &&
        connections.get(this)?.isTransaction === false &&
        new Error().stack?.includes('assertContentSuppressionRequestInside') &&
        Atomics.compareExchange(control, 0, mode, 0) === mode) {
      Atomics.add(control, 1, 1);
      if (mode === 2) throw new MemoryStoreError('evidence_unavailable');
      throw busy;
    }
    return Reflect.apply(get, this, args);
  };
  const host = await baseHost(c), count = host.counter.countTokens;
  return { ...host, counter: { ...host.counter, countTokens(text) {
    const phase = Atomics.load(control, 2);
    if (phase && text.includes(phase === 1 ? 'needle protected' : 'needle ')) Atomics.add(control, 3, 1);
    return Reflect.apply(count, host.counter, [text]);
  } } };

}

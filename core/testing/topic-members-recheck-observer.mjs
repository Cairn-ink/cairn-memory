// Count virtual-table rows before SQLite's WHERE filter, rather than merely
// counting the matching row returned by StatementSync.get().
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
const prepare = DatabaseSync.prototype.prepare;
let rows = 0, filteredPragmas = 0, queries = [];
DatabaseSync.prototype.prepare = function (sql) {
  if (workerData.constructionError && /SELECT id,revision,level,substr\(title/.test(sql)) {
    throw Object.assign(Error('controlled construction error'), workerData.constructionError);
  }
  const metadata = /FROM pragma_(table_info|index_xinfo)\(\?\)/i.test(sql);
  if (metadata) {
    this.function('recheck_metadata_visit', () => { rows++; return 1; });
    queries.push(sql);
    if (/WHERE/i.test(sql)) {
      filteredPragmas++;
      sql = sql.replace(/WHERE/i, 'WHERE recheck_metadata_visit() AND');
    } else {
      sql = sql.replace(/(FROM pragma_\w+\(\?\))/i, '$1 WHERE recheck_metadata_visit()');
    }
  }
  const statement = prepare.call(this, sql);
  return new Proxy(statement, { get(target, key) {
    if (key === 'get') return (...args) => {
      const value = target.get(...args); if (!metadata) rows++; return value;
    };
    if (key === 'columns') return () => { const value = target.columns(); rows += value.length; return value; };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = result => {
  workerData.recheckPort.postMessage({ rows, filteredPragmas, queries });
  rows = filteredPragmas = 0; queries = [];
  return post(result);
};

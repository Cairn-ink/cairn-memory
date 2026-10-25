import assert from 'node:assert/strict';
import threads, { MessageChannel } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

const tables = ['memories','mocs','moc_title_sources','moc_edges','moc_memory_refs','namespace_epochs',
  'namespace_index_state','index_generations','index_memories','index_mocs','index_title_sources','index_memory_refs','index_edges'];
const secondary = [['memories','index_memory_keyset'],['mocs','index_moc_keyset'],['moc_memory_refs','memory_moc_refs']];
const sum = values => values.reduce((a, b) => a + b, 0);

/** Independent fixture inventory of the charged opening schedule. These reads
 * inspect owned test metadata; they do not run in the bounded public reader. */
export function memberOpeningModel(db, workLimit) {
  const schema = db.prepare('SELECT rowid,name,sql FROM sqlite_master ORDER BY rowid').all();
  const tableNames = [...tables, 'store_metadata'];
  const columns = new Map(tableNames.map(table => [table, new Set(db.prepare('SELECT name,pk FROM pragma_table_info(?)').all(table)
    .filter(row => row.pk).map(row => row.name))]));
  const indexes = tables.map(table => db.prepare('SELECT name,origin FROM pragma_index_list(?)').all(table).find(row => row.origin === 'pk').name);
  for (const [table, index] of secondary) {
    indexes.push(index);
    for (const row of db.prepare('SELECT name,"key" FROM pragma_index_xinfo(?)').all(index).filter(row => row.key)) columns.get(table).add(row.name);
  }
  const declarations = schema.filter(row => tableNames.includes(row.name)).map(row => ({
    table: row.name, bytes: Buffer.byteLength(row.sql), operations: 2 * (Math.ceil(Buffer.byteLength(row.sql) / 256) + 1),
  }));
  const batchSizes = indexes.map(name => db.prepare('SELECT "key" FROM pragma_index_xinfo(?)').all(name).length);
  const phases = { plans: indexes.length, schema: schema.length + 1,
    columns: sum([...columns.values()].map(names => names.size)), primary: sum(declarations.map(row => row.operations)),
    indexes: sum(batchSizes.map(size => size + 1)) };
  const costs = [
    ...Array(phases.plans + phases.schema + phases.columns + phases.primary).fill(1),
    ...batchSizes.flatMap(size => [size, ...Array(size).fill(1)]),
  ];
  // Cold call: setup4 + initial/final fences8 + create1 + envelope1.
  // Continuation: cursor checks2 + initial/final fences8 + envelope1.
  const firstCapacity = workLimit - (4 + 8 + 1 + 1), nextCapacity = workLimit - (2 + 8 + 1);
  let openingPages = 0, offset = 0;
  while (offset < costs.length) {
    let available = openingPages === 0 ? firstCapacity : nextCapacity;
    const start = offset;
    while (offset < costs.length && costs[offset] <= available) available -= costs[offset++];
    assert.ok(offset > start, 'the next indivisible opening step must fit a call');
    openingPages++;
  }
  const openingOperations = sum(Object.values(phases));
  function rank(value) {
    if (!value) return 0;
    const s = value.opening;
    let opening;
    if (s.done) opening = openingOperations;
    else if (s.phase === 'plans') opening = s.position;
    else if (s.phase === 'schema') opening = phases.plans + (s.after ? schema.findIndex(row => row.rowid === s.after) + 1 : 0);
    else if (s.phase === 'columns') opening = phases.plans + phases.schema + s.position;
    else if (s.phase === 'primary') {
      const fetched = Math.ceil((s.offset - 1) / 256);
      const within = 2 * fetched + (s.fragment === null ? 0 : s.fragment === 0 ? 1 : -1);
      opening = phases.plans + phases.schema + phases.columns + sum(declarations.slice(0, s.position).map(row => row.operations)) + within;
    } else {
      opening = phases.plans + phases.schema + phases.columns + phases.primary +
        sum(batchSizes.slice(0, s.position).map(size => size + 1)) + (s.rows ? 1 + s.offset : 0);
    }
    if (!s.done) return opening;
    const m = value.member;
    const member = m.pending ? 4 : m.done ? 5 : m.phase === 'settle' ? 3 : m.phase === 'ref' ? m.refAfter ? 2 : 1 : 0;
    return opening + member;
  }
  // A one-Memory/one-L1-ref fixture takes Memory, ref, ref EOF, settle:4
  // steps. Ordinary continuation scans also need a second four-unit fence.
  const memberCapacity = workLimit - (2 + 8 + 1 + 4);
  assert.equal(memberCapacity, 1, 'this model diagnoses workLimit16');
  const memberPages = Math.ceil(4 / memberCapacity);
  return { phases, declarations, batchSizes, openingOperations, openingUnits: sum(costs),
    firstCapacity, nextCapacity, openingPages, memberPages, workOnlyRefusalPages: openingPages + memberPages,
    // Every successful partial must advance at least one operation. Allow one
    // call per operation, including the fourth candidate step that refuses.
    refusalPageBound: openingOperations + 4, rank };
}

export function memberProgressReader(t, fixture, namespace, { freezeClock = true } = {}) {
  const NativeWorker = threads.Worker, records = [], waiters = [], ports = [];
  let closed = false;
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      const { port1, port2 } = new MessageChannel(); ports.push(port1);
      port1.on('message', value => { const waiter = waiters.shift(); if (waiter) waiter.resolve(value); else records.push(value); });
      port1.on('close', () => { closed = true; for (const waiter of waiters.splice(0)) waiter.reject(Error('member_progress_observer_closed')); });
      super(url, { ...options, workerData: { ...options.workerData, progressPort: port2, freezeProgressClock: freezeClock }, transferList: [port2],
        execArgv: ['--import', new URL('./topic-members-progress-observer.mjs', import.meta.url).href] });
    }
  };
  syncBuiltinESMExports();
  const reader = fixture.reader(namespace);
  t.after(async () => { await reader.close(); ports.forEach(port => port.close()); threads.Worker = NativeWorker; syncBuiltinESMExports(); });
  return { reader, report() {
    if (records.length) return Promise.resolve(records.shift());
    if (closed) return Promise.reject(Error('member_progress_observer_closed'));
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  } };
}

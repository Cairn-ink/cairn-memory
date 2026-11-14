// Pure trace comparisons shared by the gate, its mutation tests and derivation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const workloadKeys = [23, 33, 52, 53].map(cell => 'workload:' + cell);
export const normalizeSQL = sql => scanSQL(sql).normalized;
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const summary = record => ({ calls: record.calls.map(([method, result, start, end]) =>
  [method, hash(result), start ?? null, end ?? null]), statements: record.statements.length,
  sql: hash(record.statements), tables: record.dump.map(([name, rows]) => [name, rows.length, hash(rows)]),
  effectWitnesses: hash(record.effectWitnesses) });

// Exact texts observed in the receipt-walk cells and the filter-off witness.
// No seek/overflow exemption.
export const currentReceiptWalkSQLTexts = new Set([
  'SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?',
  "SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id",
  "SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?",
  "SELECT r.*,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id",
]);
export const archivedReceiptWalkSQLTexts = new Set([
  "SELECT r.*, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r INDEXED BY memory_receipts ON r.memory_id=json_extract(wanted.value,'$[0]') LIMIT 5",
]);
export const receiptWalkSQLTexts = new Set([...currentReceiptWalkSQLTexts, ...archivedReceiptWalkSQLTexts]);
export const receiptWalkSQL = ([sql]) => receiptWalkSQLTexts.has(normalizeSQL(sql));

export function reviseSQL(key, statements, sqlRevisions = []) {
  for (const entry of sqlRevisions.filter(entry => entry.key === key)) {
    assert.equal(statements[entry.index]?.[0], entry.old, `archived SQL revision ${key}#${entry.index} matches the archive`);
    statements[entry.index] = [entry.new, ...statements[entry.index].slice(1)];
  }
}

// Recognize the purge family independently of hashes, so re-pinning the general
// trace hash cannot hide an extra/dropped purge in a clone without the archive.
// Full SQL, method and arguments are still compared against the ledger below.
// Tokenize before recognizing targets: comments and separators are meaningful
// only outside literals/quoted identifiers. Keep exact trace rows for the pins.
function scanSQL(sql, retainCommentTokens = false) {
  const statements=[],tokens=[];let normalized='',space=false,uncertain=false,depth=0,hasComment=false,separators=0;
  const emit=(raw,kind,value=raw)=>{
    if(space&&normalized)normalized+=' ';
    normalized+=raw;space=false;tokens.push({kind,value});
  };
  const finish=()=>{if(tokens.length)statements.push({tokens:tokens.splice(0),uncertain:uncertain||depth!==0,hasComment});uncertain=false;depth=0;hasComment=false;};
  for(let i=0;i<sql.length;) {
    const c=sql[i],next=sql[i+1];
    if(/\s/.test(c)){space=true;i++;continue;}
    // Traces flatten whitespace, losing line-comment ends. For classification,
    // fail closed over the raw suffix: quotes after its first introducer may
    // belong to a comment, so none of their boundaries can be trusted.
    if(retainCommentTokens&&((c==='-'&&next==='-')||(c==='/'&&next==='*'))){
      uncertain=true;hasComment=true;emit(c+next,'symbol');
      for(const [word]of sql.slice(i).matchAll(/[a-z_][a-z_0-9$]*/gi))emit(word,'word');
      break;
    }
    if(c==='-'&&next==='-'){while(i<sql.length&&sql[i]!=='\n'&&sql[i]!=='\r')i++;space=true;continue;}
    if(c==='/'&&next==='*'){
      const end=sql.indexOf('*/',i+2);if(end<0){uncertain=true;break;}
      i=end+2;space=true;continue;
    }
    if(["'",'"','`','['].includes(c)) {
      const start=i++,close=c==='['?']':c;let value='',closed=false;
      while(i<sql.length){
        if(sql[i]===close){
          if(c!=='['&&sql[i+1]===close){value+=close;i+=2;continue;}
          i++;closed=true;break;
        }
        value+=sql[i++];
      }
      if(!closed)uncertain=true;
      emit(sql.slice(start,i),c==="'"?'literal':'identifier',value);continue;
    }
    const word=/^[a-z_][a-z_0-9$]*/i.exec(sql.slice(i));
    if(word){emit(word[0],'word');i+=word[0].length;continue;}
    if(c==='(')depth++;if(c===')'&&--depth<0)uncertain=true;
    if(c===';'){separators++;normalized+=';';space=false;finish();i++;continue;}
    emit(c,'symbol');i++;
  }
  finish();return {normalized:normalized.trim(),statements,separators};
}
const cardTable = name => /^(?:private_cards|card_[a-z_0-9]+)$/i.test(name);
const keyword=(token,word)=>token?.kind==='word'&&token.value.toUpperCase()===word;
function targetAt(tokens,index) {
  const identifier=token=>token&&['word','identifier','literal'].includes(token.kind);
  if(!identifier(tokens[index]))return null;
  let name=tokens[index++].value;
  if(tokens[index]?.value==='.'){
    if(!identifier(tokens[index+1]))return null;
    name=tokens[index+1].value;index+=2;
  }
  return tokens[index]?.value==='.'?null:{name,index};
}
function statementTargets(statement) {
  const {tokens}=statement,writes=[];let uncertain=statement.uncertain;
  // Supported statement heads. Other syntax mentioning a Card fails closed.
  if(!['SELECT','WITH','INSERT','REPLACE','UPDATE','DELETE','BEGIN','COMMIT','ROLLBACK','SAVEPOINT','RELEASE']
    .some(word=>keyword(tokens[0],word)))uncertain=true;
  for(let i=0;i<tokens.length;i++) {
    let at=i+1,kind;
    if(keyword(tokens[i],'INSERT')||keyword(tokens[i],'REPLACE')){
      kind='insert';if(keyword(tokens[at],'OR'))at+=2;
      if(!keyword(tokens[at++],'INTO')){uncertain=true;continue;}
    } else if(keyword(tokens[i],'UPDATE')){
      // DO UPDATE SET is the conflict arm of the already classified INSERT.
      if(keyword(tokens[i-1],'DO')&&keyword(tokens[at],'SET'))continue;
      kind='update';if(keyword(tokens[at],'OR'))at+=2;
    } else if(keyword(tokens[i],'DELETE')){
      kind='delete';if(!keyword(tokens[at++],'FROM')){uncertain=true;continue;}
    } else continue;
    const target=targetAt(tokens,at);
    if(!target)uncertain=true;else writes.push({kind,table:target.name});
  }
  return {writes,uncertain};
}
const reads=(tokens,word)=>tokens.flatMap((token,index)=>keyword(token,word)?[targetAt(tokens,index+1)?.name??'']:[]);
const mentionsCard=tokens=>tokens.some(token=>cardTable(token.value)||/\b(?:private_cards|card_[a-z_0-9]+)\b/i.test(token.value));
export const purgeAdditionSQL = ([sql]) => scanSQL(sql).statements.some(statement=>{
  const {tokens}=statement;
  if(statementTargets(statement).writes.some(write=>write.kind==='delete'&&write.table.toLowerCase()==='card_operations'))return true;
  if(!tokens.some(token=>keyword(token,'SELECT')))return false;
  if(reads(tokens,'FROM').some(name=>name.toLowerCase()==='private_cards')&&reads(tokens,'JOIN').some(name=>name.toLowerCase()==='card_operations'))return true;
  return reads(tokens,'FROM').some(name=>/^sqlite_(?:master|schema)$/i.test(name))&&tokens.some((token,index)=>
    token.value.toLowerCase()==='name'&&tokens[index+1]?.value==='='&&tokens[index+2]?.kind==='literal'&&
    ['card_operations','card_memory_bindings'].includes(tokens[index+2].value.toLowerCase()));
});

// This set describes source-forgetting calls, independently of the reviewed
// subset of methods carrying ledger rows in a particular workload.
export const forgettingMethods = new Set(['forget', 'deleteConversation', 'forgetEpisode', 'reject']);
const schemaReadPragmas = new Set(['table_info','table_xinfo','foreign_key_list','index_list','index_info','index_xinfo']);
function schemaReadPragma({tokens,uncertain}) {
  return !uncertain&&tokens.length===5&&keyword(tokens[0],'PRAGMA')&&tokens[1].kind==='word'&&
    schemaReadPragmas.has(tokens[1].value.toLowerCase())&&tokens[2].value==='('&&
    ['word','identifier','literal'].includes(tokens[3].kind)&&tokens[4].value===')';
}
export function cardFamilySQL([sql, , bindings = []]) {
  const {statements,separators,normalized}=scanSQL(sql,true);
  // Only one exact read-only introspection statement is exempt. Every other
  // PRAGMA (including one embedded in a batch) retains uncertain classification.
  if(statements.length===1&&separators<=1&&!normalized.startsWith(';')&&!statements[0].hasComment&&schemaReadPragma(statements[0]))return false;
  return statements.some(statement=>{
    const {tokens}=statement,{writes,uncertain}=statementTargets(statement);
    if(keyword(tokens[0],'PRAGMA')&&keyword(tokens[1],'WRITABLE_SCHEMA'))return true;
    if(writes.some(write=>cardTable(write.table))||uncertain&&mentionsCard(tokens))return true;
    if(!tokens.some(token=>keyword(token,'SELECT')))return false;
    if(reads(tokens,'JOIN').some(name=>name.toLowerCase()==='card_operations'))return true;
    return [...reads(tokens,'FROM'),...reads(tokens,'JOIN')].some(name=>/^sqlite_(?:master|schema)$/i.test(name))&&
      (tokens.some(token=>['literal','identifier'].includes(token.kind)&&cardTable(token.value))||
        bindings.some(value=>typeof value==='string'&&cardTable(value)));
  });
}

export function validateCardStatementTexts(texts = {}, entries = []) {
  assert.ok(texts && typeof texts === 'object' && !Array.isArray(texts), 'cardStatementTexts is a method map');
  const ledgerTexts = new Set(entries.map(entry => normalizeSQL(entry.statement[0])));
  for (const [method, list] of Object.entries(texts)) {
    assert.ok(forgettingMethods.has(method) && Array.isArray(list) && list.every(sql => typeof sql === 'string' && sql.length > 0),
      'reviewed card texts are exact nonempty strings for forgetting methods');
    assert.deepEqual(list, [...new Set(list)].sort(), 'reviewed card texts are sorted and unique');
    for (const sql of list) {
      const normalized = normalizeSQL(sql);
      assert.ok(!purgeAdditionSQL([normalized]), 'reviewed card texts cannot hide purge-family statements');
      assert.ok(!ledgerTexts.has(normalized), 'reviewed card texts cannot duplicate ledger statement texts');
    }
  }
}

// Keep the environment lookup at the gate boundary so this policy is pure.
export function wideArchiveMode(available, requireArchive) {
  assert.ok(available || requireArchive !== '1', 'archive revision not available (CAIRN_REQUIRE_WIDE_ARCHIVE=1)');
  return available ? 'archive' : 'pins';
}

export function archivedCardStatementTexts(archived) {
  checkCallRanges(archived);
  return Object.fromEntries([...forgettingMethods].map(method => [method, [...new Set(archived.calls
    .filter(call => call[0] === method && call.length === 4).flatMap(call => callStatements(archived, call))
    .filter(cardFamilySQL).map(([sql]) => sql))].sort()]));
}

// A single fixture list covers all workload traces, so the gate checks their
// archive union after comparing the individual traces. Pure comparisons default
// to checking their one supplied archive, including unused list entries.
export function assertArchivedCardStatementTexts(archives, texts = {}, entries = []) {
  validateCardStatementTexts(texts, entries);
  assert.ok(archives.length > 0, 'archived card text comparison needs at least one trace');
  const observed = archives.map(archivedCardStatementTexts);
  for (const method of forgettingMethods) assert.deepEqual(
    [...new Set(observed.flatMap(map => map[method]))].sort(), texts[method] ?? [],
    `${method} reviewed card texts equal the revised archive`);
}

// ordinal is one-based among ALL calls of method, including refusals; after is
// zero-based within that revised archived call. Allowed methods are fixture data.
// Entries sharing an anchor are inserted in ledger order. Probes are individual
// entries, never an optional allowance attached to another statement.
export function validateSqlAdditions(entries = [], sqlAdditionMethods = []) {
  assert.ok(Array.isArray(entries), 'sqlAdditions is an array');
  assert.ok(Array.isArray(sqlAdditionMethods) && sqlAdditionMethods.every(method => typeof method === 'string' && method.trim() === method && method.length > 0),
    'sqlAdditionMethods is an explicit list of call methods');
  assert.equal(new Set(sqlAdditionMethods).size, sqlAdditionMethods.length, 'addition methods are listed once');
  for (const entry of entries) {
    assert.ok(entry && workloadKeys.includes(entry.key) && typeof entry.method === 'string' &&
      Number.isInteger(entry.ordinal) && entry.ordinal > 0 && !Object.hasOwn(entry, 'forget') &&
      Number.isInteger(entry.after) && entry.after >= 0, 'position-anchored workload addition');
    assert.ok(sqlAdditionMethods.includes(entry.method), 'addition belongs to a reviewed call method');
    assert.ok(Number.isInteger(entry.reference) && entry.reference > 0 &&
      typeof entry.reason === 'string' && entry.reason.trim().length > 0 && !/[\r\n]/.test(entry.reason),
    'addition has a pull request number and a public reason');
    const row = entry.statement;
    assert.ok(Array.isArray(row) && row.length === 3 && typeof row[0] === 'string' && row[0] === normalizeSQL(row[0]) &&
      ['get', 'all', 'iterate', 'run', 'exec'].includes(row[1]) && Array.isArray(row[2]), 'full traced statement row');
    assert.ok(purgeAdditionSQL(row) && !receiptWalkSQL(row), 'only reviewed purge statements, never receipt exemptions');
  }
  assert.deepEqual([...new Set(entries.map(entry => entry.method))].sort(), [...sqlAdditionMethods].sort(),
    'reviewed methods are exactly those carrying additions across the workloads');
}

const compareAnchors = (a, b) => (a.method < b.method ? -1 : a.method > b.method ? 1 : 0) || a.ordinal - b.ordinal;
const orderedEntries = (key, entries) => entries.filter(entry => entry.key === key)
  .sort((a, b) => compareAnchors(a, b) || a.after - b.after);
const statementSummary = ([sql, method, bindings]) => [hash(sql), method, hash(bindings)];
const callStatements = (record, call) => record.statements.slice(call[2], call[3]);
// Full execution rows use the worker's normalized bindings, just like addition
// ledger rows. Include empty/refused calls and count ordinals over ALL calls.
export function cardExecutionSummary(record, omitted = new Set()) {
  checkCallRanges(record);
  const ordinals = new Map(), calls = [];
  for (const call of record.calls) {
    const method = call[0], ordinal = (ordinals.get(method) ?? 0) + 1;
    ordinals.set(method, ordinal);
    if (!forgettingMethods.has(method)) continue;
    const statements = [];
    if (call.length === 4) for (let index = call[2]; index < call[3]; index++)
      if (!omitted.has(index) && cardFamilySQL(record.statements[index])) statements.push(record.statements[index]);
    calls.push({ method, ordinal, statements });
  }
  return { callCount: calls.length, calls };
}

function assertCardExecutions(key, record, pins, omitted = new Set()) {
  if (!workloadKeys.includes(key)) return;
  assert.ok(pins && Object.hasOwn(pins, key), 'cardStatementExecutions requires reviewed per-call pins for ' + key);
  assert.deepEqual(cardExecutionSummary(record, omitted), pins[key],
    key + ' Card-family executions match reviewed calls, order, exact texts, methods and bindings');
}

function checkCallRanges(record) {
  let end = 0;
  for (const call of record.calls) {
    assert.ok([2, 3, 4].includes(call.length), 'trace call shape');
    if (call.length < 3) continue;
    assert.ok(Number.isInteger(call[2]) && call[2] >= end && call[2] <= record.statements.length, 'ordered call start');
    end = call[2];
    if (call.length === 4) {
      assert.ok(Number.isInteger(call[3]) && call[3] >= end && call[3] <= record.statements.length, 'bounded call end');
      end = call[3];
    }
  }
}

export function ledgerAdditionSummary(key, entries = [], sqlAdditionMethods = []) {
  validateSqlAdditions(entries, sqlAdditionMethods);
  const calls = [];
  for (const entry of orderedEntries(key, entries)) {
    let call = calls.at(-1);
    if (!call || compareAnchors(call, entry)) calls.push(call = { method: entry.method, ordinal: entry.ordinal, statements: [] });
    call.statements.push(statementSummary(entry.statement));
  }
  return { callCount: calls.length, calls };
}

export function reconstructWideTrace(key, archived, entries = [], sqlAdditionMethods = []) {
  validateSqlAdditions(entries, sqlAdditionMethods); checkCallRanges(archived);
  const wanted = orderedEntries(key, entries), insertions = new Map();
  const ordinals = new Map();
  let consumed = 0;
  for (const call of archived.calls) {
    const method = call[0], ordinal = (ordinals.get(method) ?? 0) + 1;
    ordinals.set(method, ordinal);
    for (const entry of wanted.filter(entry => entry.method === method && entry.ordinal === ordinal)) {
      assert.equal(call.length, 4, 'addition belongs to a traced call');
      assert.ok(entry.after < call[3] - call[2], `existing anchor for ${method} ${ordinal} after ${entry.after}`);
      const index = call[2] + entry.after;
      // This is the canonical purge site, after authorization/suppression and
      // immediately before the tombstone. A refused call without it has no anchor.
      assert.equal(archived.statements[index + 1]?.[0],
        'UPDATE memories SET content = NULL, deleted = 1, revision = revision + 1, updated_at = ? WHERE id = ?',
        'purge anchor precedes the canonical Memory tombstone');
      assert.ok(index + 1 < call[3], 'purge anchor stays inside its call');
      const rows = insertions.get(index) ?? [];
      rows.push(entry.statement); insertions.set(index, rows); consumed++;
    }
  }
  assert.equal(consumed, wanted.length, 'every ledger entry consumed exactly once');
  const statements = [], offsets = [];
  archived.statements.forEach((row, index) => {
    offsets[index] = statements.length; statements.push(row, ...(insertions.get(index) ?? []));
  });
  offsets[archived.statements.length] = statements.length;
  const calls = archived.calls.map(call => call.map((value, index) => index >= 2 ? offsets[value] : value));
  return { ...archived, statements, calls };
}

// This check needs only the current trace. Select the purge family over the
// entire trace, compare full rows in their reviewed calls, and reject leftovers.
// It also returns the precise positions to subtract for receipt count checks.
export function currentAdditionSummary(key, current, entries = [], sqlAdditionMethods = [], cardStatementTexts = {}) {
  validateSqlAdditions(entries, sqlAdditionMethods); validateCardStatementTexts(cardStatementTexts, entries); checkCallRanges(current);
  const wanted = orderedEntries(key, entries), positions = new Set(), listedPositions = new Set(), calls = [];
  const texts = new Set(entries.map(entry => entry.statement[0]));
  const isAddition = row => purgeAdditionSQL(row) || texts.has(row[0]);
  const ordinals = new Map();
  let consumed = 0;
  for (const call of current.calls) {
    const method = call[0], ordinal = (ordinals.get(method) ?? 0) + 1;
    ordinals.set(method, ordinal);
    const expected = wanted.filter(entry => entry.method === method && entry.ordinal === ordinal), rows = [], indices = [];
    if (call.length !== 4) {
      assert.equal(expected.length, 0, 'additions require complete call offsets');
      continue;
    }
    for (let index = call[2]; index < call[3]; index++) {
      const statement = current.statements[index];
      const listed = forgettingMethods.has(method) && (cardStatementTexts[method] ?? []).includes(statement[0]);
      if (listed) listedPositions.add(index);
      if (isAddition(statement) && (!listed || expected.some(entry => entry.statement[0] === statement[0]))) {
        rows.push(statement); positions.add(index); indices.push(index);
      }
    }
    if (rows.length) {
      assert.ok(sqlAdditionMethods.includes(method), `${method} carries purge SQL but is not a reviewed addition method`);
      assert.ok(forgettingMethods.has(method), `${method} carries purge SQL outside a forgetting call`);
    }
    assert.deepEqual(rows, expected.map(entry => entry.statement), `${method} ${ordinal} has exactly its ledger rows and bindings`);
    // Match each anchor group as one contiguous block ending at the canonical
    // tombstone. Receipt batching can shift its absolute index within the call.
    for (let offset = 0; offset < expected.length;) {
      let end = offset + 1;
      while (end < expected.length && expected[end].after === expected[offset].after) end++;
      for (let i = offset + 1; i < end; i++) assert.equal(indices[i], indices[i - 1] + 1, 'current purge anchor group is contiguous');
      const next = indices[end - 1] + 1;
      assert.ok(next < call[3], 'current purge anchor stays inside its call');
      assert.equal(current.statements[next]?.[0],
        'UPDATE memories SET content = NULL, deleted = 1, revision = revision + 1, updated_at = ? WHERE id = ?',
        'current purge anchor precedes the canonical Memory tombstone');
      offset = end;
    }
    if (forgettingMethods.has(method)) for (let index = call[2]; index < call[3]; index++) {
      const statement = current.statements[index];
      // Per-call execution pins separately check occurrences and bindings of
      // these listed texts, even when general trace hashes are regenerated.
      // Plain Card-table SELECTs without a card_operations join also remain
      // outside this classifier; archive comparison and SQL hashes cover them.
      if (cardFamilySQL(statement) && !positions.has(index)) assert.ok((cardStatementTexts[method] ?? []).includes(statement[0]),
        `${method} has an unreviewed card-family statement`);
    }
    consumed += expected.length;
    if (rows.length) calls.push({ method, ordinal, statements: rows.map(statementSummary) });
  }
  assert.equal(consumed, wanted.length, 'no unused current-trace ledger entry');
  current.statements.forEach((row, index) => {
    if (isAddition(row)) assert.ok(positions.has(index) || listedPositions.has(index), 'no purge addition outside its reviewed call');
  });
  const effect = { callCount: calls.length, calls: calls.sort(compareAnchors) };
  assert.deepEqual(effect, ledgerAdditionSummary(key, entries, sqlAdditionMethods), 'current additions have the ledger summary');
  return { effect, positions };
}

export function assertWidePins(key, current, entries, pinned, sqlAdditionMethods = [], cardStatementTexts = {}, cardStatementExecutions) {
  const actual = summary(current);
  const { effect, positions } = currentAdditionSummary(key, current, entries, sqlAdditionMethods, cardStatementTexts);
  assertCardExecutions(key, current, cardStatementExecutions, positions);
  if (workloadKeys.includes(key)) {
    if (effect.callCount || Object.hasOwn(pinned ?? {}, 'sqlAdditions')) {
      actual.sqlAdditions = effect;
      assert.deepEqual(pinned?.sqlAdditions, ledgerAdditionSummary(key, entries, sqlAdditionMethods), 'pins explicitly describe the ledger effect');
    }
  }
  assert.deepEqual(actual, pinned, 'current trace matches its pins');
  return actual;
}

export function compareWideTables(current, archived, removedRows = []) {
  // These workloads pass []: lineage-off purges remove no rows. A future cell
  // with removals must list exact table/serialized-row pairs, each used once.
  const expected = structuredClone(archived);
  for (const { table, row } of removedRows) {
    const rows = expected.find(([name]) => name === table)?.[1];
    assert.ok(rows && rows.includes(row), 'an explicit removed row exists in the archive');
    rows.splice(rows.indexOf(row), 1);
  }
  assert.deepEqual(current, expected, 'every table population, minus only explicitly reviewed rows');
}

export function compareWideTraces({ key, current, archived, sqlAdditions = [], sqlAdditionMethods = [], cardStatementTexts = {}, cardStatementExecutions, checkArchivedCardTexts = true, receiptWalk = false }) {
  validateCardStatementTexts(cardStatementTexts, sqlAdditions);
  if (checkArchivedCardTexts) assertArchivedCardStatementTexts([archived], cardStatementTexts, sqlAdditions);
  const reconstructed = reconstructWideTrace(key, archived, sqlAdditions, sqlAdditionMethods);
  const { positions } = currentAdditionSummary(key, current, sqlAdditions, sqlAdditionMethods, cardStatementTexts);
  assertCardExecutions(key, archived, cardStatementExecutions);
  assertCardExecutions(key, current, cardStatementExecutions, positions);
  assert.deepEqual(current.effectWitnesses, archived.effectWitnesses, 'complete effect witnesses, including rolled-back writes');
  compareWideTables(current.dump, archived.dump, []);
  if (!receiptWalk) {
    assert.equal(JSON.stringify(current.calls), JSON.stringify(reconstructed.calls), 'exact serialized calls and adjusted offsets');
    assert.deepEqual(current.statements, reconstructed.statements, 'exact reconstructed SQL sequence, including transactions');
  } else {
    assert.equal(JSON.stringify(current.calls.map(([method, result]) => [method, result])),
      JSON.stringify(archived.calls.map(([method, result]) => [method, result])), 'exact serialized calls and errors');
    assert.ok(current.statements.length - positions.size <= archived.statements.length, 'receipt batching only reduces SQL after removing ledger rows');
    for (const [index, call] of current.calls.entries()) {
      assert.equal(call.length, archived.calls[index]?.length, 'matching trace call shape');
      if (call.length !== 4) continue;
      const previous = archived.calls[index], expected = reconstructed.calls[index];
      const rows = callStatements(current, call), oldRows = callStatements(archived, previous);
      const additions = [...positions].filter(position => position >= call[2] && position < call[3]).length;
      assert.ok(rows.length - additions <= oldRows.length, call[0] + ' statement count cannot rise after removing exactly ledger rows');
      assert.deepEqual(rows.filter(row => !receiptWalkSQL(row)),
        callStatements(reconstructed, expected).filter(row => !receiptWalkSQL(row)), call[0] + ' reconstructed SQL and bindings');
    }
    // Also pins opening/closing statements and SQL outside a recorded call.
    assert.deepEqual(current.statements.filter(row => !receiptWalkSQL(row)),
      reconstructed.statements.filter(row => !receiptWalkSQL(row)), 'every execution outside exact receipt enumeration');
  }
  return reconstructed;
}

// Pure trace comparisons shared by the gate, its mutation tests and derivation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const workloadKeys = [23, 33, 52, 53].map(cell => 'workload:' + cell);
export const normalizeSQL = sql => sql.replace(/\s+/g, ' ').trim();
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const summary = record => ({ calls: record.calls.map(([method, result, start, end]) =>
  [method, hash(result), start ?? null, end ?? null]), statements: record.statements.length,
  sql: hash(record.statements), tables: record.dump.map(([name, rows]) => [name, rows.length, hash(rows)]),
  effectWitnesses: hash(record.effectWitnesses) });

// Exact texts observed in the listed cells and the filter-off witness.
// Seek and overflow pages are not observed here and receive no exemption.
export const currentReceiptWalkSQLTexts=new Set([
  "SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?",
  "SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?",
  "SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=?",
  "SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'",
  "SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?",
  "SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id",
  "SELECT count(*) AS active FROM ( SELECT id FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? LIMIT 129)",
  "SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version",
  "SELECT secret FROM episode_identity WHERE singleton=1",
  "SELECT start,end,precision FROM raw_source_maps WHERE conversation_id=? AND message_id=? AND source_key=?",
  "SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?",
  "SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id",
  "SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?",
  "SELECT r.*,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id",
]);
// The archived baseline is now this line's own production tree, which emits
// the current texts only. The batch variant of the earlier baseline no longer
// occurs in any listed trace, so it receives no exemption.
export const archivedReceiptWalkSQLTexts=new Set([]);
export const receiptWalkSQLTexts=new Set([...currentReceiptWalkSQLTexts,...archivedReceiptWalkSQLTexts]);
export const receiptWalkSQL=([sql])=>receiptWalkSQLTexts.has(normalizeSQL(sql));

// Exact per-call additions to the reviewed rows; counts include every execution.
export const receiptWalkSQLAdditions = [
  { key: 'workload:52', callIndex: 1, method: 'capture', archivedCount: 0, currentCount: 5,
    statement: ["SELECT count(*) AS active FROM ( SELECT id FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? LIMIT 129)", "get", ["synthetic-off-owner", "personal", "", 0]] },
  { key: 'workload:53', callIndex: 1, method: 'capture', archivedCount: 0, currentCount: 5,
    statement: ["SELECT count(*) AS active FROM ( SELECT id FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? LIMIT 129)", "get", ["synthetic-off-owner", "personal", "", 0]] },
  { key: 'workload:53', callIndex: 92, method: 'captureRaw', archivedCount: 0, currentCount: 5,
    statement: ["SELECT count(*) AS active FROM ( SELECT id FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? LIMIT 129)", "get", ["synthetic-off-owner", "personal", "", 0]] },
  { key: 'workload:53', callIndex: 122, method: 'openRawCaptureCore.captureRaw', archivedCount: 0, currentCount: 5,
    statement: ["SELECT count(*) AS active FROM ( SELECT id FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? LIMIT 129)", "get", ["synthetic-off-owner", "personal", "", 0]] },
  { key: 'workload:53', callIndex: 122, method: 'openRawCaptureCore.captureRaw', archivedCount: 4, currentCount: 5,
    statement: ["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id", "all", ["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0],[\"00000000-0000-4000-8000-000000000047\",1,0],[\"00000000-0000-4000-8000-000000000068\",1,0],[\"00000000-0000-4000-8000-000000000070\",1,0]]", "[[\"claude-code\",\"s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680\",\"direct-message-1\",\"user\",\"Synthetic direct Raw continuation source.\"],[\"claude-code\",\"s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680\",\"direct-message-2\",\"user\",\"Synthetic direct Raw continuation source.\"]]"]] },
  // Bounded page read relocated by cut 1/4.
  { key: 'workload:52', callIndex: 58, method: 'admit', archivedCount: 0, currentCount: 1,
    statement: ["SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?", "all", ["synthetic-off-owner", "personal", "", 0, 129]] },
  // Bounded page read relocated by cut 1/4.
  { key: 'workload:53', callIndex: 92, method: 'captureRaw', archivedCount: 0, currentCount: 1,
    statement: ["SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?", "all", ["synthetic-off-owner", "personal", "", 0, 129]] },
];

// Literal per-call decreases derived from the approved 142 removed rows
// plus the two page-read relocations paired with additions below.
export const receiptWalkSQLRemovals = [
  {"key":"workload:52","callIndex":1,"method":"capture","archivedCount":135,"currentCount":132,"removedCount":3,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:52","callIndex":1,"method":"capture","archivedCount":44,"currentCount":41,"removedCount":3,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:52","callIndex":1,"method":"capture","archivedCount":10,"currentCount":7,"removedCount":3,"statement":["SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:52","callIndex":1,"method":"capture","archivedCount":9,"currentCount":7,"removedCount":2,"statement":["SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:52","callIndex":1,"method":"capture","archivedCount":16,"currentCount":13,"removedCount":3,"statement":["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'","get",[]]},
  {"key":"workload:52","callIndex":1,"method":"capture","archivedCount":1,"currentCount":0,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0]]","[[\"synthetic\",\"off-session\",\"capture-two\",\"assistant\",\"Synthetic captured review procedure.\"]]"]]},
  {"key":"workload:52","callIndex":1,"method":"capture","archivedCount":1,"currentCount":0,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:52","callIndex":58,"method":"admit","archivedCount":30,"currentCount":29,"removedCount":1,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:52","callIndex":58,"method":"admit","archivedCount":10,"currentCount":9,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:52","callIndex":58,"method":"admit","archivedCount":2,"currentCount":0,"removedCount":2,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:52","callIndex":58,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0]]","[[\"synthetic\",\"off-session\",\"suppression-0\",\"user\",\"Synthetic suppression-0\"]]"]]},
  {"key":"workload:52","callIndex":58,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:52","callIndex":58,"method":"admit","archivedCount":4,"currentCount":3,"removedCount":1,"statement":["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'","get",[]]},
  {"key":"workload:52","callIndex":59,"method":"admit","archivedCount":30,"currentCount":29,"removedCount":1,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:52","callIndex":59,"method":"admit","archivedCount":10,"currentCount":9,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:52","callIndex":59,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:52","callIndex":59,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0],[\"00000000-0000-4000-8000-000000000040\",1,0]]","[[\"synthetic\",\"off-session\",\"suppression-1\",\"user\",\"Synthetic suppression-1\"]]"]]},
  {"key":"workload:52","callIndex":59,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:52","callIndex":59,"method":"admit","archivedCount":4,"currentCount":3,"removedCount":1,"statement":["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'","get",[]]},
  {"key":"workload:52","callIndex":70,"method":"admit","archivedCount":30,"currentCount":29,"removedCount":1,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:52","callIndex":70,"method":"admit","archivedCount":10,"currentCount":9,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:52","callIndex":70,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:52","callIndex":70,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",2,0],[\"00000000-0000-4000-8000-000000000007\",3,0],[\"00000000-0000-4000-8000-000000000040\",1,0],[\"00000000-0000-4000-8000-000000000042\",1,0],[\"00000000-0000-4000-8000-000000000049\",1,0]]","[[\"synthetic\",\"off-session\",\"independent\",\"user\",\"Synthetic independent\"]]"]]},
  {"key":"workload:52","callIndex":70,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:52","callIndex":70,"method":"admit","archivedCount":4,"currentCount":3,"removedCount":1,"statement":["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'","get",[]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":146,"currentCount":143,"removedCount":3,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":48,"currentCount":45,"removedCount":3,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":60,"currentCount":56,"removedCount":4,"statement":["SELECT secret FROM episode_identity WHERE singleton=1","get",[]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":18,"currentCount":16,"removedCount":2,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","off-session"]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":24,"currentCount":22,"removedCount":2,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889"]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":10,"currentCount":7,"removedCount":3,"statement":["SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":9,"currentCount":7,"removedCount":2,"statement":["SELECT id,revision,deleted,updated_at, (SELECT encoding FROM pragma_encoding) AS receipt_encoding FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","synthetic","off-session","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889","capture-one"]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","synthetic","off-session","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889","capture-two"]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":1,"currentCount":0,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0]]","[[\"synthetic\",\"off-session\",\"capture-two\",\"assistant\",\"Synthetic captured review procedure.\"]]"]]},
  {"key":"workload:53","callIndex":1,"method":"capture","archivedCount":1,"currentCount":0,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":136,"currentCount":134,"removedCount":2,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":45,"currentCount":44,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":19,"currentCount":18,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","claude-code","s1:311f43f6d18bcae1bd0e22836b1792afac975403f59bfbb4a3d4be0ad1e8fe76"]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":38,"currentCount":35,"removedCount":3,"statement":["SELECT secret FROM episode_identity WHERE singleton=1","get",[]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":15,"currentCount":14,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","claude-code","s1:7aa6c88a4781160ac96a97d79c9a9d130cb6c783ed8fe6e083e6a96d19972af3"]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":20,"currentCount":19,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","raw","00000000-0000-4000-8000-000000000045","00000000-0000-4000-8000-000000000045"]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":7,"currentCount":5,"removedCount":2,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":7,"currentCount":6,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0]]","[[\"claude-code\",\"s1:311f43f6d18bcae1bd0e22836b1792afac975403f59bfbb4a3d4be0ad1e8fe76\",\"raw-message\",\"user\",\"Synthetic retained Raw source.\"]]"]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":7,"currentCount":6,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","claude-code","s1:311f43f6d18bcae1bd0e22836b1792afac975403f59bfbb4a3d4be0ad1e8fe76","s1:7aa6c88a4781160ac96a97d79c9a9d130cb6c783ed8fe6e083e6a96d19972af3","raw-message"]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT start,end,precision FROM raw_source_maps WHERE conversation_id=? AND message_id=? AND source_key=?","all",["00000000-0000-4000-8000-000000000045","raw-message","486a29abf89753ce268b0d3f9438931cbe71bedac62bed4905d9033e5e34217c"]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=?","get",["00000000-0000-4000-8000-000000000045","raw-message"]]},
  {"key":"workload:53","callIndex":92,"method":"captureRaw","archivedCount":11,"currentCount":10,"removedCount":1,"statement":["SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?","get",["00000000-0000-4000-8000-000000000045","raw-message",30,0]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":37,"currentCount":36,"removedCount":1,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":12,"currentCount":11,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0],[\"00000000-0000-4000-8000-000000000047\",1,0]]","[[\"synthetic\",\"off-session\",\"suppression-0\",\"user\",\"Synthetic suppression-0\"]]"]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":11,"currentCount":9,"removedCount":2,"statement":["SELECT secret FROM episode_identity WHERE singleton=1","get",[]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","off-session"]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889"]]},
  {"key":"workload:53","callIndex":115,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","synthetic","off-session","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889","suppression-0"]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":37,"currentCount":36,"removedCount":1,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":12,"currentCount":11,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0],[\"00000000-0000-4000-8000-000000000047\",1,0],[\"00000000-0000-4000-8000-000000000068\",1,0]]","[[\"synthetic\",\"off-session\",\"suppression-1\",\"user\",\"Synthetic suppression-1\"]]"]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":11,"currentCount":9,"removedCount":2,"statement":["SELECT secret FROM episode_identity WHERE singleton=1","get",[]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","off-session"]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889"]]},
  {"key":"workload:53","callIndex":116,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","synthetic","off-session","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889","suppression-1"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":164,"currentCount":159,"removedCount":5,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":49,"currentCount":46,"removedCount":3,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":33,"currentCount":31,"removedCount":2,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","claude-code","s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":75,"currentCount":69,"removedCount":6,"statement":["SELECT secret FROM episode_identity WHERE singleton=1","get",[]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":29,"currentCount":27,"removedCount":2,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","claude-code","s1:7ebaf8413187bcbcaf186544d9e685c825c53eb7ab4db1027450d4d21e63969d"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":34,"currentCount":32,"removedCount":2,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","raw","00000000-0000-4000-8000-000000000076","00000000-0000-4000-8000-000000000076"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":3,"currentCount":1,"removedCount":2,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0],[\"00000000-0000-4000-8000-000000000047\",1,0],[\"00000000-0000-4000-8000-000000000068\",1,0],[\"00000000-0000-4000-8000-000000000070\",1,0]]","[[\"claude-code\",\"s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680\",\"direct-message-1\",\"user\",\"Synthetic direct Raw continuation source.\"]]"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":10,"currentCount":7,"removedCount":3,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","claude-code","s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680","s1:7ebaf8413187bcbcaf186544d9e685c825c53eb7ab4db1027450d4d21e63969d","direct-message-1"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT start,end,precision FROM raw_source_maps WHERE conversation_id=? AND message_id=? AND source_key=?","all",["00000000-0000-4000-8000-000000000076","direct-message-1","c26c63f1b85763433e8d1eeee4c82b765817b5d3654d5126422e4f9170988434"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=?","get",["00000000-0000-4000-8000-000000000076","direct-message-1"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":11,"currentCount":10,"removedCount":1,"statement":["SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?","get",["00000000-0000-4000-8000-000000000076","direct-message-1",41,0]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":9,"currentCount":6,"removedCount":3,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0],[\"00000000-0000-4000-8000-000000000047\",1,0],[\"00000000-0000-4000-8000-000000000068\",1,0],[\"00000000-0000-4000-8000-000000000070\",1,0]]","[[\"claude-code\",\"s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680\",\"direct-message-2\",\"user\",\"Synthetic direct Raw continuation source.\"]]"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","claude-code","s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680","s1:7ebaf8413187bcbcaf186544d9e685c825c53eb7ab4db1027450d4d21e63969d","direct-message-2"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT start,end,precision FROM raw_source_maps WHERE conversation_id=? AND message_id=? AND source_key=?","all",["00000000-0000-4000-8000-000000000076","direct-message-2","c26c63f1b85763433e8d1eeee4c82b765817b5d3654d5126422e4f9170988434"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":8,"currentCount":7,"removedCount":1,"statement":["SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=?","get",["00000000-0000-4000-8000-000000000076","direct-message-2"]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":11,"currentCount":10,"removedCount":1,"statement":["SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?","get",["00000000-0000-4000-8000-000000000076","direct-message-2",41,0]]},
  {"key":"workload:53","callIndex":122,"method":"openRawCaptureCore.captureRaw","archivedCount":1,"currentCount":0,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",1,0],[\"00000000-0000-4000-8000-000000000007\",2,0],[\"00000000-0000-4000-8000-000000000047\",1,0],[\"00000000-0000-4000-8000-000000000068\",1,0],[\"00000000-0000-4000-8000-000000000070\",1,0],[\"00000000-0000-4000-8000-000000000078\",1,0]]","[[\"claude-code\",\"s1:cdcc5945dfeaf5cb09e7d07198921b5863c08e499b92f38efe3b1f384835b680\",\"direct-message-2\",\"user\",\"Synthetic direct Raw continuation source.\"]]"]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":37,"currentCount":36,"removedCount":1,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":12,"currentCount":11,"removedCount":1,"statement":["SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'namespace','','') UNION ALL SELECT fact_id,match_mode,source_version,reason,message_key,span_start,span_end,epoch_hi,epoch_lo,0 AS ancestry,NULL AS ancestor_owner,NULL AS ancestor_scope,NULL AS ancestor_project,NULL AS message_id,NULL AS start,NULL AS end FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,?,?,?) ORDER BY ancestry,epoch_hi,epoch_lo,fact_id","iterate",["synthetic-off-owner","synthetic-off-owner","personal","","synthetic-off-owner","personal","","","",""]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",0,129]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000005\",2,0],[\"00000000-0000-4000-8000-000000000007\",3,0],[\"00000000-0000-4000-8000-000000000068\",1,0],[\"00000000-0000-4000-8000-000000000070\",1,0],[\"00000000-0000-4000-8000-000000000078\",2,0],[\"00000000-0000-4000-8000-000000000085\",1,0]]","[[\"synthetic\",\"off-session\",\"independent\",\"user\",\"Synthetic independent\"]]"]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?","all",["synthetic-off-owner","personal","",1,129]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":2,"currentCount":1,"removedCount":1,"statement":["SELECT r.*,CAST(r.created_at AS BLOB) AS receipt_created_at_bytes,CAST(r.id AS BLOB) AS receipt_id_bytes,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') AND (EXISTS (SELECT 1 FROM json_each(?) source WHERE client=json_extract(source.value,'$[0]') COLLATE BINARY AND session_id=json_extract(source.value,'$[1]') COLLATE BINARY AND event_id=json_extract(source.value,'$[2]') COLLATE BINARY AND role=json_extract(source.value,'$[3]') COLLATE BINARY AND excerpt=json_extract(source.value,'$[4]') COLLATE BINARY) OR instr(CAST(client AS BLOB),x'00')>0 OR instr(CAST(session_id AS BLOB),x'00')>0 OR instr(CAST(event_id AS BLOB),x'00')>0 OR instr(CAST(role AS BLOB),x'00')>0 OR instr(CAST(excerpt AS BLOB),x'00')>0) ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id","all",["[[\"00000000-0000-4000-8000-000000000047\",2,1]]","[[\"synthetic\",\"off-session\",\"independent\",\"user\",\"Synthetic independent\"]]"]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":11,"currentCount":9,"removedCount":2,"statement":["SELECT secret FROM episode_identity WHERE singleton=1","get",[]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","off-session"]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?","get",["synthetic-off-owner","personal","","synthetic","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889"]]},
  {"key":"workload:53","callIndex":137,"method":"admit","archivedCount":3,"currentCount":2,"removedCount":1,"statement":["SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?","all",["synthetic-off-owner","personal","","synthetic","off-session","s1:20c9d0c05c2aa475dd89cc1414801684f932e513f5debc83ff6780c35f35e889","independent"]]},
];

export function reviseSQL(key, statements, sqlRevisions = []) {
  for (const entry of sqlRevisions.filter(entry => entry.key === key)) {
    assert.equal(statements[entry.index]?.[0], entry.old, `archived SQL revision ${key}#${entry.index} matches the archive`);
    statements[entry.index] = [entry.new, ...statements[entry.index].slice(1)];
  }
}

// Recognize the purge family independently of hashes, so re-pinning the general
// trace hash cannot hide an extra/dropped purge in a clone without the archive.
// Full SQL, method and arguments are still compared against the ledger below.
export const purgeAdditionSQL = ([sql]) =>
  /^SELECT\b.*\bFROM sqlite_(?:master|schema)\b.*\bname\s*=\s*'(?:card_operations|card_memory_bindings)'/i.test(sql) ||
  /^SELECT\b.*\bFROM private_cards\b.*\bJOIN card_operations\b/i.test(sql) ||
  /^DELETE FROM card_operations\b/i.test(sql);

// This set describes source-forgetting calls, independently of the reviewed
// subset of methods carrying ledger rows in a particular workload.
export const forgettingMethods = new Set(['forget', 'deleteConversation', 'forgetEpisode', 'reject']);
const identifier = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[a-z_][a-z_0-9]*)';
const qualifiedIdentifier = `(${identifier}(?:\\s*\\.\\s*${identifier})?)`;
const cardTable = name => /^(?:private_cards|card_[a-z_]+)$/i.test(name);
const tableName = name => name.split(/\s*\.\s*/).at(-1).replace(/^["`\[]|["`\]]$/g, '');
const cardWrite = new RegExp(`\\b(?:(?:INSERT(?:\\s+OR\\s+\\w+)?|REPLACE)\\s+INTO|UPDATE(?:\\s+OR\\s+\\w+)?|DELETE\\s+FROM)\\s+${qualifiedIdentifier}`, 'i');
const schemaRead = new RegExp(`\\b(?:FROM|JOIN)\\s+${qualifiedIdentifier}`, 'gi');
const cardJoin = new RegExp(`\\bJOIN\\s+${qualifiedIdentifier}`, 'gi');
export function cardFamilySQL([sql, , bindings = []]) {
  const write = cardWrite.exec(sql);
  if (write && cardTable(tableName(write[1]))) return true;
  if (!/\bSELECT\b/i.test(sql)) return false;
  if ([...sql.matchAll(cardJoin)].some(match => tableName(match[1]).toLowerCase() === 'card_operations')) return true;
  return [...sql.matchAll(schemaRead)].some(match => /^sqlite_(?:master|schema)$/i.test(tableName(match[1]))) &&
    ([...sql.matchAll(/['"`]((?:private_cards|card_[a-z_]+))['"`]/gi)].length > 0 || bindings.some(value => typeof value === 'string' && cardTable(value)));
}

// Callers can replace the Card policy with reviewed exact-text fixture lists.
// Omitting policy preserves the original comparison and synthetic fixtures.
// Distinguish omission from an explicitly supplied empty policy object.
const defaultSqlAdditionPolicy = Object.freeze({});
const familyMethods = policy => policy.familyMethods ?? [...forgettingMethods];
const additionSQL = (row, policy) => policy.sqlTexts === undefined ? purgeAdditionSQL(row) : policy.sqlTexts.includes(row[0]);
const anchorSQLTexts = policy => policy === defaultSqlAdditionPolicy ? [
  'UPDATE memories SET content = NULL, deleted = 1, revision = revision + 1, updated_at = ? WHERE id = ?',
] : policy.anchorSQLTexts ?? [];
const anchorAfterSQLTexts = policy => policy.anchorAfterSQLTexts ?? [];
function assertAdditionAnchor(before, after, atCallEnd, policy, message) {
  const predecessor = anchorAfterSQLTexts(policy).includes(before);
  assert.ok(predecessor || (!atCallEnd && anchorSQLTexts(policy).includes(after)), message);
}

export function validateCardStatementTexts(texts = {}, entries = [], policy = defaultSqlAdditionPolicy) {
  assert.ok(texts && typeof texts === 'object' && !Array.isArray(texts), 'cardStatementTexts is a method map');
  const ledgerTexts = new Set(entries.map(entry => normalizeSQL(entry.statement[0])));
  for (const [method, list] of Object.entries(texts)) {
    assert.ok(familyMethods(policy).includes(method) && Array.isArray(list) && list.every(sql => typeof sql === 'string' && sql.length > 0),
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

export function archivedCardStatementTexts(archived, policy = defaultSqlAdditionPolicy) {
  checkCallRanges(archived);
  return Object.fromEntries(familyMethods(policy).map(method => [method, [...new Set(archived.calls
    .filter(call => call[0] === method && call.length === 4).flatMap(call => callStatements(archived, call))
    .filter(cardFamilySQL).map(([sql]) => sql))].sort()]));
}

// A single fixture list covers all workload traces, so the gate checks their
// archive union after comparing the individual traces. Pure comparisons default
// to checking their one supplied archive, including unused list entries.
export function assertArchivedCardStatementTexts(archives, texts = {}, entries = [], policy = defaultSqlAdditionPolicy) {
  validateCardStatementTexts(texts, entries, policy);
  assert.ok(archives.length > 0, 'archived card text comparison needs at least one trace');
  const observed = archives.map(archived => archivedCardStatementTexts(archived, policy));
  for (const method of familyMethods(policy)) assert.deepEqual(
    [...new Set(observed.flatMap(map => map[method]))].sort(), texts[method] ?? [],
    `${method} reviewed card texts equal the revised archive`);
}

// ordinal is one-based among ALL calls of method, including refusals; after is
// zero-based within that revised archived call. Allowed methods are fixture data.
// Entries sharing an anchor are inserted in ledger order. Probes are individual
// entries, never an optional allowance attached to another statement.
export function validateSqlAdditions(entries = [], sqlAdditionMethods = [], policy = defaultSqlAdditionPolicy) {
  for (const name of ['sqlTexts', 'familyMethods', 'anchorSQLTexts', 'anchorAfterSQLTexts']) if (Object.hasOwn(policy, name)) {
    const list = policy[name];
    assert.ok(Array.isArray(list) && list.every(value => typeof value === 'string' && value.length > 0 && value === normalizeSQL(value)),
      `${name} is an exact string list`);
    assert.equal(new Set(list).size, list.length, `${name} entries are unique`);
  }
  assert.ok(Array.isArray(entries), 'sqlAdditions is an array');
  if (entries.length && policy !== defaultSqlAdditionPolicy) {
    for (const name of ['sqlTexts', 'familyMethods'])
      assert.ok(Array.isArray(policy[name]) && policy[name].length > 0, `${name} must be non-empty for a non-empty ledger`);
    assert.ok(anchorSQLTexts(policy).length + anchorAfterSQLTexts(policy).length > 0,
      'at least one anchor list must be non-empty for a non-empty ledger');
  }
  assert.ok(Array.isArray(sqlAdditionMethods) && sqlAdditionMethods.every(method => typeof method === 'string' && method.trim() === method && method.length > 0),
    'sqlAdditionMethods is an explicit list of call methods');
  assert.equal(new Set(sqlAdditionMethods).size, sqlAdditionMethods.length, 'addition methods are listed once');
  for (const entry of entries) {
    assert.ok(entry && workloadKeys.includes(entry.key) && typeof entry.method === 'string' &&
      Number.isInteger(entry.ordinal) && entry.ordinal > 0 && !Object.hasOwn(entry, 'forget') &&
      Number.isInteger(entry.after) && entry.after >= 0, 'position-anchored workload addition');
    assert.ok(!Object.hasOwn(entry, 'atCallEnd') || typeof entry.atCallEnd === 'boolean', 'atCallEnd is an explicit boolean');
    assert.ok(sqlAdditionMethods.includes(entry.method), 'addition belongs to a reviewed call method');
    assert.ok(Number.isInteger(entry.reference) && entry.reference > 0 &&
      typeof entry.reason === 'string' && entry.reason.trim().length > 0 && !/[\r\n]/.test(entry.reason),
    'addition has a pull request number and a public reason');
    const row = entry.statement;
    assert.ok(Array.isArray(row) && row.length === 3 && typeof row[0] === 'string' && row[0] === normalizeSQL(row[0]) &&
      ['get', 'all', 'iterate', 'run', 'exec'].includes(row[1]) && Array.isArray(row[2]), 'full traced statement row');
    assert.ok(additionSQL(row, policy) && !receiptWalkSQL(row), 'only reviewed purge statements, never receipt exemptions');
  }
  const anchorEnds = new Map();
  for (const entry of entries) {
    const anchor = JSON.stringify([entry.key, entry.method, entry.ordinal, entry.after]);
    const atCallEnd = entry.atCallEnd === true;
    if (anchorEnds.has(anchor)) assert.equal(atCallEnd, anchorEnds.get(anchor),
      'entries sharing an after anchor must agree on atCallEnd');
    anchorEnds.set(anchor, atCallEnd);
  }
  assert.deepEqual([...new Set(entries.map(entry => entry.method))].sort(), [...sqlAdditionMethods].sort(),
    'reviewed methods are exactly those carrying additions across the workloads');
}

const compareAnchors = (a, b) => (a.method < b.method ? -1 : a.method > b.method ? 1 : 0) || a.ordinal - b.ordinal;
const orderedEntries = (key, entries) => entries.filter(entry => entry.key === key)
  .sort((a, b) => compareAnchors(a, b) || a.after - b.after);
const statementSummary = ([sql, method, bindings]) => [hash(sql), method, hash(bindings)];
const callStatements = (record, call) => record.statements.slice(call[2], call[3]);
function receiptWalkCallRows(key, index, method, rows, oldRows, records) {
  const exact = row => JSON.stringify(row);
  const counts = list => {
    const result = new Map();
    for (const row of list.filter(receiptWalkSQL)) {
      const triple = exact(row);
      result.set(triple, (result.get(triple) ?? 0) + 1);
    }
    return result;
  };
  const previous = counts(oldRows), current = counts(rows), allowed = new Set();
  for (const triple of new Set([...previous.keys(), ...current.keys()])) {
    const oldCount = previous.get(triple) ?? 0, count = current.get(triple) ?? 0;
    if (count === oldCount) continue;
    const entries = count > oldCount ? records.additions : records.removals;
    const entry = entries.find(entry => entry.key === key && entry.callIndex === index &&
      entry.method === method && exact(entry.statement) === triple);
    assert.ok(entry && oldCount === entry.archivedCount && count === entry.currentCount &&
      (count > oldCount || oldCount - count === entry.removedCount),
      `${key} call ${index} ${method} reviewed receipt row multiplicity: ${JSON.parse(triple)[0]} archive ${oldCount}, current ${count}`);
    allowed.add(triple);
  }
  // Only literal changed triples at this call may be removed/relocated.
  // Unchanged exempt rows still participate in exact sequence comparison.
  return list => list.filter(row => !allowed.has(exact(row)));
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

export function ledgerAdditionSummary(key, entries = [], sqlAdditionMethods = [], policy = defaultSqlAdditionPolicy) {
  validateSqlAdditions(entries, sqlAdditionMethods, policy);
  const calls = [];
  for (const entry of orderedEntries(key, entries)) {
    let call = calls.at(-1);
    if (!call || compareAnchors(call, entry)) calls.push(call = { method: entry.method, ordinal: entry.ordinal, statements: [] });
    call.statements.push(statementSummary(entry.statement));
  }
  return { callCount: calls.length, calls };
}

export function reconstructWideTrace(key, archived, entries = [], sqlAdditionMethods = [], policy = defaultSqlAdditionPolicy) {
  validateSqlAdditions(entries, sqlAdditionMethods, policy); checkCallRanges(archived);
  const wanted = orderedEntries(key, entries), insertions = new Map(), terminalGroups = new Map();
  const ordinals = new Map();
  let consumed = 0;
  for (const call of archived.calls) {
    const method = call[0], ordinal = (ordinals.get(method) ?? 0) + 1;
    ordinals.set(method, ordinal);
    for (const entry of wanted.filter(entry => entry.method === method && entry.ordinal === ordinal)) {
      assert.equal(call.length, 4, 'addition belongs to a traced call');
      assert.ok(entry.after < call[3] - call[2], `existing anchor for ${method} ${ordinal} after ${entry.after}`);
      const index = call[2] + entry.after;
      // Omitted policy still requires the canonical tombstone. A terminal group
      // needs explicit permission and a reviewed final archived predecessor.
      if (entry.atCallEnd) {
        assert.equal(index, call[3] - 1, 'call-end anchor is the last archived statement');
        terminalGroups.set(index, call[3]);
      }
      else assert.ok(index + 1 < call[3], 'purge anchor stays inside its call');
      assertAdditionAnchor(archived.statements[index][0], archived.statements[index + 1]?.[0], entry.atCallEnd, policy,
        'purge anchor matches a reviewed neighbour');
      const rows = insertions.get(index) ?? [];
      rows.push(entry.statement); insertions.set(index, rows); consumed++;
    }
  }
  assert.equal(consumed, wanted.length, 'every ledger entry consumed exactly once');
  // Opener probes are a separate, closed block: their transaction/read texts
  // must not enter the purge classifier used by currentAdditionSummary.
  // Indexes and counts refer to the archive, before any insertion. They use
  // the same insertion map and offset reconstruction as ordinary ledger rows.
  const probe = policy.openerProbes;
  if (probe) {
    const entries = probe.sqlAdditions.filter(entry => entry.key === key);
    const groups = new Map();
    for (const entry of entries) {
      const group = groups.get(entry.index) ?? [];
      group.push(entry); groups.set(entry.index, group);
    }
    const anchors = archived.statements.flatMap((row, index) => index > 0 &&
      JSON.stringify(row) === JSON.stringify(probe.anchorAfter) &&
      JSON.stringify(archived.statements[index - 1]) === JSON.stringify(probe.anchorBefore) ? [index] : []);
    if (Object.hasOwn(probe.counts, key)) {
      assert.equal(anchors.length, probe.counts[key], `${key} exact archived opener probe count`);
      assert.deepEqual([...groups.keys()], anchors, `${key} one probe at every archived opener`);
    } else assert.equal(entries.length, 0, 'no probe on an unlisted key');
    for (const group of groups.values()) {
      const entry = group[0];
      const call = archived.calls.filter(call => call[0] === entry.method)[entry.ordinal - 1];
      assert.ok(call && (call.length === 4 || call[0] === 'open' && call.length === 3), 'probe belongs to its literal opener call');
      const start = call.length === 4 ? call[2] : 0, end = call.at(-1);
      assert.equal(start + entry.after + 1, entry.index, 'probe anchor has its literal call-relative ordinal');
      assert.ok(entry.index > start && entry.index < end, 'probe stays inside its archived opener');
      assert.deepEqual(archived.statements[entry.index - 1], probe.anchorBefore, 'exact opener predecessor row');
      assert.deepEqual(archived.statements[entry.index], probe.anchorAfter, 'exact unchanged opener BEGIN row');
      assert.ok(!insertions.has(entry.index - 1), 'opener probe does not overlap another addition group');
      insertions.set(entry.index - 1, group.map(entry => entry.statement));
    }
  }
  const statements = [], offsets = [];
  archived.statements.forEach((row, index) => {
    offsets[index] = statements.length; statements.push(row, ...(insertions.get(index) ?? []));
  });
  offsets[archived.statements.length] = statements.length;
  const calls = archived.calls.map(call => call.map((value, index) => index >= 2 ? offsets[value] : value));
  for (const [index, end] of terminalGroups)
    assert.equal(offsets[index] + 1 + insertions.get(index).length, offsets[end], 'reconstructed call-end group closes its call');
  return { ...archived, statements, calls };
}

// This check needs only the current trace. Select the purge family over the
// entire trace, compare full rows in their reviewed calls, and reject leftovers.
// It also returns the precise positions to subtract for receipt count checks.
export function currentAdditionSummary(key, current, entries = [], sqlAdditionMethods = [], cardStatementTexts = {}, policy = defaultSqlAdditionPolicy) {
  validateSqlAdditions(entries, sqlAdditionMethods, policy); validateCardStatementTexts(cardStatementTexts, entries, policy); checkCallRanges(current);
  const wanted = orderedEntries(key, entries), positions = new Set(), listedPositions = new Set(), calls = [];
  const texts = new Set(entries.map(entry => entry.statement[0]));
  const isAddition = row => additionSQL(row, policy) || texts.has(row[0]);
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
      const listed = familyMethods(policy).includes(method) && (cardStatementTexts[method] ?? []).includes(statement[0]);
      if (listed) listedPositions.add(index);
      if (isAddition(statement) && (!listed || expected.some(entry => entry.statement[0] === statement[0]))) {
        rows.push(statement); positions.add(index); indices.push(index);
      }
    }
    if (rows.length) {
      assert.ok(sqlAdditionMethods.includes(method), `${method} carries purge SQL but is not a reviewed addition method`);
      if (familyMethods(policy).length) assert.ok(familyMethods(policy).includes(method), `${method} carries purge SQL outside a forgetting call`);
    }
    assert.deepEqual(rows, expected.map(entry => entry.statement), `${method} ${ordinal} has exactly its ledger rows and bindings`);
    // Match each anchor group as a contiguous block beside a reviewed neighbour.
    // Receipt batching can shift its absolute index within the call.
    for (let offset = 0; offset < expected.length;) {
      let end = offset + 1;
      while (end < expected.length && expected[end].after === expected[offset].after) end++;
      for (let i = offset + 1; i < end; i++) assert.equal(indices[i], indices[i - 1] + 1, 'current purge anchor group is contiguous');
      const first = indices[offset], next = indices[end - 1] + 1;
      const before = first > call[2] ? current.statements[first - 1][0] : undefined;
      for (const entry of expected.slice(offset, end)) {
        if (entry.atCallEnd) assert.equal(next, call[3], 'current purge anchor group closes its call');
        else assert.ok(next < call[3], 'current purge anchor stays inside its call');
        assertAdditionAnchor(before, next < call[3] ? current.statements[next][0] : undefined, entry.atCallEnd, policy,
          'current purge anchor matches a reviewed neighbour');
      }
      offset = end;
    }
    if (familyMethods(policy).includes(method)) for (let index = call[2]; index < call[3]; index++) {
      const statement = current.statements[index];
      // Known pins-mode limit: another copy of an already listed exact text
      // passes this classifier. Archive exact comparison and the workload SQL
      // hash still catch it; this reviewed list intentionally has no counts.
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
  assert.deepEqual(effect, ledgerAdditionSummary(key, entries, sqlAdditionMethods, policy), 'current additions have the ledger summary');
  return { effect, positions };
}

export function assertWidePins(key, current, entries, pinned, sqlAdditionMethods = [], cardStatementTexts = {}, policy = defaultSqlAdditionPolicy) {
  const actual = summary(current);
  const effect = currentAdditionSummary(key, current, entries, sqlAdditionMethods, cardStatementTexts, policy).effect;
  if (workloadKeys.includes(key)) {
    if (effect.callCount || Object.hasOwn(pinned ?? {}, 'sqlAdditions')) {
      actual.sqlAdditions = effect;
      assert.deepEqual(pinned?.sqlAdditions, ledgerAdditionSummary(key, entries, sqlAdditionMethods, policy), 'pins explicitly describe the ledger effect');
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

export function compareWideTraces({ key, current, archived, sqlAdditions = [], sqlAdditionMethods = [], cardStatementTexts = {}, checkArchivedCardTexts = true, receiptWalk = false, sqlAdditionPolicy = defaultSqlAdditionPolicy,
  receiptWalkRecords = { additions: receiptWalkSQLAdditions, removals: receiptWalkSQLRemovals } }) {
  validateCardStatementTexts(cardStatementTexts, sqlAdditions, sqlAdditionPolicy);
  if (checkArchivedCardTexts) assertArchivedCardStatementTexts([archived], cardStatementTexts, sqlAdditions, sqlAdditionPolicy);
  const reconstructed = reconstructWideTrace(key, archived, sqlAdditions, sqlAdditionMethods, sqlAdditionPolicy);
  const { positions } = currentAdditionSummary(key, current, sqlAdditions, sqlAdditionMethods, cardStatementTexts, sqlAdditionPolicy);
  assert.deepEqual(current.effectWitnesses, archived.effectWitnesses, 'complete effect witnesses, including rolled-back writes');
  compareWideTables(current.dump, archived.dump, []);
  if (!receiptWalk) {
    assert.equal(JSON.stringify(current.calls), JSON.stringify(reconstructed.calls), 'exact serialized calls and adjusted offsets');
    assert.deepEqual(current.statements, reconstructed.statements, 'exact reconstructed SQL sequence, including transactions');
  } else {
    assert.equal(JSON.stringify(current.calls.map(([method, result]) => [method, result])),
      JSON.stringify(archived.calls.map(([method, result]) => [method, result])), 'exact serialized calls and errors');
    assert.ok(current.statements.length - positions.size <= archived.statements.length, 'receipt batching only reduces SQL after removing ledger rows');
    const currentOutside = current.statements.map((row,index) => [index,row]);
    const reconstructedOutside = reconstructed.statements.map((row,index) => [index,row]);
    const currentCovered = new Set(), reconstructedCovered = new Set();
    for (const [index, call] of current.calls.entries()) {
      assert.equal(call.length, archived.calls[index]?.length, 'matching trace call shape');
      if (call.length !== 4) continue;
      const previous = archived.calls[index], expected = reconstructed.calls[index];
      const rows = callStatements(current, call), oldRows = callStatements(archived, previous);
      const additions = [...positions].filter(position => position >= call[2] && position < call[3]).length;
      assert.ok(rows.length - additions <= oldRows.length, call[0] + ' statement count cannot rise after removing exactly ledger rows');
      const retain = receiptWalkCallRows(key, index, call[0], rows, oldRows, receiptWalkRecords);
      assert.deepEqual(retain(rows), retain(callStatements(reconstructed, expected)), call[0] + ' reconstructed SQL and bindings');
      for(let at=call[2];at<call[3];at++)currentCovered.add(at);
      for(let at=expected[2];at<expected[3];at++)reconstructedCovered.add(at);
    }
    // Also pins opening/closing statements and SQL outside a recorded call.
    assert.deepEqual(currentOutside.filter(([at]) => !currentCovered.has(at)).map(([,row]) => row),
      reconstructedOutside.filter(([at]) => !reconstructedCovered.has(at)).map(([,row]) => row),
      'every execution outside recorded calls is exact, including receipt texts');
  }
  return reconstructed;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createCairnServer } from '../../adapters/mcp/server.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
const namespace = { ownerId:'synthetic-owner', scope:'personal', projectId:null };
const ok = value => { assert.equal(value.ok,true,JSON.stringify(value)); return value.value; };
test('default core and MCP reopen the original attested base-33 lineage package', async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path,'existing.sqlite');
  const child = spawnSync(process.execPath,[new URL('../testing/create-existing-safety-store.mjs',import.meta.url).pathname,path],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);
  const db = new DatabaseSync(path,{readOnly:true});
  assert.deepEqual({...db.prepare('SELECT base_layout,card_lineage_revision FROM content_safety_control').get()}, {base_layout:33,card_lineage_revision:1});
  assert.ok(db.prepare("SELECT sql FROM sqlite_schema WHERE name='raw_conversations'").get().sql.includes("CHECK(client IN ('claude-code','codex'))"));
  db.close();
  const core = openMemoryCore({raw:true,path}); await core.close();
  // The complete local privacy package survive exact attestation on a
  // read-only connection, and subsequent local opens never need a migration.
  const reader = new DatabaseSync(path,{readOnly:true});
  try {
    attestContentSafety(reader);
    assert.equal(reader.prepare("SELECT count(*) n FROM sqlite_schema WHERE sql IS NOT NULL AND name IN ('local_raw_hide_windows','local_raw_session_modes','local_raw_session_ranges','local_raw_range_overlap','local_raw_capture_session_events')").get().n,5);
  } finally { reader.close(); }
  const server = createCairnServer({path,namespace});
  try { assert.equal(await server.contextCounterReady,true); } finally { await server.close(); }
});
for(const damage of ['missing-table','missing-index','missing-uuid-table','missing-uuid-index','missing-uuid-trigger','missing-enqueue-trigger','altered-enqueue-trigger','altered-table','altered-index','extra-table','extra-trigger'])
test(`inherited attestation refuses damaged or extended local privacy package (${damage})`,async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'existing.sqlite');
  const child=spawnSync(process.execPath,[new URL('../testing/create-existing-safety-store.mjs',import.meta.url).pathname,path],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);
  const core=openMemoryCore({path,raw:true,rawSearch:false}); await core.close();
  const db=new DatabaseSync(path);
  try {
    db.exec({
      'missing-table':'DROP TABLE local_raw_session_modes',
      'missing-uuid-table':'DROP TABLE local_raw_uuid_fences',
      'missing-uuid-index':'DROP INDEX local_raw_uuid_pending',
      'missing-uuid-trigger':'DROP TRIGGER local_raw_uuid_delete_guard',
      'missing-enqueue-trigger':'DROP TRIGGER local_raw_uuid_fence_enqueue',
      'altered-enqueue-trigger':"DROP TRIGGER local_raw_uuid_fence_enqueue; CREATE TRIGGER local_raw_uuid_fence_enqueue AFTER INSERT ON raw_session_fences BEGIN SELECT 1; END",
      'missing-index':'DROP INDEX local_raw_capture_session_events',
      'altered-table':'ALTER TABLE local_raw_session_modes ADD COLUMN unexpected TEXT',
      'altered-index':'DROP INDEX local_raw_capture_session_events; CREATE INDEX local_raw_capture_session_events ON raw_capture_events(owner_id,event_id)',
      'extra-table':'CREATE TABLE local_raw_unreviewed(value TEXT)',
      'extra-trigger':'CREATE TRIGGER local_raw_unreviewed AFTER INSERT ON local_raw_session_modes BEGIN SELECT 1; END',
    }[damage]);
  } finally { db.close(); }
  const reader=new DatabaseSync(path,{readOnly:true});
  try { assert.throws(()=>attestContentSafety(reader),{code:'unsupported_database'}); }
  finally { reader.close(); }
  assert.throws(()=>openMemoryCore({path,raw:true}),{code:'unsupported_database'});
});
for (const contentSafety of [undefined,'s2h-v1']) test(`default retains supported clients and keeps other captures Memory-only (${contentSafety??'legacy'})`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path,'fresh.sqlite');
  const core = openMemoryCore({raw:true,path,model:rationaleModel(),...(contentSafety?{contentSafety}:{})});
  workspace.defer(()=>core.close());
  const db = new DatabaseSync(path); workspace.defer(()=>db.close());
  for (const client of ['claude-code','codex','synthetic-other']) {
    const captured = ok(await core.capture({namespace,client,sessionId:'session',eventId:client,
      messages:[{id:client,role:'user',content:'Synthetic telescope '+client}]}));
    assert.equal(captured.admission.memories.length,1);
    assert.equal(db.prepare('SELECT count(*) n FROM raw_conversations WHERE client=?').get(client).n,client==='synthetic-other'?0:1);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1').get().n,2);
});

test('the unshipped five-object local package is refused',async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'old-local.sqlite');
  const child=spawnSync(process.execPath,[new URL('../testing/create-existing-safety-store.mjs',import.meta.url).pathname,path],{encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);
  const {LOCAL_RAW_PRIVACY_DDL}=await import('../content-safety-schema.mjs');
  const db=new DatabaseSync(path);db.exec(LOCAL_RAW_PRIVACY_DDL.slice(0,5).join('\n'));
  assert.throws(()=>attestContentSafety(db),{code:'unsupported_database'});db.close();
  assert.throws(()=>openMemoryCore({path,raw:true}),{code:'unsupported_database'});
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createCairnServer } from '../../adapters/mcp/server.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
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
  const server = createCairnServer({path,namespace});
  try { assert.equal(await server.contextCounterReady,true); } finally { await server.close(); }
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

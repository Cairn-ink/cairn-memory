import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for(const file of ['local-host-import.mjs','local-transport-import.mjs'])test('P2-02 SQLite-free boundary '+file,t=>{
  const result=spawnSync(process.execPath,[new URL('../../integrations/client/test/fixtures/'+file,import.meta.url).pathname],{encoding:'utf8',env:{},timeout:30000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);t.diagnostic('SQLite-free child actual exit='+result.status);
});

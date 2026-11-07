import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync,readFileSync,readdirSync } from 'node:fs';
import { join,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('unmigrated authored reads/writes/capture have exact bytes, SQL and population against the engine baseline',t=>{
  const workspace=createTestWorkspace(t,{prefix:'lineage-off-diff-'}),baseline=join(workspace.path,'baseline');mkdirSync(baseline,{mode:0o700});
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-baseline.json',import.meta.url),'utf8'));
  assert.equal(fixture.revision,'fd5c59ef8e67cc58bb855a95f8910c668150bfa3');
  const available=spawnSync('git',['cat-file','-e',fixture.revision+'^{commit}'],{cwd:root,timeout:30000}).status===0;
  let old=fixture.record;
  const run=(source,name)=>{
    const child=spawnSync(process.execPath,[fileURLToPath(new URL('../testing/card-lineage-off-worker.mjs',import.meta.url)),source,join(workspace.path,name+'.sqlite')],
      {encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024});
    assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);
  };
  if(available) {
  const listed=spawnSync('git',['ls-tree','-r','--name-only','fd5c59ef','--','core','plugins/cairn-memory/lib'],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(listed.status,0,listed.stderr);
  const paths=listed.stdout.trim().split('\n').filter(path=>!/^core\/(test|testing)\//.test(path));
  const archive=spawnSync('git',['archive','fd5c59ef','--',...paths],{cwd:root,maxBuffer:64*1024*1024,timeout:30000});assert.equal(archive.status,0,String(archive.stderr));
  const unpack=spawnSync('tar',['-xC',baseline],{input:archive.stdout,timeout:30000});assert.equal(unpack.status,0,String(unpack.stderr));
  const actual=[];function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())walk(next);else actual.push(relative(baseline,next));}}walk(baseline);
  assert.deepEqual(actual.sort(),paths.sort(),'independent source archive inventories');
  old=run(baseline,'baseline');assert.deepEqual(old,fixture.record,'frozen baseline matches a direct run');
  }
  const current=run(root,'current');
  assert.equal(JSON.stringify(current.calls),JSON.stringify(old.calls),'serialized output bytes');
  assert.deepEqual(current.statements,old.statements,'exact executed SQL and BEGIN/COMMIT sequence');
  assert.deepEqual(current.dump,old.dump,'complete canonical population bytes');
  assert.equal(current.statements.some(([sql])=>/card_body_|card_lineage_revision/.test(sql)),false,'no lineage probes or migration');
  t.diagnostic(JSON.stringify({node:process.version,baseline:fixture.revision,directBaseline:available,calls:current.calls.length,statements:current.statements.length,tables:current.dump.length}));
});

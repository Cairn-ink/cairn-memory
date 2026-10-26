import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('E1M-10 E1M-11 final workflow inventory and SQLite-free local/CLI static closure',t=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  // Follow static imports only: SQLite-reaching dynamic imports remain lazy.
  const seen=new Set();
  function visit(path){
    if(seen.has(path))return;seen.add(path);
    const source=readFileSync(new URL('../../'+path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/from\s*['"]node:sqlite['"]|import\s*['"]node:sqlite['"]/,path);
    for(const match of source.matchAll(/(?:from\s*|import\s+)['"](\.[^'"]+\.mjs)['"]/g)) {
      const url=new URL(match[1],new URL('../../'+path,import.meta.url));
      visit(fileURLToPath(url).slice(root.length));
    }
  }
  for(const entry of ['adapters/mcp/cli.mjs','integrations/client/raw/local-transport.mjs','integrations/client/raw/local-worker.mjs','integrations/client/raw/local-host.mjs','adapters/local/cli.mjs'])visit(entry);
  for (const path of ['core/topic-members-input.mjs','core/topic-members-reader.mjs','core/topic-members-storage.mjs','core/topic-snapshot.mjs']) {
    assert.doesNotMatch(readFileSync(new URL('../../'+path,import.meta.url),'utf8'), /\bcreateRequire\b/);
  }
  const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
  const jobText=workflow.split('\njobs:\n')[1];
  const jobs=[...jobText.matchAll(/^  ([a-z][\w-]*):$/gm)].map(m=>m[1]);
  const runs=[...workflow.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map(m=>m[1]);
  const second=jobText.split('\n').filter(line=>line.startsWith('  ')&&!line.startsWith('   ')&&line.endsWith(':')).map(line=>line.trim().slice(0,-1));
  assert.deepEqual(jobs,second);
  assert.ok(runs.includes('npm run test:local-transport-import'));assert.ok(runs.includes('npm run test:local-host-import'));
  const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url)));
  assert.match(pkg.scripts['measure:topic-members'],/measure-topic-members\.mjs/);
  for(const name of ['test:core','test:mcp','test:artifact'])assert.doesNotMatch(pkg.scripts[name],/measure-topic-members/);
  t.diagnostic(JSON.stringify({runtime:process.version,jobs:jobs.length,runSteps:runs.length,jobInventory:jobs,runInventory:runs,staticModules:seen.size,
    fullMatrix:'primary queued acceptance required; this test inventories, never executes broad suites'}));
});

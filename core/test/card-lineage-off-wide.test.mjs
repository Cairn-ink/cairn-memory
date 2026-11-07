import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync,readFileSync,readdirSync } from 'node:fs';
import { join,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const revision='fd5c59ef8e67cc58bb855a95f8910c668150bfa3';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pins=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-wide-baseline.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const summary=record=>({calls:record.calls.map(([method,result,start,end])=>[method,hash(result),start??null,end??null]),
  statements:record.statements.length,sql:hash(record.statements),tables:record.dump.map(([name,rows])=>[name,rows.length,hash(rows)]),
  effectWitnesses:hash(record.effectWitnesses)});
const run=(source,path,mode,cell)=>{
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../testing/card-lineage-off-wide-worker.mjs',import.meta.url)),source,path,mode,String(cell)],
    {encoding:'utf8',timeout:120000,maxBuffer:64*1024*1024});
  assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);
};
function archive(workspace) {
  if(spawnSync('git',['cat-file','-e',revision+'^{commit}'],{cwd:root,timeout:30000}).status!==0)return null;
  const baseline=join(workspace,'baseline');mkdirSync(baseline,{mode:0o700});
  const listed=spawnSync('git',['ls-tree','-r','--name-only',revision,'--','core','plugins/cairn-memory/lib'],{cwd:root,encoding:'utf8',timeout:30000});
  assert.equal(listed.status,0,listed.stderr);
  const paths=listed.stdout.trim().split('\n').filter(path=>!/^core\/(test|testing)\//.test(path));
  const packed=spawnSync('git',['archive',revision,'--',...paths],{cwd:root,maxBuffer:64*1024*1024,timeout:30000});assert.equal(packed.status,0,String(packed.stderr));
  const unpack=spawnSync('tar',['-xC',baseline],{input:packed.stdout,timeout:30000});assert.equal(unpack.status,0,String(unpack.stderr));
  const actual=[];function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())walk(next);else actual.push(relative(baseline,next));}}walk(baseline);
  assert.deepEqual(actual.sort(),paths.sort(),'git tree versus independent archive walk');
  return {path:baseline,count:actual.length};
}
const extendedOnly=new Set(['importMethodVersion','checkMethodReasonRefs','getMethodVersion','adoptMethodVersion','resolveMethod','readMethodFile',
  'publishRoleProfileRelease','readRoleTaskContext','declareCardCurrentDependencies','revalidateCardCurrentDependencies',
  'listMethodManifest','listMethodPackages','listMethodVersions','compareMethodVersions','deleteMethodVersion','deleteMethodPackage',
  'listMethodEffects','getMethodPackageUsage','disableMethodBinding','resolveMethodsForRole','listMethodBindingEvents','readMethodAttachmentBytes',
  'deleteConversation','setRawCaptureControl','resolveSourceReferences']);
const added=['inspectCardOperation','revalidateEvidence','fetchCandidateEvidence','getContextIndexStatus','isSuppressed',
  'listMethodManifest','listMethodPackages','listMethodVersions','compareMethodVersions','deleteMethodVersion','deleteMethodPackage',
  'listMethodEffects','getMethodPackageUsage','disableMethodBinding','resolveMethodsForRole','listMethodBindingEvents','readMethodAttachmentBytes'];
for(const base of [23,33])for(const mode of ['open','workload'])for(const eventTime of [false,true]) {
  const cell=eventTime?(base===23?52:53):base,key=mode+':'+cell;
  test(`lineage-zero ${key}: opening, SQL, serialized results/errors and every table match the archived baseline`,async t=>{
    const workspace=createTestWorkspace(t,{prefix:'lineage-off-wide-'});
    const oldPath=join(workspace.path,'old.sqlite'),newPath=join(workspace.path,'new.sqlite');
    const baseline=archive(workspace.path),current=run(root,newPath,mode,cell),actual=summary(current);
    if(baseline) {
      const old=run(baseline.path,oldPath,mode,cell);
      assert.deepEqual(current.effectWitnesses,old.effectWitnesses,'complete observed effect rows, including rolled-back writes');
      assert.equal(JSON.stringify(current.calls),JSON.stringify(old.calls),'exact serialized calls and errors');
      assert.deepEqual(current.statements,old.statements,'executed SQL sequence, including opening');
      assert.deepEqual(current.dump,old.dump,'every table population');
      assert.deepEqual(summary(old),pins.records[key],'frozen pins come only from the archived baseline');
    }
    assert.equal(pins.revision,revision);assert.deepEqual(actual,pins.records[key]);
    assert.ok(current.statements.every(entry=>entry.length===3&&Array.isArray(entry[2])),'SQL execution includes bound arguments');
    assert.equal(current.statements.some(([sql])=>/card_body_|card_operations_owner_action/.test(sql)),false,'no extended lineage scan');
    if(mode==='workload') {
      const memory=current.dump.find(([name])=>name==='memories');assert.ok(memory[1].length>=3);
      assert.ok(current.statements.some(([, ,args])=>args.includes('synthetic-off-owner')),'populated SQL arguments are compared');
      for(const method of ['openMemoryReader.readTopicOverview','openContextProductReader','openContextIndexMaintainer']) {
        const record=current.calls.find(([name])=>name===method);
        assert.ok(record&&record[3]>record[2],method+' includes native Worker SQL');
      }
      for(const method of new Set([...pins.coverage,...added])) {
        if(base===23&&extendedOnly.has(method)||cell<52&&method==='isSuppressed')continue;
        assert.ok(current.calls.some(([name,result])=>name.split('.').at(-1)===method&&
        (result.ok||cell===53&&method==='publishRoleProfileRelease'&&result.error?.code==='evidence_unavailable')),method+' baseline outcome');
      }
      for(const opener of ['openMemoryReader','openContextReader','openContextProductReader','openContextIndexMaintainer',
        'openContentSuppressionReader',...(base===33?['openRawCaptureCore']:[])])assert.ok(current.calls.some(([name,result])=>name===opener&&
          (result.ok||cell<52&&opener==='openContentSuppressionReader'&&result.thrown?.code==='unsupported_database')),opener+' direct baseline outcome');
      assert.ok(current.calls.some(([,result])=>result.error?.code==='action_conflict'));
      assert.ok(current.calls.some(([,result])=>result.error?.code==='revision_conflict'));
      assert.ok(current.calls.filter(([name])=>name==='capture').length>=2,'capture replay');
      if(base===33)assert.ok(current.calls.filter(([name])=>name==='declareCardCurrentDependencies').length>=2,'mutation replay');
      for(const method of ['contextRead',...(base===33?['readRoleTaskContext']:[])]) {
        const result=current.calls.find(([name])=>name===method)[1].value;
        assert.ok((result.metered.items??result.metered.evidence).length>0,method+' serves real evidence');
      }
    }
    t.diagnostic(JSON.stringify({node:process.version,cell,mode,directBaseline:Boolean(baseline),archiveFiles:baseline?.count??null,
      calls:current.calls.length,statements:current.statements.length,tables:current.dump.length}));
  });
}

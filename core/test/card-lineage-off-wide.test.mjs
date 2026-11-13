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
const receiptWalkPins=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-wide-receipt-walk.json',import.meta.url),'utf8'));
// Match the whitespace-only normalization used by the SQL trace recorder.
const normalizeSQL=sql=>sql.replace(/\s+/g,' ').trim();
// Exact texts observed in the listed cells, including the archived batch variant.
// Seek and overflow pages are not observed here and receive no exemption.
const receiptWalkSQLTexts=new Set([
  "SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ORDER BY updated_at DESC,id LIMIT ?",
  "SELECT r.*, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id",
  "SELECT r.*, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r INDEXED BY memory_receipts ON r.memory_id=json_extract(wanted.value,'$[0]') LIMIT 5",
]);
const receiptWalkSQL=([sql])=>receiptWalkSQLTexts.has(normalizeSQL(sql));
const observedReceiptWalkSQL=new Set();
const observeReceiptWalkSQL=statements=>{
  for(const row of statements)if(receiptWalkSQL(row)) {
    const sql=normalizeSQL(row[0]);
    assert.ok(receiptWalkSQLTexts.has(sql),'every exempt SQL text is explicitly listed');
    observedReceiptWalkSQL.add(sql);
  }
};
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
// Each sqlRevisions entry is an intended, reviewed SQL text change against the archived revision. It replaces only the
// SQL text of one archived statement; method and bound arguments are never substituted. Delete the list when `revision` advances.
const sqlRevisions=pins.sqlRevisions??[],workloadKeys=[23,33,52,53].map(cell=>'workload:'+cell);
test('archived SQL revisions name only workload keys and revise each statement once',()=>{
  for(const entry of sqlRevisions)assert.ok(workloadKeys.includes(entry.key)&&Number.isInteger(entry.index)&&
    typeof entry.old==='string'&&typeof entry.new==='string'&&entry.old!==entry.new,JSON.stringify(entry.key)+' revision entry');
  assert.equal(new Set(sqlRevisions.map(({key,index})=>key+'#'+index)).size,sqlRevisions.length,'no statement revised twice');
});
const revise=(key,statements)=>{
  for(const entry of sqlRevisions.filter(entry=>entry.key===key)) {
    assert.equal(statements[entry.index]?.[0],entry.old,`archived SQL revision ${key}#${entry.index} matches the archive`);
    statements[entry.index]=[entry.new,...statements[entry.index].slice(1)];
  }
};
for(const base of [23,33])for(const mode of ['open','workload'])for(const eventTime of [false,true]) {
  const cell=eventTime?(base===23?52:53):base,key=mode+':'+cell;
  test(`lineage-zero ${key}: opening, SQL, serialized results/errors and every table match the archived baseline`,async t=>{
    const workspace=createTestWorkspace(t,{prefix:'lineage-off-wide-'});
    const oldPath=join(workspace.path,'old.sqlite'),newPath=join(workspace.path,'new.sqlite');
    const baseline=archive(workspace.path),current=run(root,newPath,mode,cell),actual=summary(current);
    if(receiptWalkPins.records[key])observeReceiptWalkSQL(current.statements);
    if(baseline) {
      const old=run(baseline.path,oldPath,mode,cell);revise(key,old.statements);
      assert.deepEqual(current.effectWitnesses,old.effectWitnesses,'complete observed effect rows, including rolled-back writes');
      if(receiptWalkPins.records[key]) {
        observeReceiptWalkSQL(old.statements);
        assert.equal(JSON.stringify(current.calls.map(([method,result])=>[method,result])),
          JSON.stringify(old.calls.map(([method,result])=>[method,result])),'exact serialized calls and errors');
        assert.ok(current.statements.length<=old.statements.length,'receipt batching only reduces SQL');
        for(const [i,call] of current.calls.entries())if(call.length===4) {
          const previous=old.calls[i];
          assert.ok(call[3]-call[2]<=previous[3]-previous[2],call[0]+' statement count cannot rise');
        }
        assert.deepEqual(current.statements.filter(row=>!receiptWalkSQL(row)),old.statements.filter(row=>!receiptWalkSQL(row)),
          'every SQL execution and binding outside receipt enumeration, including all transactions');
      } else {
        assert.equal(JSON.stringify(current.calls),JSON.stringify(old.calls),'exact serialized calls and errors');
        assert.deepEqual(current.statements,old.statements,'executed SQL sequence, including opening');
      }
      assert.deepEqual(current.dump,old.dump,'every table population');
      assert.deepEqual(summary(old),pins.records[key],'frozen pins come only from the archived baseline');
    }
    assert.equal(pins.revision,revision);assert.deepEqual(actual,receiptWalkPins.records[key]??pins.records[key]);
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

test('receipt enumeration exemptions are a closed set over the listed traces',t=>{
  assert.deepEqual([...observedReceiptWalkSQL].sort(),[...receiptWalkSQLTexts].sort(),
    'every listed SQL text occurs in the listed cells; no dead exemptions');
  for(const sql of receiptWalkSQLTexts) {
    assert.equal(receiptWalkSQL([sql+' AND 1=1']),false,'an extended SQL text is not exempt');
    assert.equal(receiptWalkSQL(['EXPLAIN '+sql]),false,'a containing SQL text is not exempt');
  }
  t.diagnostic(JSON.stringify({exactReceiptEnumerationTexts:receiptWalkSQLTexts.size,
    observedReceiptEnumerationTexts:observedReceiptWalkSQL.size}));
});

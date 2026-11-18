import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync,readFileSync,readdirSync } from 'node:fs';
import { join,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { transaction } from '../database.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { validateOpenerData, assertArchivedOpeners, currentOpenerPins, assertCurrentOpenerCensus } from '../testing/card-lineage-off-wide-opener.mjs';
import * as receiptComparison from '../testing/card-lineage-off-wide-compare.mjs';
import { normalizeSQL, summary, currentReceiptWalkSQLTexts, receiptWalkSQLTexts, receiptWalkSQL, receiptWalkSQLAdditions,
  workloadKeys, validateSqlAdditions, reviseSQL, compareWideTraces, assertWidePins, validateCardStatementTexts, assertArchivedCardStatementTexts, wideArchiveMode } from '../testing/card-lineage-off-wide-compare.mjs';

const revision='c02e5135fad9ea449047e5b6325726f55c248864';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pins=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-wide-baseline.json',import.meta.url),'utf8'));
const receiptWalkPins=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-wide-receipt-walk.json',import.meta.url),'utf8'));
const openerPins=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-wide-opener.json',import.meta.url),'utf8'));
const observedReceiptWalkSQL={current:new Set(),archived:new Set()};
let archivedReceiptWalkTraces=0;
const revisedArchives=[];
let archiveAvailable=true;
const requireArchive=process.env.CAIRN_REQUIRE_WIDE_ARCHIVE;
const observeReceiptWalkSQL=(statements,trace)=>{
  for(const row of statements)if(receiptWalkSQL(row)) {
    const sql=normalizeSQL(row[0]);
    assert.ok(receiptWalkSQLTexts.has(sql),'every exempt SQL text is explicitly listed');
    observedReceiptWalkSQL[trace].add(sql);
  }
};
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
  const paths=listed.stdout.trim().split('\n').filter(path=>path&&!/^core\/(test|testing)\//.test(path));
  assert.ok(paths.length,'archive contains source files');
  const packed=spawnSync('git',['archive',revision,'--',...paths],{cwd:root,maxBuffer:64*1024*1024,timeout:30000});assert.equal(packed.status,0,String(packed.stderr));
  const unpack=spawnSync('tar',['-xC',baseline],{input:packed.stdout,timeout:30000});assert.equal(unpack.status,0,String(unpack.stderr));
  const actual=[];function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())walk(next);else actual.push(relative(baseline,next));}}walk(baseline);
  assert.deepEqual(actual.sort(),paths.sort(),'git tree versus independent archive walk');
  return {path:baseline,count:actual.length};
}
function availableArchive(workspace,t) {
  try { return archive(workspace); }
  catch(error) {
    t.diagnostic('Archive could not be read: '+error.message);
    return null;
  }
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
const sqlRevisions=[...(pins.sqlRevisions??[]),...openerPins.sqlRevisions],sqlAdditions=pins.sqlAdditions??[],sqlAdditionMethods=pins.sqlAdditionMethods??[],cardStatementTexts=pins.cardStatementTexts??{};
const sqlAdditionPolicy={...(pins.sqlAdditionPolicy??{sqlTexts:[],familyMethods:[],anchorSQLTexts:[],anchorAfterSQLTexts:[]}),openerProbes:openerPins.openerProbes};
const receiptRecord=(rows,index=0,method='capture')=>({statements:rows,dump:[],effectWitnesses:[],
  calls:[...Array.from({length:index},()=>['synthetic',{ok:true}]),[method,{ok:true},0,rows.length]]});
const compareReceiptRecords=(key,current,archived)=>{
  assertWidePins(key,current,[],summary(current),[],{},sqlAdditionPolicy);
  compareWideTraces({key,current,archived,receiptWalk:true,checkArchivedCardTexts:false,sqlAdditionPolicy});
};
test('wide gate literal policy rejects the synthetic ledger receipt reduction',()=>{
  const row=[[...currentReceiptWalkSQLTexts][0],'all',['synthetic-owner','personal','',0,10]];
  assert.throws(()=>compareReceiptRecords('workload:52',receiptRecord([row],2,'read'),
    receiptRecord([row,row],2,'read')), {code:'ERR_ASSERTION',message:/reviewed receipt row multiplicity: .* archive 2, current 1/});
});
for(const mutation of ['deletion','reordering'])
test(`unrelated receipt rows reject ${mutation} with replacement pins`,()=>{
  const schema=[...receiptWalkSQLTexts].find(sql=>sql.startsWith('SELECT schema_version AS cookie'));
  const attestation=[schema,'get',[]],select=['SELECT 1','get',[]];
  const archived=receiptRecord([attestation,select],0,'getCard');
  const rows=mutation==='deletion'?[select]:[select,attestation];
  assert.throws(()=>compareReceiptRecords('workload:53',receiptRecord(rows,0,'getCard'),archived));
});
test('a listed receipt removal with the wrong multiplicity rejects replacement pins',()=>{
  const entry={"key":"workload:52","callIndex":1,"method":"capture","archivedCount":135,"currentCount":132,"removedCount":3,"statement":["SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest,receipt_event_time) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version","get",[]]};
  const {key,callIndex,method,statement,archivedCount,currentCount}=entry;
  const make=count=>Array.from({length:count},()=>statement);
  assert.throws(()=>compareReceiptRecords(key,receiptRecord(make(currentCount+1),callIndex,method),
    receiptRecord(make(archivedCount),callIndex,method)));
});
test('reviewed receipt rows are bounded per call even with matching replacement pins',()=>{
  const spare=[...receiptWalkSQLTexts][0];
  for(const sql of receiptWalkSQLTexts) {
    const row=[sql,'all',['synthetic','original']];
    const archived=receiptRecord([row,...Array.from({length:3},()=>[spare,'get',['spare']])]);
    for(const added of [row,[sql,'all',['synthetic','changed']],[sql,'get',row[2]]])
      assert.throws(()=>compareReceiptRecords('workload:53',receiptRecord([row,added]),archived),/reviewed receipt row multiplicity/);
  }
  const removals=receiptComparison.receiptWalkSQLRemovals;
  assert.equal(removals.reduce((n,row)=>n+row.removedCount,0),142,'140 removed rows plus two explicit relocations');
  for(const entry of receiptWalkSQLAdditions) {
    const {key,callIndex,method,statement}=entry;
    const entries=[...removals,...receiptWalkSQLAdditions].filter(row=>row.key===key&&row.callIndex===callIndex&&row.method===method);
    const make=field=>entries.flatMap(row=>Array.from({length:row[field]},()=>row.statement));
    const archived=receiptRecord(make('archivedCount'),callIndex,method),current=make('currentCount');
    compareReceiptRecords(key,receiptRecord(current,callIndex,method),archived);
    for(const added of [statement,[statement[0],statement[1],[...statement[2],'changed']]])
      assert.throws(()=>compareReceiptRecords(key,receiptRecord([...current,added],callIndex,method),archived),/reviewed receipt row multiplicity/);
  }
});
test('reviewed SQL additions have explicit workload, allowed call method, ordinal, anchor and full statement rows',()=>{
  validateOpenerData(openerPins);
  validateSqlAdditions(sqlAdditions,sqlAdditionMethods,sqlAdditionPolicy);validateCardStatementTexts(cardStatementTexts,sqlAdditions,sqlAdditionPolicy);
});
test('archived SQL revisions name workload keys or exactly the reviewed open:52/open:53 BEGIN and revise each statement once',()=>{
  for(const entry of sqlRevisions)assert.ok((workloadKeys.includes(entry.key)||
    ['open:52','open:53'].includes(entry.key)&&entry.index===1&&entry.old==='BEGIN IMMEDIATE'&&entry.new==='BEGIN')&&Number.isInteger(entry.index)&&
    typeof entry.old==='string'&&typeof entry.new==='string'&&entry.old!==entry.new,JSON.stringify(entry.key)+' revision entry');
  assert.equal(new Set(sqlRevisions.map(({key,index})=>key+'#'+index)).size,sqlRevisions.length,'no statement revised twice');
});
for(const base of [23,33])for(const mode of ['open','workload'])for(const eventTime of [false,true]) {
  const cell=eventTime?(base===23?52:53):base,key=mode+':'+cell;
  test(`lineage-zero ${key}: opening, SQL, serialized results/errors and every table match the archived baseline`,async t=>{
    const workspace=createTestWorkspace(t,{prefix:'lineage-off-wide-'});
    const oldPath=join(workspace.path,'old.sqlite'),newPath=join(workspace.path,'new.sqlite');
    const baseline=availableArchive(workspace.path,t),current=run(root,newPath,mode,cell);
    archiveAvailable &&= Boolean(baseline);
    if(receiptWalkPins.records[key])observeReceiptWalkSQL(current.statements,'current');
    await t.test('archived baseline comparison',t=>{
      if(wideArchiveMode(Boolean(baseline),requireArchive)==='pins') {
        t.skip('archive revision not available');return;
      }
      const old=run(baseline.path,oldPath,mode,cell);
      assertArchivedOpeners(key,old,openerPins);
      // Frozen summaries describe the untouched archive, before revisions or additions.
      if(receiptWalkPins.records[key]) {
        observeReceiptWalkSQL(old.statements,'archived');archivedReceiptWalkTraces++;
        assert.deepEqual(summary(old),pins.records[key],'receipt cells retain their frozen archived pins');
      } else if(workloadKeys.includes(key)) {
        assertWidePins(key,old,sqlAdditions,pins.records[key],sqlAdditionMethods,cardStatementTexts,sqlAdditionPolicy);
      } else {
        assert.deepEqual(summary(old),pins.records[key],'frozen opening pins come only from the archived baseline');
      }
      reviseSQL(key,old.statements,sqlRevisions);
      if(workloadKeys.includes(key))revisedArchives.push(old);
      const reconstructed=compareWideTraces({key,current,archived:old,sqlAdditions,sqlAdditionMethods,cardStatementTexts,sqlAdditionPolicy,checkArchivedCardTexts:false,receiptWalk:Boolean(receiptWalkPins.records[key])});
      if(!receiptWalkPins.records[key])assertWidePins(key,reconstructed,sqlAdditions,currentOpenerPins(key,pins.records[key],openerPins),sqlAdditionMethods,cardStatementTexts,sqlAdditionPolicy);
    });
    assert.equal(pins.revision,revision);assertWidePins(key,current,sqlAdditions,receiptWalkPins.records[key]??currentOpenerPins(key,pins.records[key],openerPins),sqlAdditionMethods,cardStatementTexts,sqlAdditionPolicy);
    assertCurrentOpenerCensus(key,current,openerPins);
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

test('filter-off receipt batch is an exact current exemption',async t=>{
  const f=eventTimeSafetyFixture(t,33);await f.migrate();
  const db=f.connect();t.after(()=>db.close());
  const namespace={ownerId:'synthetic-owner',scope:'project',projectId:'synthetic-project'};
  db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES('parent',?,?,?,'parent','Synthetic','fact','explicit',1,1,0,'time','time')`)
    .run(namespace.ownerId,namespace.scope,namespace.projectId);
  const statements=[],prepare=db.prepare.bind(db);
  const hook=t.mock.method(db,'prepare',sql=>{statements.push([normalizeSQL(sql)]);return prepare(sql);});
  try {
    transaction(db,()=>createRawLineageStorage(db).assertReceipts(namespace,[{
      client:'synthetic',sessionId:'session',eventId:'event',role:'user',excerpt:'\uFFFD',
    }]));
  } finally {hook.mock.restore();}
  const batches=statements.filter(([sql])=>sql.includes('FROM json_each(?) wanted CROSS JOIN receipts'));
  assert.equal(batches.length,1);assert.equal(batches[0][0],"SELECT r.*,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id");
  observeReceiptWalkSQL(statements,'current');
});

test('receipt enumeration exemptions are a closed set over the listed traces',t=>{
  // The current code's texts are required in every mode, and it emits no other exempt text.
  assert.deepEqual([...observedReceiptWalkSQL.current].sort(),[...currentReceiptWalkSQLTexts].sort(),
    'the current trace emits exactly the listed current texts');
  // The archived variant is required only when the archived baseline ran for the listed cells.
  if(archivedReceiptWalkTraces)
    assert.deepEqual([...new Set([...observedReceiptWalkSQL.current,...observedReceiptWalkSQL.archived])].sort(),[...receiptWalkSQLTexts].sort(),
      'every listed SQL text occurs in the listed cells; no dead exemptions');
  else assert.equal(observedReceiptWalkSQL.archived.size,0,'no archived trace without the archived baseline');
  for(const sql of receiptWalkSQLTexts) {
    assert.equal(receiptWalkSQL([sql+' AND 1=1']),false,'an extended SQL text is not exempt');
    assert.equal(receiptWalkSQL(['EXPLAIN '+sql]),false,'a containing SQL text is not exempt');
  }
  t.diagnostic(JSON.stringify({exactReceiptEnumerationTexts:receiptWalkSQLTexts.size,archivedReceiptWalkTraces,
    observedCurrentTexts:observedReceiptWalkSQL.current.size,observedArchivedTexts:observedReceiptWalkSQL.archived.size}));
});

test('reviewed card statement texts equal the union of revised archived forgetting calls',t=>{
  if(wideArchiveMode(archiveAvailable,requireArchive)==='pins') {
    t.skip('archive revision not available');return;
  }
  assert.equal(revisedArchives.length,workloadKeys.length,'all four archived workloads were read');
  assertArchivedCardStatementTexts(revisedArchives,cardStatementTexts,sqlAdditions,sqlAdditionPolicy);
});

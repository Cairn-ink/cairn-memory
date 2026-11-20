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
import { normalizeSQL, summary, currentReceiptWalkSQLTexts, receiptWalkSQLTexts, receiptWalkSQL,
  workloadKeys, withoutDeliveryLookups, validateSqlAdditions, reviseSQL, reconstructWideTrace, compareWideTraces, assertWidePins, validateCardStatementTexts, assertArchivedCardStatementTexts, wideArchiveMode } from '../testing/card-lineage-off-wide-compare.mjs';

const revision='fd5c59ef8e67cc58bb855a95f8910c668150bfa3';
const root=fileURLToPath(new URL('../../',import.meta.url));
const pins=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-wide-baseline.json',import.meta.url),'utf8'));
const deliveryLookups=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-delivery-lookups.json',import.meta.url),'utf8'));
const receiptWalkPins=JSON.parse(readFileSync(new URL('./fixtures/card-lineage-off-wide-receipt-walk.json',import.meta.url),'utf8'));
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
const retirementNamespace = ['synthetic-off-owner', 'personal', ''];
const retirementFingerprints = [
  ['rs1:i:44f06a5fc679ca4284fcf7f7aaa35474d39c8ce3d7e9d40ef481108c20b7fd22',
    'rs1:a:b7fef572a437c4b32968ab906956ec815c30b6d81b31464eedf95bc2cb198595'],
  ['rs1:i:594db1f8830afffaf6fc3d157c904572980f50afa4e4575e0743396fe747d762',
    'rs1:a:f9875cd62ec0059ae2e85e2b7fd4628ba13e8eb23ad4a10a6ef9564d36422c19'],
  ['rs1:i:706977ea8759e9e9fabed9f91cbc932168ca8e9ac1eaca733c3bc72025a5c54b',
    'rs1:a:fd26e4021854b04ecff25e655d80800ce75f54544196c4cf4bf4176e0c5331d2'],
];
const markerInsert = 'INSERT OR IGNORE INTO suppressed(owner_id,scope,project_id,fingerprint) SELECT ?,?,?,value FROM json_each(?)';
const archivedReceiptIds = id => ['SELECT id FROM receipts WHERE memory_id=?', 'all', [id]];
const scopedReceiptSnapshot = id => [
  'SELECT r.id,r.receipt_key,r.client,r.session_id,r.event_id,r.role FROM memories m JOIN receipts r ON r.memory_id=m.id WHERE m.id=? AND (m.owner_id,m.scope,m.project_id)=(?,?,?)',
  'all', [id, ...retirementNamespace],
];
const receiptSnapshot = id => ['SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=?', 'all', [id]];
// Indices refer to the current trace for inserts and the revised archive
// for receipt reads. Only marker writes and their exact persisted rows
// leave the current trace. Every current receipt read is compared in place.
const retirementReviews = {
  'workload:23': {
    inserts: [3431, 3547, 3603], persisted: [0, 1, 2],
    reads: [
      [3430, null, scopedReceiptSnapshot("00000000-0000-4000-8000-000000000003")],
      [3544, null, scopedReceiptSnapshot("00000000-0000-4000-8000-000000000003")],
      [3594, null, scopedReceiptSnapshot("00000000-0000-4000-8000-000000000041")],
    ],
  },
  'workload:33': {
    inserts: [10518, 10757, 10872], persisted: [0, 1, 2],
    reads: [],
  },
  'workload:52': {
    inserts: [6447, 6941, 7169], persisted: [0, 2],
    reads: [
      [6456, archivedReceiptIds("00000000-0000-4000-8000-000000000005"), scopedReceiptSnapshot("00000000-0000-4000-8000-000000000005")],
      [6626, null, receiptSnapshot("00000000-0000-4000-8000-000000000005")],
      [6948, archivedReceiptIds("00000000-0000-4000-8000-000000000005"), scopedReceiptSnapshot("00000000-0000-4000-8000-000000000005")],
      [7173, archivedReceiptIds("00000000-0000-4000-8000-000000000051"), scopedReceiptSnapshot("00000000-0000-4000-8000-000000000051")],
    ],
  },
  'workload:53': {
    inserts: [17467, 18177, 18514], persisted: [0, 2],
    reads: [
      [17502, archivedReceiptIds("00000000-0000-4000-8000-000000000005"), null],
      [17743, null, receiptSnapshot("00000000-0000-4000-8000-000000000005")],
      [18212, archivedReceiptIds("00000000-0000-4000-8000-000000000005"), null],
      [18549, archivedReceiptIds("00000000-0000-4000-8000-000000000087"), null],
    ],
  },
};

function editTraceStatements(record, edits) {
  const byIndex = new Map(edits.map(([index, before, after]) => [index, { before, after }]));
  assert.equal(byIndex.size, edits.length, 'reviewed positions are unique');
  const statements = [], offsets = [];
  for (const [index, row] of record.statements.entries()) {
    offsets.push(statements.length);
    const edit = byIndex.get(index);
    if (edit) {
      if (edit.before) assert.deepEqual(row, edit.before, 'exact reviewed retirement statement and bindings');
      if (edit.after) statements.push(edit.after);
      if (!edit.before) statements.push(row);
      byIndex.delete(index);
    } else {
      statements.push(row);
    }
  }
  assert.equal(byIndex.size, 0, 'all reviewed retirement statements are accounted for');
  offsets.push(statements.length);
  const calls = record.calls.map(call => call.map((value, index) => index < 2 ? value : offsets[value]));
  return { record: { ...record, statements, calls }, offsets };
}

function projectRetirementMarkers(current, review) {
  const edits = review.inserts.map((index, batch) => [
    index, [markerInsert, 'run', [...retirementNamespace, JSON.stringify(retirementFingerprints[batch])]], null,
  ]);
  const [owner_id, scope, project_id] = retirementNamespace;
  const markerRows = new Set(review.persisted.flatMap(batch => retirementFingerprints[batch].map(fingerprint =>
    JSON.stringify({ owner_id, scope, project_id, fingerprint }))));
  const { record } = editTraceStatements(current, edits);
  const dump = record.dump.map(([table, rows]) => {
    if (table !== 'suppressed') return [table, rows];
    const remaining = rows.filter(row => !markerRows.has(row));
    assert.equal(rows.length - remaining.length, markerRows.size, 'exact persisted retirement markers');
    return [table, remaining];
  });
  return { ...record, dump };
}

function alignArchivedReceiptReads(key, archived, reads) {
  if (reads.length === 0) return { record: archived, additions: sqlAdditions };
  const { record, offsets } = editTraceStatements(archived, reads);
  const additions = sqlAdditions.map(entry => {
    if (entry.key !== key) return entry;
    const call = archived.calls.filter(([method]) => method === entry.method)[entry.ordinal - 1];
    const anchor = call[2] + entry.after;
    const moved = offsets[anchor + 1] - 1;
    assert.deepEqual(record.statements[moved], archived.statements[anchor], 'reviewed purge anchor retains its full row');
    return { ...entry, after: moved - offsets[call[2]] };
  });
  return { record, additions };
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
const sqlRevisions=pins.sqlRevisions??[],sqlAdditions=pins.sqlAdditions??[],sqlAdditionMethods=pins.sqlAdditionMethods??[],cardStatementTexts=pins.cardStatementTexts??{};
const cardStatementExecutions=pins.cardStatementExecutions;
test('reviewed SQL additions have explicit workload, allowed call method, ordinal, anchor and full statement rows',()=>{
  validateSqlAdditions(sqlAdditions,sqlAdditionMethods);validateCardStatementTexts(cardStatementTexts,sqlAdditions);
});
test('archived SQL revisions name only workload keys and revise each statement once',()=>{
  for(const entry of sqlRevisions)assert.ok(workloadKeys.includes(entry.key)&&Number.isInteger(entry.index)&&
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
    const review = retirementReviews[key];
    const currentPin = pins.currentRecords?.[key] ?? receiptWalkPins.records[key] ?? pins.records[key];
    if(receiptWalkPins.records[key])observeReceiptWalkSQL(current.statements,'current');
    await t.test('archived baseline comparison',t=>{
      if(wideArchiveMode(Boolean(baseline),requireArchive)==='pins') {
        t.skip('archive revision not available');return;
      }
      const old=run(baseline.path,oldPath,mode,cell);reviseSQL(key,old.statements,sqlRevisions);
      if(workloadKeys.includes(key))revisedArchives.push(old);
      const originalStatements = withoutDeliveryLookups(current, deliveryLookups[key] ?? []);
      const comparison = review ? projectRetirementMarkers(originalStatements, review) : originalStatements;
      const aligned = review ? alignArchivedReceiptReads(key, old, review.reads) : { record: old, additions: sqlAdditions };
      compareWideTraces({key,current:comparison,archived:aligned.record,sqlAdditions:aligned.additions,
        sqlAdditionMethods,cardStatementTexts,cardStatementExecutions,checkArchivedCardTexts:false,
        receiptWalk:Boolean(receiptWalkPins.records[key])});
      if(receiptWalkPins.records[key]) {
        observeReceiptWalkSQL(old.statements,'archived');archivedReceiptWalkTraces++;
        assert.deepEqual(summary(old),pins.records[key],'receipt cells retain their frozen archived pins');
      } else if(workloadKeys.includes(key)) {
        const reconstructed = reconstructWideTrace(key, old, sqlAdditions, sqlAdditionMethods);
        assertWidePins(key,reconstructed,sqlAdditions,pins.records[key],sqlAdditionMethods,cardStatementTexts,cardStatementExecutions);
      } else {
        assert.deepEqual(summary(old),pins.records[key],'frozen opening pins come only from the archived baseline');
      }
    });
    if (!baseline) withoutDeliveryLookups(current, deliveryLookups[key] ?? []);
    assert.equal(pins.revision,revision);assertWidePins(key,current,sqlAdditions,currentPin,sqlAdditionMethods,cardStatementTexts,cardStatementExecutions);
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

test('receipt enumeration exemptions are a closed set over the listed traces',async t=>{
  // The current code's texts are required in every mode, and it emits no other exempt text.
  assert.deepEqual([...observedReceiptWalkSQL.current].sort(),[...currentReceiptWalkSQLTexts].sort(),
    'the current trace emits exactly the listed current texts');
  await t.test('archived receipt enumeration texts',t=>{
    if(wideArchiveMode(archiveAvailable,requireArchive)==='pins') {
      t.skip('archive revision not available');return;
    }
    assert.ok(archivedReceiptWalkTraces>0,'archived receipt enumeration traces were compared');
    assert.deepEqual([...new Set([...observedReceiptWalkSQL.current,...observedReceiptWalkSQL.archived])].sort(),[...receiptWalkSQLTexts].sort(),
      'every listed SQL text occurs in the listed cells; no dead exemptions');
  });
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
  assertArchivedCardStatementTexts(revisedArchives,cardStatementTexts,sqlAdditions);
});

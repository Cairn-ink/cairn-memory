import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openDatabase, transaction } from '../database.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { createLegacyReceiptWalk } from '../testing/receipt-walk-reference.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';

const ns={ownerId:'synthetic-owner',scope:'project',projectId:'synthetic-project'};
const source=i=>({client:'synthetic',sessionId:'session',eventId:'event-'+i,role:'user',excerpt:'excerpt-'+i});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const outcome=work=>{try{work();return {decision:'accept',code:null};}catch(error){return {decision:'refuse',code:error.code};}};
const normalize=sql=>sql.replace(/\s+/g,' ').trim();
const fields=['client','sessionId','eventId','role','excerpt'];
async function fixture(t,layout) {
  const f=layout===18?safetyFixture(t):eventTimeSafetyFixture(t,33);
  if(layout===53)await f.migrate();
  const db=f.connect();t.after(()=>db.close());return {f,db};
}
function memory(db,id='parent',deleted=1) {
  db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES(?,?,?,?,?,?,'fact','explicit',1,1,?,'time','time')`).run(id,ns.ownerId,ns.scope,ns.projectId,id,deleted?null:'Synthetic',deleted);
}
function receipt(db,s,i,{time='time',parent='parent',key=digest(s)}={}) {
  db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('receipt-'+i,parent,key,...fields.map(field=>s[field]),time);
}
function trace(t,db,create,batch,{receiptPageBudget=Infinity}={}) {
  let receiptPages=0;
  const sql=[],native=db.prepare.bind(db),storage=create(db);
  const hook=t.mock.method(db,'prepare',text=>{
    const statement=native(text);
    for(const method of ['get','all','run']) {
      const execute=statement[method].bind(statement);
      statement[method]=(...args)=>{
        if(text.includes('ORDER BY created_at,id LIMIT 5')&&++receiptPages>receiptPageBudget)throw Object.assign(Error('synthetic cursor page budget'),{code:'source_budget_exceeded'});
        const result=execute(...args);sql.push({sql:normalize(text),args,rows:Array.isArray(result)?result.length:null,ids:Array.isArray(result)?result.map(row=>row.id):null,
          aliases:Array.isArray(result)&&result[0]?.receipt_key!==undefined?result.map(row=>({id:row.id,memoryId:row.memory_id,revision:row.memory_revision,deleted:row.memory_deleted})):null});return result;};
    }
    return statement;
  });
  try{return {outcome:transaction(db,()=>outcome(()=>storage.assertReceipts(ns,batch))),sql};}
  finally{hook.mock.restore();}
}

for(const layout of [18,53])test(`receipt enumeration schema and decoding premises layout=${layout}`,async t=>{
  const {db}=await fixture(t,layout);
  const expected=['id','memory_id','receipt_key','client','session_id','event_id','role','excerpt','created_at',...(layout===53?['occurred_at']:[])];
  const columns=db.prepare('PRAGMA table_info(receipts)').all();
  assert.deepEqual(columns.map(row=>[row.name,row.type,row.notnull]),expected.map(name=>[name,'TEXT',name==='occurred_at'?0:1]));
  const ddl=db.prepare("SELECT sql FROM sqlite_schema WHERE name='receipts'").get().sql;
  assert.match(ddl,/\) STRICT$/);assert.doesNotMatch(ddl,/COLLATE/i);
  assert.match(ddl,/id TEXT NOT NULL UNIQUE/);assert.match(ddl,/role TEXT NOT NULL CHECK \(role IN \('user','assistant'\)\)/);
  const probe=new DatabaseSync(':memory:');t.after(()=>probe.close());probe.exec('CREATE TABLE probe(value TEXT NOT NULL) STRICT');
  const values=['left\0right','\0x','x\0','e\u0301','é','\u{1f680}','trailing ','Case','case','','\uFEFFbom','a\uD800b','a\uDC00b'];
  const results=[];
  for(const value of values) {
    probe.prepare('INSERT INTO probe VALUES(?)').run(value);
    const row=probe.prepare('SELECT value,hex(value) bytes FROM probe ORDER BY rowid DESC LIMIT 1').get();
    assert.equal(row.bytes,Buffer.from(value).toString('hex').toUpperCase());
    const replaced=Buffer.from(value).toString('utf8');
    const truncates=process.versions.node==='22.16.0'||process.versions.node==='24.15.0';
    if(['22.16.0','24.15.0','24.22.1'].includes(process.versions.node))assert.equal(row.value,truncates?replaced.split('\0')[0]:replaced);
    else assert.ok(row.value===replaced||row.value===replaced.split('\0')[0]);
    results.push({value,...row});
  }
  for(const hex of ['80','E282','C0AF','FF']) {
    const row=probe.prepare(`SELECT CAST(x'${hex}' AS TEXT) value`).get();
    assert.equal(row.value,Buffer.from(hex,'hex').toString('utf8'));assert.ok(row.value.includes('\uFFFD'));
    results.push({hex,...row});
  }
  t.diagnostic(JSON.stringify({node:process.version,layout,columns,ddl,decoding:results}));
});

test('receipt writers preserve valid NUL-free UTF-8 cursor keys; new writers require review',()=>{
  const root=new URL('../',import.meta.url),writers=[];
  function scan(url) {
    for(const entry of readdirSync(url,{withFileTypes:true})) {
      if(entry.name==='test'||entry.name==='testing')continue;
      const path=new URL(entry.name+(entry.isDirectory()?'/':''),url);
      if(entry.isDirectory())scan(path);
      else if(entry.name.endsWith('.mjs')) {
        const text=readFileSync(path,'utf8');
        for(const match of text.matchAll(/(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+["`\[]?receipts\b/gi))writers.push([path.href.slice(root.href.length),normalize(text.slice(match.index,text.indexOf('`',match.index)))]);
      }
    }
  }
  scan(root);
  assert.deepEqual(writers.sort(),[
    ['database.mjs','INSERT INTO receipts (id, memory_id, receipt_key, client, session_id, event_id, role, excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'],
    ['runtime.mjs','INSERT INTO receipts (id, memory_id, receipt_key, client, session_id, event_id, role, excerpt, created_at${eventTime ? ", occurred_at" : ""}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${eventTime ? ", ?" : ""})'],
  ]);
  const read=name=>readFileSync(new URL(name,root),'utf8');
  assert.match(read('database.mjs'),/insert\.run\(randomUUID\(\), receipt\.memory_id,[\s\S]*?receipt\.excerpt, receipt\.created_at\)/);
  assert.match(read('content-suppression-storage.mjs'),/const key = randomUUID\(\)/);
  const runtime=read('runtime.mjs');
  assert.match(runtime,/allocateContentKey\(db,[^\n]+, 'receipt'\)/);
  assert.match(runtime,/receipt\.sessionId, receipt\.eventId, receipt\.role, receipt\.excerpt, now,/);
  assert.deepEqual([...runtime.matchAll(/(?<!function )(?<![.\w])\battach\(([^\n;]+);/g)].map(match=>normalize(match[1])),[
    "existing.id, receipt, now, insertedReceiptIds, receiptOrigin, value.receiptTimes?.[index])) || changed",
    "id, receipt, now, insertedReceiptIds, receiptOrigin, value.receiptTimes?.[index])",
    "id, receipt, now, [], 'independent', value.receiptTimes?.[index])",
  ]);
  assert.match(runtime,/function admitMutation\(ns, value, projection = \{\}, now = new Date\(\)\.toISOString\(\)\)/);
  assert.equal([...runtime.matchAll(/const now = new Date\(\)\.toISOString\(\)/g)].length,4);
  assert.match(read('admission-storage.mjs'),/const receiptNow = item\.receiptTimes\?\.some\(time => time != null\) \? new Date\(\)\.toISOString\(\) : undefined/);
});

for(const layout of [18,53])test(`wanted tuple UTF-8 bindings and filter-off SQL layout=${layout}`,async t=>{
  const {db}=await fixture(t,layout);
  transaction(db,()=>{memory(db);for(let i=0;i<9;i++)receipt(db,source(i),i);});
  db.exec("PRAGMA encoding='UTF-16le'");
  assert.equal(db.prepare('PRAGMA encoding').get().encoding,'UTF-8','existing schema fixes connection encoding');
  const wanted={client:'\u{1f680}',sessionId:'e\u0301',eventId:'é',role:'assistant',excerpt:''};
  const first=trace(t,db,createRawLineageStorage,[wanted]);
  const filtered=first.sql.filter(row=>row.sql.includes('CROSS JOIN receipts'));
  if(layout===53) {
    assert.ok(filtered.length>0);assert.ok(filtered.every(row=>row.sql.includes('instr(CAST(')));
    for(const row of filtered) {
      const bytes=db.prepare(`SELECT hex(json_extract(value,'$[0]')) a,hex(json_extract(value,'$[1]')) b,
        hex(json_extract(value,'$[2]')) c,hex(json_extract(value,'$[3]')) d,hex(json_extract(value,'$[4]')) e FROM json_each(?)`).all(row.args[1]);
      assert.deepEqual(bytes.map(row=>Object.values(row)),[fields.map(field=>Buffer.from(wanted[field]).toString('hex').toUpperCase())]);
      t.diagnostic(JSON.stringify({boundHex:bytes}));
    }
    // Once per native connection, across separate storage instances and calls.
    const second=trace(t,db,createRawLineageStorage,[wanted]);
    assert.equal(first.sql.filter(row=>row.sql==='PRAGMA encoding').length,1);
    assert.equal(second.sql.filter(row=>row.sql==='PRAGMA encoding').length,0);
  } else assert.equal(filtered.length,0);
  const baselineText="SELECT r.*,wanted.key AS wanted_entry, json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted FROM json_each(?) wanted CROSS JOIN receipts r ON r.rowid IN ( SELECT rowid FROM receipts INDEXED BY memory_receipts WHERE memory_id=json_extract(wanted.value,'$[0]') ORDER BY created_at,id LIMIT 5) ORDER BY wanted.key,r.created_at,r.id";
  for(const value of ['\0x','l\0r','x\0','\uFFFD','\uD800','\uDC00'])for(const field of ['client','sessionId','eventId','excerpt']) {
    const result=trace(t,db,createRawLineageStorage,[{...wanted,[field]:value}]);
    for(const row of result.sql.filter(row=>row.sql.includes('CROSS JOIN receipts')))assert.equal(row.sql,baselineText);
    for(const row of result.sql.filter(row=>row.sql.startsWith('SELECT r.*,? AS memory_revision')))assert.equal(row.sql,
      'SELECT r.*,? AS memory_revision,? AS memory_deleted FROM receipts r INDEXED BY memory_receipts WHERE memory_id=? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT 5');
  }
});

for(const layout of [18,53])test(`documented base limitation: UTF-16 store refused at open on both sides layout=${layout}`,async t=>{
  const {f,db}=await fixture(t,layout),path=join(f.workspace.path,'utf16.sqlite');
  const target=new DatabaseSync(path);target.exec("PRAGMA encoding='UTF-16le'");
  const schema=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
  for(const row of schema.filter(row=>row.type==='table'))target.exec(row.sql);
  for(const {name} of schema.filter(row=>row.type==='table')) {
    const quote=name=>'"'+name.replaceAll('"','""')+'"';
    for(const row of db.prepare(`SELECT * FROM ${quote(name)}`).all())target.prepare(`INSERT INTO ${quote(name)} (${Object.keys(row).map(quote)}) VALUES(${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  }
  for(const row of schema.filter(row=>row.type!=='table'))target.exec(row.sql);
  target.exec('PRAGMA user_version='+layout);target.close();chmodSync(path,0o600);
  const reference=outcome(()=>openDatabase(path,layout===53?{currentDependencies:true}:{}));
  const actual=outcome(()=>openDatabase(path,layout===53?{currentDependencies:true}:{}));
  assert.deepEqual(actual,reference);assert.equal(reference.code,'unsupported_database');
  t.diagnostic(JSON.stringify({node:process.version,layout,reference,current:actual,encoding:'UTF-16le'}));
});

// Documented base cursor limitation, outside engine-written keys. Hotfix
// invariant: never accepts what the base refuses. No cursor repair is made here.
for(const kind of ['invalid UTF-8','NUL'])test(`documented cursor difference (${kind}): never accepts what the base refuses`,async t=>{
  const {db}=await fixture(t,53);
  transaction(db,()=>{
    memory(db);
    for(let i=0;i<9;i++)receipt(db,source(i),i);
    db.exec(`UPDATE receipts SET created_at=CAST(x'${kind==='NUL'?'6C0072':'80'}' AS TEXT)`);
  });
  const old=trace(t,db,createLegacyReceiptWalk,[source(8)],{receiptPageBudget:32}),actual=trace(t,db,createRawLineageStorage,[source(8)]);
  assert.equal(actual.outcome.code,'source_excluded');
  const truncates=db.prepare("SELECT CAST(x'6C0072' AS TEXT) value").get().value==='l';
  // A NUL prefix seeks backward on truncating drivers and repeats the page;
  // bound the documented limitation instead of hanging the test runner.
  assert.equal(old.outcome.code,kind==='invalid UTF-8'?null:truncates?'source_budget_exceeded':'source_excluded');
  const stored=db.prepare('SELECT hex(created_at) bytes,created_at FROM receipts LIMIT 1').get();
  const rebound=db.prepare('SELECT hex(?) bytes').get(stored.created_at).bytes;
  const pages=old.sql.filter(row=>row.sql.startsWith('SELECT r.*,? AS memory_revision'));
  if(kind==='NUL'&&truncates) {
    assert.equal(pages.length,32);assert.deepEqual(pages.at(-1).ids,pages.at(-2).ids,'base repeats the same page');
  }
  t.diagnostic(JSON.stringify({node:process.version,kind,reference:old.outcome,current:actual.outcome,stored,rebound,
    referencePages:pages.length,firstPages:pages.slice(0,3).map(row=>({cursor:row.args.slice(3),ids:row.ids}))}));
});

test('filtered witness and overflow reach every equal-timestamp receipt by unique id',async t=>{
  const {db}=await fixture(t,53),wanted=[],expected=[];
  transaction(db,()=>{
    memory(db,'parent',0);
    for(let i=0;i<43;i++) {
      const s=source(i);receipt(db,s,String(i).padStart(3,'0'),{key:i===42?'inconsistent-key':digest(s)});
      if(i%2===0){wanted.push(s);expected.push('receipt-'+String(i).padStart(3,'0'));}
    }
  });
  const old=trace(t,db,createLegacyReceiptWalk,wanted),actual=trace(t,db,createRawLineageStorage,wanted);
  assert.deepEqual(actual.outcome,old.outcome);assert.equal(old.outcome.code,'source_excluded');
  const pages=actual.sql.filter(row=>row.sql.includes('CROSS JOIN receipts')||row.sql.startsWith('SELECT r.*,? AS memory_revision'));
  assert.ok(pages.length>1);assert.ok(pages.every(row=>row.sql.includes('instr(CAST(')));
  assert.deepEqual([...new Set(pages.flatMap(row=>row.ids))].sort(),expected);
  assert.deepEqual(pages.map(row=>row.rows),[5,5,5,5,5,2]);
  const suffix=pages[0].sql.slice(pages[0].sql.indexOf(' AND (EXISTS'),pages[0].sql.indexOf(' ORDER BY created_at,id LIMIT 5)'));
  for(const page of pages.slice(1))assert.ok(page.sql.includes(suffix),'same predicate on overflow pages');
  t.diagnostic(JSON.stringify({pageSizes:pages.map(row=>row.rows),uniqueRows:expected.length,cursors:pages.slice(1).map(row=>row.args.slice(3,5))}));
});

// Receipt cursors retain the required NUL-free valid UTF-8 domain here.
// Check decoded memory identities independently of the receipt paging keys.
test('decoded memory identities preserve the frozen decision with valid receipt cursors',async t=>{
  const {f,db}=await fixture(t,53),good='\uFFFD';
  const {writeContentSuppressionInside}=await import('../content-suppression-storage.mjs');
  transaction(db,()=>{
    memory(db,good,0);db.prepare('UPDATE memories SET revision=2 WHERE id=?').run(good);
    db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
      VALUES(CAST(x'80' AS TEXT),?,?,?,'other-key','Synthetic','fact','explicit',1,1,0,'time','time')`).run(ns.ownerId,ns.scope,ns.projectId);
    for(let i=0;i<8;i++)receipt(db,source(i),String(i).padStart(3,'0'),{parent:good});
    writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:good,matchMode:'version',
      sourceVersion:JSON.stringify(['memory-revision-v1',2]),reason:'purge',actionId:'synthetic-version-fact'});
  });
  const receipts=db.prepare('SELECT hex(id) id_bytes,hex(created_at) time_bytes,id,created_at FROM receipts ORDER BY id').all();
  for(const row of receipts)for(const [name,hex] of [['id','id_bytes'],['created_at','time_bytes']]) {
    assert.ok(!row[name].includes('\0'));assert.equal(Buffer.from(row[name]).toString('hex').toUpperCase(),row[hex]);
  }
  const validity={integrity:db.prepare('PRAGMA integrity_check').all(),foreignKeys:db.prepare('PRAGMA foreign_key_check').all(),receipts,
    memoryKeys:db.prepare('SELECT hex(id) bytes,id,revision FROM memories ORDER BY updated_at DESC,id').all()};
  assert.equal(validity.integrity[0].integrity_check,'ok');assert.deepEqual(validity.foreignKeys,[]);
  const reopened=openDatabase(f.path,{currentDependencies:true});reopened.close();validity.engineReopen='accept';
  const wanted=Array.from({length:4},(_,i)=>source(i));
  const old=trace(t,db,createLegacyReceiptWalk,wanted),control=trace(t,db,createLegacyReceiptWalk,wanted),
    actual=trace(t,db,createRawLineageStorage,wanted);
  assert.deepEqual(old.outcome,control.outcome,'frozen-reference self control');
  t.diagnostic(JSON.stringify({node:process.version,validity,wanted,reference:old,control:control.outcome,current:actual}));
  assert.deepEqual(old.outcome,{decision:'refuse',code:'source_excluded'},'the version fence is a valid refusal');
  assert.deepEqual(actual.outcome,old.outcome,'exact decision and error code with valid receipt paging keys');
});

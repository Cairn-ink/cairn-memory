import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { sourceFixture,savedSource,ns,ok,denied } from '../testing/raw-source-fixtures.mjs';
import { createLocalUuidFence } from '../local-authority-uuid.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';

const internal={...ns,projectId:ns.projectId??''};
const snapshot=db=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  .map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(row)).sort()]);
async function fixture(t,path='conversation',total=1008) {
  const f=sourceFixture(t,{kind:'episode'}),local=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  f.workspace.defer(()=>local.close());
  const source=await savedSource(f,'Synthetic copper retained evidence.',{client:'claude-code',sessionId:'target',
    episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  const row=f.db.prepare('SELECT * FROM raw_messages').get(),keys=Object.keys(row);
  const insert=f.db.prepare('INSERT INTO raw_messages('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
  f.db.exec('BEGIN');
  try {for(let n=2;n<=total;n++)insert.run(...keys.map(key=>key==='message_id'?'synthetic-copy-'+n:key==='ordinal'?n:row[key]));f.db.exec('COMMIT');}
  catch(error){f.db.exec('ROLLBACK');throw error;}
  const target=f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(source.conversationId);
  const episode=f.db.prepare('SELECT id,revision FROM session_episodes WHERE session_key=?').get(target.session_key);
  const input=path==='conversation'?{namespace:ns,conversationId:source.conversationId,expectedRevision:target.revision,actionId:'synthetic-delete'}:
    {namespace:ns,episodeId:episode.id,expectedRevision:episode.revision};
  return {...f,local,source,target,total,remove:()=>local[path==='conversation'?'deleteConversation':'forgetEpisode'](input)};
}
function cards(f,count,offset=0) {
  const stamp='2020-01-01T00:00:00.000Z';
  const card=f.db.prepare('INSERT INTO private_cards VALUES(?,?,?,?,1,?,?,?,?,?,?,NULL)');
  const raw=f.db.prepare('INSERT INTO card_raw_bindings VALUES(?,?,?,?,0,8,?,0)');
  f.db.exec('BEGIN');
  try {for(let i=offset;i<offset+count;i++) {
    card.run('synthetic-card-'+i,ns.ownerId,ns.scope,ns.projectId??'','draft','Synthetic title','Synthetic body',1,stamp,stamp);
    raw.run('synthetic-card-'+i,'binding-'+i,f.source.conversationId,f.source.messageId,'{}');
  }f.db.exec('COMMIT');}catch(error){f.db.exec('ROLLBACK');throw error;}
}
// Count rolled-back writer transactions: a successful pass has a provisional
// first/final cascade and a durable deletion. Middle chunks only commit.
function observeProbe(f,work) {
  const exec=DatabaseSync.prototype.exec;let probes=0,writer=false;
  DatabaseSync.prototype.exec=function(sql,...args) {
    const result=exec.call(this,sql,...args);
    if(sql==='BEGIN IMMEDIATE')writer=true;
    if(sql==='ROLLBACK'&&writer){probes++;writer=false;}
    if(sql==='COMMIT')writer=false;
    return result;
  };
  try{return work(()=>probes);}finally{DatabaseSync.prototype.exec=exec;}
}
for(const path of ['conversation','episode'])test(`local ${path} thousand-message deletion runs exactly first and final probes`,async t=>{
  const f=await fixture(t,path);let passes=0;
  observeProbe(f,count=>{
    let result;
    do {result=f.remove();passes++;if(!result.ok)denied(result,'local_raw_privacy_write_failed');assert.ok(passes<20);}
    while(!result.ok);
    assert.equal(count(),2,'first and final dry runs');assert.equal(passes,9);
  });
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,1008);
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  t.diagnostic(JSON.stringify({passes,dryRuns:2}));
});
for(const path of ['conversation','episode'])for(const pending of ['other-job','backfill'])
  test(`local ${path} first refusal still probes with pending ${pending}`,async t=>{
    const f=await fixture(t,path);cards(f,129);
    if(pending==='other-job') {
      await savedSource(f,'Synthetic other pending source.',{client:'claude-code',sessionId:'other',episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
      ok(f.local.fenceSession({namespace:ns,client:'claude-code',sessionId:'other'}));
    }
    assert.equal(createLocalUuidFence(f.db).pending(),true);
    const before=snapshot(f.db);
    observeProbe(f,count=>{denied(f.remove(),'dependency_limit_reached');assert.equal(count(),1);});
    assert.deepEqual(snapshot(f.db),before);
    for(const table of ['raw_session_fences','local_raw_uuid_jobs'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table+' WHERE session_key=?').get(f.target.session_key).n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,0);
  });
for(const path of ['conversation','episode'])test(`local ${path} pre-existing own fence only advances already owed hashes`,async t=>{
  const f=await fixture(t,path);ok(f.local.fenceSession({namespace:ns,client:'claude-code',sessionId:'target'}));
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_jobs WHERE session_key=?').get(f.target.session_key).n,1,'insert trigger already owes the job');
  cards(f,129);
  observeProbe(f,count=>{
    for(let pass=0;pass<8;pass++){denied(f.remove(),'local_raw_privacy_write_failed');assert.equal(count(),0);}
    denied(f.remove(),'dependency_limit_reached');assert.equal(count(),1,'final refusal is probed');
  });
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_jobs').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,1008);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1008);
});
for(const path of ['conversation','episode'])test(`local ${path} final probe catches a Card refusal introduced between passes`,async t=>{
  installRawSearchTestClock(t);const f=await fixture(t,path);cards(f,128);
  const search=await searchFixture(f);await search.maintain();
  assert.ok((await search.search({query:'copper',intent:'history'})).candidates.some(row=>row.conversationId===f.source.conversationId));
  observeProbe(f,count=>{
    denied(f.remove(),'local_raw_privacy_write_failed');assert.equal(count(),1);
    cards(f,1,128);
    for(let pass=1;pass<8;pass++)denied(f.remove(),'local_raw_privacy_write_failed');
    const before=snapshot(f.db);
    denied(f.remove(),'dependency_limit_reached');assert.equal(count(),2);
    assert.deepEqual(snapshot(f.db),before,'final refusal rolls back every table');
  });
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1008);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,1008);
  assert.equal((await search.search({query:'copper',intent:'history'})).candidates.length,0,'only documented hidden-source residual');
});

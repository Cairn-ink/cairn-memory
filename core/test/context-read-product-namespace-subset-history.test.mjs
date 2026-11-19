import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { eventTimeFixture } from '../testing/receipt-event-time-fixture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { subsetFixture,personal,project,publication,card,ok } from '../testing/context-product-subset-fixture.mjs';

function seed(f,cards) {
  const rows=[],historical=[];
  f.admit('orchard known project outside the maintained selection',project('known-unselected'));
  f.admit('orchard another owner outside the publication',{...personal,ownerId:'synthetic-other-owner'});
  for(const [i,namespace] of publication.entries()) {
    rows.push(f.admit('orchard current evidence '+i,namespace));
    const old=f.admit('orchard historical evidence '+i,namespace);rows.push(old);historical.push(old.id);
    if(cards) {
      card(f,namespace,'orchard confirmed '+i,'Synthetic confirmed support');
      const draft=label=>ok(f.call('createCardDraft',{namespace,actionId:label+i,drafting:'authored',input:{
        title:'orchard '+label+' '+i,body:'Synthetic terminal or draft support',authoredInput:{text:'Synthetic support',occurredAt:null}}}));
      draft('draft');
      const cancelled=draft('cancelled');
      ok(f.call('cancelCardDraft',{namespace,cardId:cancelled.id,expectedRevision:cancelled.revision,actionId:'cancel'+i}));
      const deleted=card(f,namespace,'orchard deleted '+i,'Synthetic deleted support');
      ok(f.call('deleteKnowledgeCard',{namespace,cardId:deleted.id,expectedRevision:deleted.revision,actionId:'delete'+i}));
    }
  }
  const writer=new DatabaseSync(f.path);
  try {
    writer.exec('BEGIN');
    const update=writer.prepare("UPDATE memories SET currentness='historical',review_state='awaiting',revision=revision+1 WHERE id=?");
    for(const id of historical)update.run(id);
    writer.exec('COMMIT');
  } finally {writer.close();}
  return rows;
}

async function exercise(s,{cards,dated=false}) {
  const history=s.build('history');s.certify('history',history);
  const db=s.side();
  try {
    const confirmed=new Set(cards?s.f.db.prepare("SELECT id FROM private_cards WHERE state='confirmed'").all().map(row=>row.id):[]);
    const before=db.prepare('SELECT * FROM publications ORDER BY projection').all();
    const seals=db.prepare('SELECT * FROM product_attestation').all();
    for(const intent of ['current','history'])for(const namespaces of [[personal],[personal,project('a')],[personal,project('b')]])for(const semantic of [false,true]) {
      const expected=namespaces.length*((intent==='history'?2:1)+(cards?1:0));
      const patch={intent,namespaces,semantic};
      const value=ok(await s.run('findCandidates',{...patch,limit:24}));
      assert.equal(value.items.length,expected);
      assert.ok(value.items.every(item=>namespaces.some(ns=>JSON.stringify(ns)===JSON.stringify(item.ref.namespace))));
      assert.ok(value.items.every(item=>item.ref.type!=='card'||confirmed.has(item.ref.cardId)));
      assert.equal(value.channels.semantic.state,semantic?'ready':'disabled');
      for(const c of Object.values(value.coverage.byType))for(const key of ['eligible','indexed','embedded','embeddedFraction','scannedFraction'])assert.equal(c[key],null);
      const assembled=ok(await s.run('contextRead',{...patch,raw:false,budget:{maxTokens:6000,maxItems:24},
        ...(dated?{representation:'representation-v2-dated'}:{})}));
      assert.equal(assembled.metered.items.length,expected);
      assert.ok(assembled.metered.items.every(item=>namespaces.some(ns=>JSON.stringify(ns)===JSON.stringify(publication[item.ref.ns]))));
      if(dated)assert.ok(assembled.metered.items.some(item=>item.date!==null&&item.date!==undefined));
      if(intent==='current')assert.ok(!JSON.stringify(assembled.metered).includes('orchard historical evidence'));
      else assert.ok(JSON.stringify(assembled.metered).includes('orchard historical evidence'));
    }
    assert.deepEqual(db.prepare('SELECT * FROM publications ORDER BY projection').all(),before);
    assert.deepEqual(db.prepare('SELECT * FROM product_attestation').all(),seals);
    assert.equal(db.prepare('SELECT count(*) n FROM work').get().n,0);
  } finally {db.close();}
}

for(const safety of [false,true])for(const cards of [false,true])test(`scoped current/history lexical and ready hybrid, safety=${safety} cards=${cards}`,async t=>{
  const s=subsetFixture(t,{safety,cards,semantic:true,seed:f=>seed(f,cards)});
  await exercise(s,{cards});
});

test('event-time layout preserves scoped dated history assembly and Card safety',async t=>{
  const f=await eventTimeFixture(t,33),host=cardHost();
  const core=openMemoryCore({path:f.path,privateCards:host.options}),db=f.connect();
  t.after(()=>{db.close();core.close();});
  const native={...f,core,db,host,call:(method,input)=>host.call(core,method,input),
    admit(content,namespace){return ok(core.admit({namespace,memory:{content,kind:'fact'},receipts:[{
      client:'synthetic',sessionId:'scoped-history',eventId:content,role:'user',excerpt:content,occurredAt:'2024-01-02T03:04:00.000Z'}]})).memory;}};
  const s=subsetFixture(t,{cards:true,semantic:true,fixtureFactory:()=>native,seed:f=>seed(f,true)});
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,53);
  await exercise(s,{cards:true,dated:true});
});

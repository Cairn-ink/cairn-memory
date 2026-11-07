import { isDeepStrictEqual } from 'node:util';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { migrateCardLineage, migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { safetyFixture, copySqliteFixture, quiescence, ns, ok, receipt } from './content-safety-s2h-fixture.mjs';
import { localPlainPort } from './raw-capture-fixtures.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
export { ns, ok, receipt, copySqliteFixture, quiescence };

export function lineageHost() {
  const tokens=new WeakMap(),grants=new WeakMap();
  const host={actorId:'synthetic-human',authorizedAt:'2026-01-01T00:00:00.000Z',generation:1,kind:null,
    options:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority:{
      authorize(request,token) {
        const expected=tokens.get(token);
        if(!expected||request.method!==expected.method||!isDeepStrictEqual(request.input,expected.input))return null;
        const grant={}, {input,...binding}=request;
        grants.set(grant,{...binding,...(request.auditVersion?{actorId:host.actorId,authorizedAt:host.authorizedAt,
          authorizationKind:host.kind??(request.method==='createCardDraft'&&input.input?.authoredInput?'authored-input':'operation')}:{})});
        return grant;
      },isCurrent(grant){const value=grants.get(grant);return value?{...value,accessGeneration:host.generation}:null;}
    }},
    call(core,method,input) { const token={},payload={namespace:ns,...input};tokens.set(token,{method,input:structuredClone(payload)});return core[method](payload,token); }
  };
  return host;
}
export async function lineageFixture(t,{base=23,eventTime=false,raw=false,rawPort,options={}}={}) {
  const f=safetyFixture(t,base);
  if(eventTime) {
    copySqliteFixture(f.path,f.backupPath);
    await migrateReceiptEventTime({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base},quiescence});
  }
  const before=f.connect(),domain=eventTime?before.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain:undefined;
  before.close();copySqliteFixture(f.path,f.backupPath);
  await migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{storeId:f.storeId,base,...(domain?{suppressionDomain:domain}:{})},quiescence});
  const host=lineageHost(),config={path:f.path,privateCards:host.options,...options};
  const core=raw?openRawCaptureCore(config,{mode:'raw-v1',sources:true,deletion:true,port:rawPort??localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})}):openMemoryCore(config);
  const db=f.connect();attestContentSafety(db);t.after(()=>{core.close();db.close();});
  const call=(method,input)=>host.call(core,method,input);
  return {...f,core,db,host,call,
    note(id){return ok(call('submitSourceNote',{actionId:id,text:'Synthetic '+id,occurredAt:null})).source;},
    draft(sources,id='draft') {return ok(call('createCardDraft',{actionId:id,drafting:'authored',input:{title:'Synthetic title',body:'Synthetic retained body',sources}}));},
    confirm(card){return ok(call('confirmCardDraft',{actionId:'confirm-'+card.id,cardId:card.id,expectedRevision:card.revision,applicability:'current'}));},
    row(id){return db.prepare('SELECT * FROM private_cards WHERE id=?').get(id);},
    identity:db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get()
  };
}

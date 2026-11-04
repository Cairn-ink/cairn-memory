// Observe known canonical mutation statements and their own native COMMIT.
// No storage queries, timers, awaits or serialization are inserted into delivery.
export function eligibilityLedger({capacity=1024}={}) {
  const transactions=new WeakMap(),revisions=new Map(),first=new Map();let enabled=false,overflow=false;
  const key=(type,id,intent)=>JSON.stringify([type,id,intent]);
  return {
    enable(value){enabled=value;},
    statement(sql,args,value,connection,commit) {
      const text=String(sql).trim().replace(/\s+/g,' '),upper=text.toUpperCase();
      if(/^BEGIN\b/.test(upper)){transactions.set(connection,[]);return;}
      if(/^ROLLBACK\b/.test(upper)){transactions.delete(connection);return;}
      if(/^COMMIT\b/.test(upper)){
        const events=transactions.get(connection)??[];transactions.delete(connection);
        if(!commit)return;
        for(const e of events){revisions.set(e.type+':'+e.id,e.revision);
          for(const intent of e.intents){const k=key(e.type,e.id,intent);if(first.has(k))continue;if(first.size>=capacity){overflow=true;continue;}
            first.set(k,{type:e.type,id:e.id,intent,revision:e.revision,...(e.bodyRevision?{bodyRevision:e.bodyRevision}:{}),firstEligibility:true,
              committedAt:commit.at,nativeCommitSequence:commit.sequence,nativeCommitOperation:commit.operation});}}
        return;
      }
      if(!enabled||!value||Number(value.changes)!==1)return;
      let event;
      if(/^INSERT INTO memories \(id, owner_id, scope, project_id, fingerprint, content, kind, origin, confidence, revision, deleted, created_at, updated_at, review_state\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, 1, 0, \?, \?, \?\)$/i.test(text))event={type:'memory',id:args[0],revision:1,intents:['history']};
      else if(/^UPDATE memories SET review_state='confirmed',revision=revision\+1,updated_at=\? WHERE id=\?$/i.test(text))event={type:'memory',id:args[1],revision:(revisions.get('memory:'+args[1])??NaN)+1,intents:['current']};
      else if(/^INSERT INTO private_cards VALUES\(\?,\?,\?,\?,1,'draft',\?,\?,NULL,\?,\?,NULL\)$/i.test(text))event={type:'card',id:args[0],revision:1,intents:[]};
      else if(/^UPDATE private_cards SET state='confirmed',revision=revision\+1,body_revision=1, confirmed_at=\?,updated_at=\? WHERE id=\?$/i.test(text))event={type:'card',id:args[2],revision:(revisions.get('card:'+args[2])??NaN)+1,bodyRevision:1,intents:['current','history']};
      else if(/^UPDATE memories SET filing_status = \?, revision = \?, updated_at = CASE WHEN revision != \? THEN \? ELSE updated_at END WHERE id = \?$/i.test(text))event={type:'memory',id:args[4],revision:args[1],intents:[]};
      if(event){if(!Number.isSafeInteger(event.revision)||event.revision<1){overflow=true;return;}
        const pending=transactions.get(connection);if(!pending){overflow=true;return;}pending.push(event);}
    },
    targets(type,id){return [...first.values()].filter(e=>e.type===type&&e.id===id);},
    get complete(){return !overflow;},
  };
}

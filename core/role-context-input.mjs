import { methodSnapshot, methodReadSet, methodRole, methodPackageRef, methodVersionRef, methodPath, methodPageLimit } from './method-package-input.mjs';
import { profileRef, releaseRef } from './role-profile-input.mjs';
import { deepFreeze } from './private-card-input.mjs';
import { object, fail } from './validation.mjs';
export function roleContextInput(original) {
  const payload=deepFreeze(methodSnapshot(original,0,{nodes:8192,units:100000,bytes:0}));
  const modes={now:['roleKey','task','history'],then:['receipt','history'],refresh:['receipt','task'],compare:['roleKey','from','to','cursor'],file:['receipt','package','path','range']};
  if(!Object.hasOwn(modes,payload.mode))fail('invalid_input');
  object(payload,['readSet','budget','deadlineMs','mode',...modes[payload.mode]]);
  const readSet=methodReadSet(payload.readSet);
  if(['now','compare'].includes(payload.mode)){if(payload.roleKey===null)fail('invalid_input');methodRole(payload.roleKey);}
  if(['then','refresh','file'].includes(payload.mode)&&typeof payload.receipt!=='string')fail('invalid_receipt');
  if(payload.task!==undefined&&(typeof payload.task!=='string'||!payload.task.trim()||!payload.task.isWellFormed()||payload.task.includes('\0')||payload.task.length>4000))fail('invalid_input');
  if(payload.history!==undefined){object(payload.history,['profile','limit','cursor']);profileRef(payload.history.profile);methodPageLimit(payload.history.limit);}
  for(const cursor of [payload.cursor,payload.history?.cursor].filter(v=>v!==undefined))if(typeof cursor!=='string'||cursor.length>8192)fail('invalid_cursor');
  if(payload.mode==='compare'){
    const parse=payload.from?.type==='role-profile-release'?releaseRef:methodVersionRef;
    parse(payload.from);parse(payload.to);
  }
  if(payload.mode==='file'){
    methodPackageRef(payload.package);methodPath(payload.path);
    if(payload.range!==undefined){object(payload.range,['start','end']);const {start,end}=payload.range;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start>4000)fail('invalid_input');}
  }
  if(payload.budget!==undefined)object(payload.budget,['maxTokens','maxItems']);
  const budget={maxTokens:payload.budget?.maxTokens===undefined?4000:payload.budget.maxTokens,maxItems:payload.budget?.maxItems===undefined?12:payload.budget.maxItems},deadlineMs=payload.deadlineMs===undefined?1000:payload.deadlineMs;
  if(!Number.isSafeInteger(budget.maxTokens)||budget.maxTokens<64||budget.maxTokens>4000||!Number.isSafeInteger(budget.maxItems)||budget.maxItems<1||budget.maxItems>24||!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>5000)fail('invalid_input');
  const input={...payload,readSet,budget,deadlineMs};
  if(payload.history)input.history={...payload.history,profile:profileRef(payload.history.profile)};
  if(payload.mode==='file')input.package=methodPackageRef(payload.package);
  if(payload.mode==='compare'){
    const parse=payload.from.type==='role-profile-release'?releaseRef:methodVersionRef;
    input.from=parse(payload.from);input.to=parse(payload.to);
  }
  return {payload,input};
}

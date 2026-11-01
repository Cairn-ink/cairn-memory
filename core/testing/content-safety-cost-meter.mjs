import { contentHostInvocations } from './content-safety-cost-hosts.mjs';
import { contentCostGateCell } from './content-safety-s2h-cost-inventory.mjs';
import { DatabaseSync } from 'node:sqlite';

// Count executed statements, including configuration/transaction exec. prepare
// calls are excluded. Connections and SQL snapshots remain inside the engine.
export async function measureContentRead(method, variant, call, ports = () => 0) {
 const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
 let statements=0,begin=0;const sql=new Map(),trace=[];
 const record=(text,connection)=>{statements++;sql.set(text,(sql.get(text)??0)+1);if(/^BEGIN/.test(text.trim()))begin++;if(/schema_version AS cookie|owner_suppression_epochs/.test(text))trace.push({sql:text,transaction:connection.isTransaction});};
 DatabaseSync.prototype.prepare=function(text){const connection=this,statement=prepare.call(this,text);return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);return typeof value!=='function'?value:(...args)=>{if(['get','all','iterate','run'].includes(key))record(text,connection);return value.apply(target,args);};}});};
 DatabaseSync.prototype.exec=function(text){for(const part of text.split(';').filter(s=>s.trim()))record(part,this);return exec.call(this,text);};
 const before=ports(),hostBefore=contentHostInvocations();let result;
 try {result=await call();}
 finally{DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;}
 const row={node:process.version,method,variant,statements,begin,ports:ports()-before,hostInvocations:contentHostInvocations()-hostBefore,result,sql:[...sql],trace};
 if(process.env.CAIRN_S2H_CELL_REPORT)console.log(JSON.stringify({tag:'R3_NATIVE_CELL',...contentCostGateCell(),...row,
  result:undefined,sql:undefined,trace:undefined,
  pureEpochSelects:row.sql.filter(([q])=>q.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs')).reduce((n,[,count])=>n+count,0),
  otherOwnerEpochSQL:row.sql.filter(([q])=>q.includes('owner_suppression_epochs')&&!q.startsWith('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs')).reduce((n,[,count])=>n+count,0),
  headerSelects:row.sql.filter(([q])=>q.includes('SELECT schema_version AS cookie')).reduce((n,[,count])=>n+count,0),
  ok:result?.ok,error:result?.error?.code,itemCount:result?.value?.items?.length??result?.value?.metered?.items?.length}));
 return row;
}

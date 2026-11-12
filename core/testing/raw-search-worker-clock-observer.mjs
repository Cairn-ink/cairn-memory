import threads from 'node:worker_threads';
import {syncBuiltinESMExports} from 'node:module';

const OriginalWorker=threads.Worker;
// Give each Worker a clock that crosses the production deadline at native
// boundaries. The functional test must replace it before opening or searching.
const observer=`{
  const {performance}=require('node:perf_hooks'),{DatabaseSync}=require('node:sqlite');
  const {parentPort}=require('node:worker_threads');
  let now=100;const crossed=new Set();
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    const boundary=sql==='PRAGMA query_only'?'opening':sql.startsWith('SELECT * FROM segments WHERE published=1 ORDER BY id DESC')?'search':null;
    if(boundary&&!crossed.has(boundary)){crossed.add(boundary);now+=1001;}
    return statement;
  };
  const post=parentPort.postMessage;
  parentPort.postMessage=function(...args){
    if(!crossed.has('opening')||!crossed.has('search'))throw Error('synthetic_worker_boundary_missing');
    return post.apply(this,args);
  };
}\n`;
threads.Worker=class extends OriginalWorker{
  constructor(source,options){
    const inject=options?.eval&&source.includes('const service=await openRawSearch(');
    super(inject?observer+source:source,options);
    if(inject)process.stdout.write('synthetic_worker_clock_injected\n');
  }
};
syncBuiltinESMExports();

import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { openContextProductFacade } from '../../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../../context-product-sidecar.mjs';
import { accessDigest } from '../../context-product-validation.mjs';

const state=new Int32Array(workerData.state);
let held=false;
function hold(path) {
  if(held)return;
  if(!existsSync(path+'-journal'))throw Error('writer did not create a journal');
  held=true;parentPort.postMessage({held:true});
  while(Atomics.load(state,0)===0) {
    if(Atomics.wait(state,0,0,10000)==='timed-out')throw Error('journal writer release timed out');
  }
}
if(workerData.kind==='canonical') {
  const db=new DatabaseSync(workerData.path);
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
    db.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(workerData.namespace.ownerId);
    hold(workerData.path);db.exec('COMMIT');
  } finally {db.close();}
} else {
  const facade=openContextProductFacade(workerData.path,{});
  const storage=productSidecar({path:workerData.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,
    rendezvous:point=>{if(point==='batch')hold(workerData.path+PRODUCT_SIDECAR_SUFFIX);}});
  const readSet=[workerData.namespace],p={readSet,types:['memory'],intent:'current',ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'journal-writer',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}};
  try {storage.refresh(p,accessDigest({ownerId:workerData.namespace.ownerId,namespaces:{readSet}}),{maxItems:1,maxMs:5000});}
  finally {storage.close();facade.close();}
}
parentPort.postMessage({committed:true});parentPort.close();

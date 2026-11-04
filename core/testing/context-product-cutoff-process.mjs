// Real-process crash fixture. Only the control marker uses filesystem I/O.
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { installCutoffBarrier } from './context-product-cutoff-host.mjs';
const [path,serialized,mode,phase,point,marker]=process.argv.slice(2),p=JSON.parse(serialized);
const sqlite=createProductSqlitePolicy({now:()=>0});sqlite.start(Infinity);
const facade=openContextProductFacade(path,{sqlite}),storage=productSidecar({path,db:facade.port.db,
  identity:facade.port.identity,features:facade.port.features,sqlite,writable:true,sidecarJournalMode:mode,now:()=>0});
const access=accessDigest({ownerId:p.readSet[0].ownerId,namespaces:{readSet:p.readSet}});
try {
  if(phase==='seed'){storage.refresh(p,access,{maxItems:1,maxMs:5000});}
  else {
    installCutoffBarrier({cutoffProcessMarker:marker,cutoffSidePath:path+PRODUCT_SIDECAR_SUFFIX,cutoffPhase:phase,cutoffPoint:point});
    for(let i=0;i<100;i++)storage.refresh(p,access,{maxItems:1024,maxMs:5000});
    throw Error('process_commit_barrier_not_reached');
  }
} finally {storage.close();facade.close();}

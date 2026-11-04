// Synthetic, report-only sizing. SQLite dbstat owns every database read.
// No file-content descriptors, network, or elapsed-time acceptance gates.
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './context-read-fixture.mjs';
import { four, card, descriptor } from './context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest } from '../context-product-validation.mjs';

export function structures(db, memories = 1642) {
  const rows = db.prepare(`SELECT s.name, coalesce(q.type,'internal') AS type, sum(s.pgsize) AS bytes,
    sum(s.payload) AS payload FROM dbstat s LEFT JOIN sqlite_schema q ON q.name=s.name
    GROUP BY s.name ORDER BY s.name`).all();
  const bytes = db.prepare('PRAGMA page_count').get().page_count * db.prepare('PRAGMA page_size').get().page_size;
  const freeBytes = db.prepare('PRAGMA freelist_count').get().freelist_count * db.prepare('PRAGMA page_size').get().page_size;
  const unassigned=bytes-freeBytes-rows.reduce((n,r)=>n+r.bytes,0);
  // dbstat omits auto-vacuum pointer-map pages. Account for those internal
  // pages separately, without attributing them to a table or hiding free space.
  if(unassigned && db.prepare('PRAGMA auto_vacuum').get().auto_vacuum!==2)throw Error('dbstat page accounting mismatch');
  if(unassigned)rows.push({name:'pointer_map',type:'internal',bytes:unassigned,payload:0});
  return { bytes, freeBytes, structures: rows.map(r=>({...r, bytesPerMemory:r.bytes/memories})) };
}

const f = fixture(null, { cards:true });
let facade, storage;
try {
  // Unique but overlapping zh/ja/en prose: 1,642 Memories + 164 authored Cards,
  // distributed personal + three projects. No padding of canonical storage.
  const prose = [
    '索引生命週期需要保留完整證據與排序。團隊討論專案規劃、維護預算與資料安全，逐步驗證搜尋結果。',
    '東京のチームは検索結果と記憶の証拠を確認する。プロジェクト計画と保守の予算を毎週見直します。',
    'The orchard team reviews project planning, maintenance budgets, durable checkpoints and search evidence every week.'
  ];
  for(let i=0;i<1642;i++) {
    const namespace=four[i%four.length];
    f.admit(`${i}: ${prose[i%3]} ${prose[(i+1)%3]} ${prose[(i+2)%3]}`,namespace);
    if(i%10===0 && i<1640)card(f,namespace,'索引 東京 orchard '+i,prose[i%3]);
  }
  facade=openContextProductFacade(f.path,{});
  storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true});
  const access=accessDigest({ownerId:four[0].ownerId,namespaces:{readSet:four}}), builds=[];
  for(const intent of ['current','history']) {
    const p={readSet:four,types:['memory','card'],intent,ownerCoverage:descriptor(four)};
    let quanta=0, publication;
    do {
      storage.refresh(p,access,{maxItems:1024,maxMs:1000});
      publication=storage.observe(p,access).publication;
      if(++quanta>10000)throw Error('sizing build failed to complete');
    } while(!publication);
    builds.push({intent,quanta,counts:publication.counts});
    process.stderr.write(`completed ${intent}: ${quanta} quanta\n`);
  }
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  try {
    const canonical=structures(f.db),sidecar=structures(side);
    process.stdout.write(JSON.stringify({memories:1642,cards:164,namespaces:4,builds,canonical,sidecar,ratio:sidecar.bytes/canonical.bytes},null,2)+'\n');
  } finally {side.close();}
} finally {storage?.close();facade?.close();await f.workspace.cleanup();}

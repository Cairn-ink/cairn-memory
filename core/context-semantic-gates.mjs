import { fail } from './validation.mjs';

export const nearestRank=(values,q)=>{
  if(!Array.isArray(values)||!values.length||values.some(v=>typeof v!=='number'||!Number.isFinite(v))||q<=0||q>1)fail('invalid_input');
  return [...values].sort((a,b)=>a-b)[Math.ceil(q*values.length)-1];
};
function mean(values) {
  let sum=0,correction=0;
  for(const value of values){const adjusted=value-correction,next=sum+adjusted;correction=(next-sum)-adjusted;sum=next;}
  return sum/values.length;
}
export function retrievalMetrics(returned,relevant) {
  const gold=new Set(relevant),seen=new Set();let hits5=0,hits12=0,dcg=0;
  for(let i=0;i<Math.min(12,returned.length);i++) {
    const id=returned[i];if(seen.has(id))fail('invalid_input');seen.add(id);
    if(gold.has(id)){hits12++;if(i<5)hits5++;dcg+=1/Math.log2(i+2);}
  }
  const ideal=Array.from({length:Math.min(12,gold.size)},(_,i)=>1/Math.log2(i+2)).reduce((a,b)=>a+b,0);
  return {recall5:gold.size?hits5/gold.size:0,recall12:gold.size?hits12/gold.size:0,ndcg12:ideal?dcg/ideal:0};
}
export function pairedBootstrap(differences,seed) {return stratifiedBootstrap([differences],seed);}
function stratifiedBootstrap(groups,seed) {
  if(!groups.length||groups.some(g=>!g.length||g.some(v=>!Number.isFinite(v)))||!Number.isInteger(seed)||seed<1||seed>0xffffffff)fail('invalid_input');
  let state=seed>>>0;
  const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  const draws=[],constant=groups.every(g=>g.every(v=>v===g[0]));
  for(let sample=0;sample<10000;sample++) {
    if(constant){draws.push(mean(groups.map(g=>g[0])));continue;}
    draws.push(mean(groups.map(group=>{
      let sum=0,correction=0;
      for(let i=0;i<group.length;i++){const adjusted=group[Math.floor(random()*group.length)]-correction,next=sum+adjusted;correction=(next-sum)-adjusted;sum=next;}
      return sum/group.length;
    })));
  }
  const delta=mean(groups.map(mean)),lower=nearestRank(draws,.025),upper=nearestRank(draws,.975);
  return {version:'paired-xorshift32-nearest-rank-v1',seed,delta,lower,upper,uncertainty:Math.max(Math.abs(delta-lower),Math.abs(upper-delta)),draws};
}
// Pure arithmetic over a sealed registration and fabricated/retained paired
// observations. It neither collects measurements nor authorizes enablement.
export function evaluateSemanticGates({queries,strata,seed,safety,extension,acceptance}) {
  const ids=new Set(),byId=new Map();
  for(const q of queries){if(ids.has(q.id))fail('invalid_input');ids.add(q.id);byId.set(q.id,q);}
  const primary=strata.filter(s=>s.primary),primaryMembership=new Map(),reports=[],bootstrapCache=new Map();
  let incomplete=false;
  const challenges=['zh-to-en','en-to-zh','cross-language','paraphrase','short-cjk','code-switching','exact-identifier','identifier:path','identifier:sha','identifier:error','identifier:flag'];
  const expectedCells=['zh','en','ja','mixed'].flatMap(language=>['current','history'].flatMap(intent=>[18,23,33].flatMap(schema=>[1112,3336].map(world=>({language,intent,schema,world})))));
  const cellKey=cell=>cell&&JSON.stringify([cell.language,cell.intent,cell.schema,cell.world]);
  if(primary.length!==48||new Set(primary.map(s=>cellKey(s.cell))).size!==48||expectedCells.some(cell=>!primary.some(s=>s.applicable&&cellKey(s.cell)===cellKey(cell))))incomplete=true;
  const cellOf=new Map();for(const s of primary)for(const id of s.queryIds)cellOf.set(id,s.cell);
  for(const id of challenges) {
    const parent=strata.find(s=>s.id===id);
    if(!parent?.applicable){incomplete=true;continue;}
    for(const intent of ['current','history'])for(const schema of [18,23,33])for(const world of [1112,3336]) {
      const expected=parent.queryIds.filter(id=>{const cell=cellOf.get(id);return cell?.intent===intent&&cell?.schema===schema&&cell?.world===world;}).sort();
      const slice=strata.find(s=>s.id===`${id}:${intent}:${schema}:${world}`);
      if(!slice||slice.applicable!==(expected.length>0)||JSON.stringify([...slice.queryIds].sort())!==JSON.stringify(expected))incomplete=true;
    }
  }
  for(const s of strata) {
    if(!s.applicable)continue;
    if(new Set(s.queryIds).size!==s.queryIds.length)fail('invalid_input');
    const rows=s.queryIds.map(id=>{if(!byId.has(id)){incomplete=true;return null;}return byId.get(id);}).filter(Boolean);
    const positives=rows.filter(q=>q.positive),negatives=rows.filter(q=>!q.positive);
    if(positives.length<50||negatives.length<10)incomplete=true;
    if(s.primary)for(const q of positives)primaryMembership.set(q.id,(primaryMembership.get(q.id)??0)+1);
    if(!positives.length){reports.push({id:s.id,delta:null,ndcgDelta:null,pass:false});continue;}
    const differences=positives.map(q=>q.b.recall12-q.a.recall12);
    const aggregate=s.id==='cross-language'||s.id.startsWith('cross-language:');
    const groups=aggregate?['zh-to-en','en-to-zh'].map(id=>{
      const membership=new Set(strata.find(s=>s.id===id)?.queryIds??[]);
      return positives.filter(q=>membership.has(q.id)).map(q=>q.b.recall12-q.a.recall12);
    }):[differences];
    if(groups.some(g=>!g.length)){incomplete=true;reports.push({id:s.id,delta:null,ndcgDelta:null,pass:false});continue;}
    const cacheKey=JSON.stringify(groups);
    if(!bootstrapCache.has(cacheKey))bootstrapCache.set(cacheKey,stratifiedBootstrap(groups,seed));
    const bootstrap=bootstrapCache.get(cacheKey);
    const ndcgDelta=aggregate?mean(['zh-to-en','en-to-zh'].map(id=>{
      const membership=new Set(strata.find(s=>s.id===id)?.queryIds??[]);return mean(positives.filter(q=>membership.has(q.id)).map(q=>q.b.ndcg12-q.a.ndcg12));
    })):mean(positives.map(q=>q.b.ndcg12-q.a.ndcg12));
    const critical=['zh-to-en','en-to-zh','cross-language','paraphrase'].some(id=>s.id===id||s.id.startsWith(id+':'));
    const identifier=s.id==='exact-identifier'||s.id.startsWith('exact-identifier:')||s.id.startsWith('identifier:');
    const noRegression=bootstrap.delta>=-Math.max(bootstrap.uncertainty,.01);
    reports.push({id:s.id,delta:bootstrap.delta,ndcgDelta,bootstrap,pass:noRegression&&(!critical||bootstrap.delta>=.05)&&(!identifier||bootstrap.delta>=0)});
  }
  if(queries.some(q=>q.positive&&primaryMembership.get(q.id)!==1)||!primary.length)incomplete=true;
  if(queries.some(q=>q.valid!==true))incomplete=true;
  const primaryReports=reports.filter(r=>primary.some(s=>s.id===r.id));
  const recallDelta=primaryReports.some(r=>r.delta===null)?null:mean(primaryReports.map(r=>r.delta));
  const ndcgDelta=primaryReports.some(r=>r.ndcgDelta===null)?null:mean(primaryReports.map(r=>r.ndcgDelta));
  // The two directions are weighted equally, regardless of population size.
  const directions=['zh-to-en','en-to-zh'].map(id=>reports.find(r=>r.id===id)?.delta);
  const crossLanguageDelta=directions.some(x=>x===null||x===undefined)?null:mean(directions);
  const pass=!incomplete&&recallDelta>=.02&&ndcgDelta>=0&&crossLanguageDelta>=.05&&reports.every(r=>r.pass)&&safety===true&&extension===true&&acceptance===true;
  return {state:[safety,extension,acceptance].some(v=>v===false)?'fail':incomplete?'inconclusive':pass?'pass':'fail',recallDelta,ndcgDelta,crossLanguageDelta,reports};
}
export function stagingAddedLatency(cells) {
  const expected=['current:2000','current:5000','history:2000','history:5000'],seen=new Set(),reports=[];
  for(const c of cells) {
    const id=c.intent+':'+c.requestMaxMs;
    if(seen.has(id)||!expected.includes(id)||c.memories!==1642||c.namespaces!==26||c.schema!==18||c.canonicalJournal!=='DELETE'||c.sidecarJournal!=='DELETE')fail('invalid_input');seen.add(id);
    const warmups=c.pairs.filter(p=>p.warmup),scheduled=c.pairs.filter(p=>!p.warmup),valid=scheduled.filter(p=>p.valid&&p.hybrid);
    const enough=warmups.length===3&&scheduled.length<=500&&valid.length>=50;
    const added=enough?nearestRank(valid.map(p=>p.b),.95)-nearestRank(valid.map(p=>p.a),.95):null;
    reports.push({id,pairs:scheduled.length,validPairs:valid.length,addedP95Ms:added,state:!enough?'inconclusive':added<=150?'pass':'fail'});
  }
  return {state:seen.size!==4||reports.some(r=>r.state==='inconclusive')?'inconclusive':reports.every(r=>r.state==='pass')?'pass':'fail',reports};
}

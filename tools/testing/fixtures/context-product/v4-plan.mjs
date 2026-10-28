// Revision 1 is copied verbatim as data from Appendix V4-A. No SQLite imports.
import appendix from './v4-definition.json' with {type:'json'};
import { isDeepStrictEqual } from 'node:util';
import { immutable, digest } from './report.mjs';
export const V4 = immutable(appendix);
export const DEFINITIONS = immutable(Object.fromEntries(['engine','production'].map(profile=>[profile,
  {...appendix,platformProfile:profile,platform:appendix.profiles[profile]}])));
export const LABELS = V4.windows.readMix.methods;
export const LANGUAGES = V4.sets.Q;
export const INTENTS = V4.sets.I;
export function methodProfile(label) {
  const m=V4.methods[label];
  if(m)return {methodLabel:label,method:m.method,...(m.limit?{limit:m.limit}:{limit:m.maxItems,maxTokens:m.maxTokens})};
  const match=/^f(1|24)-(full|compact|snapshot)$/.exec(label);
  if(!match)throw Error('v4_method_label');
  return {methodLabel:label,method:'fetchCandidateEvidence',refs:Number(match[1]),adapter:match[2]};
}
const resolve=value=>typeof value==='string'?V4.sets[value]:value;
const product=axes=>Object.entries(axes).reduce((rows,[key,values])=>rows.flatMap(row=>values.map(value=>({...row,[key]:value}))),[{}]);
const applies=(row,p)=>row.profiles==='both'||row.profiles.includes(p);
export function buildV4Plan(profile) {
  if(!Object.hasOwn(DEFINITIONS,profile))throw Error('v4_profile_required');
  const rows=[];
  const add=(row,kind,axes,extra=()=>({}))=>{
    for(const d of product(axes)) {
      const [canonical,sidecar]=d.journal,[schema,type]=d.schemaType??[d.schema,undefined];
      const {world,journal,schemaType,method,...other}=d;
      const cell={protocol:V4.protocol,revision:V4.revision,platformProfile:profile,row:row.id,kind,scope:'launch',
        count:world,...other,schema,canonical,sidecar,...(type?{type}:{}),...(method?methodProfile(method):{}),...extra(d)};
      cell.key=JSON.stringify([V4.protocol,profile,row.id,...Object.values(d)]);
      rows.push(cell);
    }
  };
  const standard=row=>({world:resolve(row.world),schema:resolve(row.schema),journal:resolve(row.journal)});
  for(const row of V4.requestRows.filter(r=>applies(r,profile))) {
    const labels=resolve(row.method).flatMap(m=>m==='fetch'?row.refs.flatMap(n=>resolve(row.adapter).map(a=>`f${n}-${a}`)):[m]);
    add(row,'requests',{...standard(row),intent:resolve(row.intent),method:labels,language:resolve(row.language),load:row.load},d=>({
      series:['warmups','main',...(d.load==='idle'?['cold',...(methodProfile(d.method).method==='findCandidates'?['warm-reference']:[])]:[])],
      sampleRules:{warmups:{minimum:3,ceiling:3},main:{minimum:50,ceiling:500},cold:{minimum:10,ceiling:100},'warm-reference':{minimum:50,ceiling:500}},windows:0}));
  }
  for(const row of V4.windowRows.filter(r=>applies(r,profile)))add(row,'exposure',{...standard(row),load:row.load},d=>({
    windows:d.load==='retained-target-rotation'?8:5,windowMs:30000,pairedBaseline:true,readMix:'window-read-mix-v4',
    references:V4.series.windowReference.seriesOrder.map(([label,intent])=>({...methodProfile(label),intent,language:'language-rotation-v4'}))}));
  for(const row of V4.otherRows) {
    const axes={world:resolve(row.world),...(row.schemaType?{schemaType:row.schemaType}:{schema:resolve(row.schema)}),journal:resolve(row.journal)};
    if(row.intent)axes.intent=resolve(row.intent);
    if(row.case)axes.injection=resolve(row.case);
    const kind={F:'freshness',A:'availability',O:'overflow',B:'backup',T:'injection'}[row.id];
    add(row,kind,axes,d=>row.id==='O'?{...methodProfile('c24'),scope:'overflow',language:'mixed',load:'idle',series:['warmups','main','cold'],
      sampleRules:{warmups:{minimum:3,ceiling:3},main:{minimum:50,ceiling:500},cold:{minimum:10,ceiling:100}}}:
      row.id==='T'?{subprobes:V4.stateSubprobes[d.injection]}:{});
  }
  // Numeric world/schema order, preserving appendix row and array order for ties.
  rows.sort((a,b)=>a.count-b.count||a.schema-b.schema);
  const keys=new Set(),populations=new Set();
  for(const [id,cell] of rows.entries()) {
    cell.id=id;
    if(keys.has(cell.key))throw Error('v4_duplicate_cell');keys.add(cell.key);
    if(cell.kind==='requests'){
      const k=JSON.stringify([cell.count,cell.schema,cell.canonical,cell.sidecar,cell.intent,cell.methodLabel,cell.language,cell.load]);
      if(populations.has(k))throw Error('v4_duplicate_population');populations.add(k);
    }
  }
  const actual=v4Counts(rows),expected=V4.expectedCounts[profile];
  if(!isDeepStrictEqual(actual,expected))throw Error('v4_inventory_arithmetic');
  return rows;
}
export function v4Counts(plan) {
  const count=kind=>plan.filter(c=>c.kind===kind).length,requests=plan.filter(c=>c.kind==='requests'),w=plan.filter(c=>c.kind==='exposure');
  const series=s=>plan.filter(c=>c.series?.includes(s)).length;
  const idleReference=series('warm-reference'),windowReference=w.reduce((n,c)=>n+c.references.length,0);
  return {request:requests.length,exposure:w.length,freshness:count('freshness'),availability:count('availability'),overflow:count('overflow'),storage:count('backup'),
    state:count('injection'),stateSubprobes:plan.reduce((n,c)=>n+(c.subprobes?.length??0),0),cells:plan.length,main:series('main'),warmupGroups:series('warmups'),cold:series('cold'),idleReference,windowReference,reference:idleReference+windowReference,
    fixedWindows:w.reduce((n,c)=>n+2*c.windows,0),writeSuccessCredits:w.reduce((n,c)=>n+(c.load==='retained-target-rotation'?400:200),0),freshCloseSuccessCredits:w.filter(c=>c.load!=='retained-target-rotation').length*100};
}
export function estimateV4(profile,plan=buildV4Plan(profile)) {
  const c=v4Counts(plan),engine=profile==='engine',costs={mainAndWarmups:c.main*53*(engine?.55:.50),cold:c.cold*10*(engine?1:.9),
    idleReferences:c.idleReference*50*(engine?.3:.25),windowReferences:c.windowReference*50*(engine?.3:.25),fixedWindows:c.fixedWindows*30,
    sharedSessions:12*180,storage:c.storage*(engine?90:60),state:c.state*(engine?8:5),placements:c.fixedWindows*(engine?5:4.5),failuresAndSlowOperations:engine?3600:1800};
  for(const key of Object.keys(costs))costs[key]=Math.round(costs[key]*10)/10;
  return {protocol:V4.protocol,revision:1,profile:V4.profiles[profile].id,...c,costSeconds:costs,
    estimateSeconds:Math.round(Object.values(costs).reduce((a,b)=>a+b,0)*10)/10,reservationSeconds:V4.profiles[profile].reservationSeconds,
    inventoryHash:digest(plan),assumption:'Planning allowances, not timeouts or measured timings; slower attempts are never censored.'};
}
export function rotatingCell(cell,ordinal) {
  return {...cell,language:cell.language==='language-rotation-v4'?LANGUAGES[ordinal%3]:cell.language};
}
export function windowSlot(cell,repetition,ordinal) {
  return {...cell,...methodProfile(LABELS[ordinal%10]),language:LANGUAGES[(ordinal+repetition)%3],intent:INTENTS[(Math.floor(ordinal/10)+repetition)%2]};
}

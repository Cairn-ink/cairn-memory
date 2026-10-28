// Deterministic template authoring; no engine execution or database imports.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import constants from './registration.constants.json' with {type:'json'};
import {fixtureSpecs} from './corpus.mjs';
import {buildV4Plan,estimateV4} from '../../tools/testing/fixtures/context-product/v4-plan.mjs';
export function buildTemplate() {
const plan=buildV4Plan('engine');
const sessionKeys=[...new Set(plan.filter(c=>c.kind==='freshness').map(c=>JSON.stringify([c.count,c.schema,c.canonical,c.sidecar])))];
const sessions=sessionKeys.map((key,s)=>{const schema=JSON.parse(key)[1],types=schema===18?['memory']:['memory','card'];const targets=types.flatMap((type,t)=>Array.from({length:100},(_,i)=>({id:`s${s}-${type}-${i}`,type,probe:`qfreshs${s.toString().padStart(2,'0')}t${t}n${i.toString().padStart(3,'0')}lexical`,batch:Math.floor(i/10),createMs:i*800,reviewMs:i*800+35000})));
return {key,durationMs:180000,probeLanes:20,availabilityLanes:1,probeEveryMs:750,writer:{lifecycle:'fresh',target:'same-projection',cadenceMs:20,backlog:false,keeper:false,operations:['capture','review'],startMs:0,endMs:180000},targets,batches:Array.from({length:10},(_,ordinal)=>({ordinal,query:targets.filter(t=>t.batch===ordinal).map(t=>t.probe).join(' ')})),availability:['current','history'].flatMap((intent,j)=>Array.from({length:100},(_,i)=>({id:`s${s}-a-${intent}-${i}`,releaseMs:i*1800+j*800,methodLabel:['c12','a1500'][i%2],language:['zh','ja','mixed'][i%3],intent}))).sort((a,b)=>a.releaseMs-b.releaseMs)};});
const perCell=c=>{const e=estimateV4('engine',[c]);return e.estimateSeconds-e.costSeconds.sharedSessions-e.costSeconds.failuresAndSlowOperations;};
const groupKeys=[...new Set(plan.map(c=>JSON.stringify([c.count,c.schema,c.canonical,c.sidecar])))];
const groups=groupKeys.map(key=>{const [count,schema,canonical,sidecar]=JSON.parse(key);let cells=plan.filter(c=>c.count===count&&c.schema===schema&&c.canonical===canonical&&c.sidecar===sidecar);return {key,cells,cost:cells.reduce((n,c)=>n+perCell(c),0)+(sessionKeys.includes(key)?180:0)};}).sort((a,b)=>b.cost-a.cost);
const segments=[{id:'segment-1',cellKeys:[],estimateSeconds:1800},{id:'segment-2',cellKeys:[],estimateSeconds:1800}];
for(const group of groups){const s=segments[0].estimateSeconds<=segments[1].estimateSeconds?segments[0]:segments[1];s.cellKeys.push(...group.cells.map(c=>c.key));s.estimateSeconds+=group.cost;}
for(const s of segments){const e=estimateV4('engine',plan.filter(c=>s.cellKeys.includes(c.key)));const ns=sessions.filter(x=>plan.some(c=>s.cellKeys.includes(c.key)&&['freshness','availability'].includes(c.kind)&&JSON.stringify([c.count,c.schema,c.canonical,c.sidecar])===x.key)).length;s.estimateSeconds=Math.round((e.estimateSeconds-e.costSeconds.sharedSessions-e.costSeconds.failuresAndSlowOperations+ns*180+1800)*10)/10;s.estimateProvenance='V4.6 serial allowances, each physical session once, 1800 s failure allowance per segment; no timing claim';s.startLocal=s.id==='segment-1'?'23:00':null;}
if(segments[0].estimateSeconds>24300)throw Error('night_budget');

return {...structuredClone(constants),fixtures:fixtureSpecs.map(f=>({...f,path:'${volumeRoot}/qualification-snapshots/'+f.id+'.sqlite'})),sessions,segments,
stateProbes:Object.fromEntries(plan.filter(c=>c.injection==='post-catch-up').flatMap(c=>c.subprobes.map((p,i)=>[c.key+':'+p.id,`qcatchupcell${c.id}probe${i}lexical`]))),
probes:Object.fromEntries(sessions.flatMap(s=>{const [count,schema]=JSON.parse(s.key);return ['memory',...(schema===18?[]:['card'])].flatMap(type=>['current','history'].map(intent=>[`${count}:${schema}:${type}:${intent}`,s.targets.filter(t=>t.type===type).map(t=>t.probe)]));}))};
}
if(process.argv[1]===fileURLToPath(import.meta.url))writeFileSync(new URL('./registration.engine.template.json',import.meta.url),JSON.stringify(buildTemplate(),null,2)+'\n');

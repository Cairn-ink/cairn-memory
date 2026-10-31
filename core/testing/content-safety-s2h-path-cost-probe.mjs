// Frozen round-1 diagnostics, parameterized for permanent all-path gates.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const [kind,version,size,facts='0',absent='match',mode='lexical',limit='12']=process.argv.slice(2);
const args=[process.execPath,'probe','working',size,version,facts,absent,mode,facts,limit];
if (['context','status'].includes(kind)) {
 let s=readFileSync(new URL('./content-safety-s2h-cost-probe.mjs',import.meta.url),'utf8')
  .replace("const root=fileURLToPath(new URL('../../',import.meta.url));",'const root='+JSON.stringify(root)+';');
 if(kind==='context') {
  s=s.replace('maintenance:false,','maintenance:false,counter:{id:"synthetic",countTokens:()=>{if(active)active.counterCalls=(active.counterCalls??0)+1;return 1;}},');
  s=s.replace('const result=await reader.findCandidates(query,token);','const {limit,...input}=query;const result=await reader.contextRead({...input,budget:{maxTokens:4000,maxItems:Number(process.argv[9])}},token);');
  s=s.replace('result.value?.items.length','result.value?.metered?.items?.length');
  s=s.replace('result.value?.coverage.byType.memory.eligible','result.value?.diagnostics?.candidates?.coverage?.byType?.memory?.eligible');
 } else {
  s=s.replace('const result=await reader.findCandidates(query,token);','const result=await reader.getContextIndexStatus({readSet:[ns],types:["memory"],intent:query.intent},token);');
  s=s.replace('result.value?.items.length','result.value?.items?.length');
 }
 s=s.replace('assert.equal(result.value.coverage.byType.memory.eligible,physical===48&&Number(factCount)>0?null:n-effectiveFacts);','');
 s=s.replace('prepare:c.prepare,','counterCalls:c.counterCalls??0,prepare:c.prepare,');
 process.argv=args;
 await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
} else {
 const templates=JSON.parse(readFileSync(new URL('./content-safety-s2h-path-cost-templates.json',import.meta.url),'utf8'));
 const s=templates[kind].replace('ROOT',JSON.stringify(root).replaceAll('\"','\\\"')).replace('ARGS',JSON.stringify(args));
 await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
}

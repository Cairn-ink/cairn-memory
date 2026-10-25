import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hash, fail, canonical } from './common.mjs';
import {SUPPORT_VERSION} from '../scorer/support.mjs';
import {authenticatedGeneratorTrivia} from './trivia-authority-a6.mjs';
const generatorRoot=new URL('../generator/',import.meta.url);
export function verifiedInputs(directory,{split='pilot'}={}) {
  const freeze=JSON.parse(readFileSync(new URL('freeze.json',generatorRoot))),manifest=JSON.parse(readFileSync(join(directory,'manifest.json')));
  if(manifest.split!==split||manifest.seed!==freeze.seed)fail('input_split_or_seed_mismatch');
  const checked=[];
  for(const [name,entry]of Object.entries(manifest.hashes)) {
    const data=readFileSync(join(directory,name)),frozen=freeze.hashes[`artifacts/${split}/${name}`];
    if(!frozen||data.length!==frozen.bytes||hash(data)!==entry.sha256||entry.sha256!==frozen.sha256)fail('generator_hash_mismatch:'+name);checked.push(name);
  }
  const files=readdirSync(directory).filter(n=>n!=='manifest.json').sort();
  if(canonical(files)!==canonical(checked.sort()))fail('input_inventory_mismatch');
  const jsonl=name=>readFileSync(join(directory,name),'utf8').trimEnd().split('\n').filter(Boolean).map(JSON.parse);
  return {families:jsonl('families.jsonl'),gold:jsonl('gold.jsonl'),support:jsonl('support.jsonl'),verification:{split,files:checked.length,routes:['freeze.json + generator manifest hashes','filesystem enumeration + byte readback']}};
}
// This projection is used only AFTER all reader dispatches for this checkpoint.
export function scorerCase(family,checkpoint,goldRow,supportRow) {
  const g=goldRow.checkpoints.find(c=>c.batch===checkpoint.batch).G_correct,s=supportRow.checkpoints.find(c=>c.batch===checkpoint.batch);
  const strip=claim=>{const {citations,...rest}=claim;return rest;},spans=[],bySpan=new Map();
  const acceptedGraphs=s.acceptedGraphs.map(graph=>({edges:graph.edges.map(edge=>({from:edge.from,to:edge.to,support:edge.support.map(alt=>alt.map(q=>{
    const key=canonical(q);if(!bySpan.has(key)){const id='s'+bySpan.size;bySpan.set(key,id);spans.push({id,origin:q.turn_id,start:q.start,end:q.end,text:q.quote});}return bySpan.get(key);
  }))}))}));
  const {supportTrivia,scoringOptions}=authenticatedGeneratorTrivia(family,supportRow.optional_trivia,checkpoint);
  const gold={supportVersion:SUPPORT_VERSION,supportTrivia,question:checkpoint.question,current:{status:g.current.status,rows:g.current.rows.map(strip)},old:{status:g.old.status,records:g.old.records.map(r=>({predecessor_turn:r.predecessor_turn,status:r.status,rows:r.rows.map(strip)}))},reason:{status:g.reason.status,nodes:(goldRow.checkpoints.find(c=>c.batch===checkpoint.batch).private_causal??g).reason.nodes.map(n=>({id:n.id,claim:strip(n.claim)})),acceptedGraphs},supportSpans:spans};
  return {gold,scoringOptions};
}

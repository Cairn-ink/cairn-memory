import { createHash } from 'node:crypto';
import { scoreBM25 } from './context-read-bm25.mjs';
import { termFrequencies, tokenizeT1 } from './context-read-tokenize.mjs';
import { cosine } from './context-read-embedder.mjs';
import { RAW_SEARCH_LIMITS, binary } from './raw-search-input.mjs';

const order = (a,b) => b.score-a.score || binary(a.id,b.id);
export const searchProjection = text => text.normalize('NFKC').replace(/\s+/gu,' ').trim();
/** Exact source offsets; normalization happens independently inside each chunk. */
export function rawSearchChunks(text, offset = 0) {
  const result = []; let start = 0, end = 0;
  const emit = () => {
    if (start === end) return;
    const input = searchProjection(text.slice(start,end));
    if (input) result.push({ start:offset+start,end:offset+end,input,
      inputIdentity:createHash('sha256').update(input).digest('hex') });
  };
  // Normalization can expand text. Test the normalized input after every code
  // point, reserving the existing adapter's byte framing allowance.
  for (const cp of text) {
    const next = searchProjection(text.slice(start,end)+cp);
    if (end > start && (next.length > 4000 || Buffer.byteLength(next) > 8000)) {
      emit(); start=end;
    }
    end += cp.length;
  }
  emit();
  return result;
}
export const rawSearchPostings = text => {
  const { length,frequencies } = termFrequencies(text);
  return { length,terms:[...frequencies] };
};
const merge = (docs,check=()=>{}) => {
  const frequencies = new Map(); let length=0;
  for (const doc of docs) {check();length+=doc.length; for (const [term,f] of doc.frequencies) frequencies.set(term,(frequencies.get(term)??0)+f); }
  return { length,frequencies };
};
function rank(docs, terms,check=()=>{}) {
  const df = new Map(), totalLength = docs.reduce((n,d)=>{check();return n+d.length;},0);
  for (const doc of docs) {check();for (const term of doc.frequencies.keys()) df.set(term,(df.get(term)??0)+1);}
  const corpus = {N:docs.length,totalLength,df};
  return docs.map(d=>{check();return {id:d.id,score:scoreBM25(terms,d,corpus)??0};}).filter(d=>d.score>0).sort((a,b)=>{check();return order(a,b);});
}
export function rawSearchRrf(left,right,limit=24) {
  const scores=new Map();
  for (const list of [left,right]) list.slice(0,limit).forEach((row,i)=>scores.set(row.id,(scores.get(row.id)??0)+.5/(11+i)));
  return [...scores].map(([id,score])=>({id,score})).sort(order).slice(0,limit);
}
/** Pure hierarchy arithmetic, with independent turn/session/within corpora. */
export function retrieveRaw(segments,query,{ vectors = null,queryVector = null,maxWork=50000,maxTurns=256,check=()=>{},accept=()=>true } = {}) {
  const compare=(a,b)=>{check();return order(a,b);};
  const turns=new Map(), sessions=new Map(); let work=0, partial=false,turnPartial=false;
  const charge = n => { work+=n; if (work>maxWork) {partial=true;return false;} return true; };
  for (const segment of segments) {check();
    if (!charge(1)) break;
    const source=segment.source, ref=source.ref;
    const id=JSON.stringify([ref.namespace,ref.conversationId,ref.messageId]);
    const sessionId=JSON.stringify([ref.namespace,ref.conversationId]);
    let turn=turns.get(id);
    if (!turn) { turn={id,sessionId,ordinal:source.ordinal,role:source.role,segments:[]}; turns.set(id,turn); }
    turn.segments.push(segment);
  }
  for (const turn of turns.values()) {check();
    Object.assign(turn,merge(turn.segments.map(s=>({length:s.postings.length,frequencies:new Map(s.postings.terms)})),check));
    const spans=turn.segments.map(s=>s.source.ref.span).filter(Boolean).sort((a,b)=>a.start-b.start);
    let through=0;
    for(const span of spans){if(span.start!==through)break;through=span.end;}
    const total=turn.segments[0].source.totalUnits??turn.segments[0].source.manifest?.message.total_units;
    turn.complete=total===undefined||through===total;
    const members=sessions.get(turn.sessionId)??[]; members.push(turn);sessions.set(turn.sessionId,members);
  }
  const terms=[...new Set(tokenizeT1(query))], own=d=>terms.filter(t=>d.frequencies.has(t)).length/(terms.length||1);
  const all=[...turns.values()], lexical=rank(all,terms,check).slice(0,maxTurns);
  const sessionDocs=[...sessions].map(([id,members])=>{check();
    members.sort((a,b)=>{check();return a.ordinal-b.ordinal||binary(a.id,b.id);});
    // The prototype prefixes each message's role only in session documents.
    const roleDocs=members.map(m=>{check();const tf=termFrequencies(m.role);return {...tf};});
    return {id,...merge([...members,...roleDocs],check)};
  });
  const vectorScores=vectors?.blocks?scoreRawVectorBlocks(vectors,queryVector,check):null;
  const chunkMax=segment=>{check();return vectorScores?vectorScores[vectors.positions.get(segment.key)]:
    Math.max(-Infinity,...(vectors.get(segment.key)??[]).map(v=>cosine(queryVector,v)));};
  const semantic=vectors&&queryVector?new Map(all.map(t=>[t.id,Math.max(-Infinity,...t.segments.map(chunkMax))])):null;
  const semRank=docs=>docs.map(d=>({id:d.id,score:semantic.get(d.id)})).filter(d=>Number.isFinite(d.score)).sort(compare).slice(0,maxTurns);
  const globalRank=semantic ? rawSearchRrf(lexical,semRank(all),maxTurns) : lexical;
  const semSessions=semantic ? [...sessions].map(([id,m])=>({id,score:Math.max(...m.map(t=>semantic.get(t.id)))})).sort(compare).slice(0,maxTurns) : null;
  const sessionRank=rank(sessionDocs,terms,check).slice(0,maxTurns);
  const rankedSessions=semantic?rawSearchRrf(sessionRank,semSessions,maxTurns):sessionRank;
  const within=[];
  for (const session of rankedSessions) {
    const members=sessions.get(session.id);
    if (!charge(members.length)) break;
    const bm=rank(members,terms,check), scores=new Map(bm.map(row=>[row.id,row.score])), max=Math.max(1e-12,...scores.values());
    const lexicalWithin=members.map((t,i)=>({id:t.id,score:(scores.get(t.id)??0)/max+.6*own(t)+.35*own(merge(
      [members[i-1]?.ordinal===t.ordinal-1?members[i-1]:null,members[i+1]?.ordinal===t.ordinal+1?members[i+1]:null].filter(Boolean)))}))
      .filter(t=>t.score>0).sort(compare).slice(0,maxTurns);
    within.push((semantic?rawSearchRrf(lexicalWithin,semRank(members),maxTurns):lexicalWithin).slice(0,3));
  }
  const centers=[0,1,2].flatMap(i=>within.flatMap(hits=>hits[i]?[hits[i]]:[]));
  const scores=new Map();
  for (const list of [globalRank,centers]) list.forEach((row,i)=>scores.set(row.id,(scores.get(row.id)??0)+1/(61+i)));
  const candidates=new Map();
  for (const [id,score] of [...scores].sort((a,b)=>{check();return b[1]-a[1]||binary(a[0],b[0]);})) {
    const center=turns.get(id),members=sessions.get(center.sessionId),index=members.indexOf(center);
    for (const [turn,factor] of [[center,1],[members[index-1],.65],[members[index+1],.65]]) {
      if (!turn || Math.abs(turn.ordinal-center.ordinal)>1 || turn!==center&&(!turn.complete||!center.complete)) continue;
      if (!charge(1)) break;
      if (!candidates.has(turn.id)&&candidates.size>=maxTurns) {turnPartial=true;continue;}
      if (!candidates.has(turn.id)||candidates.get(turn.id).score<score*factor)
        candidates.set(turn.id,{id:turn.id,turn,score:score*factor,centerId:id,neighbor:id!==turn.id});
    }
  }
  const rows=[];
  for(const row of [...candidates.values()].sort(compare)){
    check();const accepted=accept(row,turns.get(row.centerId));
    if(accepted)rows.push(accepted===true?row:accepted);
    if(rows.length===RAW_SEARCH_LIMITS.depth)break;
  }
  const incomplete=rows.some(row=>!row.turn.complete);
  const contributors=new Map();
  for(const row of rows)for(const turn of [row.turn,turns.get(row.centerId)])
    for(const segment of turn.segments)contributors.set(JSON.stringify(segment.source.ref),segment.source);
  return {rows,sources:[...contributors.values()],coverage:{status:partial||turnPartial||incomplete?'partial':'complete',scanned:Math.min(work,maxWork),expanded:candidates.size,
    causes:[...(partial?['work_limit']:[]),...(turnPartial?['turn_limit']:[]),...(incomplete?['partial_turn']:[])]}};
}

/** Load/validate once before the scoring loop. Blocks contain whole fp32 vectors;
 * segment offsets retain every contributing chunk, including chunk maxima. */
export function loadRawVectorBlocks(segments,metadata,check=()=>{}) {
  const dimensions=metadata.dimensions,blockVectors=256,blocks=[],positions=new Map();
  const offsets=new Uint32Array(segments.length+1),total=segments.reduce((n,s)=>{check();return n+s.chunks.length;},0);let count=0;
  for(let i=0;i<segments.length;i++){
    positions.set(segments[i].key,i);offsets[i]=count;
    for(const chunk of segments[i].chunks){check();
      const bytes=chunk.vector;
      if(!(bytes instanceof Uint8Array)||bytes.byteLength!==dimensions*4)throw Object.assign(Error('dimension_mismatch'),{code:'dimension_mismatch'});
      if(count%blockVectors===0)blocks.push(new Float32Array(Math.min(blockVectors,total-count)*dimensions));
      const block=blocks.at(-1),start=count%blockVectors*dimensions;
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let squared=0;
      for(let j=0;j<dimensions;j++){
        if(j%4096===0)check();
        const value=view.getFloat32(j*4,true);block[start+j]=value;squared+=value*value;
      }
      const norm=Math.sqrt(squared);
      if(!Number.isFinite(norm)||norm<=0||metadata.normalization==='l2'&&Math.abs(norm-1)>1e-5)
        throw Object.assign(Error('invalid_vector'),{code:'invalid_vector'});
      count++;
    }
  }
  offsets[segments.length]=count;
  return {blocks,offsets,positions,dimensions,blockVectors,count};
}
/** No row objects, vector conversions, JSON or allocation in the inner scan. */
export function scoreRawVectorBlocks({blocks,offsets,dimensions,blockVectors},query,check=()=>{}) {
  const scores=new Float64Array(offsets.length-1);let querySquared=0;
  for(let j=0;j<dimensions;j++)querySquared+=query[j]*query[j];
  for(let segment=0;segment<scores.length;segment++){
    let max=-Infinity;
    for(let vector=offsets[segment];vector<offsets[segment+1];vector++){check();
      const block=blocks[Math.floor(vector/blockVectors)],start=vector%blockVectors*dimensions;
      let dot=0,squared=0;
      for(let j=0;j<dimensions;j++){if(j%4096===0)check();const v=block[start+j];dot+=query[j]*v;squared+=v*v;}
      const score=dot/(Math.sqrt(querySquared)*Math.sqrt(squared));
      if(!Number.isFinite(score))throw Object.assign(Error('invalid_vector'),{code:'invalid_vector'});
      max=Math.max(max,Math.max(-1,Math.min(1,score)));
    }
    scores[segment]=max;
  }
  return scores;
}

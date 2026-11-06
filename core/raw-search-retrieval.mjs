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
const merge = docs => {
  const frequencies = new Map(); let length=0;
  for (const doc of docs) { length+=doc.length; for (const [term,f] of doc.frequencies) frequencies.set(term,(frequencies.get(term)??0)+f); }
  return { length,frequencies };
};
function rank(docs, terms) {
  const df = new Map(), totalLength = docs.reduce((n,d)=>n+d.length,0);
  for (const doc of docs) for (const term of doc.frequencies.keys()) df.set(term,(df.get(term)??0)+1);
  const corpus = {N:docs.length,totalLength,df};
  return docs.map(d=>({id:d.id,score:scoreBM25(terms,d,corpus)??0})).filter(d=>d.score>0).sort(order);
}
export function rawSearchRrf(left,right) {
  const scores=new Map();
  for (const list of [left,right]) list.slice(0,24).forEach((row,i)=>scores.set(row.id,(scores.get(row.id)??0)+.5/(11+i)));
  return [...scores].map(([id,score])=>({id,score})).sort(order).slice(0,24);
}
/** Pure hierarchy arithmetic, with independent turn/session/within corpora. */
export function retrieveRaw(segments,query,{ vectors = null,queryVector = null,maxWork=50000,maxTurns=256 } = {}) {
  const turns=new Map(), sessions=new Map(); let work=0, partial=false,turnPartial=false;
  const charge = n => { work+=n; if (work>maxWork) {partial=true;return false;} return true; };
  for (const segment of segments) {
    if (!charge(1)) break;
    const source=segment.source, ref=source.ref;
    const id=JSON.stringify([ref.namespace,ref.conversationId,ref.messageId]);
    const sessionId=JSON.stringify([ref.namespace,ref.conversationId]);
    let turn=turns.get(id);
    if (!turn) { turn={id,sessionId,ordinal:source.ordinal,role:source.role,segments:[]}; turns.set(id,turn); }
    turn.segments.push(segment);
  }
  for (const turn of turns.values()) {
    Object.assign(turn,merge(turn.segments.map(s=>({length:s.postings.length,frequencies:new Map(s.postings.terms)}))));
    const spans=turn.segments.map(s=>s.source.ref.span).filter(Boolean).sort((a,b)=>a.start-b.start);
    let through=0;
    for(const span of spans){if(span.start!==through)break;through=span.end;}
    const total=turn.segments[0].source.manifest?.message.total_units;
    turn.complete=total===undefined||through===total;
    const members=sessions.get(turn.sessionId)??[]; members.push(turn);sessions.set(turn.sessionId,members);
  }
  const terms=[...new Set(tokenizeT1(query))], own=d=>terms.filter(t=>d.frequencies.has(t)).length/(terms.length||1);
  const all=[...turns.values()], lexical=rank(all,terms).slice(0,24);
  const sessionDocs=[...sessions].map(([id,members])=>{
    members.sort((a,b)=>a.ordinal-b.ordinal||binary(a.id,b.id));
    // The prototype prefixes each message's role only in session documents.
    const roleDocs=members.map(m=>{const tf=termFrequencies(m.role);return {...tf};});
    return {id,...merge([...members,...roleDocs])};
  });
  const semantic=vectors&&queryVector ? new Map(all.map(t=>[t.id,Math.max(-Infinity,
    ...t.segments.flatMap(s=>(vectors.get(s.key)??[]).map(v=>cosine(queryVector,v))))])) : null;
  const semRank=docs=>docs.map(d=>({id:d.id,score:semantic.get(d.id)})).filter(d=>Number.isFinite(d.score)).sort(order).slice(0,24);
  const global=semantic ? rawSearchRrf(lexical,semRank(all)) : lexical;
  const semSessions=semantic ? [...sessions].map(([id,m])=>({id,score:Math.max(...m.map(t=>semantic.get(t.id)))})).sort(order).slice(0,24) : null;
  const sessionRank=rank(sessionDocs,terms).slice(0,24);
  const rankedSessions=semantic?rawSearchRrf(sessionRank,semSessions):sessionRank;
  const within=[];
  for (const session of rankedSessions) {
    const members=sessions.get(session.id);
    if (!charge(members.length)) break;
    const bm=rank(members,terms), scores=new Map(bm.map(row=>[row.id,row.score])), max=Math.max(1e-12,...scores.values());
    const lexicalWithin=members.map((t,i)=>({id:t.id,score:(scores.get(t.id)??0)/max+.6*own(t)+.35*own(merge(
      [members[i-1]?.ordinal===t.ordinal-1?members[i-1]:null,members[i+1]?.ordinal===t.ordinal+1?members[i+1]:null].filter(Boolean)))}))
      .filter(t=>t.score>0).sort(order).slice(0,24);
    within.push((semantic?rawSearchRrf(lexicalWithin,semRank(members)):lexicalWithin).slice(0,3));
  }
  const centers=[0,1,2].flatMap(i=>within.flatMap(hits=>hits[i]?[hits[i]]:[]));
  const scores=new Map();
  for (const list of [global,centers]) list.forEach((row,i)=>scores.set(row.id,(scores.get(row.id)??0)+1/(61+i)));
  const candidates=new Map();
  for (const [id,score] of [...scores].sort((a,b)=>b[1]-a[1]||binary(a[0],b[0]))) {
    const center=turns.get(id),members=sessions.get(center.sessionId),index=members.indexOf(center);
    for (const [turn,factor] of [[center,1],[members[index-1],.65],[members[index+1],.65]]) {
      if (!turn || Math.abs(turn.ordinal-center.ordinal)>1 || turn!==center&&(!turn.complete||!center.complete)) continue;
      if (!charge(1)) break;
      if (!candidates.has(turn.id)&&candidates.size>=maxTurns) {turnPartial=true;continue;}
      if (!candidates.has(turn.id)||candidates.get(turn.id).score<score*factor)
        candidates.set(turn.id,{id:turn.id,turn,score:score*factor,centerId:id,neighbor:id!==turn.id});
    }
  }
  const rows=[...candidates.values()].sort(order).slice(0,RAW_SEARCH_LIMITS.depth),incomplete=rows.some(row=>!row.turn.complete);
  return {rows,coverage:{status:partial||turnPartial||incomplete?'partial':'complete',scanned:Math.min(work,maxWork),expanded:candidates.size,
    causes:[...(partial?['work_limit']:[]),...(turnPartial?['turn_limit']:[]),...(incomplete?['partial_turn']:[])]}};
}

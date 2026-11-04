// Independent frozen BM25 arithmetic over canonical authoring inputs, never a
// context-read result. T1 is the normative text grammar, not a ranking oracle.
import { tokenizeT1 } from '../../core/context-read-tokenize.mjs';
import { compareRefs } from './corpus.mjs';
export function goldRanking(catalog,query) {
  const docs=catalog.map(d=>({...d,tokens:tokenizeT1(d.text)})),terms=[...new Set(tokenizeT1(query))],N=docs.length;
  const avg=docs.reduce((n,d)=>n+d.tokens.length,0)/(N||1),df=new Map(terms.map(t=>[t,docs.filter(d=>d.tokens.includes(t)).length]));
  return docs.map(d=>{let matched=false,score=0;for(const t of terms){const f=d.tokens.filter(x=>x===t).length;if(!f)continue;matched=true;score+=Math.log(1+(N-df.get(t)+0.5)/(df.get(t)+0.5))*f*2.2/(f+1.2*(0.25+0.75*d.tokens.length/avg));}return {...d,matched,score};})
    .filter(d=>d.matched).sort((a,b)=>b.score-a.score||compareRefs(a.ref,b.ref)).map(d=>d.ref);
}

import { isDeepStrictEqual } from 'node:util';

export function createContextReadHost({requestBinding,issued,attempts}) {
  const counts=new Int32Array(attempts);
  return {
    authorize({method,input}) {
      const matches=isDeepStrictEqual({method,input},issued);
      Atomics.add(counts,matches?0:1,1);
      return matches?requestBinding:null;
    },
    isCurrent:()=>true,
    counter:{id:'synthetic-characters',countTokens:text=>text.length},
  };
}

// Independent source-authored A-6 engineering inputs, never paid replies.
import {validateExtraction} from '../schema.mjs';
import {identifyEvents} from '../event-identity.mjs';
const scope={any:[{all:[]}]},date=n=>`2034-01-${String(n).padStart(2,'0')}T00:00:00.000Z`;
export function named(n,{name='n'+n,refs=n===1?[]:['n'+(n-1)],subject='lumiu service',predicate='dispatch configuration',text=null,...patch}={}) {
  text??=`Record ${name??'anonymous'}: adopt route secretRoute${n}. References: ${refs.join(', ')}. Explicit cause secretCause${n}.`;
  const turn='turn'+n,anchor=quote=>({turn_id:turn,quote,occurrence:1});
  const wire={event_id:'local'+n,source_turns:[turn],observed_at:date(n),kind:'decision',commitment:'adopted',change_type:n===1?'initial':'refinement',replacement_extent:n===1?'entire_predecessor':'partial',subject,predicate,scope,effective_interval:{from:date(n),to:null},record_name:name?{name,anchor:anchor(name)}:null,predecessor_refs:refs.map(record_name=>({record_name,anchor:anchor(record_name)})),payload:{type:'slots',route:{value:{type:'Text',text:'secretRoute'+n},anchors:[anchor(text)]},approval:null,cap:null},source_quotes:[anchor(text)],reason_quotes:[],...patch};
  const input={observed_at:wire.observed_at,turns:[{turn_id:turn,text}]};
  return {wire,input,event:()=>identifyEvents('independent-name-world',n,validateExtraction({events:[wire]},input).events)[0]};
}

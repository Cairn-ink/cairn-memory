// Public independently authored teaching worlds, engineering conformance only.
// These reserved demo worlds never enter research/calibration or paid dispatch.
import {CONTRACT_A6} from './contract-projection-a6.mjs';
export function inheritanceCasesA6(){return CONTRACT_A6.worked_examples.inheritance_pairs.flatMap(pair=>pair.variants.map(variant=>{
 const family_id='independent-inheritance-'+pair.language+'-'+variant.explicit_preservation;
 const initial=CONTRACT_A6.worked_examples.extraction.find(x=>x.language===pair.language&&x.id.startsWith('demo-own-reference')).batches[0].expected[0];
 const make=(turn,n,slots,name,refs)=>{const anchor=quote=>({turn_id:turn.turn_id,quote,occurrence:1});return {...structuredClone(initial),event_id:'e'+n,source_turns:[turn.turn_id],observed_at:`2034-07-${String(n+8).padStart(2,'0')}T02:00:00.000Z`,change_type:n===1?'initial':'refinement',replacement_extent:n===1?'entire_predecessor':'partial',record_name:{name,anchor:anchor(name)},predecessor_refs:refs.map(record_name=>({record_name,anchor:anchor(record_name)})),source_quotes:[anchor(turn.text)],payload:{type:'slots',...Object.fromEntries(Object.entries(slots).map(([k,value])=>[k,value?{value,anchors:[anchor(turn.text)]}:null]))}};};
 const wires=[make(pair.predecessor,1,{route:{type:'Text',text:'demoRoute9'},approval:{type:'Boolean',value:false},cap:{type:'Quantity',decimal:'17',unit:'requests/day'}},'demoLira',[]),make(variant.turn,2,variant.supplied_slots,'demoPico',['demoLira'])];
 const question='Give complete route, approval and cap, predecessor demo-start, and the complete quoted explanation. Historical labels: erroneous, previously_adopted, expired, unavailable, unresolved.';
 const family={family_id,language:pair.language,header:{subject:'demoService',predicate:'dispatch configuration',scope_text:'all 12 audience cells'},namespace:{ownerId:'independent-inheritance',scope:'personal',projectId:null},batches:[pair.predecessor,variant.turn].map((turn,i)=>({ordinal:i+1,observed_at:wires[i].observed_at,turns:[structuredClone(turn)]})),checkpoints:[{batch:2,at:wires[1].observed_at,question,focal_turn:variant.turn.turn_id,requested_predecessor_turns:[pair.predecessor.turn_id]}]};
 return {family,wires,expected_current:structuredClone(pair.expected_current),explicit_preservation:variant.explicit_preservation};
}));}

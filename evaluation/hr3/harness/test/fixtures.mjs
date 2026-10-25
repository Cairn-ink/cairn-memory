export const scope={any:[{all:[]}]};
export const tw={any:[{all:[{field:'country',values:['TW']}]}]};
export const text=text=>({type:'Text',text});
export const date=n=>`2031-01-${String(n).padStart(2,'0')}T00:00:00.000Z`;
export function event(n,patch={}) {
  return {event_id:'e'+n,source_turns:['t'+n],observed_at:date(n),kind:'decision',commitment:'adopted',change_type:n===1?'initial':'reversal',subject:'service',predicate:'route',claims:[{field:'value',value:text(String(n))}],scope,effective_interval:{from:date(n),to:null},record_name:{name:String(n),anchor:{turn_id:'t'+n,quote:String(n),occurrence:1,start:0,end:String(n).length}},predecessor_refs:n===1?[]:[{record_name:String(n-1),anchor:{turn_id:'t'+n,quote:String(n-1),occurrence:1,start:2,end:2+String(n-1).length}}],source_turn_order:['t'+n],replacement_extent:'entire_predecessor',field_mask:['value'],reason_nodes:[],reason_edges:[],source_quotes:[{turn_id:'t'+n,start:0,end:1,quote:String(n)}],batch:n,ordinal:0,...patch};
}
export function publicFamily() {return {family_id:'synthetic',header:{subject:'service',predicate:'route',scope_text:'all'},batches:[{ordinal:1,observed_at:date(1),turns:[{turn_id:'t1',speaker:'user',text:'1'}]}]};}
export const plan=[{operation:'extraction',ids:'^.+$',maxDispatches:100},{operation:'reader',ids:'^.+$',maxDispatches:100},{operation:'research-embedding',ids:'^.+$',maxDispatches:100},{operation:'product-embedding',ids:'^.+$',maxDispatches:100}];
export function referenceCases() {
 const a=event(1),partial=event(2,{change_type:'refinement',replacement_extent:'partial',claims:[{field:'cap',value:text('20')}],field_mask:['cap']}),scoped=event(2,{scope:tw,change_type:'scope_change',replacement_extent:'partial'});
 return [
  {name:'correction',events:[a,event(2,{change_type:'correction'})],at:date(2)},
  {name:'reversal',events:[a,event(2)],at:date(2)},
  {name:'partial_refinement',events:[event(1,{claims:[{field:'value',value:text('route')},{field:'cap',value:text('10')}],field_mask:['value','cap']}),partial],at:date(2)},
  {name:'overlapping_scopes',events:[a,scoped],at:date(2)},
  {name:'retroactive_correction',events:[a,event(3,{change_type:'correction',effective_interval:{from:date(2),to:null},predecessor_refs:event(2).predecessor_refs})],at:date(3)},
  {name:'future_pending',events:[a,event(2,{effective_interval:{from:date(4),to:null}})],at:date(2)},
  {name:'future_activated',events:[a,event(2,{effective_interval:{from:date(4),to:null}})],at:date(4)},
  {name:'expiry',events:[a,event(2,{effective_interval:{from:date(2),to:date(3)}})],at:date(3)},
  {name:'multiple_predecessors',events:[a,scoped,event(3,{predecessor_refs:[...event(3).predecessor_refs,...event(2).predecessor_refs]})],at:date(3)},
  {name:'unresolved_link',events:[a,event(2,{predecessor_refs:[]})],at:date(2)}
 ];
}

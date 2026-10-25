// Independent adapter engineering witnesses; no calibration or pilot answers.
export function a4Fixture() {
  const scope={any:[{all:[]}]},valid={from:null,to:null};
  const slot=value=>({state:value===null?'not_specified':'value',value});
  const row=route=>({scope:structuredClone(scope),valid:structuredClone(valid),route:slot(route),approval:slot(true),cap:slot({decimal:'48',unit:'requests/day'}),citations:[]});
  const claim=text=>({subject:'engineering example',predicate:'causal_condition',value:{type:'Text',text},scope:structuredClone(scope),valid:structuredClone(valid),qualifiers:[],citations:[]});
  const citation=(item,quote,intent='current')=>({intent,item,unit:'body',source:null,quote,occurrence:1});
  const answer={current:{status:'active',rows:[row('route-b')]},old:{status:'available',records:[{predecessor_turn:'prior-turn',status:'previously_adopted',rows:[row('route-a')]}]},reason:{status:'stated',support:[]}};
  const delivered=[{item:0,unit:'body',source:null,text:'A causes B.'},{item:1,unit:'body',source:null,text:'B causes C.'},{item:2,unit:'body',source:null,text:'Previously route-a.'}];
  const gold={answer,private_causal:{reason:{nodes:['A','B','C'].map(id=>({id,claim:claim(id)}))}},acceptedGraphs:[{edges:[{from:'A',to:'B'},{from:'B',to:'C'}]}]};
  const question='Give route, approval and cap, the predecessor prior-turn, and the complete explanation.';
  const world={id:'independent-a4',question,gold:structuredClone(gold),delivered:structuredClone(delivered),row_support:[{citation:citation(2,delivered[2].text,'history')}],edge_support:[{from:'A',to:'B',alternatives:[[citation(0,delivered[0].text)]]},{from:'B',to:'C',alternatives:[[citation(1,delivered[1].text)]]}]};
  const candidate=structuredClone(answer);candidate.reason.support=[citation(0,delivered[0].text),citation(1,delivered[1].text)];candidate.old.records[0].rows[0].citations=[citation(2,delivered[2].text,'history')];
  return {row:{id:'independent-a4-row',world_id:world.id,question,gold,candidate,delivered},world};
}

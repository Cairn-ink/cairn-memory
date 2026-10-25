// Closed A-4 wire schema. Used by runtime and certificates after A-4.1;
// admission remains separate from structural/provider validation.
const s={type:'string'},arr=items=>({type:'array',items});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const ref=name=>({$ref:'#/$defs/'+name});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const tag=value=>({type:'string',const:value});
const decimal={type:'string',pattern:String.raw`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$`};
export const SCHEMA_VERSION='hr3-extraction-a4-preflight-v1';
const defs={
  Anchor:obj({turn_id:s,quote:s,occurrence:{type:'integer',minimum:1}}),
  Scope:obj({any:arr(obj({all:arr(obj({field:s,values:arr(s)}))}))}),
  Interval:obj({from:nullable(s),to:nullable(s)}),
  // Well-shaped but incompatible Values must reach independent admission;
  // therefore the provider schema cannot constrain each slot to its domain.
  Value:{anyOf:[obj({type:tag('Text'),text:s}),obj({type:tag('Boolean'),value:{type:'boolean'}}),
    obj({type:tag('Quantity'),decimal,unit:s}),obj({type:tag('Instant'),iso:s}),
    obj({type:tag('Range'),lower:nullable(decimal),upper:nullable(decimal),lowerClosed:{type:'boolean'},upperClosed:{type:'boolean'},unit:s})]},
  Supplied:nullable(obj({value:ref('Value'),anchors:arr(ref('Anchor'))})),
};
export const preflightExtractionSchema={...obj({events:arr(obj({
  event_id:s,source_turns:arr(s),observed_at:s,kind:s,
  commitment:s,
  change_type:s,subject:s,predicate:s,
  payload:{anyOf:[obj({type:tag('slots'),route:ref('Supplied'),approval:ref('Supplied'),cap:ref('Supplied')}),
    obj({type:tag('context'),text:s,anchors:arr(ref('Anchor'))})]},
  scope:ref('Scope'),effective_interval:ref('Interval'),
  predecessor_anchors:arr(obj({source_turn:s,record_name:s,subject:s,predicate:s})),
  replacement_extent:s,
  reason_quotes:arr(ref('Anchor')),source_quotes:arr(ref('Anchor')),
}))}),$defs:defs};

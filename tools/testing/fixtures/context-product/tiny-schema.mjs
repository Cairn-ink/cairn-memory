// Closed lexical candidate DTO. This is also a useful registration building block.
const object=properties=>({type:'object',properties}),en=(...values)=>({enum:values});
const number={type:'number',min:0},integer={...number,integer:true},text={type:'string'},nullable=s=>({oneOf:[en(null),s]});
const array=(items,max=24)=>({type:'array',items,max});
const namespace=object({ownerId:text,scope:en('personal','project'),projectId:nullable(text)});
const memoryRef=object({type:en('memory'),namespace,memoryId:text,revision:integer});
const cardRef=object({type:en('card'),namespace,cardId:text,revision:integer,bodyRevision:integer});
const rank=object({rank:integer,rawScore:number});
const selection=object({policy:en('recent-projects-v1'),selectionRevision:text,requestedNamespaces:integer,selectedNamespaces:integer,omittedNamespaces:integer});
const channel=object({state:en('ready','disabled','absent','unavailable','partial_coverage','stale_index','timeout','budget_denied'),causes:array(text)});
const byType=object({eligible:nullable(integer),indexed:nullable(integer),embedded:nullable(integer),scanned:nullable(integer),embeddedFraction:nullable(number),scannedFraction:nullable(number)});
const types={oneOf:[object({memory:byType}),object({memory:byType,card:byType}),object({card:byType})]};
export const candidateSchema=object({ok:en(true),value:object({version:en('context-read-v1'),items:array(object({ref:{oneOf:[memoryRef,cardRef]},rank:integer,fusionScore:nullable(number),channels:object({lexical:nullable(rank),semantic:nullable(rank)})})),
  channels:object({lexical:channel,semantic:channel}),
  coverage:object({status:en('complete','partial','unavailable'),freshness:en('current','stale','unverified'),byType:types,namespaces:selection,
    maintenance:object({available:{type:'boolean'},state:en('ready','rebuilding','partial'),buildState:en('ready','rebuilding','partial'),reason:nullable(text),progress:nullable(object({phase:integer,checkpoint:integer,sequence:integer,baseSequence:integer}))}),
    depths:object({lexical:integer,semantic:integer}),omitted:object({lexical:nullable(integer),semantic:nullable(integer),horizon:nullable(integer)}),stops:object({deadline:{type:'boolean'},budget:{type:'boolean'}})}),
  trace:{...object({namespaceSelection:selection,requested:en('lexical','hybrid'),effective:en('lexical','hybrid'),family:en('local','hosted'),preset:en('rrf-k60-d12','rrf-k10'),embedder:en(null),tokenizer:en('hr1-t1-v1'),representation:en('candidate-text-v1'),
    timings:object({maintenanceMs:number,lexicalMs:number,semanticPreflightMs:number,embeddingMs:number,fusionMs:number})}),optional:['namespaceSelection']},nextCursor:nullable({type:'string',max:8192})})});
export const tinySchema=candidateSchema;

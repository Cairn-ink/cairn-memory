// Explicit public authoring paths. Arrays use '*'; no subtree wildcard exists.
// Colliding leaf names are licensed by the closed extraction/answer schemas or
// the listed public product-operation fields, never by an authoring container.
import {preflightExtractionSchema} from './preflight-a4-schema.mjs';
import {answerSchema} from '../scorer/schema.mjs';
export const PUBLIC_AUTHOR_PATHS=[
 'language','change_type','namespace','namespace.ownerId','namespace.scope','namespace.projectId',
 'header','header.subject','header.predicate','header.scope_text','batches','batches.*','batches.*.ordinal','batches.*.observed_at','batches.*.effective_at','batches.*.turns','batches.*.turns.*','batches.*.turns.*.turn_id','batches.*.turns.*.speaker','batches.*.turns.*.text',
 'ast.events','ast.events.*',...['event_id','source_turns','observed_at','kind','commitment','change_type','subject','predicate','scope','effective_interval','predecessor_anchors','replacement_extent','source_quotes','claims'].map(k=>'ast.events.*.'+k),
 ...['scope.any','scope.any.*','scope.any.*.all','scope.any.*.all.*','scope.any.*.all.*.field','scope.any.*.all.*.values','scope.any.*.all.*.values.*','effective_interval.from','effective_interval.to','source_turns.*','predecessor_anchors.*','predecessor_anchors.*.source_turn','predecessor_anchors.*.record_name','predecessor_anchors.*.subject','predecessor_anchors.*.predicate','source_quotes.*','source_quotes.*.turn_id','source_quotes.*.start','source_quotes.*.end','source_quotes.*.offset_unit','source_quotes.*.quote','claims.*','claims.*.field','claims.*.value','claims.*.value.type','claims.*.value.text','claims.*.value.value','claims.*.value.decimal','claims.*.value.unit','claims.*.value.iso','claims.*.value.lower','claims.*.value.upper','claims.*.value.lowerClosed','claims.*.value.upperClosed'].map(k=>'ast.events.*.'+k),
];
export const PUBLIC_PRODUCT_FIELDS=['public_header','public_contract','turns','question','checkpoint','focal_turn','requested_predecessor_turns','namespace','ownerId','scope','projectId','content','kind','receipts','excerpt','source','role','id','memoryId','cardId','expectedRevision','readSet','types','intent','budget','maxItems','maxMs','query','semantic','limit','deadlineMs','maxTokens','title','body','input','authoredInput','text','actionId','type','version','sourceId','revision','expectedBodyRevision','reason','dependencies','memory','confidence','origin','state','support','sourceRevision','sourceMemoryId','bodyRevision','namespaceIndex','ns','rev','f','index','sameAs','sameAsBody','item','metadata','filing','reviewState'];
export const PRODUCT_SCHEMA_BINDINGS={
 'core/private-card-input.mjs':['occurredAt','drafting','bindings','applicability','sources','memoryRefs','sourcePolicy','sourceId','contentIdentity','completeness'],
 'core/method-package-input.mjs':['files','mediaType','path','basedOn','expectedPackageRevision','bindingNamespace','package','packageId','versionId','manifestIdentity','roleId','roleKey','change','items','reasonRefs','summary','paths'],
 'core/card-current-input.mjs':['currentDependencies','context','packages','snapshot','expectedDependencyRevision'],
};
export function publicVocabulary(){const names=new Set([...PUBLIC_PRODUCT_FIELDS,...Object.values(PRODUCT_SCHEMA_BINDINGS).flat()]);for(const p of PUBLIC_AUTHOR_PATHS)names.add(p.split('.').at(-1));
 const visit=x=>{if(!x||typeof x!=='object')return;for(const k of Object.keys(x.properties??{}))names.add(k);for(const y of Object.values(x))visit(y);};visit(preflightExtractionSchema);visit(answerSchema);return names;}

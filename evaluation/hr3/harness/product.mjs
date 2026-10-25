// P's only product entrypoints are the public core and MCP constructors.
import { openMemoryCore } from '../../../core/index.mjs';
import { createCairnServer } from '../../../adapters/mcp/server.mjs';
import { Client } from '@modelcontextprotocol/client';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, normalize, hash, orderEvents, intervalStart } from './common.mjs';
import {PrivacyGuard,sourceOrderAliases,neutralControl,namespaceAliases} from './privacy.mjs';
import { freshEvents } from './event-identity.mjs';
import { resolveLinks, unit,distinctQuotes,compactSlots,ingestionLosses } from './research.mjs';
const ok=r=>{if(!r.ok)throw Object.assign(Error(r.error.code),{code:r.error.code});return r.value;};
const TOKEN=Object.freeze({fixtureAuthority:'explicit-user'});
function linkedTransports() {
  const pair=[{},{}];
  pair.forEach((port,i)=>Object.assign(port,{async start(){},async send(message){queueMicrotask(()=>pair[1-i].onmessage?.(structuredClone(message)));},async close(){port.onclose?.();}}));return pair;
}
export function formatEvent(e,readerId='record') {
  const header=canonical({record:readerId,subject:e.subject,predicate:e.predicate,kind:e.context?'context':'slots',
    scope:e.scope,valid:e.effective_interval,...(e.context?{}:{slots:compactSlots(e.claims)}),sources:e.source_turns});
  // Every admitted quotation occurs once in this formatter. Never append any
  // predecessor text, residual scope or overwritten-content reconstruction.
  return header+'\n'+distinctQuotes([e]).map(q=>`${q.turn_id}: ${q.quote}`).join('\n');
}
export class ProductAgent {
  static async open({namespace,embedder,counter,tempRoot=tmpdir(),onAuthorizationExposure=()=>{},privacy=new PrivacyGuard(),aliases=sourceOrderAliases()}={}) {
    const self=new ProductAgent();self.aliases=aliases;self.namespaceAliases=namespaceAliases(namespace);namespace=self.namespaceAliases.own;self.namespace=namespace;self.privacy=privacy;self.embedder=embedder;counter={id:counter.id,countTokens:counter.countTokens};self.counter=counter;
    self.directory=mkdtempSync(join(tempRoot,'hr3-p-'));chmodSync(self.directory,0o700);self.path=join(self.directory,'store.sqlite');
    self.onAuthorizationExposure=onAuthorizationExposure;self.privacy.check('product-payload',{namespace},{surface:'constructor',method:'namespace'});self.log=[{surface:'constructor',method:'namespace',input:{namespace}}];self.events=[];self.refs=new Map();self.pending=[];self.schedules=new Map();self.contentOrigins=new Map();self.receiptOrigins=new Map();self.symbols={};self.controlRecords=[];self.forgottenIds=new Set();
    const allowed=new Set([canonical(namespace)]);
    const authority={authorize(request,token){if(!token||!allowed.has(canonical(request.namespace)))return null;const {input,...grant}=request;return {...grant,accessGeneration:1};},isCurrent(grant){return grant;}};
    const policy={family:'hosted',maxRequests:100000,maxUsd:2.56,maxConcurrent:1,estimateUsd:texts=>texts.reduce((n,t)=>n+Buffer.byteLength(t)+16,0)*.02/1000000};
    self.core=openMemoryCore({path:self.path,privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'}},methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},contextRead:{version:'context-read-v1',authority,embedder,counter,policy}});
    self.server=createCairnServer({path:self.path,namespace,privateCards:'local-v1',methodPackages:'local-v1',privateCardCurrentDependencies:'local-v1',contextRead:'context-read-v1',contextEmbedding:{embedder,policy},contextCounter:counter,client:'hr3',sessionId:'hr3-public-agent'});
    self.client=new Client({name:'hr3-offline-harness',version:'1'});const [a,b]=linkedTransports();
    try {await self.server.connect(a);await self.client.connect(b);return self;}catch(e){await self.close();throw e;}
  }
  call(method,input,authority=TOKEN) {
    input=this.namespaceAliases.payload(input);this.privacy.check('product-payload',input,{surface:'core',method});
    const result=this.core[method](input,authority);this.log.push({surface:'core',method,event:this.activeEvent??null,arm:'P',input:structuredClone(input),result:structuredClone(result),outcome:result.ok?'operation_success':'operation_refusal'});return result;
  }
  async tool(name,input) {
    input=this.namespaceAliases.payload(input);this.privacy.check('product-payload',input,{surface:'mcp',method:name});
    const result=await this.client.callTool({name,arguments:input});this.log.push({surface:'mcp',method:name,input:structuredClone(input),result:structuredClone(result),outcome:result.isError?'operation_refusal':'operation_returned'});return result;
  }
  async toolEnvelope(name,input) {const result=await this.tool(name,input);let envelope;try {envelope=JSON.parse(result.content[0].text);}catch {envelope={ok:false,error:{code:'invalid_mcp_reply'}};}this.log.push({surface:'agent',method:'operation_outcome',operation:name,event:this.activeEvent??null,arm:'P',outcome:envelope.ok?'operation_success':'operation_refusal'});return envelope;}
  inspect(id,namespace=this.namespace) {return this.call('get',{namespace,memoryId:id,receiptLimit:50});}
  registerReceiptOrigin(excerpt,map) {
    const maps=this.receiptOrigins.get(excerpt)??[];
    if(!maps.some(m=>canonical(m)===canonical(map)))maps.push(map);
    this.receiptOrigins.set(excerpt,maps);
  }
  receiptOrigin(excerpt) {
    const maps=this.receiptOrigins.get(excerpt)??[];
    if(maps.length===1)return maps[0];
    if(maps.length>1)this.log.push({surface:'agent',method:'ambiguous_receipt_origin',candidates:maps.length});
    // The product does not expose enough source identity to choose among
    // identical excerpts. Preserve support uncertainty; never guess an origin.
    return null;
  }
  receipts(e) {
    const quotes=[...e.source_quotes].sort((a,b)=>e.source_turns.indexOf(a.turn_id)-e.source_turns.indexOf(b.turn_id)||a.start-b.start);
    this.log.push({surface:'agent',method:'receipt_selection',event:e.event_id,omitted:quotes.slice(4)});
    return quotes.slice(0,4).map((q,i)=>{
      const excerpt=normalize(q.quote).slice(0,800),receipt={client:'hr3',sessionId:'hr3-public-agent',eventId:`${this.aliases.id(e.event_id)}/${i}`,role:'user',excerpt};
      this.registerReceiptOrigin(excerpt,{segments:[{origin:q.turn_id,start:q.start,text:q.quote}],normalize:true,truncate:800});return receipt;
    });
  }
  registerContent(text,e) {
    // Construct a provenance segmentation of the formatter, preserving verbatim quote portions only.
    const segments=[];let cursor=0;
    for(const q of distinctQuotes([e])) {
      const at=text.indexOf(q.quote,cursor);if(at<0)continue;
      if(at>cursor)segments.push({origin:`product-format:${e.event_id}`,start:cursor,text:text.slice(cursor,at)});
      segments.push({origin:q.turn_id,start:q.start,text:q.quote});cursor=at+q.quote.length;
    }
    if(cursor<text.length)segments.push({origin:`product-format:${e.event_id}`,start:cursor,text:text.slice(cursor)});
    this.contentOrigins.set(normalize(text),{segments,normalize:true,truncate:null});
  }
  async ingest(events,at,{linkedEvents}={}) {
    const incoming=freshEvents(this.events,events);
    this.aliases.register(incoming);this.events.push(...incoming);
    const linked=linkedEvents??resolveLinks(this.events);const fresh=new Set(incoming.map(e=>e.event_id));
    for(const e of linked.filter(e=>fresh.has(e.event_id))) {
      this.log.push({surface:'agent',method:'named_link_decision',event:e.event_id,targets:e.targets,errors:e.link_errors,names:e.name_diagnostics});
      if(e.commitment!=='adopted'){this.log.push({surface:'agent',method:'skip_nonadopted',event:e.event_id,source_turns:e.source_turns,reason:'commitment_filter',commitment:e.commitment});continue;}
      if(e.unresolved){this.log.push({surface:'agent',method:'unresolved_mapping',event:e.event_id,errors:e.link_errors,anchor_diagnostics:ingestionLosses(this.events,at,{linkedEvents:linked}).find(row=>row.event===e.event_id)?.anchors});continue;}
      this.pending.push(e);
    }
    const due=this.pending.filter(e=>intervalStart(e)<=Date.parse(at)).sort((a,b)=>intervalStart(a)-intervalStart(b)||orderEvents(a,b));
    this.pending=this.pending.filter(e=>intervalStart(e)>Date.parse(at));
    // Checkpoint writes precede scheduled expiries.
    for(const e of due){this.activeEvent=e.event_id;await this.apply(e);}this.activeEvent=null;
    await this.expire(at);
  }
  async apply(e) {
    const targets=e.targets.map(id=>this.refs.get(id));
    if(targets.some(x=>!x||this.forgottenIds.has(x.id)||!this.inspect(x.id).ok)){this.log.push({surface:'agent',method:'unresolved_product_target',event:e.event_id,reason:'absent_product_target'});return;}
    if(e.change_type==='expiry') {
      // Extracted explicit boundary confirms a deadline, rather than creating a decision assertion.
      for(const id of e.targets){const ref=this.refs.get(id);if(ref&&e.replacement_extent==='entire_predecessor')this.schedules.set(ref.id,{id:ref.id,revision:ref.revision,deadline:e.effective_interval.from,anchor:e.source_quotes[0],event:e,contentHash:hash(this.inspect(ref.id).value?.memory?.content??'')});else {if(ref)this.schedules.delete(ref.id);this.log.push({surface:'agent',method:'partial_expiry_unresolved',event:e.event_id});}}return;
    }
    const content=formatEvent(e,this.aliases.id(e.event_id)),receipts=this.receipts(e);this.registerContent(content,e);
    let result;
    if(e.change_type==='correction') {
      // Atomic corrections only. Preserve multi-target refusals rather than synthesizing a merged record.
      for(const ref of targets) {
        const inspection=this.inspect(ref.id);if(!inspection.ok)continue;
        result=await this.toolEnvelope('correct_memory',{memoryId:ref.id,expectedRevision:inspection.value.memory.revision,content,kind:e.kind});
        if(result.ok){const inspected=this.inspect(ref.id);this.refs.set(e.event_id,{id:ref.id,revision:inspected.value.memory.revision});this.schedules.delete(ref.id);this.schedule(e,this.refs.get(e.event_id),content);}
      }
      // MCP creates its receipt from the submitted formatter, not the original source quote.
      this.registerReceiptOrigin(normalize(content).slice(0,800),{segments:[{origin:`mcp-submitted:${e.event_id}`,start:0,text:content}],normalize:true,truncate:800});
      return;
    }
    if(e.replacement_extent==='entire_predecessor'&&e.change_type==='reversal'&&targets.length) {
      for(const ref of targets) {
        const inspected=this.inspect(ref.id);if(!inspected.ok)continue;
        result=this.call('supersede',{namespace:this.namespace,memoryId:ref.id,expectedRevision:inspected.value.memory.revision,replacement:{content,kind:e.kind},receipts});
        if(result.ok){this.refs.set(e.event_id,result.value.memory);this.schedules.delete(ref.id);}
      }
    } else result=this.call('admit',{namespace:this.namespace,memory:{content,kind:e.kind},receipts});
    if(result?.ok){for(const target of targets)this.schedules.delete(target.id);const ref=result.value.memory;this.refs.set(e.event_id,ref);this.schedule(e,ref,content);}
  }
  schedule(e,ref,content) {
    if(e.effective_interval.to!==null&&ref)this.schedules.set(ref.id,{id:ref.id,revision:ref.revision,deadline:e.effective_interval.to,anchor:e.source_quotes[0],event:e,contentHash:hash(normalize(content))});
  }
  async expire(at) {
    for(const [id,s]of this.schedules) {
      if(Date.parse(s.deadline)>Date.parse(at))continue;
      const inspected=this.inspect(id);const m=inspected.value?.memory;
      if(!inspected.ok||m.state==='historical'){this.schedules.delete(id);continue;}
      if(m.revision!==s.revision||hash(m.content)!==s.contentHash||!m.content.includes(s.deadline)){this.log.push({surface:'agent',method:'expiry_revalidation_required',id,deadline:s.deadline});continue;}
      const before={state:m.state,revision:m.revision};
      const content=`no_active_decision; ${s.event.subject} ${s.event.predicate}; scope=${canonical(s.event.scope)}; expiry=${s.deadline}`;
      const result=this.call('supersede',{namespace:this.namespace,memoryId:id,expectedRevision:m.revision,replacement:{content,kind:'context'},receipts:this.receipts({...s.event,source_quotes:s.anchor?[s.anchor]:[]})});
      this.log.push({surface:'agent',method:'adapter-scheduled',event:s.event.event_id,source_turns:s.event.source_turns,outcome:result.ok?'scheduled_expiry_success':'scheduled_expiry_refusal',before,after:this.inspect(id),result});if(result.ok)this.schedules.delete(id);
    }
  }
  async controls(controls,batch) {
    for(const raw of controls) {
      const control=this.namespaceAliases.payload(neutralControl(raw));
      if(control.kind==='card')await this.cardControl(control,batch);
      else if(control.kind==='named_forget_replay_foreign')await this.safetyControl(control,batch);
    }
  }
  resolveSymbols(value) {
    if(typeof value==='string'&&value.startsWith('$')){const symbol=this.symbols[value.slice(1)];if(symbol===undefined)throw Error('unresolved_symbol:'+value);return structuredClone(symbol);}
    if(Array.isArray(value))return value.map(v=>this.resolveSymbols(v));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.resolveSymbols(v)]));return value;
  }
  async cardControl(control,batch) {
    for(const action of control.actions.filter(a=>a.batch===batch)) {
      let payload=this.resolveSymbols(action.payload);
      if(action.authority==='unauthorized-mcp') {
        const names={confirmCardDraft:'confirm_private_card_draft',declareCardCurrentDependencies:'declare_private_card_current_dependencies',revalidateCardCurrentDependencies:'revalidate_private_card_current_dependencies'};
        const {namespace,currentDependencies,applicability,...args}=payload;
        const response=await this.toolEnvelope(names[action.call],action.call==='confirmCardDraft'?{cardId:args.cardId,expectedRevision:args.expectedRevision,actionId:args.actionId}:{...args,...(currentDependencies?{roleId:'finance',packages:currentDependencies.packages.map(x=>x.package)}:{})});
        this.log.push({surface:'control',method:'unauthorized',call:action.call,result:response});continue;
      }
      if(payload.cardId&&this.symbols.cardId) {
        const inspected=this.call('getCard',{namespace:this.namespace,cardId:payload.cardId});
        if(inspected.ok){if(action.call==='editKnowledgeCard'&&!payload.bindings.length)payload.bindings=inspected.value.card.bindings.map(b=>b.source);payload.expectedRevision=inspected.value.card.revision;if(payload.expectedDependencyRevision!==null&&Object.hasOwn(payload,'expectedDependencyRevision'))payload.expectedDependencyRevision=inspected.value.card.support.currentDependency?.revision??null;}
      }
      const result=this.call(action.call,payload);if(!result.ok)continue;
      const v=result.value;
      if(action.call==='importMethodVersion'){this.symbols.M=v.package;this.symbols[action.returns.includes('V2')?'V2':'V1']=v.version;this.symbols.packageRevision=v.packageRevision;}
      if(action.call==='adoptMethodVersion')this.symbols.b=v.binding.revision;
      if(action.call==='resolveMethod')this.symbols[action.returns[0]]=v.snapshot;
      if(action.call==='createCardDraft'){this.symbols.cardId=v.id;this.symbols.c=v.revision;}
      if(this.symbols.cardId) {
        const detail=this.call('getCard',{namespace:this.namespace,cardId:this.symbols.cardId});
        if(detail.ok){this.symbols.c=detail.value.card.revision;this.symbols.d=detail.value.card.support.currentDependency?.revision??null;}
      }
    }
  }
  async safetyControl(control,batch) {
    for(const action of control.actions.filter(a=>a.batch===batch)) {
      if(action.call==='admit') {
        const result=this.call('admit',{namespace:action.namespace,memory:{content:action.content,kind:'context'},receipts:[{client:'hr3',sessionId:'control',eventId:action.actionId,role:'user',excerpt:action.content}]});
        if(result.ok){for(const name of action.returns??[])this.symbols[name]=name==='revision'?result.value.memory.revision:result.value.memory.id;
          if(action.namespace.ownerId===this.namespace.ownerId&&!action.expected)this.controlRecords.push({id:'control-'+(action.returns?.[0]??'record'),productId:result.value.memory.id,body:action.content,current:true,history:true});}
        this.log.push({surface:'control',method:'safety_admit',expected:action.expected??null,result});if(action.expected?.suppressed&&result.ok){await this.onAuthorizationExposure();throw Object.assign(Error('authorization_exposure'),{code:'authorization_exposure'});}
      } else {
        const id=this.resolveSymbols(action.target),detail=this.inspect(id),result=detail.ok?this.call('forget',{namespace:action.namespace,memoryId:id,expectedRevision:detail.value.memory.revision}):detail;
        if(result.ok)this.forgottenIds.add(id);this.controlRecords=this.controlRecords.filter(r=>r.productId!==id);this.log.push({surface:'control',method:'named_forget',result});
      }
    }
  }
  controlSnapshot() {
    const records=this.controlRecords.map(({productId,...r})=>r);
    if(this.symbols.cardId) {
      const detail=this.call('getCard',{namespace:this.namespace,cardId:this.symbols.cardId});
      if(detail.ok){const c=detail.value.card;records.push({id:'control-card',body:c.title+'\n'+c.body,current:c.state==='confirmed'&&c.support.currentDependency?.status==='current',history:c.state==='confirmed'});}
    }
    return records;
  }
  async retrieve(query) {
    const delivered=[],blocks={},diagnostics={};
    for(const intent of ['current','history']) {
      const refresh=[];
      for(let i=0;i<4;i++){const input={readSet:[this.namespace],types:['memory','card'],intent,budget:{maxItems:128,maxMs:5000}};this.privacy.check('product-payload',input,{surface:'core',method:'refreshContextIndex'});const result=await this.core.refreshContextIndex(input,TOKEN);refresh.push(result);this.log.push({surface:'core',method:'refreshContextIndex',input:structuredClone(input),intent,result});if(!result.ok||result.value.status==='complete')break;}
      const candidates=await this.toolEnvelope('find_memory_candidates',{query,types:['memory','card'],intent,semantic:true,limit:24,deadlineMs:5000});
      const response=await this.tool('read_memory_context',{query,types:['memory','card'],intent,semantic:true,maxTokens:2000,maxItems:12,deadlineMs:5000});
      diagnostics[intent]={sourceAddresses:[],refresh,candidates,metadata:response._meta??null,error:response.isError??false};
      blocks[intent]=response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
      if(response.isError)continue;
      const wire=JSON.parse(blocks[intent]);const items=wire.value.items;
      for(let i=0;i<items.length;i++) {
        const item=items[i],bodyMap=this.contentOrigins.get(item.body);
        if(item.ref.ns!==0||this.forgottenIds.has(item.ref.id)||item.ref.id===this.symbols.foreignRecord){await this.onAuthorizationExposure();throw Object.assign(Error('authorization_exposure'),{code:'authorization_exposure'});}
        delivered.push(bodyMap?{...unit(intent,i,'body',null,item.body,'product:'+item.ref.id),...bodyMap}:unit(intent,i,'body',null,item.body,'product:'+item.ref.id));
        for(let j=0;j<item.sources.length;j++) {
          const s=item.sources[j];
          diagnostics[intent].sourceAddresses.push({item:i,deliveredSource:j,originalReceiptIndex:s.index});
          let text=s.excerpt;
          if(s.sameAsBody)text=item.body;
          if(s.sameAs){const previous=items[s.sameAs.item];const src=previous.sources[s.sameAs.source];text=src.sameAsBody?previous.body:src.excerpt;}
          if(typeof text!=='string')throw Error('unsupported_product_source_alias');
          const map=s.sameAsBody?bodyMap:this.receiptOrigin(text);
          delivered.push(map?{...unit(intent,i,'receipt',j,text,'product-receipt:'+item.ref.id),...map}:unit(intent,i,'receipt',j,text,'product-receipt:'+item.ref.id));
        }
      }
    }
    return {blocks,delivered,diagnostics};
  }
  state() {return {version:'hr3-product-agent-a6-v1',arm:'P',readerAliases:this.aliases.diagnostics(),namespaceAliases:this.namespaceAliases.diagnostics(),pending:this.pending.map(e=>e.event_id),schedules:[...this.schedules.values()].map(({event,...s})=>({...s,event_id:event.event_id})),refs:[...this.refs],controls:this.controlSnapshot(),operations:this.log};}
  async close() {try{await this.client?.close();await this.server?.close();}finally{this.core?.close();if(this.directory)rmSync(this.directory,{recursive:true,force:true});}}
}

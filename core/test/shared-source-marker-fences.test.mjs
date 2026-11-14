import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';

const root=new URL('../',import.meta.url);
const normalize=text=>text.replace(/\s+/g,' ').trim();
const named=(node,name)=>node?.type==='Identifier'&&node.name===name;
const callNamed=(node,name)=>node?.type==='CallExpression'&&named(node.callee,name);
const isFunction=node=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node?.type);
const parentFunction=site=>[...(site?.ancestors??[])].reverse().find(isFunction);
const owner=site=>[...(site?.ancestors??[])].reverse().find(node=>isFunction(node)&&node.id?.name)?.id?.name;
const label=site=>(site?.file??'<source>')+':'+(site?.line??site?.node?.loc?.start?.line??'?')+' '+
  (isFunction(site?.node)&&site.node.id?.name||owner(site)||'<module>');
const classified=(site,kind,message)=>label(site)+' ['+kind+'] '+message;
const propertyNamed=(node,name)=>node?.type==='Property'&&!node.computed&&
  (named(node.key,name)||node.key?.type==='Literal'&&node.key.value===name);

// Discover the engine's production modules from the filesystem. New modules,
// insert sites and helper callers must enter the catalog, even in a source
// distribution without repository metadata. Test fixtures are not writers.
function productionFiles(directory=root,prefix=''){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    if(['test','testing'].includes(entry.name))return [];
    const file=prefix+entry.name;
    if(entry.isDirectory())return productionFiles(new URL(entry.name+'/',directory),file+'/');
    return entry.isFile()&&entry.name.endsWith('.mjs')?[file]:[];
  }).sort();
}
function inventory(file,source){
  const nodes=[],functions=[];
  function walk(node,ancestors=[]){
    if(!node||typeof node.type!=='string')return;
    const site={node,ancestors,file,line:node.loc?.start?.line};
    assert.ok(Number.isInteger(site.line),classified(site,'location','AST node needs a source line'));
    nodes.push(site);
    if(isFunction(node)&&node.id?.name)functions.push(site);
    for(const [key,value]of Object.entries(node))if(!['loc','start','end'].includes(key)){
      if(Array.isArray(value))value.forEach(child=>walk(child,[...ancestors,node]));
      else if(value&&typeof value==='object')walk(value,[...ancestors,node]);
    }
  }
  let tree;
  try{tree=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});}
  catch(error){assert.fail(file+':'+(error.loc?.line??'?')+' <module> [parse] '+error.message);}
  walk(tree);
  return {source,nodes,functions,text:node=>{
    assert.ok(Number.isInteger(node?.start)&&Number.isInteger(node?.end),
      classified(nodes.find(site=>site.node===node)??{file},'source-range','expected a source-backed AST node'));
    return normalize(source.slice(node.start,node.end));
  }};
}
function functionSite(sources,file,name){
  const sites=sources.get(file)?.functions?.filter(site=>site.node?.id?.name===name)??[];
  assert.equal(sites.length,1,file+':1 '+name+' [function-catalog] expected one named function');return sites[0];
}
const inside=(site,node)=>site?.node?.start>node?.start&&site?.node?.end<node?.end;
const calls=(sources,name)=>[...sources.values()].flatMap(source=>source.nodes.filter(site=>callNamed(site.node,name)));
const transaction=site=>site.ancestors.some(node=>callNamed(node,'transaction')&&named(node.arguments?.[0],'db'));
function epochReturn(source,site){
  const fn=parentFunction(site),block=fn?.body;
  assert.ok(!fn?.async&&!fn?.generator&&block?.type==='BlockStatement'&&Array.isArray(block.body),
    classified(site,'marker-body','expected a synchronous function with a block body'));
  const statement=block.body.find(node=>node?.start<=site.node.start&&node?.end>=site.node.end);
  assert.ok(statement?.type==='ExpressionStatement'&&statement.expression===site.node,
    classified(site,'marker-call','marker call must be unconditional in its function body'));
  const last=block.body.at(-1);
  assert.equal(last?.type,'ReturnStatement',classified(site,'return-shape','expected one final successful return'));
  assert.equal(last?.argument?.type,'ObjectExpression',classified(site,'return-shape','successful return must be an object'));
  const properties=last.argument.properties;
  assert.ok(Array.isArray(properties),classified(site,'return-shape','expected object members'));
  // correct() returns projection spreads before indexRevision; forget returns
  // a reviewEffects spread after it. SpreadElement has no key and is valid.
  assert.ok(properties.every(property=>['Property','SpreadElement'].includes(property?.type)),
    classified(site,'return-member','unclassified object member'));
  const epochs=properties.filter(property=>propertyNamed(property,'indexRevision'));
  assert.equal(epochs.length,1,classified(site,'epoch-return','expected one explicit indexRevision property'));
  const epoch=epochs[0];
  assert.ok(callNamed(epoch?.value,'advanceEpoch')&&!epoch.value.optional&&named(epoch.value.arguments?.[0],'ns'),
    classified(site,'epoch-return','must advance this namespace on successful return'));
  const returns=source.nodes.filter(candidate=>candidate.node.type==='ReturnStatement'&&
    candidate.node.start>statement.start&&inside(candidate,block)&&parentFunction(candidate)===fn);
  assert.deepEqual(returns.map(candidate=>candidate.node.start),[last.start],
    classified(site,'return-flow','cannot return after inserting markers without advancing the epoch'));
}

const sourceInventory=()=>new Map(productionFiles().map(file=>[file,inventory(file,readFileSync(new URL(file,root),'utf8'))]));
function assertMarkerFences(sources){
  const head=node=>node?.type==='TemplateLiteral'?node.quasis?.[0]?.value?.cooked??'':
    node?.type==='Literal'&&typeof node.value==='string'?node.value:'';
  const insertsSuppressed=node=>/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+suppressed\b/i.test(head(node));
  const literals=[...sources.values()].flatMap(source=>source.nodes.filter(site=>insertsSuppressed(site.node)));
  const prepares=[...sources.values()].flatMap(source=>source.nodes.filter(site=>site.node.type==='CallExpression'&&
    site.node.callee?.type==='MemberExpression'&&named(site.node.callee.property,'prepare')&&
    insertsSuppressed(site.node.arguments?.[0])));
  assert.deepEqual(literals.map(site=>[site.file,site.node.start]).sort(),
    prepares.map(site=>[site.file,site.node.arguments?.[0]?.start]).sort(),
    'suppressed [insert-shape] independent literal and prepare catalogs agree: '+literals.map(label).join(', '));
  assert.deepEqual(literals.map(site=>site.file+':'+owner(site)).sort(),[
    'content-suppression-storage.mjs:suppressReceiptsInside','runtime.mjs:suppress',
  ],'suppressed [writer-catalog] every insert needs an epoch proof: '+literals.map(label).join(', '));

  const helper=functionSite(sources,'content-suppression-storage.mjs','suppressReceiptsInside');
  const helperSource=sources.get(helper.file),helperText=helperSource.text(helper.node);
  assert.ok(callNamed(helper.node.body?.body?.[0]?.expression,'requireSuppressionTransaction'),
    classified(helper,'transaction','marker emitter requires the caller transaction'));
  const marker=prepares.find(site=>owner(site)==='suppressReceiptsInside');
  assert.ok(marker,classified(helper,'insert-shape','expected marker prepare site'));
  const condition=[...marker.ancestors].reverse().find(node=>node.type==='IfStatement');
  assert.ok(named(condition?.test,'denySharedSource'),classified(marker,'marker-condition','the default false path cannot write markers'));
  assert.equal(helper.node.params?.[5]?.type,'AssignmentPattern',classified(helper,'marker-default','expected default parameter'));
  assert.equal(helper.node.params?.[5]?.right?.value,false,classified(helper,'marker-default','markers default to false'));
  assert.match(helperText,/JSON\.stringify\(receiptDenialTokens\(rows\)\)/);
  assert.match(helperText,/for \(const row of rows\).*writeContentSuppressionInside\(db,/);
  // No aliases or indirect invocations can evade the caller census.
  for(const [file,source]of sources)for(const site of source.nodes)if(named(site.node,'suppressReceiptsInside')){
    const parent=site.ancestors.at(-1);
    assert.ok(parent?.type==='ImportSpecifier'&&parent.imported?.name===parent.local?.name||
      parent?.type==='FunctionDeclaration'&&parent.id===site.node||
      parent?.type==='CallExpression'&&!parent.optional&&parent.callee===site.node,
      classified(site,'helper-reference','expected a direct marker helper reference'));
  }
  const writers=calls(sources,'suppressReceiptsInside');
  assert.deepEqual(writers.map(site=>site.file+':'+owner(site)).sort(),[
    'runtime.mjs:correct','runtime.mjs:forgetMutationInside','runtime.mjs:removeReceipts',
  ],'suppressReceiptsInside [caller-catalog] every caller is classified: '+writers.map(label).join(', '));
  for(const site of writers){
    const source=sources.get(site.file),name=owner(site),args=site.node.arguments;
    assert.ok(named(args?.[0],'db')&&named(args?.[1],'ns'),classified(site,'helper-arguments','expected db and ns'));
    if(name==='removeReceipts'){
      assert.equal(args.length,5,'receipt removal leaves denySharedSource at false');continue;
    }
    epochReturn(source,site);
    if(name==='correct'){
      assert.equal(args?.[5]?.value,true,classified(site,'marker-enable','correction enables markers'));
      assert.ok(transaction(site),classified(site,'transaction','correction owns the write transaction'));
    }else{
      assert.ok(args?.[5],classified(site,'marker-enable','forget must specify the marker condition'));
      assert.equal(source.text(args[5]),"suppressionReason === 'user_forget' || reason === 'rejected'",
        classified(site,'marker-enable','forget enables markers for user forget and rejection'));
    }
  }
  // The other insert handles content fingerprints only, never marker tokens.
  assert.deepEqual(calls(sources,'suppress').map(site=>sources.get(site.file).text(site.node)).sort(),
    ['suppress(ns, current.fingerprint)','suppress(ns, current.fingerprint)']);
  const suppress=functionSite(sources,'runtime.mjs','suppress').node;
  assert.deepEqual(suppress.params?.map(node=>node?.name),['ns','value']);
  assert.equal(suppress.body?.body?.length,1,'the fingerprint inserter cannot manufacture marker values');
  assert.match(sources.get('runtime.mjs').text(suppress),
    /\.run\(\.\.\.boundary\(ns\), value\)/);

  const insideCalls=calls(sources,'forgetMutationInside');
  assert.equal(insideCalls.length,1);assert.equal(owner(insideCalls[0]),'forgetMutation');
  const wrapper=sources.get('runtime.mjs').text(functionSite(sources,'runtime.mjs','forgetMutation').node);
  assert.match(wrapper,/reason = 'forgotten', suppressionReason = reason === 'forgotten' \? 'user_forget' : 'purge'/);
  const forgetting=calls(sources,'forgetMutation');
  assert.deepEqual(forgetting.map(site=>site.file+':'+owner(site)).sort(),[
    'confirmation-storage.mjs:resolve','episode-storage.mjs:forget','raw-deletion-storage.mjs:cascadeInside','runtime.mjs:forget',
  ]);
  for(const site of forgetting){
    assert.ok(named(site.node.arguments?.[0],'ns'),classified(site,'forget-arguments','expected ns'));
    if(site.file==='raw-deletion-storage.mjs'){
      assert.equal(site.node.arguments?.[3]?.value,'forgotten',classified(site,'forget-reason','expected forgotten'));
      assert.equal(site.node.arguments?.[4]?.value,'purge',classified(site,'forget-reason','Raw purge leaves markers disabled'));
    }else{
      assert.ok(transaction(site),label(site)+' public forgetting owns the write transaction');
      if(site.file==='confirmation-storage.mjs')assert.equal(site.node.arguments?.[3]?.value,'rejected',classified(site,'forget-reason','rejection enables markers'));
      else assert.ok(site.node.arguments.length<=3,'default user forget writes markers');
    }
  }
  const runtime=sources.get('runtime.mjs');
  assert.match(runtime.text(functionSite(sources,'runtime.mjs','advanceEpoch').node),
    /INSERT INTO namespace_epochs\(owner_id, scope, project_id, epoch\).*DO UPDATE SET epoch = epoch \+ 1.*\.run\(\.\.\.boundary\(ns\)\)/);

  // Trace that exact namespace cell through observation, signed publication
  // comparison, final delivery, and the cached-page path, including Card-only
  // requests. This proof does not depend on the suppression package existing.
  const side=sources.get('context-product-sidecar.mjs');
  const fences=side.text(functionSite(sources,'context-product-sidecar.mjs','canonicalProductFences').node);
  assert.match(fences,/for \(const ns of p\.readSet\)/);
  assert.match(fences,/LEFT JOIN namespace_epochs n ON n\.owner_id=\? AND n\.scope=\? AND n\.project_id=\?/);
  assert.match(fences,/else memory=db\.prepare\(`SELECT epoch FROM namespace_epochs WHERE \$\{where\}`\)\.get\(\.\.\.boundary\(ns\)\)\?\.epoch\?\?1/);
  assert.match(fences,/canonical\.push\(\{ memory,/);
  assert.match(fences,/canonicalFenceDigest: digest\(canonical\)/);
  assert.match(side.text(functionSite(sources,'context-product-sidecar.mjs','target').node),/canonicalProductFences\(reader,p\)/);
  assert.match(side.text(functionSite(sources,'context-product-sidecar.mjs','recordBindings').node),
    /r\.canonicalFenceDigest !== t\.canonicalFenceDigest\) return 'fence_changed'/);
  const observe=side.text(functionSite(sources,'context-product-sidecar.mjs','observe').node);
  assert.match(observe,/const t = target\(p,access\)/);
  assert.match(observe,/const mismatch = recordBindings\(r,t\)/);
  assert.match(observe,/status\(p,mismatch \? 'stale' : 'ready'/);
  const index=sources.get('context-product-index.mjs');
  const final=index.text(functionSite(sources,'context-product-index.mjs','final').node);
  assert.match(final,/return read\(/);
  assert.match(final,/const current=storage\.observe\(p,access\.accessGenerations\)/);
  assert.match(final,/current\.dto\.lexical\.state!=='ready'.*fail\(code\)/);
  assert.match(index.source,/p\.suppressionEpoch=r\.suppressionEpoch/);
  assert.match(index.source,/try\{return final\(p,access,r\.publication,/);
  assert.match(index.source,/if\(e\.code==='index_unavailable'\)fail\('cursor_stale'\)/);
  assert.doesNotMatch(index.source,/rankingVersion|PRAGMA data_version/);
  const cacheWrites=index.nodes.filter(({node})=>node.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&
    named(node.callee.object,'rankings')&&named(node.callee.property,'set'));
  assert.equal(cacheWrites.length,2,'both ranking insertion sites remain fenced');
  for(const site of cacheWrites){
    const block=[...site.ancestors].reverse().find(node=>node.type==='BlockStatement');
    assert.ok(Array.isArray(block?.body),classified(site,'cache-body','expected a block around cache insertion'));
    const delivered=block.body.find(node=>node?.type==='VariableDeclaration'&&node.declarations?.some(declaration=>
      named(declaration.id,'delivered')&&callNamed(declaration.init,'final')));
    assert.ok(delivered&&delivered.end<site.node.start,'cache insertion follows a successful final fence');
  }
}

test('every production marker insertion is transactionally fenced for Card reads',()=>{
  assertMarkerFences(sourceInventory());
});

test('the marker catalog rejects missing epoch advances and unclassified writers',()=>{
  const original=sourceInventory(),runtime=original.get('runtime.mjs');
  const mutations=['correct','forgetMutationInside'].map(name=>{
    const fn=functionSite(original,'runtime.mjs',name).node,text=runtime.source.slice(fn.start,fn.end);
    const changed=text.replace('indexRevision: advanceEpoch(ns)','indexRevision: epoch(ns)');
    assert.notEqual(changed,text);
    return runtime.source.slice(0,fn.start)+changed+runtime.source.slice(fn.end);
  });
  mutations.push(runtime.source+"\nfunction syntheticMarker(db,ns,token) { db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,token); }\n");
  mutations.push(runtime.source+'\nfunction syntheticMarker(db,ns,id,options) { suppressReceiptsInside(db,ns,id,options,undefined,true); }\n');
  const correction=functionSite(original,'runtime.mjs','correct');
  const marker=calls(original,'suppressReceiptsInside').find(site=>site.file==='runtime.mjs'&&owner(site)==='correct');
  assert.ok(marker,classified(correction,'mutation-fixture','expected the correction marker call'));
  const block=parentFunction(marker)?.body,last=block?.body?.at(-1);
  assert.equal(last?.type,'ReturnStatement',classified(marker,'mutation-fixture','expected the correction return'));
  const replace=(node,text)=>runtime.source.slice(0,node.start)+text+runtime.source.slice(node.end);
  // Valid JS shapes that used to fall through to unguarded node accesses.
  mutations.push(replace(last,'return;'));
  mutations.push(replace(last,'return null;'));
  mutations.push(replace(last,'return { ...projection };'));
  mutations.push(replace(last,'return { indexRevision: advanceEpoch?.(ns) };'));
  mutations.push(replace(marker.node,'(() => '+runtime.source.slice(marker.node.start,marker.node.end)+')()'));
  for(const source of mutations){
    const mutated=new Map(original);mutated.set('runtime.mjs',inventory('runtime.mjs',source));
    assert.throws(()=>assertMarkerFences(mutated),error=>{
      assert.ok(error instanceof assert.AssertionError,'unexpected AST shapes must be assertion failures, never TypeError');
      assert.match(error.message,/runtime\.mjs:\d+ (?:correct|forgetMutationInside|syntheticMarker)\b/,
        'the assertion names the affected function and source line');
      assert.match(error.message,/\[[a-z-]+\]/,'the assertion classifies the failed proof');
      return true;
    });
  }
});

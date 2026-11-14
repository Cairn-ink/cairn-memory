import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';

const root=new URL('../',import.meta.url);
const normalize=text=>text.replace(/\s+/g,' ').trim();
const named=(node,name)=>node?.type==='Identifier'&&node.name===name;
const callNamed=(node,name)=>node?.type==='CallExpression'&&named(node.callee,name);

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
    const site={node,ancestors,file,line:node.loc.start.line};nodes.push(site);
    if((node.type==='FunctionDeclaration'||node.type==='FunctionExpression')&&node.id)functions.push(site);
    for(const [key,value]of Object.entries(node))if(!['loc','start','end'].includes(key)){
      if(Array.isArray(value))value.forEach(child=>walk(child,[...ancestors,node]));
      else if(value&&typeof value==='object')walk(value,[...ancestors,node]);
    }
  }
  walk(parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true}));
  return {source,nodes,functions,text:node=>normalize(source.slice(node.start,node.end))};
}
const label=site=>site.file+':'+site.line;
const owner=site=>[...site.ancestors].reverse().find(node=>
  (node.type==='FunctionDeclaration'||node.type==='FunctionExpression')&&node.id)?.id.name;
function functionSite(sources,file,name){
  const sites=sources.get(file).functions.filter(site=>site.node.id.name===name);
  assert.equal(sites.length,1,file+' '+name);return sites[0];
}
const inside=(site,node)=>site.node.start>node.start&&site.node.end<node.end;
const calls=(sources,name)=>[...sources.values()].flatMap(source=>source.nodes.filter(site=>callNamed(site.node,name)));
const transaction=site=>site.ancestors.some(node=>callNamed(node,'transaction')&&named(node.arguments[0],'db'));
function epochReturn(source,site){
  const block=[...site.ancestors].reverse().find(node=>node.type==='BlockStatement');
  assert.ok(block,label(site)+' has a synchronous body');
  const statement=block.body.find(node=>node.start<=site.node.start&&node.end>=site.node.end);
  assert.equal(statement.type,'ExpressionStatement',label(site)+' marker call is unconditional in this body');
  const last=block.body.at(-1);
  assert.equal(last.type,'ReturnStatement',label(site)+' has one final successful return');
  assert.equal(last.argument.type,'ObjectExpression');
  const epoch=last.argument.properties.find(property=>property.key.name==='indexRevision');
  assert.ok(callNamed(epoch?.value,'advanceEpoch')&&named(epoch.value.arguments[0],'ns'),
    label(site)+' must advance this namespace on successful return');
  const returns=source.nodes.filter(candidate=>candidate.node.type==='ReturnStatement'&&
    candidate.node.start>statement.start&&inside(candidate,block));
  assert.deepEqual(returns.map(candidate=>candidate.node.start),[last.start],
    label(site)+' cannot successfully return after inserting markers without advancing the epoch');
}

const sourceInventory=()=>new Map(productionFiles().map(file=>[file,inventory(file,readFileSync(new URL(file,root),'utf8'))]));
function assertMarkerFences(sources){
  const head=node=>node.type==='TemplateLiteral'?node.quasis[0].value.cooked:
    node.type==='Literal'&&typeof node.value==='string'?node.value:'';
  const insertsSuppressed=node=>/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+suppressed\b/i.test(head(node));
  const literals=[...sources.values()].flatMap(source=>source.nodes.filter(site=>insertsSuppressed(site.node)));
  const prepares=[...sources.values()].flatMap(source=>source.nodes.filter(site=>site.node.type==='CallExpression'&&
    site.node.callee.type==='MemberExpression'&&site.node.callee.property.name==='prepare'&&
    insertsSuppressed(site.node.arguments[0])));
  assert.deepEqual(literals.map(site=>[site.file,site.node.start]).sort(),
    prepares.map(site=>[site.file,site.node.arguments[0].start]).sort(),'independent literal and prepare catalogs agree');
  assert.deepEqual(literals.map(site=>site.file+':'+owner(site)).sort(),[
    'content-suppression-storage.mjs:suppressReceiptsInside','runtime.mjs:suppress',
  ],'every suppressed insert is classified; a new marker writer needs an epoch proof');

  const helper=functionSite(sources,'content-suppression-storage.mjs','suppressReceiptsInside');
  const helperSource=sources.get(helper.file),helperText=helperSource.text(helper.node);
  assert.ok(callNamed(helper.node.body.body[0].expression,'requireSuppressionTransaction'));
  const marker=prepares.find(site=>owner(site)==='suppressReceiptsInside');
  const condition=[...marker.ancestors].reverse().find(node=>node.type==='IfStatement');
  assert.ok(named(condition.test,'denySharedSource'),'the default false path cannot write markers');
  assert.equal(helper.node.params[5].type,'AssignmentPattern');
  assert.equal(helper.node.params[5].right.value,false);
  assert.match(helperText,/JSON\.stringify\(receiptDenialTokens\(rows\)\)/);
  assert.match(helperText,/for \(const row of rows\).*writeContentSuppressionInside\(db,/);
  // No aliases or indirect invocations can evade the caller census.
  for(const [file,source]of sources)for(const site of source.nodes)if(named(site.node,'suppressReceiptsInside')){
    const parent=site.ancestors.at(-1);
    assert.ok(parent.type==='ImportSpecifier'&&parent.imported.name===parent.local.name||
      parent.type==='FunctionDeclaration'&&parent.id===site.node||
      parent.type==='CallExpression'&&parent.callee===site.node,file+' direct marker helper reference');
  }
  const writers=calls(sources,'suppressReceiptsInside');
  assert.deepEqual(writers.map(site=>site.file+':'+owner(site)).sort(),[
    'runtime.mjs:correct','runtime.mjs:forgetMutationInside','runtime.mjs:removeReceipts',
  ],'every helper caller is derived and classified');
  for(const site of writers){
    const source=sources.get(site.file),name=owner(site),args=site.node.arguments;
    assert.ok(named(args[0],'db')&&named(args[1],'ns'));
    if(name==='removeReceipts'){
      assert.equal(args.length,5,'receipt removal leaves denySharedSource at false');continue;
    }
    epochReturn(source,site);
    if(name==='correct'){
      assert.equal(args[5].value,true);assert.ok(transaction(site),'correction owns the write transaction');
    }else assert.equal(source.text(args[5]),"suppressionReason === 'user_forget' || reason === 'rejected'");
  }
  // The other insert handles content fingerprints only, never marker tokens.
  assert.deepEqual(calls(sources,'suppress').map(site=>sources.get(site.file).text(site.node)).sort(),
    ['suppress(ns, current.fingerprint)','suppress(ns, current.fingerprint)']);
  const suppress=functionSite(sources,'runtime.mjs','suppress').node;
  assert.deepEqual(suppress.params.map(node=>node.name),['ns','value']);
  assert.equal(suppress.body.body.length,1,'the fingerprint inserter cannot manufacture marker values');
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
    assert.ok(named(site.node.arguments[0],'ns'));
    if(site.file==='raw-deletion-storage.mjs'){
      assert.equal(site.node.arguments[3].value,'forgotten');assert.equal(site.node.arguments[4].value,'purge');
    }else{
      assert.ok(transaction(site),label(site)+' public forgetting owns the write transaction');
      if(site.file==='confirmation-storage.mjs')assert.equal(site.node.arguments[3].value,'rejected');
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
  const cacheWrites=index.nodes.filter(({node})=>node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&
    named(node.callee.object,'rankings')&&named(node.callee.property,'set'));
  assert.equal(cacheWrites.length,2,'both ranking insertion sites remain fenced');
  for(const site of cacheWrites){
    const block=[...site.ancestors].reverse().find(node=>node.type==='BlockStatement');
    const delivered=block.body.find(node=>node.type==='VariableDeclaration'&&node.declarations.some(declaration=>
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
  for(const source of mutations){
    const mutated=new Map(original);mutated.set('runtime.mjs',inventory('runtime.mjs',source));
    assert.throws(()=>assertMarkerFences(mutated),assert.AssertionError);
  }
});

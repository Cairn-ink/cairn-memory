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

// Resolve lexical bindings, imports and dependency-injected capabilities. A
// capability may be renamed, passed positionally, nested in an options object,
// or returned as a factory method. Every other escape fails closed. In
// particular this is not a search for identifiers spelled "suppress".
function sourceWalker(sources){
  const sites=[...sources.values()].flatMap(source=>source.nodes),byNode=new Map(sites.map(site=>[site.node,site]));
  const bindings=[],scopes=new Map();
  const scopeOf=site=>[...site.ancestors].reverse().find(node=>
    ['Program','BlockStatement','ForOfStatement','ForStatement'].includes(node.type)||isFunction(node));
  function bind(pattern,scope,origin,path=[]){
    if(pattern?.type==='AssignmentPattern')return bind(pattern.left,scope,origin,path);
    if(pattern?.type==='ObjectPattern'){
      for(const property of pattern.properties){
        if(property.type==='Property'&&!property.computed)bind(property.value,scope,origin,[...path,property.key.name??property.key.value]);
      }
    }else if(pattern?.type==='Identifier'){
      const binding={id:pattern,scope,...origin,path};bindings.push(binding);
      if(!scopes.has(scope))scopes.set(scope,new Map());
      scopes.get(scope).set(pattern.name,binding);
    }
  }
  for(const site of sites){
    const node=site.node;
    if(node.type==='FunctionDeclaration')bind(node.id,scopeOf(site),{fn:node});
    if(isFunction(node))node.params.forEach((param,index)=>bind(param,node,{fn:node,param:index}));
    if(node.type==='VariableDeclarator')bind(node.id,scopeOf(site),{declaration:node,site});
    if(node.type==='ImportSpecifier')bind(node.local,scopeOf(site),{import:site.ancestors.at(-1),imported:node.imported.name});
  }
  function bindingOf(node){
    const site=byNode.get(node);
    for(const scope of [...(site?.ancestors??[])].reverse()){
      const binding=scopes.get(scope)?.get(node.name);if(binding)return binding;
    }
  }
  const references=new Map(bindings.map(binding=>[binding,[]]));
  for(const site of sites){
    if(site.node.type!=='Identifier')continue;
    const parent=site.ancestors.at(-1);
    if(parent?.type==='Property'&&parent.key===site.node&&!parent.computed||
      parent?.type==='MemberExpression'&&parent.property===site.node&&!parent.computed||
      ['ImportSpecifier','ExportSpecifier'].includes(parent?.type))continue;
    const binding=bindingOf(site.node);
    if(binding&&binding.id!==site.node)references.get(binding).push(site);
  }
  function imported(binding){
    const file=new URL(binding.import.source.value,new URL(byNode.get(binding.id).file,root));
    const name=file.href.slice(root.href.length),source=sources.get(name);
    return source?.functions.find(site=>site.node.id.name===binding.imported)?.node;
  }
  function argumentAt(call,binding){
    let value=call.node.arguments[binding.param];
    for(const key of binding.path)value=value?.type==='ObjectExpression'?value.properties.find(p=>propertyNamed(p,key))?.value:undefined;
    return value;
  }
  function directFunction(node,seen=new Set()){
    if(isFunction(node))return node;
    if(node?.type!=='Identifier')return;
    const binding=bindingOf(node);
    if(!binding||seen.has(binding))return;
    const next=new Set(seen);next.add(binding);
    if(binding?.import)return imported(binding);
    if(binding.param===undefined)return binding.fn??directFunction(binding.declaration?.init,next);
    const incoming=callers(binding.fn),targets=incoming.map(call=>directFunction(argumentAt(call,binding),next));
    if(targets.length&&targets.every(fn=>fn&&fn===targets[0]))return targets[0];
  }
  const callerMemo=new Map();
  function callers(fn){
    if(callerMemo.has(fn))return callerMemo.get(fn);
    const found=[],visited=new Map();callerMemo.set(fn,found);
    function parameter(pattern,path){
      if(pattern?.type==='AssignmentPattern')return parameter(pattern.left,path);
      if(pattern?.type==='ObjectPattern'){
        const property=pattern.properties.find(p=>propertyNamed(p,path[0]));
        assert.ok(property,classified(byNode.get(pattern),'helper-flow','injected capability must have a named recipient'));
        return parameter(property.value,path.slice(1));
      }
      assert.equal(pattern?.type,'Identifier',classified(byNode.get(pattern),'helper-flow','unsupported recipient'));
      visit(bindings.find(binding=>binding.id===pattern),path);
    }
    function expression(node,path){
      const site=byNode.get(node),parent=site?.ancestors.at(-1);
      if(parent?.type==='MemberExpression'&&parent.object===node&&!parent.computed){
        if(path.length&&named(parent.property,path[0]))expression(parent,path.slice(1));
        else assert.ok(path.length,classified(site,'helper-flow','unclassified helper member access'));
      }else if(parent?.type==='CallExpression'&&parent.callee===node){
        assert.ok(!path.length&&!parent.optional,classified(site,'helper-flow','expected a direct capability call'));
        found.push(byNode.get(parent));
      }else if(parent?.type==='VariableDeclarator'&&parent.init===node)parameter(parent.id,path);
      else if(parent?.type==='Property'&&parent.value===node){
        assert.ok(!parent.computed&&parent.kind==='init',classified(site,'helper-flow','unsupported capability property'));
        const object=byNode.get(parent).ancestors.at(-1);
        assert.equal(object?.type,'ObjectExpression',classified(site,'helper-flow','expected a capability object'));
        expression(object,[parent.key.name??parent.key.value,...path]);
      }else if(parent?.type==='CallExpression'){
        const target=directFunction(parent.callee),index=parent.arguments.indexOf(node);
        assert.ok(target&&index>=0,classified(site,'helper-flow','unresolved capability recipient'));
        parameter(target.params[index],path);
      }else if(parent?.type==='ReturnStatement'){
        const outer=parentFunction(site);
        assert.ok(outer,classified(site,'helper-flow','expected a factory return'));
        for(const call of callers(outer))expression(call.node,path);
      }else assert.fail(classified(site,'helper-flow','unclassified capability reference'));
    }
    function visit(binding,path){
      assert.ok(binding,classified(byNode.get(fn),'helper-flow','missing lexical binding'));
      const key=JSON.stringify(path),seen=visited.get(binding)??new Set();
      if(seen.has(key))return;seen.add(key);visited.set(binding,seen);
      for(const site of references.get(binding))expression(site.node,path);
    }
    const declaration=bindings.find(binding=>binding.fn===fn&&binding.param===undefined);
    assert.ok(declaration,classified(byNode.get(fn),'helper-flow','expected a named capability'));
    visit(declaration,[]);
    for(const binding of bindings)if(binding.import&&imported(binding)===fn)visit(binding,[]);
    return found;
  }
  const returns=fn=>fn.body.type==='BlockStatement'?sites.filter(site=>site.node.type==='ReturnStatement'&&
    parentFunction(site)===fn).map(site=>site.node.argument):[fn.body];
  const fields=(pattern,path)=>{
    if(pattern.type==='Identifier')return [{binding:bindings.find(binding=>binding.id===pattern),path}];
    if(pattern.type==='AssignmentPattern')return fields(pattern.left,path);
    if(pattern.type==='ObjectPattern')return pattern.properties.flatMap(p=>fields(p.value,[...path,p.key.name??p.key.value]));
    return [];
  };
  function callEnvironment(fn,args,env){
    const bound=new Map(env);
    fn.params.forEach((pattern,index)=>{
      for(const {binding,path}of fields(pattern,[]))bound.set(binding,{node:args[index],env,path});
    });
    return bound;
  }
  // Prove values by their origins, rather than their variable names. Arrays
  // carry their element provenance through map/filter and for-of; parameters
  // are checked at every discovered caller, including returned factory methods.
  function prove(node,kind,env=new Map(),path=[],element=false,seen=new Set()){
    const site=byNode.get(node),message=classified(site,'fingerprint-value','expected a stored Memory fingerprint or engine SHA-256 fingerprint');
    assert.ok(node,message);
    const key=node.start+':'+site.file+':'+kind+':'+path.join('.')+':'+element;
    assert.ok(!seen.has(key),message+' (cyclic origin)');
    const next=new Set(seen);next.add(key);
    const again=(value,bindings=env,keys=path,items=element)=>prove(value,kind,bindings,keys,items,next);
    if(kind==='fingerprint'&&!path.length&&!element&&node.type==='MemberExpression'&&!node.computed&&named(node.property,'fingerprint')){
      return prove(node.object,'memory',env,[],false,next);
    }
    if(node.type==='Identifier'){
      if(node.name==='undefined'&&kind==='memory')return 0;
      const binding=bindingOf(node),bound=env.get(binding);
      assert.ok(binding,message);
      // Reassignment could invalidate a row or replace its fingerprint. Refuse
      // it, including writes to any member of the source row.
      for(const ref of references.get(binding))assert.ok(!ref.ancestors.some(parent=>
        parent.type==='AssignmentExpression'&&parent.left.start<=ref.node.start&&parent.left.end>=ref.node.end||
        parent.type==='UpdateExpression'),classified(ref,'fingerprint-value','mutable fingerprint origin'));
      if(bound)return again(bound.node,bound.env,[...(bound.path??[]),...path],bound.element??element);
      if(binding.declaration){
        const loop=binding.site.ancestors.find(parent=>parent.type==='ForOfStatement'&&parent.left.start<=node.start);
        if(!binding.declaration.init&&loop)return again(loop.right,env,path,true);
        return again(binding.declaration.init);
      }
      if(binding.param!==undefined){
        const fn=binding.fn,fnSite=byNode.get(fn),parent=fnSite.ancestors.at(-1);
        if(parent?.type==='CallExpression'&&parent.arguments[0]===fn&&parent.callee.type==='MemberExpression'&&named(parent.callee.property,'map')){
          return again(parent.callee.object,env,path,true);
        }
        const incoming=callers(fn);
        assert.ok(incoming.length,message+' (no source-backed callers)');
        return incoming.reduce((count,call)=>count+again(call.node.arguments[binding.param],new Map(),[...binding.path,...path]),0);
      }
    }
    if(node.type==='MemberExpression'&&!node.computed)return again(node.object,env,[node.property.name,...path]);
    if(node.type==='ObjectExpression'&&path.length){
      const property=node.properties.find(p=>propertyNamed(p,path[0]));
      assert.ok(property,message);return again(property.value,env,path.slice(1));
    }
    if(node.type==='ConditionalExpression')return again(node.consequent)+again(node.alternate);
    if(node.type==='CallExpression'){
      const method=node.callee.type==='MemberExpression'?node.callee.property.name:undefined;
      if(kind==='memory'&&!path.length&&node.callee.type==='MemberExpression'&&method===(element?'all':'get')){
        const prepare=node.callee.object;
        if(prepare?.type==='CallExpression'&&named(prepare.callee?.property,'prepare')){
          const sql=sources.get(site.file).text(prepare.arguments[0]);
          if(/^\s*[`'"]SELECT (?:memories\.\*|\*)[\s\S]*? FROM memories\b/.test(sql))return 1;
        }
      }
      if(element&&method==='filter')return again(node.callee.object);
      if(element&&method==='map'&&isFunction(node.arguments[0])){
        const callback=node.arguments[0],bound=new Map(env);
        for(const {binding,path:keys}of fields(callback.params[0],[]))bound.set(binding,{node:node.callee.object,env,path:keys,element:true});
        return returns(callback).reduce((count,value)=>count+again(value,bound,path,false),0);
      }
      const fn=directFunction(node.callee);
      if(kind==='fingerprint'&&!path.length&&!element&&fn===functionSite(sources,'validation.mjs','fingerprint').node)return 1;
      if(fn)return returns(fn).reduce((count,value)=>count+again(value,callEnvironment(fn,node.arguments,env)),0);
    }
    assert.fail(message);
  }
  return {callers,prove};
}

function assertFingerprintClass(sources,insert){
  const suppress=functionSite(sources,'runtime.mjs','suppress'),source=sources.get(suppress.file);
  assert.equal(owner(insert),'suppress',classified(insert,'fingerprint-insert','expected the fingerprint helper'));
  assert.deepEqual(suppress.node.params.map(node=>node.name),['ns','value']);
  assert.equal(suppress.node.body.body.length,1,classified(insert,'fingerprint-insert','helper cannot manufacture marker values'));
  assert.equal(source.text(suppress.node.body.body[0]),
    'db.prepare(`INSERT OR IGNORE INTO suppressed (owner_id, scope, project_id, fingerprint) VALUES (?, ?, ?, ?)`) .run(...boundary(ns), value);',
    classified(insert,'fingerprint-insert','only the supplied value is inserted'));
  const fingerprint=functionSite(sources,'validation.mjs','fingerprint');
  assert.equal(sources.get(fingerprint.file).text(fingerprint.node),
    'function fingerprint(content) { return createHash("sha256").update(content.toLowerCase()).digest("hex"); }',
    classified(fingerprint,'fingerprint-shape','SHA-256 hex is exactly 64 lower-case hexadecimal characters'));
  assert.match(sources.get('validation.mjs').source,/import \{ createHash \} from "node:crypto"/);
  const tokens=functionSite(sources,'raw-source-roots.mjs','receiptDenialTokens'),tokenSource=sources.get(tokens.file);
  const arrays=tokenSource.nodes.filter(site=>inside(site,tokens.node)&&site.node.type==='ArrayExpression'&&
    site.node.elements.some(node=>node?.type==='BinaryExpression'&&node.operator==='+'&&node.left?.value==='rs1:i:'));
  assert.equal(arrays.length,1,classified(tokens,'marker-shape','expected one token-pair builder'));
  assert.deepEqual(arrays[0].node.elements.map(node=>node?.type==='BinaryExpression'&&node.operator==='+'?node.left?.value:undefined),
    ['rs1:i:','rs1:a:'],classified(tokens,'marker-shape','every token begins with rs1:, outside [0-9a-f]{64}'));
  assert.equal(tokenSource.text(tokens.node),
    "function receiptDenialTokens(receipts) { return [...new Set(receipts.flatMap(receipt => [ 'rs1:i:' + receipt.receipt_key, 'rs1:a:' + createHash('sha256').update(JSON.stringify([ 'receipt-source-address-v1', receipt.client, receipt.session_id, receipt.event_id, receipt.role, ])).digest('hex'), ]))]; }",
    classified(tokens,'marker-shape','the token-pair builder is the only returned marker source'));
  const denials=functionSite(sources,'content-safety.mjs','receiptDenialsInside');
  const reads=sources.get(denials.file).text(denials.node);
  assert.match(reads,/for \(const batch of batches\) for \(const token of receiptDenialTokens\(batch.receipts\)\)/);
  assert.match(reads,/missing.set\(id, \[\.\.\.boundary\(batch.namespace\), token\]\)/);
  assert.match(reads,/s.fingerprint=w.value.*\.all\(JSON.stringify\(\[\.\.\.missing.values\(\)\].map\(value => value\[3\]\)\), \.\.\.boundary\(namespace\)\)/);
  assert.match(reads,/s.fingerprint=json_extract\(w.value,'\$\[3\]'\).*\.all\(JSON.stringify\(\[\.\.\.missing.values\(\)\]\)\)/);
  // Both marker lookup shapes compare the complete token by equality. A
  // [0-9a-f]{64} fingerprint cannot satisfy either rs1:-prefixed lookup.
  const walker=sourceWalker(sources),sites=walker.callers(suppress.node);
  assert.ok(sites.length,classified(suppress,'fingerprint-callers','expected source-backed fingerprint calls'));
  for(const site of sites){
    assert.equal(site.node.arguments.length,2,classified(site,'fingerprint-value','expected namespace and fingerprint'));
    let proof;
    try{proof=walker.prove(site.node.arguments[1],'fingerprint');}
    catch(error){
      assert.ok(error instanceof assert.AssertionError,'provenance failures must be classified assertions');
      assert.fail(classified(site,'fingerprint-value','unproven value: '+error.message));
    }
    assert.ok(proof>0,classified(site,'fingerprint-value','no proven fingerprint origin'));
  }
  return sites;
}
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
  const classes=new Map([['marker',[]],['fingerprint',[]]]);
  for(const site of prepares){
    const matches=[
      site.file==='content-suppression-storage.mjs'&&owner(site)==='suppressReceiptsInside'?'marker':null,
      site.file==='runtime.mjs'&&owner(site)==='suppress'?'fingerprint':null,
    ].filter(Boolean);
    assert.equal(matches.length,1,classified(site,'writer-class','every suppressed insert belongs to exactly one class'));
    classes.get(matches[0]).push(site);
  }
  for(const [kind,sites]of classes)assert.equal(sites.length,1,'suppressed ['+kind+'-insert] expected one classified emitter');

  const helper=functionSite(sources,'content-suppression-storage.mjs','suppressReceiptsInside');
  const helperSource=sources.get(helper.file),helperText=helperSource.text(helper.node);
  assert.ok(callNamed(helper.node.body?.body?.[0]?.expression,'requireSuppressionTransaction'),
    classified(helper,'transaction','marker emitter requires the caller transaction'));
  const marker=prepares.find(site=>owner(site)==='suppressReceiptsInside');
  assert.ok(marker,classified(helper,'insert-shape','expected marker prepare site'));
  const condition=[...marker.ancestors].reverse().find(node=>node.type==='IfStatement');
  assert.ok(named(condition?.test,'denySharedSource'),classified(marker,'marker-condition','the default false path cannot write markers'));
  const member=marker.ancestors.at(-1),run=marker.ancestors.at(-2);
  assert.ok(member?.type==='MemberExpression'&&named(member.property,'run')&&run?.type==='CallExpression'&&run.callee===member,
    classified(marker,'marker-values','expected immediate execution of the marker insert'));
  assert.equal(helperSource.text(run.arguments[1]),'JSON.stringify(receiptDenialTokens(rows))',
    classified(marker,'marker-values','only rs1:-prefixed tokens enter the marker insert'));
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
  assertFingerprintClass(sources,classes.get('fingerprint')[0]);
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

test('the fingerprint catalog follows renamed injected helpers into a new module',()=>{
  const sources=sourceInventory(),runtime=sources.get('runtime.mjs');
  const injected=runtime.source.replace('  const supersessionStorage = createSupersessionStorage(',
    `  const syntheticFingerprints=createSyntheticFingerprintStorage({block:suppress});
  function syntheticFingerprint(ns,id){
    syntheticFingerprints.remember(ns,activeRow(ns,id));
    syntheticFingerprints.hashed(ns,'synthetic content');
  }
  const supersessionStorage = createSupersessionStorage(`);
  assert.notEqual(injected,runtime.source);
  sources.set('runtime.mjs',inventory('runtime.mjs',injected+
    "\nimport { createSyntheticFingerprintStorage } from './synthetic-fingerprint-storage.mjs';\n"));
  const file='synthetic-fingerprint-storage.mjs',source=`
import {fingerprint as engineFingerprint} from './validation.mjs';
export function createSyntheticFingerprintStorage({block:deny}) {
  const renamed=deny;
  function remember(ns,row){renamed(ns,row.fingerprint);}
  function hashed(ns,content){renamed(ns,engineFingerprint(content));}
  return {remember,hashed};
}`;
  sources.set(file,inventory(file,source));
  assertMarkerFences(sources);
  for(const value of ["'rs1:i:synthetic'","({fingerprint:'rs1:i:synthetic'}).fingerprint"]){
    sources.set(file,inventory(file,source.replace('row.fingerprint',value)));
    assert.throws(()=>assertMarkerFences(sources),error=>{
      assert.ok(error instanceof assert.AssertionError);
      assert.match(error.message,/synthetic-fingerprint-storage\.mjs:\d+ remember \[fingerprint-value\]/);
      return true;
    });
  }
});

test('the fingerprint catalog rejects marker values at the injected supersession caller',()=>{
  const sources=sourceInventory(),file='supersession-storage.mjs',source=sources.get(file).source;
  const changed=source.replace('suppress(ns, previous.fingerprint)',"suppress(ns, 'rs1:i:synthetic')");
  assert.notEqual(changed,source);sources.set(file,inventory(file,changed));
  assert.throws(()=>assertMarkerFences(sources),error=>{
    assert.ok(error instanceof assert.AssertionError);
    assert.match(error.message,/supersession-storage\.mjs:\d+ retireMutation \[fingerprint-value\]/);
    return true;
  });
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

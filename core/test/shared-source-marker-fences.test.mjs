import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { ns, ok } from '../testing/card-lineage-fixture.mjs';
import { fixture, capture, act, markers, originalRow } from '../testing/shared-source-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { receiptDenialTokens } from '../raw-source-roots.mjs';

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
  return {callers,directFunction,bindingOf};
}

const fingerprintMember=node=>node?.type==='MemberExpression'&&!node.computed&&!node.optional&&named(node.property,'fingerprint');
const engineFingerprintCall=(node,walker,fn)=>node?.type==='CallExpression'&&!node.optional&&
  node.callee.type==='Identifier'&&walker.directFunction(node.callee)===fn;

// A complete, reviewed producer/sink census, not an object-data-flow proof.
// Keep duplicates: the confirmation INSERT and its UPDATE bind the same value.
// Five same-named auxiliary properties are pump configuration signatures or
// raw-search capabilities/index payloads, not Memory fingerprints. Catalog
// those too, rather than exempting their modules from discovery. The two
// suppressed sinks are checked separately by the unchanged emitter proofs.
const expectedFingerprintProducers=[
  ['card-raw-sources.mjs','object',"createHash('sha256').update(sealed).digest('hex')"],
  ['content-safety-observations.mjs','object','memory.fingerprint'],
  ['content-suppression-storage.mjs','INSERT suppressed.fingerprint','JSON.stringify(receiptDenialTokens(rows, replacements))'],
  ['context-product-pump.mjs','object','fingerprint'],
  ['context-semantic-pump.mjs','object','fingerprint'],
  ['ordered-capture-storage.mjs','INSERT confirmation_supersessions.previous_fingerprint','row.previous.fingerprint'],
  ['ordered-capture-storage.mjs','UPDATE confirmation_supersessions.previous_fingerprint','row.previous.fingerprint'],
  ['raw-search-authority.mjs','object','fingerprint'],
  ['raw-search-maintenance.mjs','object','fingerprint'],
  ['raw-search-storage.mjs','object','fingerprint'],
  ['runtime.mjs','INSERT suppressed.fingerprint','value'],
  ['runtime.mjs','INSERT memories.fingerprint','value.fingerprint'],
  ['runtime.mjs','UPDATE memories.fingerprint','value.fingerprint'],
  ['suppression-content.mjs','object','fingerprint(content)'],
  ['validation.mjs','object','fingerprint(content)'],
];
const producerKey=entry=>JSON.stringify(entry);
const producerTuple=entry=>[entry.site.file,entry.kind,entry.expression];
const fingerprintColumn=name=>['fingerprint','previous_fingerprint'].includes(name.toLowerCase());
const sqlIdentifier=text=>text.trim().replace(/^["`\[]|["`\]]$/g,'').toLowerCase();

function fingerprintProducers(sources,walker){
  const result=[];
  for(const source of sources.values()){
    const add=(site,kind,value)=>{
      assert.ok(value,classified(site,'fingerprint-producer','missing source-backed column value'));
      result.push({site,kind,value,expression:source.text(value)});
    };
    for(const site of source.nodes){
      const node=site.node,parent=site.ancestors.at(-1);
      // Include quoted/computed literal names, and reject computed writes
      // below; neither can bypass the census by changing AST node shape.
      if(node.type==='Property'&&parent?.type==='ObjectExpression'&&
          (node.key.name??node.key.value)==='fingerprint'){
        assert.ok(!node.computed&&node.kind==='init',classified(site,'fingerprint-producer','expected a data property'));
        add(site,'object',node.value);
      }
      if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&
          (node.left.property.name??node.left.property.value)==='fingerprint'){
        assert.ok(!node.left.computed&&node.operator==='=',classified(site,'fingerprint-producer','expected a simple property assignment'));
        add(site,'assignment',node.right);
      }
      // Scan SQL text independently of prepare/run discovery, so moving a
      // write out of its immediate prepare/run shape fails closed.
      const sql=node.type==='Literal'&&typeof node.value==='string'?node.value:
        node.type==='TemplateLiteral'?node.quasis.map(part=>part.value.cooked).join('${expression}'):'';
      if(!/^\s*(?:INSERT|UPDATE)\b/i.test(sql)||!/\b(?:previous_)?fingerprint\b/i.test(sql))continue;
      const prepare=parent,member=site.ancestors.at(-2),run=site.ancestors.at(-3);
      assert.ok(prepare?.type==='CallExpression'&&named(prepare.callee?.property,'prepare')&&prepare.arguments[0]===node&&
        member?.type==='MemberExpression'&&member.object===prepare&&named(member.property,'run')&&
        run?.type==='CallExpression'&&run.callee===member,
      classified(site,'fingerprint-producer','SQL fingerprint writes require immediate prepare(...).run(...)'));
      const args=run.arguments.flatMap(arg=>{
        if(arg.type!=='SpreadElement')return [arg];
        const fn=arg.argument.type==='CallExpression'&&walker.directFunction(arg.argument.callee),array=fn?.body;
        assert.ok(array?.type==='ArrayExpression'&&array.elements.every(value=>value&&value.type!=='SpreadElement'),
          classified(site,'fingerprint-producer','SQL spread arity must be a source-backed fixed array'));
        return array.elements;
      });
      const bound=offset=>args[(sql.slice(0,offset).match(/\?/g)??[]).length];
      const insert=/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([^\s(]+)\s*\(([^)]+)\)\s*/i.exec(sql);
      const inserted=new Map();
      if(insert){
        const table=sqlIdentifier(insert[1]),columns=insert[2].split(',').map(sqlIdentifier);
        const rest=sql.slice(insert[0].length),values=/^VALUES\s*\(([^)]+)\)/i.exec(rest);
        if(values){
          const cells=values[1].split(','),base=insert[0].length+values[0].indexOf('(')+1;
          assert.equal(cells.length,columns.length,classified(site,'fingerprint-producer','INSERT column/value arity'));
          let offset=base;
          for(const [index,column]of columns.entries()){
            const cell=cells[index];
            if(fingerprintColumn(column)){
              assert.equal(cell.trim(),'?',classified(site,'fingerprint-producer','fingerprint SQL expression must bind a JS value'));
              const value=bound(offset);inserted.set(column,value);add(site,'INSERT '+table+'.'+column,value);
            }
            offset+=cell.length+1;
          }
        }else{
          // The only SELECT producer is the already-proved marker emitter:
          // json_each unwraps the JS token array bound in the fourth slot.
          assert.equal(normalize(sql),
            'INSERT OR IGNORE INTO suppressed(owner_id,scope,project_id,fingerprint) SELECT ?,?,?,value FROM json_each(?)',
            classified(site,'fingerprint-producer','unclassified INSERT SELECT'));
          add(site,'INSERT '+table+'.fingerprint',args[3]);
        }
      }
      const update=insert?/\bDO\s+UPDATE\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(sql):
        /^\s*UPDATE\s+([^\s]+)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|$)/i.exec(sql);
      if(update){
        const table=sqlIdentifier(insert?insert[1]:update[1]),set=update[insert?1:2];
        let offset=update.index+update[0].indexOf(set);
        for(const cell of set.split(',')){
          const assignment=/^\s*([^=]+)=([\s\S]*)$/.exec(cell);
          assert.ok(assignment,classified(site,'fingerprint-producer','unclassified UPDATE assignment'));
          const column=sqlIdentifier(assignment[1]),expression=assignment[2].trim();
          if(fingerprintColumn(column)){
            const excluded=expression.match(/^excluded\.(\w+)$/i);
            assert.ok(expression==='?'||insert&&excluded&&sqlIdentifier(excluded[1])===column,
              classified(site,'fingerprint-producer','fingerprint UPDATE must bind JS or reuse its INSERT column'));
            add(site,'UPDATE '+table+'.'+column,excluded?inserted.get(column):bound(offset+cell.indexOf('=')+1));
          }
          offset+=cell.length+1;
        }
      }
      assert.ok(insert||update,classified(site,'fingerprint-producer','unclassified fingerprint SQL write'));
    }
  }
  return result;
}

function assertFingerprintProducers(sources,walker,fingerprint){
  const producers=fingerprintProducers(sources,walker);
  const auxiliaryOwners=new Map([
    ['context-product-pump.mjs','renewContextMaintenancePump'],
    ['context-semantic-pump.mjs','semanticPump'],
    ['raw-search-authority.mjs','createRawSearchAuthority'],
    ['raw-search-maintenance.mjs','run'],
    ['raw-search-storage.mjs','unpack'],
  ]);
  const sinks=expectedFingerprintProducers.filter(([,kind])=>kind==='INSERT suppressed.fingerprint').map(producerKey);
  for(const entry of producers){
    const {site,value,kind,expression}=entry,tuple=producerTuple(entry);
    if(kind==='object'&&expression==='fingerprint'&&auxiliaryOwners.has(site.file)){
      assert.equal(owner(site),auxiliaryOwners.get(site.file),classified(site,'fingerprint-producer','unreviewed auxiliary property'));
      continue;
    }
    if(sinks.includes(producerKey(tuple)))continue;
    let hash=value?.callee?.object;
    const hex=value?.type==='CallExpression'&&!value.optional&&value.callee.type==='MemberExpression'&&
      !value.callee.computed&&named(value.callee.property,'digest')&&value.arguments.length===1&&value.arguments[0].value==='hex';
    while(hash?.type==='CallExpression'&&!hash.optional&&hash.callee.type==='MemberExpression'&&
      !hash.callee.computed&&named(hash.callee.property,'update'))hash=hash.callee.object;
    const cryptoBinding=hash?.callee?.type==='Identifier'&&walker.bindingOf(hash.callee);
    const sha256=hex&&callNamed(hash,'createHash')&&hash.arguments.length===1&&hash.arguments[0].value==='sha256'&&
      cryptoBinding?.imported==='createHash'&&cryptoBinding.import.source.value==='node:crypto';
    assert.ok(fingerprintMember(value)||engineFingerprintCall(value,walker,fingerprint)||sha256||
      value?.type==='MemberExpression'&&!value.computed&&named(value.property,'previous_fingerprint'),
      classified(site,'fingerprint-producer','unapproved fingerprint value: '+expression));
  }
  const actual=producers.map(producerTuple).map(producerKey).sort(),expected=expectedFingerprintProducers.map(producerKey).sort();
  const unexpected=producers.find(entry=>!expected.includes(producerKey(producerTuple(entry))));
  assert.deepEqual(actual,expected,classified(unexpected?.site??producers[0]?.site,'fingerprint-producer-catalog',
    'complete producer list must equal the reviewed list ('+producers.length+' entries); '+
    producers.map(entry=>label(entry.site)+' '+entry.kind+' <- '+entry.expression).join('; ')));
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
  assert.equal(fingerprint.ancestors.at(-1)?.type,'ExportNamedDeclaration',
    classified(fingerprint,'fingerprint-shape','the reviewed digest builder is the exported engine fingerprint'));
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
    // The builder may only drop tokens that the same builder derives for a correction's replacement receipts.
    "function receiptDenialTokens(receipts, replacements = []) { const retained = new Set(replacements.length ? receiptDenialTokens(replacements) : []); return [...new Set(receipts.flatMap(receipt => [ 'rs1:i:' + receipt.receipt_key, 'rs1:a:' + createHash('sha256').update(JSON.stringify([ 'receipt-source-address-v1', receipt.client, receipt.session_id, receipt.event_id, receipt.role, ])).digest('hex'), ]).filter(token => !retained.has(token)))]; }",
    classified(tokens,'marker-shape','the token-pair builder is the only returned marker source'));
  const denials=functionSite(sources,'content-safety.mjs','receiptDenialsInside');
  const reads=sources.get(denials.file).text(denials.node);
  assert.match(reads,/for \(const batch of batches\) for \(const token of receiptDenialTokens\(batch.receipts\)\)/);
  assert.match(reads,/missing.set\(id, \[\.\.\.boundary\(batch.namespace\), token\]\)/);
  assert.match(reads,/s.fingerprint=w.value.*\.all\(JSON.stringify\(\[\.\.\.missing.values\(\)\].map\(value => value\[3\]\)\), \.\.\.boundary\(namespace\)\)/);
  assert.match(reads,/s.fingerprint=json_extract\(w.value,'\$\[3\]'\).*\.all\(JSON.stringify\(\[\.\.\.missing.values\(\)\]\)\)/);
  // Both marker lookup shapes compare the complete token by equality. A
  // [0-9a-f]{64} fingerprint cannot satisfy either rs1:-prefixed lookup:
  // r and s are not hex digits, so the two value classes are disjoint.
  const walker=sourceWalker(sources),sites=walker.callers(suppress.node);
  assert.ok(sites.length,classified(suppress,'fingerprint-callers','expected source-backed fingerprint calls'));
  for(const site of sites){
    assert.equal(site.node.arguments.length,2,classified(site,'fingerprint-value','expected namespace and fingerprint'));
    const value=site.node.arguments[1];
    assert.ok(fingerprintMember(value)||engineFingerprintCall(value,walker,fingerprint.node),
      classified(site,'fingerprint-value','expected non-computed <expr>.fingerprint or a direct engine fingerprint call; got '+
        sources.get(site.file).text(value)));
  }
  assertFingerprintProducers(sources,walker,fingerprint.node);
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
  assert.equal(helperSource.text(run.arguments[1]),'JSON.stringify(receiptDenialTokens(rows, replacements))',
    classified(marker,'marker-values','only rs1:-prefixed tokens enter the marker insert'));
  // A correction may name the same Memory's new receipts so that a re-cited receipt derives no marker.
  // Only the last parameter carries them, and it defaults to none.
  assert.equal(helper.node.params?.length,8,classified(helper,'marker-replacements','expected eight parameters'));
  assert.ok(helper.node.params[7]?.type==='AssignmentPattern'&&named(helper.node.params[7].left,'replacements')&&
    helper.node.params[7].right?.type==='ArrayExpression'&&helper.node.params[7].right.elements.length===0,
    classified(helper,'marker-replacements','replacements default to an empty list'));
  assert.equal(helper.node.params?.[5]?.type,'AssignmentPattern',classified(helper,'marker-default','expected default parameter'));
  assert.equal(helper.node.params?.[5]?.right?.value,false,classified(helper,'marker-default','markers default to false'));
  assert.match(helperText,/JSON\.stringify\(receiptDenialTokens\(rows, replacements\)\)/);
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
      // The replacements are exactly this correction's own normalized new receipts.
      assert.equal(args.length,8,classified(site,'marker-replacements','correction names its replacement receipts'));
      assert.equal(source.text(args[7]).replace(/\s+/g,' '),
        "value.receipts.map(receipt => ({ receipt_key: receiptKey(receipt), client: receipt.client, session_id: receipt.sessionId, event_id: receipt.eventId, role: receipt.role }))",
        classified(site,'marker-replacements','only the corrected Memory\'s incoming receipts are replacements'));
    }else{
      assert.ok(args?.[5],classified(site,'marker-enable','forget must specify the marker condition'));
      assert.equal(args.length,7,classified(site,'marker-replacements','forget and rejection never name replacements'));
      assert.equal(source.text(args[5]),"suppressionReason === 'user_forget' || reason === 'rejected'",
        classified(site,'marker-enable','forget enables markers for user forget and rejection'));
    }
  }
  // Token subtraction exists only where a correction writes markers and where the verifier derives them.
  const subtracting=calls(sources,'receiptDenialTokens').filter(site=>site.node.arguments.length!==1);
  assert.deepEqual(subtracting.map(site=>site.file+':'+site.node.arguments.length+':'+sources.get(site.file).text(site.node.arguments[1])).sort(),[
    'content-suppression-storage.mjs:2:replacements','content-write-safety.mjs:2:replacements',
  ],'receiptDenialTokens [replacement-census] every two-argument call is classified: '+subtracting.map(label).join(', '));
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
  for(const value of ["'rs1:i:synthetic'",'`rs1:i:${row.id}`',"'rs1:i:' + row.id","row['fingerprint']",'row']){
    sources.set(file,inventory(file,source.replace('row.fingerprint',value)));
    assert.throws(()=>assertMarkerFences(sources),error=>{
      assert.ok(error instanceof assert.AssertionError);
      assert.match(error.message,/synthetic-fingerprint-storage\.mjs:\d+ remember \[fingerprint-value\]/);
      return true;
    });
  }
  sources.set(file,inventory(file,source.replace('row.fingerprint',"({fingerprint:'rs1:i:' + row.id}).fingerprint")));
  assert.throws(()=>assertMarkerFences(sources),error=>{
    assert.ok(error instanceof assert.AssertionError);
    assert.match(error.message,/synthetic-fingerprint-storage\.mjs:\d+ remember \[fingerprint-producer\]/);
    return true;
  });
});

test('the fingerprint catalog rejects marker values at the injected supersession caller',()=>{
  const original=sourceInventory(),file='supersession-storage.mjs',source=original.get(file).source;
  for(const value of ["'rs1:i:synthetic'",'`rs1:i:${previous.id}`']){
    const changed=source.replace('suppress(ns, previous.fingerprint)','suppress(ns, '+value+')');
    assert.notEqual(changed,source);
    const sources=new Map(original);sources.set(file,inventory(file,changed));
    assert.throws(()=>assertMarkerFences(sources),error=>{
      assert.ok(error instanceof assert.AssertionError);
      assert.match(error.message,/supersession-storage\.mjs:\d+ retireMutation \[fingerprint-value\]/);
      return true;
    });
  }
});

test('the fingerprint producer catalog rejects marker producers and unreviewed safe producers',()=>{
  const original=sourceInventory(),file='synthetic-fingerprint-producer.mjs';
  const mutations=[
    "export function produce(x){return {fingerprint:'rs1:i:' + x};}",
    "export function produce(x,row){row.fingerprint='rs1:i:' + x;}",
    "export function produce(db,x){db.prepare('INSERT INTO memories (fingerprint) VALUES (?)').run('rs1:i:' + x);}",
    "export function produce(db,x){db.prepare('UPDATE memories SET fingerprint=?').run('rs1:i:' + x);}",
    "export function produce(db,x){db.prepare('UPDATE confirmation_supersessions SET previous_fingerprint=?').run('rs1:i:' + x);}",
    // Even an allowed expression needs an explicit catalog review.
    "import {fingerprint} from './validation.mjs'; export function produce(x){return {fingerprint:fingerprint(x)};}",
  ];
  for(const source of mutations){
    const sources=new Map(original);sources.set(file,inventory(file,source));
    assert.throws(()=>assertMarkerFences(sources),error=>{
      assert.ok(error instanceof assert.AssertionError);
      assert.match(error.message,/synthetic-fingerprint-producer\.mjs:\d+ produce \[fingerprint-producer(?:-catalog)?\]/);
      return true;
    });
  }
});

// Follow shared-source-forget.test.mjs's
// "shared source fresh-default forget, independent=false" and
// shared-source-writes.test.mjs's correction/forget/rejection statement-addition cases.
// Ordered retirement follows ordered-capture.test.mjs's "O1/O4 ordered captures
// automatically retire Friday, bind real Monday evidence and preserve inferred authority".
test('public fingerprint and marker writers produce disjoint suppressed values',{timeout:15000},async t=>{
  const f=await fixture(t,'fresh-default'),siblings=f.model.items;
  const sources=sourceInventory();
  // Use the static proof's helper/caller censuses and pinned default arguments:
  // receipt removal disables markers; forgetMutationInside expands to its
  // user-forget/rejection routes, excluding the explicitly purging Raw route.
  const markerWriters=calls(sources,'suppressReceiptsInside').flatMap(site=>{
    if(site.node.arguments.length<=5||site.node.arguments[5]?.value===false)return [];
    if(owner(site)!=='forgetMutationInside')return [site];
    return calls(sources,'forgetMutation').filter(({node})=>{
      const reason=node.arguments[3]?.value??'forgotten';
      const suppressionReason=node.arguments[4]?.value??(reason==='forgotten'?'user_forget':'purge');
      return suppressionReason==='user_forget'||reason==='rejected';
    });
  });
  const staticWriters=[...markerWriters.map(site=>['marker',label(site)]),
    ...sourceWalker(sources).callers(functionSite(sources,'runtime.mjs','suppress').node)
      .map(site=>['fingerprint',label(site)])];
  const workload={
    supersession:[['fingerprint','supersession-storage.mjs:55 retireMutation']],
    correct:[['marker','runtime.mjs:357 correct'],['fingerprint','runtime.mjs:363 correct']],
    forget:[['marker','runtime.mjs:417 forget'],['fingerprint','runtime.mjs:395 forgetMutationInside']],
    reject:[['marker','confirmation-storage.mjs:35 resolve'],['fingerprint','runtime.mjs:395 forgetMutationInside']],
    episode:[['marker','episode-storage.mjs:1012 forget'],['fingerprint','runtime.mjs:395 forgetMutationInside']],
  };
  const stored=()=>f.db.prepare('SELECT * FROM suppressed ORDER BY owner_id,scope,project_id,fingerprint').all();
  const rowKey=row=>JSON.stringify([row.owner_id,row.scope,row.project_id,row.fingerprint]);
  const observations=[];
  const exercise=async(operation,call)=>{
    const before=stored(),result=await call(),after=stored();
    const previous=new Set(before.map(rowKey)),added=after.filter(row=>!previous.has(rowKey(row)));
    const writers=workload[operation];
    for(const [kind,site]of writers){
      const shape=kind==='fingerprint'?/^[0-9a-f]{64}$/:/^rs1:[ia]:/;
      assert.ok(added.some(row=>shape.test(row.fingerprint)),site+' ['+kind+'-runtime-write] public '+operation+' added a row');
    }
    observations.push({writers,before,after,added});
    return {result,added};
  };
  const item=content=>({content,kind:'fact',confidence:.8,sourceIndices:[0]});
  f.model.reconcile=()=>({transitions:[{replacementIndex:0,predecessorIndex:0,evidenceIndices:[0],
    relation:'supersedes',valueChange:'changed',adoption:'explicit'}]});
  const ordered=async(sequence,content)=>{
    f.model.items=[item(content)];
    return ok(await f.core.capture({namespace:ns,client:'synthetic',sessionId:'marker-ordered',eventId:'ordered-'+sequence,
      causal:{streamId:'marker-stream',sequence},messages:[{id:'ordered-message-'+sequence,role:'user',content}]}));
  };
  const first=await ordered(1,'Project Alpha deadline is Friday.');
  const predecessor=first.admission.memories[0],oldFingerprint=originalRow(f,predecessor).fingerprint;
  const {result:second,added:retired}=await exercise('supersession',()=>ordered(2,'Project Alpha deadline is Monday.'));
  assert.deepEqual(second.reconciliation,{status:'applied',reason:null,retiredCount:1});
  const history=f.db.prepare('SELECT * FROM memory_supersessions').all();
  assert.equal(history.length,1,'ordered capture reached retireMutation');
  assert.equal(history[0].previous_memory_id,predecessor.id);
  assert.equal(history[0].replacement_memory_id,second.admission.memories[0].id);
  assert.ok(retired.some(row=>row.fingerprint===oldFingerprint),'retirement added its fingerprint in this call');
  assert.ok(stored().some(row=>row.fingerprint===oldFingerprint),'retirement wrote its fingerprint');

  f.model.items=siblings;
  const [sibling,target]=await capture(f),before=originalRow(f,sibling);
  const mutate=async(operation,memory)=>{
    const fingerprint=originalRow(f,memory).fingerprint,markerCount=markers(f).length;
    const {result,added}=await exercise(operation,()=>act(f,operation,memory));
    ok(result);
    assert.ok(added.some(row=>row.fingerprint===fingerprint),operation+' added the original fingerprint in this call');
    assert.ok(stored().some(row=>row.fingerprint===fingerprint),operation+' wrote the original fingerprint');
    assert.ok(markers(f).length>markerCount,operation+' wrote new shared-source markers');
    if(operation==='correct')assert.notEqual(originalRow(f,memory).fingerprint,fingerprint,'correction changed content identity');
  };
  await mutate('forget',target);
  assert.deepEqual(originalRow(f,sibling),before,'sibling forget left the survivor unchanged');
  for(const operation of ['correct','forget','reject']){
    const content='Synthetic marker-fence '+operation+' target';
    f.model.items=[{...item(content),kind:operation==='reject'?'decision':'fact'}];
    const captured=ok(await f.core.capture({namespace:ns,client:'synthetic',sessionId:'marker-'+operation,
      eventId:'marker-'+operation,messages:[{id:'marker-message-'+operation,role:'user',content}]}));
    const memory=captured.admission.memories[0];
    if(operation==='reject')assert.equal(originalRow(f,memory).review_state,'awaiting');
    await mutate(operation,memory);
  }

  // Follow shared-source-episode.test.mjs's fresh linked=false construction:
  // public Episode capture links one Memory; ordinary capture reuses its saved
  // message coordinates for an unlinked sibling. Forgetting follows E7
  // "conversation deletion forgets deduplicated/historical lineage with suppression,
  // unrelated survives" in episode-storage.test.mjs and CF1's Episode forget.
  const linkedContent='Synthetic legacy Episode linked claim',sharedText=linkedContent+'. Synthetic Episode sibling evidence.';
  const episodeCore=openMemoryCore({path:f.path,...episodeOptions,
    model:episodeModel({extract:()=>({items:[item(linkedContent)]})})});
  t.after(()=>episodeCore.close());
  const episodeCapture=ok(await episodeCore.capture(episodeInput(1,'marker-legacy-episode',{namespace:ns,
    messages:[{id:'marker-episode-message',role:'user',content:sharedText}]})));
  const linked=episodeCapture.admission.memories[0],episodeId=episodeCapture.episode.id;
  const saved=ok(episodeCore.get({namespace:ns,memoryId:linked.id})).receipts[0];
  f.model.items=[item('Synthetic legacy Episode surviving sibling')];
  const episodeSibling=ok(await f.core.capture({namespace:ns,client:saved.client,sessionId:saved.sessionId,
    eventId:'marker-episode-sibling',messages:[{id:saved.eventId,role:saved.role,content:saved.excerpt}]})).admission.memories[0];
  assert.notEqual(episodeSibling.id,linked.id);
  assert.deepEqual(f.db.prepare('SELECT memory_id FROM episode_memory_links WHERE episode_id=? ORDER BY memory_id').all(episodeId)
    .map(row=>row.memory_id),[linked.id],'only the target Memory is linked to the Episode');
  const siblingBefore=originalRow(f,episodeSibling),linkedFingerprint=originalRow(f,linked).fingerprint;
  const siblingReceipts=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(episodeSibling.id);
  assert.equal(siblingReceipts.length,1,'sibling has the shared message receipt');
  const siblingTokens=receiptDenialTokens(siblingReceipts);
  assert.equal(siblingTokens.length,2,'sibling supplies identity and address markers');
  assert.deepEqual(siblingTokens,receiptDenialTokens(f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(linked.id)),
    'linked Memory and unlinked sibling share receipt identity and message address');
  const episode=ok(episodeCore.getEpisode({namespace:ns,episodeId})).episode;
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='raw_deletion_actions'").get().n,0,
    'fresh-default has no source-root deletion: forgetEpisode must take the legacy branch');
  const {result:episodeForgotten,added:episodeRows}=await exercise('episode',()=>episodeCore.forgetEpisode({namespace:ns,episodeId,
    expectedRevision:episode.revision}));
  assert.equal(ok(episodeForgotten).forgotten,true);
  assert.ok(episodeRows.some(row=>row.fingerprint===linkedFingerprint),'legacy Episode forget added the linked fingerprint');
  for(const token of siblingTokens)assert.ok(episodeRows.some(row=>row.fingerprint===token),
    'legacy Episode forget added the sibling receipt token: '+token);
  assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episodeId).deleted,1);
  assert.equal(f.core.get({namespace:ns,memoryId:linked.id}).error.code,'memory_not_found');
  assert.deepEqual(originalRow(f,episodeSibling),siblingBefore,'legacy Episode forget left the unlinked sibling unchanged');
  assert.deepEqual(ok(f.core.get({namespace:ns,memoryId:episodeSibling.id})).receipts,[],'sibling receipt is withheld by the markers');

  // Only writers whose individual call added the required class enter this
  // list. Keep duplicates in the source catalog so an extra call site also fails.
  const runtimeWriters=[...new Map(observations.flatMap(row=>row.writers).map(writer=>[JSON.stringify(writer),writer])).values()];
  const compareWriters=catalog=>assert.deepEqual(runtimeWriters.map(writer=>JSON.stringify(writer)).sort(),
    catalog.map(writer=>JSON.stringify(writer)).sort(),'suppressed [runtime-writer-catalog] exercised writers equal source-derived writers');
  compareWriters(staticWriters);
  assert.throws(()=>compareWriters([...staticWriters,['marker','synthetic-extra-writer.mjs:1 extraWriter']]),
    {code:'ERR_ASSERTION',message:/\[runtime-writer-catalog\]/},'an unexercised extra source writer must fail coverage');
  let fingerprints=0,tokens=0;
  for(const row of stored()){
    const value=row.fingerprint,hex=/^[0-9a-f]{64}$/.test(value),marker=/^rs1:[ia]:/.test(value);
    assert.equal(Number(hex)+Number(marker),1,'suppressed value belongs to exactly one class: '+value);
    assert.equal(hex&&marker,false,'fingerprints never match marker decisions');
    fingerprints+=Number(hex);tokens+=Number(marker);
  }
  assert.ok(fingerprints>=5,'retirement, sibling forget, correction, public forget and rejection wrote distinct fingerprints');
  assert.ok(tokens>0,'the marker class is non-empty');
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
  // Replacement receipts: a correction may name only its own incoming receipts, and forgetting may name none.
  const substitute=(from,to)=>{assert.equal(runtime.source.split(from).length,2,'one mutation site: '+from);return runtime.source.replace(from,to);};
  mutations.push(substitute('value.receipts.map(receipt => ({ receipt_key: receiptKey(receipt)','receiptSnapshot.map(receipt => ({ receipt_key: receipt.receipt_key'));
  mutations.push(substitute('cachedContentLayout(db)?.suppressionRevision ? undefined : receiptSnapshot);','cachedContentLayout(db)?.suppressionRevision ? undefined : receiptSnapshot, receiptSnapshot);'));
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

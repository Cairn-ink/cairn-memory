import test from 'node:test';
import assert from 'node:assert/strict';
import {useInstalledDependencies} from '../dependencies.mjs';
import {PrivacyGuard,PRIVATE_FIELD_INVENTORY} from '../privacy.mjs';
import {collectPrivateMetadata,templatePlaceholders} from '../private-field-inventory.mjs';
import {event} from './fixtures.mjs';
useInstalledDependencies();
const family={family_id:'pilot-correction-L01-W1'};


test('A6 placeholder inventory: P formatter record alias passes without public-path exemptions',async()=>{
 const {formatEvent}=await import('../product.mjs');
 assert.ok(templatePlaceholders().includes('record'));
 assert.ok(!PRIVATE_FIELD_INVENTORY.fields.some(f=>f.name==='record'));
 assert.doesNotThrow(()=>new PrivacyGuard(family).check('product-payload',{memory:{content:formatEvent(event(1),'r1')}}));
});
test('A6 placeholder inventory: private values under every formatter key remain rejected',async()=>{
 const {formatEvent}=await import('../product.mjs');
 const header=JSON.parse(formatEvent(event(1),'r1').split('\n')[0]);
 const privateValue=family.family_id;
 for(const key of Object.keys(header))assert.throws(()=>new PrivacyGuard(family).check('product-payload',{memory:{content:JSON.stringify({...header,[key]:privateValue})}}),/private_label_leak/,key);
});
test('A6 placeholder inventory: undeclared map keys fail closed and declared values stay recursive',()=>{
 const origin='private_generator_support',wrap=variables=>({optional_trivia:{emission_inputs:[{variables}]}});
 assert.throws(()=>collectPrivateMetadata(wrap({undeclared_placeholder:'secret'}),origin,()=>{}),/undeclared_template_placeholder:undeclared_placeholder/);
 for(const key of templatePlaceholders()){
  const found=[];collectPrivateMetadata(wrap({[key]:{private_nested_marker:'secret'}}),origin,(name,path)=>found.push({name,path}));
  assert.ok(found.some(f=>f.name==='private_nested_marker'&&f.path.includes('.variables.'+key+'.')));
  assert.ok(!found.some(f=>f.path.endsWith('.variables.'+key)));
 }
});
test('A6 placeholder inventory: genuine record metadata outside variables remains inventoried',()=>{
 for(const source of [{record:'private'}, {optional_trivia:{record:'private'}}, {optional_trivia:{emission_inputs:[{variables:{record:{record:'private'}}}]}}]){
  const found=[];collectPrivateMetadata(source,'private_generator_support',(name,path)=>found.push({name,path}));
  assert.ok(found.some(f=>f.name==='record'));
 }
});

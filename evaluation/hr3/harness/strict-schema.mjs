#!/usr/bin/env node
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {providerSchema,extractionSchema,answerSchema} from './schema.mjs';

// Walk schema nodes rather than keyword containers such as properties/$defs.
// This is an offline structural check, not a provider acceptance probe.
export function checkStrictSchema(schema) {
  let nodes=0,objects=0;
  function visit(node,path) {
    nodes++;
    assert.ok(node&&typeof node==='object'&&!Array.isArray(node),`${path}: schema object required`);
    assert.equal(node.oneOf,undefined,`${path}: use anyOf`);
    if(Object.hasOwn(node,'$ref')) {
      assert.deepEqual(Object.keys(node),['$ref'],`${path}: $ref must have no sibling keywords`);
      assert.ok(typeof node.$ref==='string'&&node.$ref.startsWith('#/$defs/')&&schema.$defs?.[node.$ref.slice(8)],`${path}: dangling ref`);
      return;
    }
    const types=Array.isArray(node.type)?node.type:[node.type];
    if(Object.hasOwn(node,'anyOf'))assert.ok(Array.isArray(node.anyOf)&&node.anyOf.length>0,`${path}: nonempty anyOf required`);
    if(!node.anyOf||Object.hasOwn(node,'type'))assert.ok(types.length&&types.every(t=>['object','array','string','integer','number','boolean','null'].includes(t)),`${path}: type required`);
    if(types.includes('object')) {
      objects++;
      assert.equal(node.additionalProperties,false,`${path}: closed object required`);
      assert.deepEqual([...(node.required??[])].sort(),Object.keys(node.properties??{}).sort(),`${path}: all properties required`);
    }
    for(const [key,child] of Object.entries(node.properties??{}))visit(child,`${path}/properties/${key}`);
    for(const [key,child] of Object.entries(node.$defs??{}))visit(child,`${path}/$defs/${key}`);
    if(node.items)visit(node.items,`${path}/items`);
    for(const [i,child] of (node.anyOf??[]).entries())visit(child,`${path}/anyOf/${i}`);
  }
  visit(schema,'$');return {nodes,objects};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  for(const [name,schema] of Object.entries({extraction:extractionSchema,reader:answerSchema}))
    process.stdout.write(JSON.stringify({name,...checkStrictSchema(providerSchema(schema)),status:'PASS'})+'\n');
}

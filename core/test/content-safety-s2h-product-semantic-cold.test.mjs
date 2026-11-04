import test from 'node:test';
import assert from 'node:assert/strict';
import { productSemanticCells } from '../testing/content-safety-s2h-product-semantic-probe.mjs';

// Immutable main 26f9e467 native cold-refresh baseline. BEGIN and actual host
// invocations are controls; the statement ceiling fails on a6ec0e0e (+3).
for(const base of [18,23,33])for(const n of [12,24])test(`native legacy cold refresh v${base} n${n}`,async t=>{
 const [row]=await productSemanticCells(t,{base,n,coldOnly:true});
 assert.ok(row.statements<=(base===33?(n===12?819:1167):(n===12?687:903)),'legacy cold refresh adds no statements over main 26f9e467');
 assert.equal(row.headerSelects,0,'legacy cold refresh executes no suppression-header probe (also fails on merged #541)');
 assert.ok(row.begin<=52,'control: native BEGIN never exceeds immutable main; #541 also removes two BEGINs');
 assert.equal(row.hostInvocations,27,'control: original host invocation count');
});

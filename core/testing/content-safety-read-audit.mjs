import assert from 'node:assert/strict';
import { dirname, relative, resolve } from 'node:path';
import { splitRoot, splitSources } from './content-safety-split-audit.mjs';

// Close the lower-layer import graph, rather than trusting the name of the
// immediate helper. Aliased, forwarded and dynamic local imports are followed
// as well. None of these modules may receive a predicate callback by name.
export function assertContentReadGraph(sources = splitSources()) {
  const roots = ['core/content-suppression-storage.mjs', 'core/raw-lineage-storage.mjs'];
  const pending = [...roots], visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.notEqual(file, 'core/content-safety.mjs', 'read validation re-entry through ' + file);
    const source = sources.get(file);
    assert.equal(typeof source, 'string', 'unresolved lower-layer module: ' + file);
    assert.doesNotMatch(source, /\b(?:contentReadSafety|canonicalContentReadSafety|canonicalReceiptReadSafety|sourceReadSafety|receiptReadSafety|anchoredReadSafety)\b/,
      'read validation callback re-entry in ' + file);
    assert.doesNotMatch(source, /\b(?:import\s*\(|eval\s*\(|new\s+Function\b)/,
      'unreviewed dynamic validation edge in ' + file);
    for (const edge of source.matchAll(/(['"])(\.[^'"\n]+\.mjs)\1/g)) {
      const target = relative(splitRoot, resolve(splitRoot, dirname(file), edge[2]));
      assert.ok(!target.startsWith('../'), 'lower-layer import escapes repository');
      pending.push(target);
    }
  }
  // Fact-only entry takes data, never a caller-supplied validation callback.
  assert.match(sources.get(roots[0]), /export function contentSuppressionReasonInside\(db, ns, target = \{\}\)/);
  assert.match(sources.get(roots[1]), /export function createRawLineageStorage\(db, \{ readMemo \} = \{\}\)/,
    'lineage entry cannot receive a validation callback');
  const upper = sources.get('core/content-safety.mjs');
  function region(name, next) {
    const start = upper.indexOf('function ' + name + '(');
    const end = next ? upper.indexOf('function ' + next + '(', start + 1) : upper.length;
    assert.ok(start >= 0 && end > start, 'unreviewed read graph region: ' + name);
    return upper.slice(start,end);
  }
  const entries = ['contentReadSafety','canonicalContentReadSafety','canonicalReceiptReadSafety',
    'sourceReadSafety','receiptReadSafety','anchoredReadSafety'];
  for (const [name,next] of [['rawSuppression','sourceSuppression'],['sourceSuppression','sourceReadSafety']]) {
    const body = region(name,next).slice(region(name,next).indexOf('\n') + 1);
    for (const entry of entries) assert.doesNotMatch(body,new RegExp('\\b'+entry+'\\b'),
      'fact helper validation re-entry: '+name+' -> '+entry);
    assert.doesNotMatch(body,new RegExp('\\b'+name+'\\b'),'recursive fact helper: '+name);
    if (name === 'rawSuppression') assert.doesNotMatch(body,/\bsourceSuppression\b/,'back-edge in fact helper graph');
    assert.doesNotMatch(body,/\b(?:import\s*\(|eval\s*\(|new\s+Function\b)/,'dynamic fact helper edge');
  }
  assert.match(upper,/function rawSuppression\(db, ns, targets\)/);
  assert.match(upper,/function sourceSuppression\(db, ns, ref, rawTargets, ancestryChecked\)/);
  const order = ['canonicalReceiptReadSafety','receiptReadSafety','anchoredReadSafety',
    'memorySuppression','cardContributorsInside','rawSuppression','sourceSuppression',
    'sourceReadSafety','canonicalContentReadSafety','contentReadSafety'];
  const children = {
    canonicalReceiptReadSafety:[], receiptReadSafety:['canonicalReceiptReadSafety'],
    anchoredReadSafety:['receiptReadSafety'], sourceReadSafety:['canonicalReceiptReadSafety'],
    canonicalContentReadSafety:['receiptReadSafety','sourceReadSafety'], contentReadSafety:['canonicalContentReadSafety'],
  };
  for (const name of entries) {
    const index = order.indexOf(name), body = region(name,order[index+1]);
    assert.equal([...body.matchAll(new RegExp('\\b'+name+'\\b','g'))].length,1,'recursive validation entry: '+name);
    for (const target of entries.filter(target=>target!==name&&!children[name].includes(target)))
      assert.doesNotMatch(body,new RegExp('\\b'+target+'\\b'),'unreviewed validation re-entry: '+name+' -> '+target);
  }
  const receipt = region('canonicalReceiptReadSafety','receiptReadSafety');
  for (const name of entries.filter(name=>name!=='canonicalReceiptReadSafety'))
    assert.doesNotMatch(receipt,new RegExp('\\b'+name+'\\b'),'canonical receipt callback re-entry: '+name);
  const factory = region('createContentReadMemo','rawAncestryColumn');
  for (const name of entries) assert.doesNotMatch(factory,new RegExp('\\b'+name+'\\b'),'memo factory callback re-entry: '+name);
  for (const file of ['core/context-read-sidecar.mjs','core/context-product-sidecar.mjs'])
    assert.doesNotMatch(sources.get(file),/currentCardEligible\s*:\s*\([^)]*\)\s*=>\s*(?:contextCardEligible|cardEligible)\s*\(/,
      'Card eligibility callback re-enters its validation entry: '+file);
  return { modules: visited.size, roots: roots.length, factHelpers:2, entries:entries.length };
}

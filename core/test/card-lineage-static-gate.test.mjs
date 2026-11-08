import test from 'node:test';
import assert from 'node:assert/strict';
import { featureSources } from '../testing/receipt-event-time-audit.mjs';
import { moduleEdges } from '../testing/receipt-event-time-modules.mjs';

const accessorConsumers=new Set(['core/card-lineage.mjs','core/card-raw-sources.mjs','core/content-safety-layout.mjs','core/existing-store.mjs']);
const servingConsumers=new Set(['core/content-safety.mjs','core/content-write-safety.mjs','core/content-safety-boundary.mjs',
  'core/private-card-storage.mjs','core/private-evidence-storage.mjs','core/private-organization-storage.mjs',
  'core/context-read-facade.mjs','core/context-read-sidecar.mjs','core/context-product-index.mjs','core/context-product-sidecar.mjs',
  'core/content-suppression-evidence.mjs','core/role-context-evidence.mjs','core/role-context-facade.mjs','core/method-package-storage.mjs']);
function imports(sources) {
  const actual=new Set(),readers=new Set();
  for(const [file,source]of sources)for(const edge of moduleEdges(file,source)) {
    if(!/\/(?:card-lineage|content-safety-schema)\.mjs$/.test(edge.path))continue;
    assert.ok(edge.kind==='import'&&edge.node.specifiers.every(s=>s.type==='ImportSpecifier'),'private capability namespace escape: '+file);
    for(const s of edge.node.specifiers) {
      if(s.imported.name==='cardLineageRevision') {
        assert.equal(s.local.name,s.imported.name);assert.ok(accessorConsumers.has(file),'unreviewed lineage accessor: '+file);actual.add(file);
      }
      if(['hasCardLineage','cardLineageItemInside','cardLineageNamespaceInside','loadCardBodyContributorsInside'].includes(s.imported.name)&&file!=='core/card-lineage.mjs') {
        assert.equal(s.local.name,s.imported.name);assert.ok(servingConsumers.has(file),'unreviewed serving lineage consumer: '+file);readers.add(file);
      }
    }
  }
  assert.deepEqual([...actual].sort(),[...accessorConsumers].sort());
  assert.deepEqual([...readers].sort(),[...servingConsumers].sort());
  return actual.size+readers.size;
}
test('private lineage capability has a closed named-import graph',t=>{
  const sources=featureSources();assert.equal(imports(sources),18);t.diagnostic('4 attestation/accessor consumers; 14 canonical serving consumers');
  for(const code of ["import {cardLineageRevision} from './content-safety-schema.mjs';",
    "import {hasCardLineage as shortcut} from './card-lineage.mjs';","import * as lineage from './card-lineage.mjs';"]) {
    const copy=new Map(sources);copy.set('core/unreviewed-lineage.mjs',code);assert.throws(()=>imports(copy));
  }
});

test('offline lineage migration remains outside every serving, CLI and installer selection path',()=>{
  const sources=featureSources();
  assert.match(sources.get('core/content-safety-migration.mjs'),/export async function migrateCardLineage\(input\)/);
  for(const [file,source]of sources)if(file!=='core/content-safety-migration.mjs')
    assert.doesNotMatch(source,/\bmigrateCardLineage\b/,'unapproved automatic migration selector: '+file);
});

const paths=[
  ['direct/metadata','core/private-card-storage.mjs',[/function detail\(/,/!cardSafe\(ns, row/,/cardMetadataInside[\s\S]*cardSafe/,/if \(cardSafe\(ns, row, 'listCards', memo\)\) visible.push\(row\)/]],
  ['MOC navigation','core/private-organization-storage.mjs',[/cardDetailInside\(/,/contentReadSafety\(/,/cardLineageNamespaceInside/]],
  ['MOC endpoints','core/context-read-relations.mjs',[/contextCardEligible\(/]],
  ['MOC title/member dispatch','core/context-read-moc.mjs',[/reader.endpoint\(original, \{ projection: memory, titleSource: !memory \}\)/,/reader.endpoint\(original, \{ projection: memory \}\)/]],
  ['embedded raw getter','core/context-read-sidecar.mjs',[/function textFor[\s\S]*?hasCardLineage[\s\S]*?cardEligible/,/const checkCandidates = safetyLayout && \(lineage \|\|/,/!lineage&&isBudgetEmbeddingPort/]],
  ['service raw getter','core/context-product-sidecar.mjs',[/const text=row.eligible[\s\S]*?hasCardLineage[\s\S]*?contextCardEligible/,/!lineageCards\(p\)&&memo\?\.facts\?\.length===0/,/visible.checkEach&&\(hasCardLineage/]],
  ['hybrid zero-fact filtering','core/context-product-index.mjs',[/hasCardLineage\(db\) \|\| c.suppressionEpoch/g,/cardLineageItemInside\(db,current\)/]],
  ['metadata peek/evidence/history','core/private-evidence-storage.mjs',[/peek&&!hasCardLineage\(db\)/,/cardDetailInside\(/,/cardLineageItemInside\(db,value\)/,/cardLineageNamespaceInside\(db,ns\)/]],
  ['prepared/cached/fallback','core/context-read-facade.mjs',[/cardLineageItemInside\(db,\s*item\)/,/cardLineageItemInside\(db,\s*current\)/,/cardLineageNamespaceInside\(db,ns\)/]],
  ['role evidence','core/role-context-evidence.mjs',[/itemsInside\(/,/cardLineageItemInside\(db,item\)/]],
  ['role prepared generations','core/role-context-facade.mjs',[/cardLineageNamespaceInside\(db,ns\)/]],
  ['method attachment','core/method-package-storage.mjs',[/cardDetailInside\(/,/cardLineageNamespaceInside\(db,ns\)/]],
  ['canonical predicate','core/content-safety.mjs',[/loadCardBodyContributorsInside\(/,/sourceReadSafety\(db,\{identity,namespace:ns,ref:source,memo\}/]],
  ['final output','core/content-safety-boundary.mjs',[/kind==='card'&&!factsOnly&&hasCardLineage/,/contentReadSafety\(db,\{identity,namespace:ns,method:'getCard'/]],
];
function coverage(sources) {
  for(const [name,file,checks]of paths) {
    assert.ok(sources.has(file),'missing read path '+name);
    for(const expression of checks)assert.match(sources.get(file),expression,name+': '+file);
  }
  return paths.length;
}
test('each authored read-decision group retains its canonical predicate or final provenance fence',t=>{
  const sources=featureSources();assert.equal(coverage(sources),14);
  const controls=new Set(paths.map(([,file])=>file));
  for(const file of controls) {
    const copy=new Map(sources);copy.set(file,'');assert.throws(()=>coverage(copy),'removed path must fail the gate');
  }
  t.diagnostic(`${paths.length} read-decision groups, independently checked with ${controls.size} removed-module controls; no new export/why API`);
});

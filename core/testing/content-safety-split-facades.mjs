import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createContextReadSupervisor, openContextSemanticCoordinator, renewContextMaintenancePump } from '../index.mjs';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { canonicalJson } from '../context-product-validation.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { configured } from './context-product-owner-fixture.mjs';

// Enumerate the two public service handles without dispatching maintenance or
// embedding work. The semantic host is the existing offline synthetic fixture.
export async function additionalSplitFacades(t, f, ns) {
  const service = configured(t, f.path, [ns], { service: true });
  const now = Math.floor(Number(process.hrtime.bigint()) / 1e6);
  const pump = renewContextMaintenancePump({ supervisor: service.supervisor, id: randomUUID(),
    window: { id: randomUUID(), endsAtMonoMs: now + 60000, usedItems: 1, usedMs: 0 },
    budgets: { maxItems: 1, maxMs: 100 }, quantum: { maxItems: 1, maxMs: 100 }, pollMs: 1000,
    renewalMs: 60000, serviceCredential: service.token,
    projections: [{ options: service.options, types: ['memory'] }] });
  f.workspace.defer(() => pump.close());
  const supervisor = createContextReadSupervisor(); f.workspace.defer(() => supervisor.close());
  const anchorPath = join(f.workspace.path, 'authority.sqlite'), ledgerPath = join(f.workspace.path, 'ledger.sqlite');
  createExclusiveSqliteFile(anchorPath);
  const authority = new DatabaseSync(anchorPath); f.workspace.defer(() => authority.close());
  authority.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT; CREATE TABLE enrollments(owner TEXT PRIMARY KEY) STRICT;');
  const ledgerIdentity = { accountingDomainId: 'synthetic-split', ledgerId: 'synthetic-ledger' };
  await provisionSemanticOwner({ path: ledgerPath, identity: ledgerIdentity, ownerId: ns.ownerId,
    deadlineAt: Number(process.hrtime.bigint()) / 1e6 + 5000,
    enrollment: {
      authorizeNeverBound: owner => !authority.prepare('SELECT 1 FROM enrollments WHERE owner=?').get(owner),
      createIfNeverBound(anchor) {
        authority.exec('BEGIN IMMEDIATE');
        try {
          authority.prepare('INSERT INTO enrollments VALUES(?)').run(anchor.ownerId);
          authority.prepare('INSERT INTO anchors VALUES(?,?)').run(anchor.ownerId, canonicalJson(anchor));
          authority.exec('COMMIT'); return true;
        } catch { authority.exec('ROLLBACK'); return false; }
      },
    } });
  const token = { opaque: randomUUID() }, state = new SharedArrayBuffer(64); new Int32Array(state)[0] = 1;
  const binding = { kind: 'semantic-service', serviceId: randomUUID(), credentialBindingId: randomUUID(),
    credentialExpiresUtcMs: null, credentialDigest: credentialDigest(token), ownerId: ns.ownerId, scope: 'owner', issuedAt: 0,
    methods: ['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'],
    ...ledgerIdentity, ledgerEpoch: 1, bindingRevision: 1 };
  const priceTable = { authorityId: 'synthetic-price', revision: 'one', sequence: 1,
    effectiveFromUtcMs: Date.now() - 1000, effectiveUntilUtcMs: Date.now() + 3600000,
    usdPerMillionInputTokens: { 'text-embedding-3-small': '0.02' } };
  const semantic = await openContextSemanticCoordinator({ version: 'context-read-product-p2e-v1', supervisor,
    ledgerPath, ledgerIdentity, provider: { provider:'openai',model:'text-embedding-3-small',dimensions:1536,
      normalization:'l2',requestTimeoutMs:3000,maxBatchDocuments:64 },
    refreshCaps: { steady:{maxItemsPerUtcDay:2000,maxUsdPerUtcDay:'0.05'},
      backfill:{maxItemsPerUtcDay:20000,maxUsdPerUtcDay:'0.50',maxUsdTotal:'5'} },
    backfillTargets: [{ canonicalPath:f.path,readSet:[ns],types:['memory'],intents:['current','history'] }], priceTable,
    host: { moduleUrl:new URL('./context-semantic-host.mjs',import.meta.url).href,
      configuration:{semanticServiceBinding:binding,anchorPath,state,priceTable} } });
  f.workspace.defer(() => semantic.close());
  return { semantic, pump };
}

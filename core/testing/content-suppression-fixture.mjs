import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMemoryCore, openContentSuppressionReader } from '../index.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { suppressionServiceIssuance } from '../context-product-service.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns, ok, receipt } from './content-safety-s2h-fixture.mjs';
export { ns, ok, receipt };

export async function suppressionFixture(t, base = 18, makeFixture = safetyFixture) {
  const f = makeFixture(t,base); await f.migrate();
  const db = f.connect(), core = openMemoryCore({ path:f.path }), handles = [];
  t.after(async () => { for (const h of handles) await h.close(); core.close(); db.close(); });
  const expected = { storeId:f.storeId,suppressionDomain:db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain };
  const checkpoint = epoch => ({ owner:ns.ownerId,...expected,epoch:String(epoch) });
  const credential = { opaque:'synthetic-suppression-credential' };
  const service = { kind:'service',serviceId:'synthetic-service',credentialBindingId:'synthetic-binding',credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(credential),ownerId:ns.ownerId,namespaces:{ readSet:[ns],ownerCoverage:{ policy:'recent-projects-v1',
      selectionRevision:'synthetic-selection',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0 } },issuedAt:0 };
  const grant = patch => ({ version:'content-suppression-grant-v1',expected,scope:{ kind:'owner' },
    permissions:{ reconcile:true,erasureReconciliation:false },accessGeneration:1,...patch });
  function memory(text = 'Synthetic pull content', namespace = ns) {
    return ok(core.admit({ namespace,memory:{ content:text,kind:'fact' },receipts:[receipt(randomUUID())] })).memory;
  }
  const descriptor = (memory, namespace = ns) => ({ kind:'memory',...expected,namespace,key:memory.id,incarnation:memory.id,boundRevision:memory.revision,ancestors:[] });
  const fact = (c, patch = {}) => transaction(db,() => writeContentSuppressionInside(db,{ namespace:c.namespace,
    kind:c.kind,key:c.key,reason:'purge',actionId:randomUUID(),...patch }));
  async function reader(q = grant(), patch = {}) {
    const binding = suppressionServiceIssuance(service,q), state = { binding,live:true,samples:0,requests:[] };
    const host = { authorize(request) { state.requests.push(request); return state.authorize ? state.authorize(request) : state.binding; },
      isCurrent(grant,request) { state.samples++; return state.current ? state.current(grant,request) : state.live; } };
    const options = { version:'content-suppression-read-v1',path:f.path,expected,serviceBinding:service,suppression:q,host,requestMaxMs:5000,...patch };
    const handle = await openContentSuppressionReader(options); handles.push(handle);
    return { handle,state,options };
  }
  function clean(value) {
    const text = JSON.stringify(value);
    assert.doesNotMatch(text,/Synthetic pull content|Synthetic receipt secret|synthetic-source-name|cleanup_status|action_id|recorded_at|evidence_origin/);
    return text;
  }
  return { ...f,db,core,expected,checkpoint,credential,service,grant,memory,descriptor,fact,reader,clean };
}

import { parentPort, workerData } from 'node:worker_threads';
import { requestAuthority } from './context-product-authority.mjs';
import { nativeObserver, sealNative } from './context-product-telemetry.mjs';
import { PRODUCT_PROFILE, verifyRecords, boundedData, mono, issuance, deadline, operationRecord } from './context-product-control.mjs';
import { productFailure } from './context-product-reader.mjs';
import { contextInput } from './context-read-input.mjs';
import { ownData } from './local-authority-input.mjs';
import { fail } from './validation.mjs';

const { request, operation: opening, binding } = workerData;
let facade, host, active = false, disposing;
const owned = [], resources = new Int32Array(workerData.resources);
const resourceOwner = Object.freeze({
  register(kind, close) {
    const at = kind === 'lease' ? 0 : kind === 'provider' ? 2 : -1;
    if (at < 0 || typeof close !== 'function' || owned.length >= 64) fail('invalid_input');
    Atomics.add(resources, at, 1); owned.push({ at, close });
  },
});
const observer = nativeObserver(workerData.frame);

const within = op => { if (process.hrtime.bigint() >= mono(op.operationCutoffMonoNs)) fail('read_timeout'); };
function result(operation, result, extra = {}) { parentPort.postMessage({ operation, result, ...extra }); }
function dispose() {
  return disposing ??= (async () => {
    let failed = false;
    try { facade?.close(); } catch { failed = true; }
    for (const resource of owned.reverse()) {
      try { await resource.close(); Atomics.add(resources, resource.at + 1, 1); } catch { failed = true; }
    }
    if (failed) fail('reader_failed');
  })();
}
function capabilities() {
  return { ok: true, value: { version: 'context-read-v1', profile: PRODUCT_PROFILE,
    methods: ['fetchCandidateEvidence'], types: facade.capabilities.types, intents: ['current', 'history'],
    execution: 'worker', hardResponseCutoff: true, cancellation: true, readSetMaximum: 2,
    namespaceSelection: 'recent-projects-v1', readyOnly: true, maintenance: false,
    channels: { lexical: { enabled: true }, semantic: { configured: false, enabled: false } },
    schemas: { memory: [18, ...Array.from({ length: 14 }, (_, i) => i + 20)], card: Array.from({ length: 11 }, (_, i) => i + 23) },
    journals: ['DELETE'], unsupported: ['candidates', 'assembly', 'index-status', 'maintenance', 'semantic', 'relations', 'moc', 'raw-search'] } };
}
try {
  verifyRecords(request, opening, request, operationRecord(request, mono(request.admittedMonoNs), workerData.deadlineMs, 1, opening.operationId)); within(opening);
  issuance(binding, request, workerData.readSet, workerData.ownerCoverage);
  const { contextProductFileIdentity } = await import('./read-database.mjs');
  const fileIdentity = contextProductFileIdentity(workerData.path);
  const permission = new Promise((resolve, reject) => parentPort.once('message', message => {
    try {
      if (message.kind !== 'identity-ack') fail('reader_failed');
      verifyRecords(request, message.operation, request, opening); resolve();
    } catch (error) { reject(error); }
  }));
  parentPort.postMessage({ kind: 'identity', operation: opening, fileIdentity });
  await permission; within(opening);
  observer.identity = actual => { if (actual !== fileIdentity) fail('unsafe_database_file'); };
  const module = await import(workerData.host.moduleUrl);
  host = await module.createContextReadHost(Object.freeze({ ...workerData.host.configuration, resourceOwner }));
  if (typeof host?.close === 'function') resourceOwner.register('lease', () => host.close());
  const authorize = requestAuthority(host, binding, request);
  within(opening);
  const { openContextProductFacade } = await import('./context-read-facade.mjs');
  facade = openContextProductFacade(workerData.path, { observer, authorize });
  within(opening);
  // The opening telemetry remains unsealed until connection disposal.
  result(opening, { ok: true, value: null }, { fileIdentity: facade.fileIdentity });
} catch (error) {
  try { await dispose(); sealNative(workerData.frame); } catch { /* No seal: diagnostic coverage is incomplete. */ }
  result(opening, productFailure(error.code));
}
parentPort.on('message', async message => {
  if (message?.method === 'close') {
    observer.select(workerData.frame);
    try { await dispose(); sealNative(workerData.frame); parentPort.close(); }
    catch { process.exitCode = 1; parentPort.close(); }
    return;
  }
  if (active || !facade) { result(message.operation, productFailure('reader_failed')); return; }
  active = true;
  const { operation, frame } = message;
  observer.select(frame);
  try {
    verifyRecords(message.request, operation, request, operationRecord(request, mono(operation.enteredMonoNs),
      deadline(message.input?.deadlineMs), opening.workerEpoch, operation.operationId));
    if (operation.workerEpoch !== opening.workerEpoch) fail('authority_required');
    within(operation);
    if (frame && (frame.operationId !== operation.operationId || frame.workerEpoch !== operation.workerEpoch)) fail('reader_failed');
    let response;
    if (message.method === 'getContextReadCapabilities') response = capabilities();
    else if (message.method === 'fetchCandidateEvidence') {
      const payload = boundedData(message.input), { deadlineMs, ...fetchInput } = payload;
      deadline(deadlineMs);
      response = facade.fetchCandidateEvidence(fetchInput, message.credential, payload);
    } else {
      // No production index/search route is released by P2a. Even this bare
      // refusal must validate the complete method/payload request binding.
      if (message.method === 'getContextIndexStatus') {
        const value = ownData(message.input, ['readSet', 'types', 'intent', 'deadlineMs']);
        contextInput('findCandidates', { readSet: value.readSet, types: value.types, intent: value.intent, query: 'status' }, facade.capabilities.types);
      } else {
        contextInput(message.method, message.input, facade.capabilities.types);
        if (message.input.semantic === true) fail('invalid_input');
      }
      const enter = requestAuthority(host, binding, request);
      enter(message.method, boundedData(message.input), message.credential);
      response = productFailure('index_unavailable');
    }
    within(operation); sealNative(frame); result(operation, response);
  } catch (error) { sealNative(frame); result(operation, productFailure(error.code)); }
  finally { active = false; }
});

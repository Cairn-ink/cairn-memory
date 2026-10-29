import { createMaintenanceAttribution } from './context-product-attribution.mjs';
import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { serviceIssuance } from './context-product-service.mjs';
import { requestAuthority } from './context-product-authority.mjs';
import { nativeObserver, sealNative } from './context-product-telemetry.mjs';
import { PRODUCT_PROFILE, verifyRecords, boundedData, mono, issuance, deadline, operationRecord } from './context-product-control.mjs';
import { productFailure } from './context-product-reader.mjs';
import { createProductSqlitePolicy } from './context-product-sqlite.mjs';
import { fail } from './validation.mjs';
import { openDiagnosticClock, validOpenDiagnosticBuffer } from './context-product-open-diagnostic.mjs';

const workerFirst = validOpenDiagnosticBuffer(workerData.openPhases) ? process.hrtime.bigint() : undefined;
const phase = openDiagnosticClock(workerData.openPhases);
phase?.mark('workerFirst', workerFirst);
const { request, operation: opening, binding } = workerData;
let facade, index, host, active = false, disposing, currentControl = request;
let semantic,currentOperation=opening,booting=true,closing=false,rejectPermission,exiting;
const owned = [], resources = new Int32Array(workerData.resources);
const resourceOwner = Object.freeze({
  register(kind, close) {
    const at = kind === 'lease' ? 0 : kind === 'provider' ? 2 : -1;
    if (at < 0 || typeof close !== 'function' || owned.length >= 64) fail('invalid_input');
    Atomics.add(resources, at, 1); owned.push({ at, close });
  },
});
const attribution=workerData.maintenance ? createMaintenanceAttribution({buffer:workerData.maintenanceMarker}) : undefined;
const observer = nativeObserver(workerData.frame);
if (phase) observer.openDiagnostic = phase;
const sqlite = workerData.wal ? createProductSqlitePolicy({ observer }) : null;
const startSqlite = op => sqlite?.start(Number(mono(op.operationCutoffMonoNs)) / 1e6);

// Match the legacy native mapping without linking SQLite into bootstrap.
const nativeFailure = error => productFailure(error?.code === 'ERR_SQLITE_ERROR'
  ? Number.isInteger(error.errcode) && [5, 6].includes(error.errcode & 255) ? 'storage_busy' : 'storage_error'
  : error?.code);
const within = op => { if (closing) fail('store_closed'); if (process.hrtime.bigint() >= mono(op.operationCutoffMonoNs)) fail('read_timeout'); };
function result(operation, result, extra = {}) { parentPort.postMessage({ operation, result, ...extra }); }
function dispose() {
  return disposing ??= (async () => {
    let failed = false;
    try { semantic?.close(); index?.close(); facade?.close(); } catch { failed = true; }
    for (const resource of owned.reverse()) {
      try { await resource.close(); Atomics.add(resources, resource.at + 1, 1); } catch { failed = true; }
    }
    if (failed) fail('reader_failed');
  })();
}
// Close never races bootstrap acquisition or an outstanding asynchronous call.
function exitWhenIdle() {
  return exiting ??= (async () => {
    observer.select(workerData.frame);
    try { await dispose(); sealNative(workerData.frame); phase?.mark('disposed'); }
    catch { process.exitCode = 1; }
    parentPort.close();
  })();
}
parentPort.on('message', message => {
  if (message?.method !== 'close') return;
  closing = true; phase?.mark('closeReceived');
  rejectPermission?.(Object.assign(Error('store_closed'), { code: 'store_closed' }));
  if (!booting && !active) void exitWhenIdle();
});
function capabilities() {
  return { ok: true, value: { version: 'context-read-v1', profile: PRODUCT_PROFILE,
    methods: workerData.maintenance ? ['refreshContextIndex','getContextIndexStatus'] : ['findCandidates','contextRead','fetchCandidateEvidence','getContextIndexStatus'], types: facade.capabilities.types, intents: ['current', 'history'],
    execution: 'worker', hardResponseCutoff: true, cancellation: true, readSetMaximum: 32,
    namespaceSelection: 'recent-projects-v1', readyOnly: true, maintenance: Boolean(workerData.maintenance), assembly: index.assembly,
    channels: { lexical: { enabled: true }, semantic: { configured: false, enabled: false } },
    schemas: { memory: [18, ...Array.from({ length: 14 }, (_, i) => i + 20)], card: Array.from({ length: 11 }, (_, i) => i + 23) },
    ...(workerData.wal ? { journals: ['DELETE','WAL'], sidecarJournals: ['DELETE','WAL'], wal: {available:true} } : { journals: ['DELETE'], sidecarJournals: ['DELETE'], wal: {available:false,reason:'deferred_to_p2d'} }), unsupported: ['semantic', 'relations', 'moc', 'raw-search'] } };
}
try {
  startSqlite(opening);
  verifyRecords(request, opening, request, operationRecord(request, mono(request.admittedMonoNs), workerData.deadlineMs, 1, opening.operationId)); within(opening);
  if (workerData.maintenance) serviceIssuance(binding,workerData.readSet,workerData.ownerCoverage);
  else issuance(binding, request, workerData.readSet, workerData.ownerCoverage);
  phase?.mark('verified');
  const { contextProductFileIdentity } = await import('./read-database.mjs'); within(opening);
  phase?.mark('databaseImported');
  const fileIdentity = contextProductFileIdentity(workerData.path);
  phase?.mark('fileIdentified');
  const permission = new Promise((resolve, reject) => { rejectPermission = reject; parentPort.once('message', message => {
    try {
      if (message.kind !== 'identity-ack') fail('reader_failed');
      verifyRecords(request, message.operation, request, opening); resolve();
    } catch (error) { reject(error); }
  }); });
  phase?.mark('identitySent');
  parentPort.postMessage({ kind: 'identity', operation: opening, fileIdentity });
  await permission; rejectPermission = undefined; within(opening);
  phase?.mark('identityAcked');
  observer.identity = actual => { if (actual !== fileIdentity) fail('unsafe_database_file'); };
  const module = await import(workerData.host.moduleUrl); within(opening);
  phase?.mark('hostImported');
  host = await module.createContextReadHost(Object.freeze({ ...workerData.host.configuration, resourceOwner }));
  if (typeof host?.close === 'function') resourceOwner.register('lease', () => host.close());
  const authorize = (method,payload,credential) => requestAuthority(host,binding,currentControl)(method,payload,credential);
  if(workerData.semanticConfig) {
    const {semanticClient}=await import('./context-semantic-client.mjs'); within(opening);
    semantic=semanticClient(workerData.semanticPort,workerData.semanticConfig,()=>currentOperation);
  }
  within(opening);
  phase?.mark('hostCreated');
  const { openContextProductFacade } = await import('./context-read-facade.mjs'); within(opening);
  phase?.mark('facadeImported');
  phase?.mark('facadeOpening');
  facade = openContextProductFacade(workerData.path, { observer, authorize, sqlite });
  phase?.mark('facadeOpened');
  const { openProductIndex } = await import('./context-product-index.mjs'); within(opening);
  phase?.mark('indexImported');
  index = openProductIndex({path:workerData.path,facade,authorize,ownerCoverage:workerData.ownerCoverage,observer,sqlite,sidecarJournalMode:workerData.sidecarJournalMode,maintenance:workerData.maintenance,counter:host.counter,semantic,operation:()=>currentOperation,attribution});
  phase?.mark('indexOpened');
  within(opening);
  // The opening telemetry remains unsealed until connection disposal.
  phase?.mark('openSent');
  result(opening, { ok: true, value: null }, { fileIdentity: facade.fileIdentity });
} catch (error) {
  try { await dispose(); sealNative(workerData.frame); } catch { /* No seal: diagnostic coverage is incomplete. */ }
  result(opening, nativeFailure(error));
} finally {
  booting = false;
  if (closing) await exitWhenIdle();
}
parentPort.on('message', async message => {
  if (closing || message?.method === 'close') return;
  if (active || !facade) { result(message.operation, productFailure('reader_failed')); return; }
  active = true;
  attribution?.reset(message.maintenanceOrdinal);
  const receivedAt=Number(process.hrtime.bigint())/1e6;
  if (message.method === 'fetchCandidateEvidence') phase?.mark('readReceived');
  const { operation, frame } = message;
  observer.select(frame);
  try {
    const callRequest = workerData.maintenance ? message.request : request;
    if (workerData.maintenance && (callRequest.clockDomainId !== request.clockDomainId || callRequest.credentialBindingId !== binding.credentialBindingId || callRequest.credentialExpiresUtcMs !== binding.credentialExpiresUtcMs)) fail('authority_required');
    verifyRecords(message.request, operation, callRequest, operationRecord(callRequest, mono(operation.enteredMonoNs),
      deadline(message.method === 'refreshContextIndex' ? message.input?.budget?.maxMs : message.input?.deadlineMs), opening.workerEpoch, operation.operationId));
    if (operation.workerEpoch !== opening.workerEpoch) fail('authority_required');
    currentControl = callRequest;
    currentOperation=operation;
    startSqlite(operation);
    within(operation);
    if (frame && (frame.operationId !== operation.operationId || frame.workerEpoch !== operation.workerEpoch)) fail('reader_failed');
    let response;
    const observation = {};
    if (message.method === 'getContextReadCapabilities') {
      response = capabilities();
      if(semantic) {
        const access=requestAuthority(host,binding,currentControl)(message.method,message.input,message.credential),snapshot=await semantic.snapshot();
        const value=response.value;
        value.channels.semantic={configured:snapshot.identity!==null,enabled:snapshot.policy?.semantic??null};
        value.unsupported=value.unsupported.filter(x=>x!=='semantic');
        value.semanticExtension={version:'context-read-product-p2e-v1',ownerVectorPurge:true,queryEmbeddingMaximum:1,completeCoverageRequired:true,durableOwnerLedger:true,refreshBudgetDimensions:['maxItems','maxMs','maxUsd']};
        response=access.envelope(()=>response);
      }
    }
    else if (message.method === 'fetchCandidateEvidence') {
      if (workerData.maintenance) fail('authority_required');
      const payload = boundedData(message.input), { deadlineMs, ...fetchInput } = payload;
      deadline(deadlineMs);
      response = facade.fetchCandidateEvidence(fetchInput, message.credential, payload);
      phase?.mark('readFinished');
    } else {
      if (workerData.maintenance && !['getContextIndexStatus','refreshContextIndex'].includes(message.method)) fail('authority_required');
      response = await index.run(message.method, boundedData(message.input), message.credential,
        performance.now() + Number(mono(operation.operationCutoffMonoNs)-process.hrtime.bigint())/1e6, observation);
    }
    if(attribution) {
      const preparationStarted=Number(process.hrtime.bigint())/1e6;
      within(operation);sealNative(frame);
      const {at,...detail}=observation,metrics=attribution.snapshot();
      attribution.serialize(()=>result(operation,response,{...(at===undefined?{}:{observedAtMonoMs:at}),
        maintenancePhases:{...detail,...metrics,...(message.maintenanceOrdinal===null?{}:{ordinal:message.maintenanceOrdinal}),
          dispatchMs:receivedAt-Number(mono(operation.enteredMonoNs))/1e6,
          resultPreparationMs:metrics.resultPreparationMs+Number(process.hrtime.bigint())/1e6-preparationStarted,finishedAtMonoMs:Number(process.hrtime.bigint())/1e6}}));
    } else {
      within(operation);sealNative(frame);
      if (message.method === 'fetchCandidateEvidence') phase?.mark('readResultSent');
      result(operation,response,observation.at===undefined?{}:{observedAtMonoMs:observation.at,
        maintenancePhases:{...observation,at:undefined,dispatchMs:receivedAt-Number(mono(operation.enteredMonoNs))/1e6,finishedAtMonoMs:Number(process.hrtime.bigint())/1e6}});
    }
  } catch (error) { sealNative(frame); result(operation, nativeFailure(error)); }
  finally { active = false; if (closing) await exitWhenIdle(); }
});

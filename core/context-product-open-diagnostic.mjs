// Internal, opt-in attribution only. Fixed timestamps share the process hrtime
// domain across isolates. No authority, file names, IDs or content are retained.
const events = [
  'admitted', 'issued', 'spawn', 'workerFirst', 'verified', 'databaseImported',
  'fileIdentified', 'identitySent', 'identityAcked', 'hostImported', 'hostCreated',
  'facadeImported', 'facadeOpening', 'canonicalIdentity', 'canonicalPreflight',
  'canonicalNative', 'canonicalConfigured', 'productLayout', 'canonicalValidated',
  'canonicalReturned', 'facadeOpened', 'indexImported', 'indexOpened', 'openSent',
  'openReceived', 'openAccepted', 'readEntered', 'readSent', 'readReceived',
  'readFinished', 'readResultSent', 'readDelivered', 'readAccepted', 'closeEntered',
  'closeReceived', 'disposed', 'closeExited', 'closeFinished',
];
const positions = new Map(events.map((name, i) => [name, i]));
export function openDiagnosticBuffer(admitted) {
  const buffer = new SharedArrayBuffer(events.length * 8);
  Atomics.store(new BigInt64Array(buffer), 0, admitted);
  return buffer;
}
export function openDiagnosticClock(buffer) {
  if (!buffer) return null;
  const view = new BigInt64Array(buffer);
  return { mark(name, at) { Atomics.store(view, positions.get(name), at ?? process.hrtime.bigint()); } };
}
const intervals = {
  parentValidationIssuance: ['admitted', 'issued'], parentDispatch: ['issued', 'spawn'],
  workerStartStaticGraph: ['spawn', 'workerFirst'], workerVerification: ['workerFirst', 'verified'],
  readDatabaseImport: ['verified', 'databaseImported'], fileIdentity: ['databaseImported', 'fileIdentified'],
  identityPreparation: ['fileIdentified', 'identitySent'], identityAckIpc: ['identitySent', 'identityAcked'],
  hostImport: ['identityAcked', 'hostImported'], hostCreate: ['hostImported', 'hostCreated'],
  facadeImport: ['hostCreated', 'facadeImported'], facadeSetup: ['facadeImported', 'facadeOpening'],
  canonicalIdentity: ['facadeOpening', 'canonicalIdentity'], canonicalPreflight: ['canonicalIdentity', 'canonicalPreflight'],
  canonicalNativeOpen: ['canonicalPreflight', 'canonicalNative'], canonicalConfigure: ['canonicalNative', 'canonicalConfigured'],
  canonicalProductLayout: ['canonicalConfigured', 'productLayout'], canonicalOtherValidation: ['productLayout', 'canonicalValidated'],
  canonicalReturn: ['canonicalValidated', 'canonicalReturned'], facadeInitialize: ['canonicalReturned', 'facadeOpened'],
  productIndexImport: ['facadeOpened', 'indexImported'], productIndexOpen: ['indexImported', 'indexOpened'],
  workerResultPreparation: ['indexOpened', 'openSent'], openResultIpc: ['openSent', 'openReceived'],
  parentOpenAcceptance: ['openReceived', 'openAccepted'],
  openTotal: ['admitted', 'openAccepted'], facadeOpenTotal: ['facadeOpening', 'facadeOpened'],
  canonicalOpenTotal: ['facadeOpening', 'canonicalReturned'],
  fetchParentDispatch: ['readEntered', 'readSent'], fetchDispatchIpc: ['readSent', 'readReceived'],
  fetchWorker: ['readReceived', 'readFinished'], fetchResultPreparation: ['readFinished', 'readResultSent'],
  fetchResponseIpc: ['readResultSent', 'readDelivered'], fetchParentAcceptance: ['readDelivered', 'readAccepted'],
  fetchTotal: ['readEntered', 'readAccepted'], closeDispatch: ['closeEntered', 'closeReceived'],
  closeDispose: ['closeReceived', 'disposed'], closeWorkerExit: ['disposed', 'closeExited'],
  closeParentFinish: ['closeExited', 'closeFinished'], closeTotal: ['closeEntered', 'closeFinished'],
  lifecycleTotal: ['admitted', 'closeFinished'],
};
export function openDiagnosticSnapshot(buffer) {
  const view = new BigInt64Array(buffer), result = {};
  for (const [name, [start, end]] of Object.entries(intervals)) {
    const a = Atomics.load(view, positions.get(start)), b = Atomics.load(view, positions.get(end));
    if (a > 0n && b >= a) result[name + 'Ms'] = Number(b - a) / 1e6;
  }
  return Object.freeze(result);
}

// Internal, opt-in attribution only. Fixed timestamps share the process hrtime
// domain across isolates. No authority, file names, IDs or content are retained.
import { types } from 'node:util';

const events = [
  'admitted', 'issued', 'spawn', 'workerFirst', 'verified', 'databaseImported',
  'fileIdentified', 'identitySent', 'identityAcked', 'hostImported', 'hostCreated',
  'facadeImported', 'facadeOpening', 'canonicalIdentity', 'canonicalPreflight',
  'canonicalNative', 'canonicalConfigured', 'productLayout', 'canonicalValidated',
  'facadeOpened', 'indexImported', 'indexOpened', 'openSent',
  'openReceived', 'openAccepted', 'readEntered', 'readSent', 'readReceived',
  'readFinished', 'readResultSent', 'readDelivered', 'readAccepted', 'closeEntered',
  'closeReceived', 'disposed', 'closeExited', 'closeFinished',
];
const positions = new Map(events.map((name, i) => [name, i]));
const byteLength = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get;
export const validOpenDiagnosticBuffer = buffer => types.isSharedArrayBuffer(buffer) && Reflect.apply(byteLength, buffer, []) === events.length * 8;
export function openDiagnosticBuffer(admitted) {
  const buffer = new SharedArrayBuffer(events.length * 8);
  Atomics.store(new BigInt64Array(buffer), 0, admitted);
  return buffer;
}
export function openDiagnosticClock(buffer) {
  if (!validOpenDiagnosticBuffer(buffer)) return null;
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
  facadeInitialize: ['canonicalValidated', 'facadeOpened'],
  productIndexImport: ['facadeOpened', 'indexImported'], productIndexOpen: ['indexImported', 'indexOpened'],
  workerResultPreparation: ['indexOpened', 'openSent'], openResultIpc: ['openSent', 'openReceived'],
  parentOpenAcceptance: ['openReceived', 'openAccepted'],
  openTotal: ['admitted', 'openAccepted'], facadeOpenTotal: ['facadeOpening', 'facadeOpened'],
  canonicalOpenTotal: ['facadeOpening', 'canonicalValidated'],
  fetchParentDispatch: ['readEntered', 'readSent'], fetchDispatchIpc: ['readSent', 'readReceived'],
  fetchWorker: ['readReceived', 'readFinished'], fetchResultPreparation: ['readFinished', 'readResultSent'],
  fetchResponseIpc: ['readResultSent', 'readDelivered'], fetchParentAcceptance: ['readDelivered', 'readAccepted'],
  fetchTotal: ['readEntered', 'readAccepted'], closeDispatch: ['closeEntered', 'closeReceived'],
  closeDispose: ['closeReceived', 'disposed'], closeWorkerExit: ['disposed', 'closeExited'],
  closeParentFinish: ['closeExited', 'closeFinished'], closeTotal: ['closeEntered', 'closeFinished'],
  lifecycleTotal: ['admitted', 'closeFinished'],
};
export const OPEN_DIAGNOSTIC_FIELDS = Object.freeze(Object.keys(intervals).map(name => name + 'Ms'));
export function openDiagnosticSnapshot(buffer) {
  if (!validOpenDiagnosticBuffer(buffer)) return undefined;
  const view = new BigInt64Array(buffer), result = {};
  for (const [name, [start, end]] of Object.entries(intervals)) {
    const a = Atomics.load(view, positions.get(start)), b = Atomics.load(view, positions.get(end));
    if (a > 0n && b >= a) result[name + 'Ms'] = Number(b - a) / 1e6;
  }
  return Object.freeze(result);
}

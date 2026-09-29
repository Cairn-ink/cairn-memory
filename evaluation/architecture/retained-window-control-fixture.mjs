// Synthetic-only collection-cardinality fixture frozen in docs/plans/retained-window-control.md.
export const namespace = Object.freeze({ ownerId: 'retained-window-control', scope: 'personal', projectId: null });
export const otherNamespace = Object.freeze({ ownerId: 'retained-window-other', scope: 'personal', projectId: null });
export const client = 'retained-control';
export const sessionId = 'synthetic-collection';

const overrides = new Map([
  ['37/5', 'Batch 37 slot 5: The amber calibration ledger says the spare valve rests in Bay C. This record is synthetic and has no real-world referent.'],
  ['37/3', 'Batch 37 slot 3: The amber calibration ledger says the spare valve rests in Bay D. This record is synthetic and marked obsolete.'],
  ['12/2', 'Batch 12 slot 2: The cobalt field notebook says the green sensor rests in Bay A. This record is synthetic and has no real-world referent.'],
  ['20/4', 'Batch 20 slot 4: The basalt routing sheet says the test gate is open. This record is synthetic and has no real-world referent.'],
]);

export const correctedBasalt = 'Batch 20 slot 4: The basalt routing sheet says the test gate is closed. This record is synthetic and has no real-world referent.';
export const handle = (batch, slot) => `${batch}/${slot}`;
export const batchId = batch => String(batch).padStart(2, '0');
export const sourceText = (batch, slot) => overrides.get(handle(batch, slot)) ??
  `Batch ${batchId(batch)} slot ${slot}: The fictional parcel ${batchId(batch)}-${slot} is filed in vault ${slot}. This record is synthetic and has no real-world referent.`;
export const sourceMessage = (batch, slot) => Object.freeze({
  id: `message-${batchId(batch)}-${slot}`, role: 'user', content: sourceText(batch, slot),
});
export const captureBatch = batch => Object.freeze({ namespace, client, sessionId,
  eventId: `batch-${batchId(batch)}`,
  messages: Object.freeze(Array.from({ length: 6 }, (_, slot) => sourceMessage(batch, slot))) });
export const batches = Object.freeze(Array.from({ length: 50 }, (_, batch) => captureBatch(batch)));
export const questions = Object.freeze([
  { id: 'Q1', text: 'Where does the amber calibration ledger place the spare valve?', source: '37/5' },
  { id: 'Q2', text: 'Where does the cobalt field notebook place the green sensor?', source: '12/2' },
  { id: 'Q3', text: 'Where is the reserve valve kept according to the orange instrument log?', source: '37/5' },
  { id: 'Q4', text: 'Does the amber calibration ledger place the spare valve in Bay D?', source: '37/5', decoy: '37/3' },
  { id: 'Q5', text: 'Where is the silver telescope stored?', source: null },
  { id: 'Q6', text: 'What is the current state of the basalt test gate?', source: '20/4' },
]);

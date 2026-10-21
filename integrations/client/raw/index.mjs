// Internal synthetic foundation; intentionally outside installed client closure.
export { scanRawRecordRanges } from './bounds.mjs';
export { prepareRawRecord } from './message.mjs';
export { planRawBatch, restoreRawBatch } from './planner.mjs';
export { validateRawRequest, classifyRawAcknowledgement } from './protocol.mjs';

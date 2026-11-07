import assert from 'node:assert/strict';
import { parentPort } from 'node:worker_threads';
import { boundedData } from '../context-product-control.mjs';

const frozen = value => !value || typeof value !== 'object' ||
  Object.isFrozen(value) && Object.values(value).every(frozen);
export function createContextReadHost({serviceBinding, requestBinding, refuse, baseline}) {
  const binding = serviceBinding ?? requestBinding;
  let authorized;
  return {
    authorize(request) {
      authorized = request;
      if (baseline) assert.equal('maintenancePhase' in request, false);
      assert.ok(frozen(request));
      // Exercise the exact bounded snapshot used by the content authority port.
      assert.deepEqual(boundedData(request), request);
      parentPort.postMessage({kind:'phase-evidence', event:'authorize', request});
      return binding;
    },
    isCurrent(grant, request) {
      assert.equal(grant, binding, 'content authority port preserves host grant identity');
      parentPort.postMessage({kind:'phase-evidence', event:'isCurrent', same:request === authorized, frozen:frozen(request)});
      return !refuse;
    },
    counter:{id:'synthetic-phase-counter', countTokens:() => 1},
  };
}

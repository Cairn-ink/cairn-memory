import { createMemoryCore } from './contract.mjs';
import { createMemoryRuntime } from './runtime.mjs';
import { createRawCaptureStorage } from './raw-capture-storage.mjs';
import { isStorageBusy } from './database.mjs';
import { fail, MemoryStoreError } from './validation.mjs';

const success = value => ({ ok: true, value });
const failure = error => {
  const code = isStorageBusy(error) ? 'storage_busy' : error instanceof MemoryStoreError ? error.code : 'storage_error';
  return { ok: false, error: { code, retryable: code === 'storage_busy' } };
};
const invoke = work => { try { return success(work()); } catch (error) { return failure(error); } };

/** Synthetic/internal construction only; intentionally absent from installed files. */
export function openRawCaptureCore(input, rawOptions) {
  const descriptor = Object.getOwnPropertyDescriptor(rawOptions, 'lineage');
  if (descriptor && (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean')) fail('invalid_input');
  const lineage = descriptor?.value === true;
  const profile = structuredClone(Object.fromEntries(['captureQualification','captureSourcePolicy',
    'captureEvidence','captureRationale','sessionEpisodes'].filter(key => Object.hasOwn(input, key)).map(key => [key,input[key]])));
  let storage, capture, runtime;
  const core = createMemoryCore(input, {
    createRuntime: config => (runtime = createMemoryRuntime(config, { rawCapture: true,
      rawLineage: lineage === true,
      attachRaw: db => (storage = createRawCaptureStorage({ db, profile, ...rawOptions })) })),
    attachCapture: operation => { capture = operation; },
  });
  return Object.freeze({ ...core,
    async captureRaw(request) {
      try {
        runtime.ready();
        const registration = await storage.prepare(request);
        let interpretation;
        try {
          if (registration.hasProjection && registration.replay) interpretation = success(registration.observeReplay());
          else if (registration.hasProjection) interpretation = await capture(registration.input, registration);
          else {
            registration.commitOnly();
            interpretation = success(registration.emptyOutcome());
          }
        } catch (error) { interpretation = failure(error); }
        if (!interpretation.ok) {
          const observation = registration.observeFailedInterpretation();
          if (observation) interpretation = success(observation);
        }
        const raw = registration.result();
        return raw ? success({ raw, interpretation }) : interpretation;
      } catch (error) { return failure(error); }
    },
    getConversation: async input => { try { runtime.ready(); return success(await storage.getConversation(input)); } catch (error) { return failure(error); } },
    getRawUsage: input => invoke(() => { runtime.ready(); return storage.getRawUsage(input); }),
    getRawCaptureControl: input => invoke(() => { runtime.ready(); return storage.getRawCaptureControl(input); }),
    setRawCaptureControl: input => invoke(() => { runtime.ready(); return storage.setRawCaptureControl(input); }),
    fenceSession: input => invoke(() => { runtime.ready(); return storage.fenceSession(input); }),
  });
}

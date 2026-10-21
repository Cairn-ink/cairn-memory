import { createMemoryRuntime } from './runtime.mjs';
import { createRawCaptureStorage } from './raw-capture-storage.mjs';
import { isStorageBusy } from './database.mjs';
import { MemoryStoreError } from './validation.mjs';

const success = value => ({ ok: true, value });
const failure = error => {
  const code = isStorageBusy(error) ? 'storage_busy' : error instanceof MemoryStoreError ? error.code : 'storage_error';
  return { ok: false, error: { code, retryable: code === 'storage_busy' } };
};
const invoke = work => { try { return success(work()); } catch (error) { return failure(error); } };

// Receive the builder to avoid a contract -> composition -> contract cycle.
export function composeRawCore(buildCore, input, rawOptions, { sources, lineage, deletion }) {
  const profile = structuredClone(Object.fromEntries(['captureQualification','captureSourcePolicy',
    'captureEvidence','captureRationale','sessionEpisodes'].filter(key => Object.hasOwn(input, key)).map(key => [key,input[key]])));
  let storage, capture, runtime;
  const core = buildCore(input, {
    rawSources: sources,
    createRuntime: config => (runtime = createMemoryRuntime(config, { rawCapture: true,
      rawSources: sources,
      rawLineage: lineage === true,
      rawDeletion: deletion,
      attachRaw: db => (storage = createRawCaptureStorage({ db, profile, ...rawOptions, sources })) })),
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
    ...(deletion ? {
      previewDeleteConversation: input => invoke(() => runtime.previewDeleteConversation(input)),
      deleteConversation: input => invoke(() => runtime.deleteConversation(input)),
      listRawEffects: input => invoke(() => runtime.listRawEffects(input)),
    } : {}),
  });
}

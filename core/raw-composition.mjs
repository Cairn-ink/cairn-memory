import { captureInvocationDeadline } from './capture-deadline.mjs';
import { isRawEpochConflict, retryRawEpochConflict } from './raw-journal.mjs';
import { createLocalRawSearch } from './local-raw-search.mjs';
import { contentSafetyFacade } from './content-safety-boundary.mjs';
import { createMemoryRuntime } from './runtime.mjs';
import { createRawCaptureStorage } from './raw-capture-storage.mjs';
import { isStorageBusy } from './database.mjs';
import { MemoryStoreError } from './validation.mjs';

const success = value => ({ ok: true, value });
const failure = error => {
  const code = isStorageBusy(error) ? 'storage_busy' : error instanceof MemoryStoreError ? error.code : 'storage_error';
  return { ok: false, error: { code, retryable: code === 'storage_busy' || code === 'local_raw_privacy_write_failed' } };
};
const retryCapture = (work, deadline) => retryRawEpochConflict(work, { deadline }).catch(failure);
const invoke = work => { try { return success(work()); } catch (error) { return failure(error); } };

// Receive the builder to avoid a contract -> composition -> contract cycle.
export function composeRawCore(buildCore, input, rawOptions, { sources, lineage, deletion, localControls = false, localRawPrivacy = false, rawTextReaders = true, captureDefault = false, searchDefault = false, searchManager, searchEmbedding }) {
  const profile = structuredClone(Object.fromEntries(['captureQualification','captureSourcePolicy',
    'captureEvidence','captureRationale','sessionEpisodes','captureQualifiedDuplicates'].filter(key => Object.hasOwn(input, key)).map(key => [key,input[key]])));
  let storage, capture, runtime;
  const core = buildCore(input, {
    rawSources: sources,
    createRuntime: config => (runtime = createMemoryRuntime(config, { rawCapture: true,
      rawSources: sources,
      rawLineage: lineage === true,
      rawDeletion: deletion,
      localControls,
      localRawPrivacy,
      attachRaw: db => (storage = createRawCaptureStorage({ db, profile, ...rawOptions, sources, localRawPrivacy })) })),
    attachCapture: operation => { capture = operation; },
  });
  const deadlineMs = Object.hasOwn(input, 'captureDeadlineMs') ? input.captureDeadlineMs : undefined;
  const search = searchDefault ? searchManager ?? (rawOptions.mode !== 'off' ? createLocalRawSearch(input.path, rawOptions.port, searchEmbedding) : null) : null;
  return contentSafetyFacade({ ...core,
    ...(search ? search.methods : {}),
    close() {
      // Stop scheduling synchronously; native close bounds provider settlement.
      const stopped = search?.close();
      const result = core.close();
      return stopped ? Promise.resolve(stopped).then(() => result) : result;
    },
    ...(captureDefault && rawOptions.interpretation !== 'host' ? { capture(request) { const deadline = captureInvocationDeadline(deadlineMs); return retryCapture(async () => {
      const arrivalToken = {};
      try {
        runtime.ready();
        const registration = await storage.prepareCapture(request, arrivalToken, deadline);
        if (!registration) return await capture(request, undefined, deadline);
        let result;
        result = await capture(registration.input, registration, deadline);
        registration.assertEpochCurrent();
        // Raw retention also works with no extraction provider or failed preflight.
        if (!registration.result()) registration.commitOnly();
        search?.schedule(request.namespace);
        return result;
      } catch (error) {
        try { if (error.code !== 'store_closed') storage.fenceArrival(arrivalToken); } catch (fenceError) { return failure(fenceError); }
        if (isRawEpochConflict(error) || error.code === 'model_timeout') throw error;
        return failure(error);
      }
    }, deadline); } } : {}),
    captureRaw(request, invocation) { const deadline = captureInvocationDeadline(deadlineMs, invocation); return retryCapture(async () => {
      const arrivalToken = {};
      try {
        runtime.ready();
        const registration = await storage.prepare(request, false, undefined, [], arrivalToken, deadline);
        let interpretation;
        try {
          if (rawOptions.interpretation === 'host' || !registration.hasProjection) {
            registration.commitOnly();
            interpretation = success(registration.emptyOutcome());
          }
          else if (registration.replay) interpretation = success(registration.observeReplay());
          else interpretation = await capture(registration.input, registration, deadline);
          registration.assertEpochCurrent();
        } catch (error) { if (isRawEpochConflict(error)) throw error; interpretation = failure(error); }
        if (!interpretation.ok) {
          const observation = registration.observeFailedInterpretation();
          if (observation) interpretation = success(observation);
        }
        const raw = registration.result();
        if (!raw) storage.fenceArrival(arrivalToken);
        if (raw) search?.schedule(request.namespace);
        return raw ? success({ raw, interpretation }) : interpretation;
      } catch (error) {
        // A window may have arrived during asynchronous sealing/model work.
        // Preparation/sealing can fail before returning a registration. Use
        // only its validated, detached arrival identity for conservative fencing.
        // Commit-time overlap already committed its fence before refusing.
        try { if (error.code !== 'store_closed') storage.fenceArrival(arrivalToken); } catch (fenceError) { return failure(fenceError); }
        if (isRawEpochConflict(error) || error.code === 'model_timeout') throw error;
        return failure(error);
      }
    }, deadline); },
    ...(rawTextReaders ? {
      getConversation: async input => { try { runtime.ready(); return success(await storage.getConversation(input)); } catch (error) { return failure(error); } },
    } : {}),
    listRawConversations: input => invoke(() => { runtime.ready(); return storage.listRawConversations(input); }),
    getRawUsage: input => invoke(() => { runtime.ready(); return storage.getRawUsage(input); }),
    getRawCaptureControl: input => invoke(() => { runtime.ready(); return storage.getRawCaptureControl(input); }),
    setRawCaptureControl: input => invoke(() => { runtime.ready(); return storage.setRawCaptureControl(input); }),
    ...(localControls ? {
      getLocalCaptureControl: input => invoke(() => { runtime.ready(); return storage.getLocalCaptureControl(input); }),
      setLocalCaptureControl: input => invoke(() => { runtime.ready(); return storage.setLocalCaptureControl(input); }),
    } : {}),
    fenceSession: input => invoke(() => { runtime.ready(); return storage.fenceSession(input); }),
    ...(deletion ? {
      previewDeleteConversation: input => invoke(() => runtime.previewDeleteConversation(input)),
      deleteConversation: input => invoke(() => runtime.deleteConversation(input)),
      listRawEffects: input => invoke(() => runtime.listRawEffects(input)),
    } : {}),
  }, { check: runtime.assertContentScope, portGuard: runtime.contentPortGuard, failure,
    validate: (method,args,result,scopes) => {
      if (['getConversation','listRawConversations','getRawUsage','listRawEffects','previewDeleteConversation'].includes(method) && result?.ok) runtime.assertContentOutput(result.value,scopes);
    }, asyncMethods: ['capture','captureRaw','getConversation','searchRaw','maintainRawSearch','getRawSearchStatus'], noOwner: ['close',
    'getPrivateCardCapabilities','getAssetCapabilities','getMethodPackageCapabilities','getContextReadCapabilities'] });
}

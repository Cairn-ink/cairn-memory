import { createLocalRawSearch } from './local-raw-search.mjs';
import { contentSafetyFacade } from './content-safety-boundary.mjs';
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
export function composeRawCore(buildCore, input, rawOptions, { sources, lineage, deletion, localControls = false, captureDefault = false, searchDefault = false, searchManager, searchEmbedding }) {
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
      attachRaw: db => (storage = createRawCaptureStorage({ db, profile, ...rawOptions, sources })) })),
    attachCapture: operation => { capture = operation; },
  });
  const search = searchDefault ? searchManager ?? (rawOptions.mode !== 'off' ? createLocalRawSearch(input.path, rawOptions.port, searchEmbedding) : null) : null;
  return contentSafetyFacade({ ...core,
    ...(search ? search.methods : {}),
    close() {
      // Stop scheduling synchronously; join all owned work before resolving close.
      const stopped = search?.close();
      const result = core.close();
      return stopped ? Promise.resolve(stopped).then(() => result) : result;
    },
    ...(captureDefault ? { async capture(request) {
      try {
        runtime.ready();
        const registration = await storage.prepareCapture(request);
        let result;
        result = await capture(registration.input, registration);
        // Raw retention also works with no extraction provider or failed preflight.
        if (!registration.result()) registration.commitOnly();
        search?.schedule(request.namespace);
        return result;
      } catch (error) { return failure(error); }
    } } : {}),
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
        if (raw) search?.schedule(request.namespace);
        return raw ? success({ raw, interpretation }) : interpretation;
      } catch (error) { return failure(error); }
    },
    getConversation: async input => { try { runtime.ready(); return success(await storage.getConversation(input)); } catch (error) { return failure(error); } },
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

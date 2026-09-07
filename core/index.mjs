import { createMemoryRuntime } from "./runtime.mjs";
import {
  fail, identifier, limit, memoryInput, namespace, object, revision,
} from "./validation.mjs";

export { MemoryStoreError } from "./validation.mjs";
export { openMemoryCore } from "./contract.mjs";

/** Embedded storage only. The caller, not this library, authenticates owners. */
export function openMemoryStore(input) {
  const runtime = createMemoryRuntime(input);

  function bindScope(input) {
    runtime.ready();
    const ns = namespace(input);

    return Object.freeze({
      remember(input) {
        runtime.ready();
        const value = memoryInput(input);
        return runtime.admit(ns, { ...value, receipts: [value.receipt] },
          { legacy: true }).legacyMemory;
      },

      get(id) {
        runtime.ready();
        return runtime.legacyGet(ns, identifier(id));
      },

      list(options = {}) {
        runtime.ready();
        object(options, ["limit"]);
        return runtime.legacyList(ns, limit(options.limit));
      },

      search(query, options = {}) {
        runtime.ready();
        object(options, ["limit"]);
        const count = limit(options.limit);
        if (typeof query !== "string" || query.length > 4_000) fail("invalid_query");
        const terms = [...new Set(query.normalize("NFKC").toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? [])];
        if (terms.length === 0) return [];
        return runtime.legacySearch(ns, terms, count);
      },

      correct(id, input, expectedRevision) {
        runtime.ready();
        identifier(id);
        revision(expectedRevision);
        const value = memoryInput(input);
        if (value.origin !== "explicit") fail("correction_must_be_explicit");
        return runtime.correct(ns, id,
          { ...value, receipts: [value.receipt] }, expectedRevision, { legacy: true }).legacyMemory;
      },

      forget(id, expectedRevision) {
        runtime.ready();
        identifier(id);
        revision(expectedRevision);
        return runtime.forget(ns, id, expectedRevision).forgotten;
      },
    });
  }

  return Object.freeze({ scope: bindScope, close: runtime.close });
}

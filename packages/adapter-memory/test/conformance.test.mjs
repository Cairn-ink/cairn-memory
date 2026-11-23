import { CAPABILITIES, OPTIONAL_PORTS } from "@cairn-ink/core";
import { defineConformanceTests } from "@cairn-ink/conformance/node-test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

const optional = new Set(Object.values(OPTIONAL_PORTS));
const accepted = Object.fromEntries(CAPABILITIES.filter((flag) => !optional.has(flag)).map((flag) => [flag, true]));

function factory(name, enableFlags) {
  return {
    name,
    async open({ capabilities }) {
      const ids = ["first", "second", "id-\uE001", "id-\u{10001}", "id-\uE000", "id-\u{10000}"];
      let index = 0;
      const adapter = createMemoryAdapter({
        capabilities: enableFlags ? { ...accepted, semanticRetrieval: capabilities.semanticRetrieval ?? true } : {},
        newId() {
          const current = index++;
          return ids[current] ?? `id-${current}`;
        },
      });
      const { harness, nativeErrorMap } = adapter;
      return {
        adapter,
        harness,
        nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

defineConformanceTests(factory("memory", true));
defineConformanceTests(factory("memory (no flags)", false));

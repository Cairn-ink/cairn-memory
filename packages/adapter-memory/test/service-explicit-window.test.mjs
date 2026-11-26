import { test } from "node:test";
import { keylessScenarios, scenarios } from "../../core/test/helpers/service-explicit-window.mjs";
import { createMemoryAdapter } from "../src/index.mjs";

for (const fingerprintKey of [false, true]) {
  const mode = fingerprintKey ? "keyed" : "keyless";
  for (const [name, scenario] of Object.entries(fingerprintKey ? scenarios : { ...scenarios, ...keylessScenarios })) {
    test(`memory ${mode} ${name}`, t => scenario(t, createMemoryAdapter({
      capabilities: { fingerprintKey, rawArchive: true, rawWindowHide: true, contextRead: true, contextRawRead: true,
        documentCards: !fingerprintKey, documentCardSearch: !fingerprintKey, receiptAttachAdvancesRevision: true,
        inspect: true },
    })));
  }
}

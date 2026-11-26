import { test } from "node:test";
import { scenarios } from "../../core/test/helpers/service-explicit-window.mjs";
import { createMemoryAdapter } from "../src/index.mjs";

for (const fingerprintKey of [false, true]) {
  const mode = fingerprintKey ? "keyed" : "keyless";
  for (const [name, scenario] of Object.entries(scenarios)) {
    test(`memory ${mode} ${name}`, t => scenario(t, createMemoryAdapter({
      capabilities: { fingerprintKey, rawArchive: true, rawWindowHide: true, contextRead: true, contextRawRead: true,
        documentCards: !fingerprintKey, documentCardSearch: !fingerprintKey, receiptAttachAdvancesRevision: true },
    })));
  }
}

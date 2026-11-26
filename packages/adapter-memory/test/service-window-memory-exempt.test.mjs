import { test } from "node:test";
import { windowMemoryScenarios } from "../../core/test/helpers/service-window-memory-exempt.mjs";
import { createMemoryAdapter } from "../src/index.mjs";

for (const fingerprintKey of [false, true]) {
  const mode = fingerprintKey ? "keyed" : "keyless";
  for (const [name, scenario] of Object.entries(windowMemoryScenarios)) {
    test(`memory ${mode} ${name}`, t => scenario(t, createMemoryAdapter({
      capabilities: { fingerprintKey, rawArchive: true, rawWindowHide: true, contextRead: true, contextRawRead: true,
        documentCards: true, documentCardSearch: true, receiptAttachAdvancesRevision: true, inspect: true, placement: true },
    })));
  }
}

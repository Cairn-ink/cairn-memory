import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RETAINED_KEYED_DIGEST_CASES, runCase } from "@cairn-ink/conformance";
import { coreDigest, normalizeForHash, prepareCoreText } from "@cairn-ink/core";

const memoryFactory = (create = createMemoryAdapter) => ({
  name: "memory",
  async open({ capabilities }) {
    const adapter = create({ capabilities });
    return {
      adapter, harness: adapter.harness, sessionRefs: "plain", embeddingDimensions: null,
      nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], async close() {},
    };
  },
});

function retainedCase(id) {
  const testCase = RETAINED_KEYED_DIGEST_CASES.find((candidate) => candidate.id === id);
  assert.ok(testCase, `Missing retained digest case ${id}`);
  return testCase;
}

for (const testCase of RETAINED_KEYED_DIGEST_CASES) {
  const factory = memoryFactory();
  test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}

test("retained ring signers are scoped to live HMAC-only domains for the owner", async () => {
  const { keys, harness } = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const owner = "test-owner";
  const text = "Garden basil";
  const old = await keys.userKey(owner);
  const fact = { owner, kind: "text", mode: "exact", origin: "forget", actionId: "test-forget" };
  const digest = await coreDigest(text, old);
  await harness.seedFact(owner, { ...fact, text: { digests: [digest] } });
  assert.deepEqual(await keys.retainedDigesters(owner), [], "The current signing domain must be omitted");
  await harness.setFingerprintSecret("test-secret-rotation");
  const [signer, ...extra] = await keys.retainedDigesters(owner);
  assert.deepEqual(extra, []);
  assert.deepEqual(Object.keys(signer).sort(), ["alg", "keyId", "label", "mac"]);
  assert.deepEqual([signer.alg, signer.keyId, signer.label], ["hmac", old.id, "core"]);
  assert.equal(await signer.mac(normalizeForHash(prepareCoreText(text))), digest.value);

  const other = "test-other-owner";
  const otherDigest = await coreDigest(text, await keys.userKey(other));
  await harness.seedFact(other, { ...fact, owner: other, text: {
    digests: [{ ...otherDigest, keyId: old.id }, await coreDigest(text)],
  } });
  assert.deepEqual(await keys.retainedDigesters(other), [], "A fact with a SHA-256 alias must not enable a signer");
});

const adapterEntry = new URL("../src/index.mjs", import.meta.url);
const adapterModule = (name) => new URL(`./${name}.mjs`, adapterEntry);
const coreEntry = new URL(import.meta.resolve("@cairn-ink/core"));

async function sourceMutant(name, module, routes, original, replacement) {
  const source = readFileSync(module, "utf8");
  assert.equal(source.split(original).length - 1, 1, `Expected one mutation site for ${name}`);
  const tagged = (url) => {
    const copy = new URL(url);
    copy.searchParams.set("variant", name);
    return copy.href;
  };
  const entry = tagged(adapterEntry);
  const isolated = new Set([module, ...routes].map((url) => url.href));
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (context.parentURL && new URL(context.parentURL).searchParams.get("variant") === name &&
          isolated.has(resolved.url)) {
        return { ...resolved, url: tagged(resolved.url) };
      }
      return resolved;
    },
    load(url, context, nextLoad) {
      if (url === tagged(module)) {
        return { format: "module", source: source.replace(original, replacement), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  try {
    const { createMemoryAdapter: createMutant } = await import(entry);
    return memoryFactory(createMutant);
  } finally {
    hooks.deregister();
  }
}

test("K-KD-9 detects stripping the signing label on insert", async () => {
  const factory = await sourceMutant("drop-insert-label", adapterModule("memory-store"), [],
    "row: { ...content, digests, ...created, scope:",
    "row: { ...content, digests: digests.map(({ label, ...digest }) => digest), ...created, scope:");
  await assert.rejects(runCase(factory, retainedCase("K-KD-9")), /Dump must preserve all supplied digest fields and domains/);
});

test("K-KD-8 detects comparing MACs without the signing label", async () => {
  const factory = await sourceMutant("ignore-comparison-label", new URL("./privacy/withholds.mjs", coreEntry),
    [adapterModule("fact-match"), coreEntry, new URL("./privacy/fact-match.mjs", coreEntry)],
    "(left.label ?? left.pipeline) === (right.label ?? right.pipeline);",
    "true;");
  await assert.rejects(runCase(factory, retainedCase("K-KD-8")), /A wrong-label write query must fail closed/);
});

test("K-KD-9 detects counting an incomplete row only once", async () => {
  const factory = await sourceMutant("one-count-per-row", adapterModule("unit-of-work"), [],
    'for (const digest of domains.values()) {\n' +
      '          if (compareValidatedDigests(digests ?? [], [digest]) === "ineligible") count++;\n        }',
    'if ([...domains.values()].some(digest => compareValidatedDigests(digests ?? [], [digest]) === "ineligible")) count++;');
  await assert.rejects(runCase(factory, retainedCase("K-KD-9")), /One row missing two live domains must count twice/);
});

test("K-KD-7v rejects a signer that signs only the current redacted form", async () => {
  const factory = memoryFactory((options) => {
    const adapter = createMemoryAdapter(options);
    const retained = adapter.keys.retainedDigesters;
    adapter.keys.retainedDigesters = async (owner) => (await retained(owner)).map((signer) => ({
      ...signer,
      async mac(text) {
        return signer.mac(normalizeForHash(prepareCoreText(text)));
      },
    }));
    return adapter;
  });
  await assert.rejects(runCase(factory, retainedCase("K-KD-7v")),
    /A matching V1-variant retained-domain save must be suppressed, got saved/);
});

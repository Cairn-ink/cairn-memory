import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPTURE_DELETE_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    for (const testCase of CAPTURE_DELETE_CASES) {
      test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
        assert.equal(await runCase(factory, testCase), null);
      });
    }
  }
}

const [beforeCapture] = CAPTURE_DELETE_CASES;

async function loadRawVariant(variant, mutate) {
  const adapter = new URL(`../src/index.mjs?variant=${variant}`, import.meta.url);
  const raw = new URL(`./raw.mjs?variant=${variant}`, adapter);
  const source = mutate(readFileSync(raw, "utf8"));
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === adapter.href && specifier === "./raw.mjs") return nextResolve(raw.href, context);
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === raw.href) return { format: "module", shortCircuit: true, source };
      return nextLoad(url, context);
    },
  });
  try {
    return (await import(adapter.href)).createMemoryAdapter;
  } finally {
    hooks.deregister();
  }
}

function retainLedger(source) {
  // The conversation-delete blanking call, whether it passes a named session matcher or an inline one.
  const matcher = /blankCaptureMessages\(state, namespace, (?:matchesSession|\(?key\)? => slots\.has\(sessionSlot\(namespace, key\)\))\)/gu;
  assert.equal(source.match(matcher)?.length, 1, "Expected one ledger blanking call for conversation deletion");
  return source.replace(matcher, "blankCaptureMessages(state, namespace, () => false)");
}

async function rejectsCaptureDelete(create, message, suffix = "") {
  const factory = rawFactory({ create });
  const timings = ["before capture", "model call", "embedder call"];
  for (const [index, testCase] of CAPTURE_DELETE_CASES.entries()) {
    await assert.rejects(runCase(factory, testCase),
      { message: `${message} (${timings[index]}, previously archived${suffix})` }, testCase.id);
  }
}

test("K-CAP-DEL-1 rejects a delete that removes Raw rows and retains ledger text", async () => {
  const create = await loadRawVariant("retain-delete-ledger", retainLedger);
  await assert.rejects(runCase(rawFactory({ create }), beforeCapture),
    { message: "Deleted message text must be absent from the store (before capture, previously archived)" });
});

test("K-CAP-DEL cases reject flushing the deleted batch to Raw on the next successful same-owner archive", async () => {
  await rejectsCaptureDelete(options => {
    const adapter = createMemoryAdapter(options);
    const { capture, raw } = adapter;
    const { admit } = capture;
    const { archive, deleteConversation } = raw;
    let admitted;
    let pending;
    capture.admit = async (tx, key, messages) => {
      const result = await admit(tx, key, messages);
      if (result.status === "admitted") admitted = { key, messages };
      return result;
    };
    raw.deleteConversation = async (tx, scope, session) => {
      if (admitted?.key.scope.owner === scope.owner && admitted.key.sessionId === session.sessionId) {
        pending = admitted;
        admitted = undefined;
      }
      return deleteConversation(tx, scope, session);
    };
    raw.archive = async (tx, key, messages) => {
      const result = await archive(tx, key, messages);
      if (result.archived > 0 && pending?.key.scope.owner === key.scope.owner && pending.key.sessionId !== key.sessionId) {
        const { archived } = await archive(tx, pending.key, pending.messages);
        assert.equal(archived, pending.messages.length);
        pending = undefined;
      }
      return result;
    };
    return adapter;
  }, "Deleted conversation must leave no Raw rows", ", after control capture");
});

test("K-CAP-DEL cases reject a delayed flush that a repeated delete would clear", async () => {
  await rejectsCaptureDelete(options => {
    const adapter = createMemoryAdapter(options);
    const { capture, raw } = adapter;
    const { admit } = capture;
    const { archive, deleteConversation } = raw;
    let admitted;
    let pending;
    capture.admit = async (tx, key, messages) => {
      const result = await admit(tx, key, messages);
      if (result.status === "admitted") admitted = { key, messages };
      return result;
    };
    raw.deleteConversation = async (tx, scope, session) => {
      // A repeated delete of the same conversation drops the queued batch, so only an archive in between restores it.
      if (pending?.key.scope.owner === scope.owner && pending.key.sessionId === session.sessionId) pending = undefined;
      else if (admitted?.key.scope.owner === scope.owner && admitted.key.sessionId === session.sessionId) {
        pending = admitted;
        admitted = undefined;
      }
      return deleteConversation(tx, scope, session);
    };
    raw.archive = async (tx, key, messages) => {
      const result = await archive(tx, key, messages);
      if (result.archived > 0 && pending?.key.scope.owner === key.scope.owner && pending.key.sessionId !== key.sessionId) {
        const { archived } = await archive(tx, pending.key, pending.messages);
        assert.equal(archived, pending.messages.length);
        pending = undefined;
      }
      return result;
    };
    return adapter;
  }, "Deleted conversation must leave no Raw rows", ", after control capture");
});

test("K-CAP-DEL cases reject a delete that blanks and fences Raw rows", async () => {
  await rejectsCaptureDelete(options => {
    const adapter = createMemoryAdapter(options);
    const { raw } = adapter;
    const { deleteConversation } = raw;
    raw.deleteConversation = async (tx, scope, session) => {
      const { items } = await raw.listRaw(tx, { owner: scope.owner, namespaces: [scope.namespace] }, { cursor: null, limit: 20 });
      const messages = items.filter(row => row.client === session.client && row.sessionId === session.sessionId)
        .map(({ messageId, role, occurredAtMs }) => ({ id: messageId, role, occurredAtMs, content: "" }));
      const result = await deleteConversation(tx, scope, session);
      if (messages.length > 0) {
        const key = { scope, ...session, eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64) };
        assert.equal((await raw.archive(tx, key, messages)).archived, messages.length);
        await raw.fenceSession(tx, scope, session);
      }
      return result;
    };
    return adapter;
  }, "Deleted conversation must leave no physically stored Raw rows", ", after control capture");
});

test("K-CAP-DEL cases reject a delete that lowercases the ledger text", async () => {
  const create = await loadRawVariant("lowercase-delete-ledger", source => {
    const matcher = /message\.content = "";/gu;
    assert.equal(source.match(matcher)?.length, 1, "Expected one assignment that blanks ledger text");
    return source.replace(matcher, "message.content = message.content.toLowerCase();");
  });
  const message = "Deleted message text must be absent from the store";
  await rejectsCaptureDelete(create, message);
  await rejectsCaptureDelete(options => {
    const adapter = create(options);
    const { dump } = adapter.harness;
    adapter.harness.dump = async () => {
      const snapshot = await dump();
      for (const { claims = [] } of snapshot) {
        for (const { messages = [] } of claims) {
          for (const entry of messages) {
            if (entry.content === entry.content.toLowerCase()) entry.content = entry.content.replaceAll(" ", "\n\t");
          }
        }
      }
      return snapshot;
    };
    return adapter;
  }, message);
});

test("K-CAP-DEL cases reject a delete that retains ledger text and hides deleted events from the dump", async () => {
  const create = await loadRawVariant("hide-retained-delete-ledger", retainLedger);
  await rejectsCaptureDelete(options => {
    const adapter = create(options);
    const { deleteConversation } = adapter.raw;
    const { dump } = adapter.harness;
    const deleted = new Set();
    adapter.raw.deleteConversation = async (tx, scope, session) => {
      const result = await deleteConversation(tx, scope, session);
      deleted.add(session.sessionId);
      return result;
    };
    adapter.harness.dump = async () => (await dump()).map(owner => ({
      ...owner, claims: owner.claims?.filter(({ key }) => !deleted.has(key.sessionId)) ?? [],
    }));
    return adapter;
  }, "Deleted capture must leave no message text in the ledger");
});

test("K-CAP-DEL cases reject a delete that also removes an unrelated conversation's Raw rows", async () => {
  await rejectsCaptureDelete(options => {
    const adapter = createMemoryAdapter(options);
    const { raw } = adapter;
    const { deleteConversation } = raw;
    const deleted = new Set();
    raw.deleteConversation = async (tx, scope, session) => {
      const result = await deleteConversation(tx, scope, session);
      if (deleted.has(session.sessionId)) return result;
      deleted.add(session.sessionId);
      const { items } = await raw.listRaw(tx, { owner: scope.owner, namespaces: [scope.namespace] }, { cursor: null, limit: 20 });
      const unrelated = items.find(row => row.client !== session.client || row.sessionId !== session.sessionId);
      if (unrelated) await deleteConversation(tx, scope, unrelated);
      return result;
    };
    return adapter;
  }, "The unrelated conversation must keep its listed Raw row");
});

test("K-CAP-DEL-1 rejects a delete that does nothing", async () => {
  const factory = rawFactory({
    create(options) {
      const adapter = createMemoryAdapter(options);
      adapter.raw.deleteConversation = async () => ({ rawDeleted: 0 });
      return adapter;
    },
  });
  await assert.rejects(runCase(factory, beforeCapture),
    { message: "Conversation deletion must remove its Raw rows (before capture, previously archived)" });
});

test("K-CAP-DEL cases still pass with an always-allowing assertEligible", async () => {
  const factory = rawFactory({
    create(options) {
      const adapter = createMemoryAdapter(options);
      adapter.capture.assertEligible = async () => {};
      return adapter;
    },
  });
  for (const testCase of CAPTURE_DELETE_CASES) {
    assert.equal(await runCase(factory, testCase), null, testCase.id);
  }
});

import assert from "node:assert/strict";
import { openMemoryCore } from "../../../core/index.mjs";
import { createRawSearchAuthority } from "../../../core/raw-search-authority.mjs";
import { openReadDatabase } from "../../../core/read-database.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { localPlainPort, rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rawSearchHost } from "../../../core/testing/raw-search-fixtures.mjs";
import { fixture } from "./legacy/fixtures.mjs";
import { coreScope, ok, personal, prepareInput, project } from "./migration-fixtures.mjs";

export const rawNamespaces = [personal, project];

export async function legacyRawVisible(path, namespaces = rawNamespaces) {
  const reader = openReadDatabase(path, { contextRead: true });
  try {
    const authority = createRawSearchAuthority(reader, {
      ownerId: personal.ownerId, readSet: namespaces, crypto: localPlainPort(), authority: rawSearchHost().authority,
    });
    const visible = [];
    let cursor;
    for (;;) {
      const page = authority.inventory(cursor);
      for (const { source } of page.rows) {
        if (source) visible.push({ namespace: coreScope(source.ref.namespace).namespace,
          messageId: source.ref.messageId, content: await authority.open(source) });
      }
      if (page.complete) break;
      cursor = page.rows.at(-1).key;
    }
    return visible.sort(order);
  } finally {
    reader.db.close();
  }
}

const order = (a, b) => a.messageId.localeCompare(b.messageId);

export async function migratedRawVisible(adapter, namespaces = rawNamespaces) {
  const visible = [];
  for (const namespace of namespaces) {
    const { owner, namespace: name } = coreScope(namespace);
    await adapter.uow.run(owner, { readOnly: true }, async tx => {
      let cursor = null;
      do {
        const page = await adapter.raw.listRaw(tx, { owner, namespaces: [name] }, { limit: 2, cursor });
        visible.push(...page.items.map(({ ref, messageId, content }) => ({ namespace: ref.namespace, messageId, content })));
        cursor = page.nextCursor;
      } while (cursor);
    });
  }
  return visible.sort(order);
}

export async function seedRawDeletion(directory) {
  const legacy = await fixture(directory, 29, { localPrivacy: true });
  const input = prepareInput(directory, legacy);
  const engine = openMemoryCore({ path: legacy.path, raw: true, rawSearch: false, model: {
    ...rationaleModel(),
    extract: ({ input }) => ({ items: input.messages.map(message => ({
      content: "Derived " + message.content.split(" ")[0], kind: "fact", confidence: 0.7, sourceIndices: [message.index],
    })) }),
  } });
  const time = Date.now();
  const at = ms => new Date(ms).toISOString();
  const archived = async (id, namespace, occurredAt) => {
    const raw = `${id} synthetic archived message`;
    const request = rawRequest(splitRaw(raw, { id, occurredAt })[0], { namespace, sessionId: id + "-session" });
    const value = ok(await engine.captureRaw(request));
    const memory = ok(value.interpretation).admission.memories[0];
    assert.equal(ok(engine.get({ namespace, memoryId: memory.id })).memory.content, "Derived " + id);
    return { raw, request, memory, conversationId: value.raw.conversationId };
  };
  try {
    const deleted = await archived("magnolia", project, at(time - 7_200_000));
    const spanned = await archived("sycamore", personal, at(time));
    const unknown = await archived("willow", personal, null);
    const visible = await legacyRawVisible(legacy.path);
    for (const item of [deleted, spanned, unknown]) {
      assert.ok(visible.some(row => row.content === item.raw), "Raw oracle saw each source before its deletion");
    }
    const { conversations } = ok(engine.listRawConversations({
      namespace: project, client: deleted.request.client,
    }));
    const conversation = conversations.find(conversation => conversation.id === deleted.conversationId);
    assert.ok(conversation);
    ok(await engine.deleteConversation({ namespace: project, conversationId: deleted.conversationId,
      expectedRevision: conversation.revision, actionId: "remove-magnolia" }));
    ok(await engine.forget({ namespace: personal, memoryId: spanned.memory.id, expectedRevision: spanned.memory.revision }));
    for (const item of [deleted, spanned, unknown]) {
      assert.equal((await engine.captureRaw({ ...item.request, eventId: "retry-" + item.request.eventId })).error?.code,
        "conversation_deleted");
    }
    return { input, deleted, spanned, unknown, time };
  } finally {
    await engine.close();
  }
}

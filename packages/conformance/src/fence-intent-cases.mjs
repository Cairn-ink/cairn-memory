import { PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { check, equal, row } from "./support.mjs";

/** @import { ItemRef, Scope } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

/** @param {CaseContext} ctx @param {Scope} scope @param {string} text @returns {Promise<ItemRef>} */
async function insert(ctx, scope, text) {
  const { uow, memories } = ctx.adapter;
  const content = await row(ctx, text);
  const { id } = await uow.run(scope.owner, {}, tx => memories.insert(tx, scope, content, [], 1));
  return { type: "memory", id, namespace: scope.namespace };
}

/** @param {CaseContext} ctx @param {Scope} scope */
async function insertHistorical(ctx, scope) {
  const { uow, supersession } = ctx.adapter;
  check(supersession, "Supersession was enabled without a supersession port");
  const historical = await insert(ctx, scope, "original memory");
  await uow.run(scope.owner, {}, tx => supersession.markHistorical(tx, scope, historical.id, 2));
  return historical;
}

/** @param {CaseContext} ctx @param {Scope} scope */
async function insertForgotten(ctx, scope) {
  const forgotten = await insert(ctx, scope, "forgotten memory");
  // Keep the row stored so the fence has to honor the permanent forget fact.
  await ctx.harness.seedFact(scope.owner, {
    ...scope, origin: "forget", actionId: "forget", kind: "identity", memoryId: forgotten.id,
  });
  return forgotten;
}

/** @type {readonly ConformanceCase[]} */
export const FENCE_INTENT_CASES = [
  {
    id: "K-FEN-I1", title: "drops forgotten and historical memories by default", needs: [],
    async run(ctx) {
      const { adapter: { capabilities, uow, fence }, owner } = ctx;
      const scope = ctx.scope(null);
      const readSet = { owner, namespaces: [scope.namespace] };
      const active = await insert(ctx, scope, "visible memory");
      const forgotten = await insertForgotten(ctx, scope);
      const refs = [forgotten, active];
      if (capabilities.supersession) refs.push(await insertHistorical(ctx, scope));

      await uow.run(owner, { readOnly: true }, async tx => {
        equal(await fence.assertVisible(tx, readSet, refs), [active],
          "Default fence must drop forgotten and historical memories");
      });
    },
  },
  {
    id: "K-FEN-I2", title: "keeps historical memories for read", needs: [],
    async run(ctx) {
      const { adapter: { capabilities, uow, fence }, owner } = ctx;
      if (!capabilities.supersession) return "needs supersession to produce historical memories";

      const scope = ctx.scope(null);
      const readSet = { owner, namespaces: [scope.namespace] };
      const historical = await insertHistorical(ctx, scope);
      const active = await insert(ctx, scope, "replacement memory");
      const refs = [historical, active];
      await uow.run(owner, { readOnly: true }, async tx => {
        equal(await fence.assertVisible(tx, readSet, refs, "read"), refs,
          "Read fence must keep historical and active memories in input order");
      });
    },
  },
  {
    id: "K-FEN-I3", title: "keeps forgotten, suppressed, and foreign memories hidden for read", needs: [],
    async run(ctx) {
      const { adapter: { uow, fence }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const readSet = { owner, namespaces: [scope.namespace] };
      const visible = await insert(ctx, scope, "visible memory");
      const forgotten = await insertForgotten(ctx, scope);
      const suppressedText = "suppressed memory";
      const suppressed = await insert(ctx, scope, suppressedText);
      const otherNamespace = await insert(ctx, ctx.scope("other"), "memory in another namespace");
      const otherOwner = await insert(ctx, { ...scope, owner: ctx.otherOwner }, "memory of another owner");

      await harness.seedFact(owner, {
        ...scope, origin: "forget", actionId: "suppress", kind: "text", mode: "exact",
        text: { digests: [{
          alg: "sha256", value: (await ctx.hash(suppressedText)).slice("sha256:".length),
          pipeline: "core", redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null,
        }] },
      });

      await uow.run(owner, { readOnly: true }, async tx => {
        for (const hidden of [forgotten, suppressed, otherNamespace, otherOwner]) {
          equal(await fence.assertVisible(tx, readSet, [hidden, visible], "read"), [visible],
            "Read fence must drop the hidden memory and keep the visible memory");
        }
      });
    },
  },
];

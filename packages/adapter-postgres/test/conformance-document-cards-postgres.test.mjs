import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import * as kit from "@cairn-ink/conformance";
import { DOCUMENT_CARD_CORRECT_CASES } from "@cairn-ink/conformance/document-card-correct";
import { DOCUMENT_CARD_VISIBILITY_INPUT_CASES } from "@cairn-ink/conformance/document-card-visibility-input";
import { CONTEXT_READ_DOCUMENT_CARD_CASES } from "@cairn-ink/conformance/context-read-document-cards";
import { capabilities, factIncarnationBody, userFingerprintKey } from "@cairn-ink/core";
import { documentCardVisible } from "@cairn-ink/core/routing";
import {
  createPostgresCapturePorts, createPostgresConflictEdgeStore, createPostgresDocumentCardCandidates,
  createPostgresDocumentCardStore, createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresMemoryStore,
  createPostgresPauseStore, createPostgresQuantityLedgerStore, createPostgresRawPorts, createPostgresRawReads,
  createPostgresSupersessionStore, createPostgresSuppressionStore, createPostgresTopicStore, createPostgresUnitOfWork,
  HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { publishFingerprintKey } from "../src/digest-gate.mjs";
import { migrationDatabase } from "./migration-database.mjs";

const databaseUrl = process.env.CORE_PG_TEST_URL;

const notApplicable = new Map([
  ...kit.TOPIC_CARD_CASES.map(({ id }) => [id, "Requires topic-card placement and card membership views"]),
  ...kit.TOPICS_FOR_CARDS_CASES.map(({ id }) => [id, "Requires filing cards and reading batch topic annotations via forCards"]),
  ...kit.DELIVERY_VISIBILITY_CASES.map(({ id }) => [id, "Asserts batch topic annotations after filing and withholding a card"]),
  ["T-CONTEXT-DOCUMENT-CARD-1", "Requires qualified Context Read card refs, evidence and amendment assembly"],
  ["T-CONTEXT-DOCUMENT-CARD-2", "Requires Context Read card discovery, snapshots and fetching evidence for prior refs"],
  ["T-CONTEXT-DOCUMENT-CARD-3", "Requires Context Read token budgeting for cards, amendments and cited memories"],
  ["T-CARD-CORRECT-8", "Checks a Context Read card generation through snapshotState as well as the owner revision"],
  ["T-CARD-CORRECT-RECEIPT-PRIVACY", "Requires Inspect and Context Read evidence for a regenerated card and its citations"],
  ["T-CARD-LINK-6", "Files the card and checks annotations, topic members and counts after changing a linked memory revision"],
  ["T-CARD-CORRECT-CLASSIFY-NO-INPUT-PORT", "Requires pendingCards to return an eligible card before classification"],
  ["T-CARD-INPUT-1", "Inserts a card into a non-personal namespace before checking ref order"],
  ["T-CARD-LINK-3", "Expects not_found for linkMemories in a non-personal namespace, which this adapter does not support"],
  ["T-CARD-PURGE-2", "The primary run archives Raw and inserts cards in a non-personal namespace to test indeterminate evidence"],
  ["T-CARD-CORRECT-LATE-FACT", "The final read needs a durable text revision to distinguish a post-replacement metadata update"],
]);

const cardCapability = name => name === "documentCards" || name === "documentCardSearch";
const requiresCards = entry => entry.needs?.some(cardCapability) ||
  entry.followUp?.needs?.some(cardCapability);
const allCases = [...Object.values(kit).flatMap(value => Array.isArray(value) ? value : []),
  kit.DOCUMENT_CARD_CORRECTION_PRIVACY_CASE, ...DOCUMENT_CARD_CORRECT_CASES, ...DOCUMENT_CARD_VISIBILITY_INPUT_CASES,
  ...CONTEXT_READ_DOCUMENT_CARD_CASES].filter(requiresCards);
assert.equal(new Set(allCases.map(({ id }) => id)).size, allCases.length);
for (const id of notApplicable.keys()) assert.ok(allCases.some(entry => entry.id === id), id);

const hash = text => createHash("sha256").update(text).digest("hex");

function postgresFactory(t) {
  return {
    name: "Postgres document cards",
    async open({ capabilities: requested }) {
      const { pool, source } = await migrationDatabase(t);
      const uow = createPostgresUnitOfWork(source);
      const secret = randomBytes(32);
      const lineageSecret = randomUUID();
      const hashSessionKey = (client, sessionId) =>
        createHmac("sha256", secret).update(JSON.stringify([client, sessionId])).digest("hex");
      const keys = { userKey: owner => requested.fingerprintKey
        ? userFingerprintKey(lineageSecret, owner, HOSTED_FINGERPRINT_LABELS) : null };
      const readOptions = { hashSessionKey };
      const rawOptions = { ...readOptions, lineageSecret, fingerprintKeys: async owner => {
        const key = await keys.userKey(owner);
        return key ? [key] : [];
      } };
      const rawArchive = requested.rawArchive !== false;
      const sessionLineage = rawArchive && requested.sessionLineage === true;
      const cardOptions = { ...(rawArchive ? rawOptions : readOptions), sessionKey: hashSessionKey, fingerprintKey: keys.userKey };
      const documentCards = createPostgresDocumentCardStore(cardOptions);
      const documentCardCandidates = createPostgresDocumentCardCandidates(cardOptions);
      const { purgeCards } = documentCards;
      const rawPorts = rawArchive ? createPostgresRawPorts({ ...rawOptions, fingerprintKeys: async owner =>
        (await rawOptions.fingerprintKeys(owner)).map(key => ({ key, pipeline: "core" })), purgeCards }) : null;
      const nearDuplicate = requested.nearDuplicate !== false;
      // Cases that only request placement can fall back to the card and search ports.
      const exposePlacement = requested.placement && !requested.contextRead;
      const memoryReads = createPostgresMemoryReads(rawArchive ? rawOptions : readOptions);
      const { lexical, vector } = createPostgresMemoryCandidates(readOptions);
      const suppressions = createPostgresSuppressionStore({ ...readOptions, sessionRefs: "plain", vectorSuppression: true });
      const fence = {
        async assertVisible(tx, selection, refs, intent) {
          const items = await memoryReads.fence.assertVisible(tx, selection, refs.filter(ref => ref.type !== "card"), intent);
          if (!selection.namespaces.includes(null)) return items;
          const cards = refs.filter(ref => ref.type === "card" && ref.namespace === null);
          const scope = { owner: selection.owner, namespace: null };
          const inputs = await documentCards.visibilityInputs(tx, scope, cards, { requireRaw: rawArchive });
          for (const [i, input] of inputs.entries()) {
            if (input && (await documentCardVisible(input)).visible) items.push(cards[i]);
          }
          return items;
        },
      };
      const quantityLedger = requested.quantityLedger ? createPostgresQuantityLedgerStore() : undefined;
      return {
        adapter: {
          name: "postgres",
          capabilities: capabilities({
            embeddingRequiredOnInsert: true, nearDuplicate, vectorSuppression: true, semanticRetrieval: true,
            rawArchive, rawWindowHide: rawArchive, sessionLineage,
            rawSpans: true, supersession: true, conflictEdges: true, fingerprintKey: requested.fingerprintKey === true,
            shingleSuppression: rawArchive && requested.fingerprintKey === true, quantityLedger: quantityLedger !== undefined,
            documentCards: true, documentCardSearch: true, placement: exposePlacement === true,
          }),
          uow, suppressions, keys, lexical, vector, ...memoryReads, fence, documentCards, documentCardCandidates,
          capture: createPostgresCapturePorts({ lineageSecret, hashSessionKey, nearDuplicate }),
          memories: createPostgresMemoryStore({ ...readOptions, nearDuplicate, purgeCards }),
          pause: createPostgresPauseStore(),
          supersession: createPostgresSupersessionStore(readOptions),
          conflicts: createPostgresConflictEdgeStore(readOptions),
          ...(exposePlacement && { placement: createPostgresTopicStore(readOptions) }),
          ...(rawPorts && { raw: { ...rawPorts.raw, ...createPostgresRawReads(rawOptions) },
            ...(sessionLineage && { sessionLineage: rawPorts.sessionLineage }) }),
          ...(quantityLedger && { quantityLedger }),
        },
        sessionRefs: "plain",
        embeddingDimensions: 1536,
        timeoutMs: 30_000,
        settleMs: 100,
        harness: {
          hashSessionKey,
          async seedOwners(owner, otherOwner) {
            await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, otherOwner]);
            await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true), ($2, true)",
              [owner, otherOwner]);
            for (const id of [owner, otherOwner]) {
              const key = await keys.userKey(id);
              if (key) await uow.run(id, {}, tx => publishFingerprintKey(tx, key.id));
            }
          },
          async seedFact(owner, fact) {
            await uow.run(owner, {}, tx => suppressions.writeFact(tx, fact, hash(factIncarnationBody(fact))));
          },
          async dump() {
            const { rows } = await pool.query(`SELECT u.id AS owner,
              ARRAY(SELECT jsonb_build_object('cards', jsonb_build_array(jsonb_build_array(c.id,
                to_jsonb(c) || jsonb_build_object('amendments', ARRAY(
                  SELECT to_jsonb(a) FROM core_document_card_amendments a
                  WHERE a.user_id = c.user_id AND a.card_id = c.id ORDER BY a.insertion_sequence)))))
                FROM document_cards c WHERE c.user_id = u.id AND c.scope_id = c.user_id ORDER BY c.id) AS "documentCards",
              ARRAY(SELECT to_jsonb(r) FROM raw_messages r WHERE r.user_id = u.id ORDER BY r.id) AS "rawRows",
              (SELECT to_jsonb(s) FROM core_owner_state s WHERE s.user_id = u.id) AS "ownerState"
              FROM users u ORDER BY u.id`);
            return rows;
          },
        },
        // The fixture helper registers its teardown on the enclosing test.
        async close() {},
      };
    },
  };
}

for (const testCase of allCases) {
  const reason = notApplicable.get(testCase.id);
  test(`${testCase.id} ${testCase.title}`,
    { skip: reason ?? (databaseUrl ? false : "CORE_PG_TEST_URL is not set"), timeout: 120_000 }, async t => {
      const factory = postgresFactory(t);
      const prepared = run => async ctx => {
        // The kit creates these owner IDs after opening the adapter.
        await ctx.harness.seedOwners(ctx.owner, ctx.otherOwner);
        return run(ctx);
      };
      const result = await kit.runCase(factory, {
        ...testCase, run: prepared(testCase.run),
        ...(testCase.followUp && { followUp: { ...testCase.followUp, run: prepared(testCase.followUp.run) } }),
      });
      assert.equal(result, null, "Every additional skip needs an explicit inventory reason");
    });
}

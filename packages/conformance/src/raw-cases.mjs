import { compareUtf8, coreDigest, createBM25, factIncarnationBody } from "@cairn-ink/core";
import { check, equal, readDump, rejects } from "./support.mjs";

/** @import { RawSpanFact, SessionFact, StoredFact, SuppressionFact, TextFact, WindowFact } from "@cairn-ink/core" */
/** @import { CaptureKey, CaptureMessage, Namespace, ProvenClosure, RawSegment, RetrievalScope, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const client = "test-client";
const otherClient = "other-client";
const sessionId = "test-conversation";
const query = "cedar";

/** @param {CaseContext} ctx @param {Namespace} [namespace] @returns {CaptureKey} */
function key(ctx, namespace = null) {
  return { scope: ctx.scope(namespace), client, sessionId, eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64) };
}

/** @param {string} id @param {number | null} occurredAtMs @param {string} [content] @returns {CaptureMessage} */
function message(id, occurredAtMs, content = "cedar garden") {
  return { id, role: "user", content, occurredAtMs };
}

/** @param {CaseContext} ctx @param {CaptureKey} [capture] */
function fixture(ctx, capture = key(ctx)) {
  const { raw, uow } = ctx.adapter;
  check(raw, "rawArchive requires the raw ports");
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(capture.scope.owner, { pauseLock: true }, fn);
  /** @type {RetrievalScope} */
  const scope = { owner: capture.scope.owner, namespaces: [capture.scope.namespace] };
  return {
    raw, write, scope, capture,
    archive: (/** @type {CaptureMessage[]} */ messages) => write((tx) => raw.archive(tx, capture, messages)),
    allowed: () => write((tx) => raw.archiveAllowed(tx, capture)),
    search: (limit = 20, selection = scope) => uow.run(selection.owner, { readOnly: true },
      (tx) => raw.raw(tx, selection, query, "search", { limit, queryVector: new Float32Array([1]) })),
    page: (limit = 20, /** @type {string | null} */ cursor = null, selection = scope) =>
      uow.run(selection.owner, { readOnly: true }, (tx) => raw.listRaw(tx, selection, { limit, cursor })),
    remove: () => write((tx) => raw.deleteConversation(tx, capture.scope, capture)),
    fence: () => write((tx) => raw.fenceSession(tx, capture.scope, capture)),
  };
}

/** @param {ReturnType<typeof fixture>} f @param {StoredFact[]} facts */
function purge(f, facts) {
  return f.write((tx) => f.raw.purgeWithheld(tx, f.capture.scope, facts));
}

/** @param {CaptureKey} capture @param {string} actionId */
function factBase(capture, actionId) {
  return { owner: capture.scope.owner, namespace: capture.scope.namespace, origin: /** @type {const} */ ("forget"), actionId };
}

/** @param {CaseContext} ctx @param {CaptureKey} capture */
function hashSession(ctx, capture) {
  check(typeof ctx.harness.hashSessionKey === "function", "Hashed session and raw span fixtures require harness.hashSessionKey");
  const hash = ctx.harness.hashSessionKey(capture.client, capture.sessionId);
  check(typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash), "Raw span and hashed session fixtures need a session hash");
  return hash;
}

/** @param {CaseContext} ctx @param {CaptureKey} capture @returns {SessionFact} */
function sessionFact(ctx, capture) {
  const { client, sessionId } = capture;
  const session = ctx.sessionRefs === "plain" ? { client, sessionId } : { client, sessionKeyHash: hashSession(ctx, capture) };
  return { ...factBase(capture, "forget-conversation"), kind: "session", session };
}

/** @param {CaptureKey} capture @param {true} [unknownTime] @returns {WindowFact} */
function windowFact(capture, unknownTime) {
  return { ...factBase(capture, "forget-window"), kind: "window", client: capture.client, window: { startMs: -2, endMs: 2 },
    ...(unknownTime && { unknownTime }) };
}

/** @param {CaseContext} ctx @param {CaptureKey} capture @param {CaptureMessage} item @param {number} [startUtf16]
 * @returns {Promise<RawSpanFact>}
 */
async function spanFact(ctx, capture, item, startUtf16 = 1) {
  return { ...factBase(capture, "forget-span"), kind: "rawSpan", sessionKeyHash: hashSession(ctx, capture),
    messageKey: item.id, startUtf16, endUtf16: startUtf16 + 2, contentDigest: (await ctx.hash(item.content)).slice(7) };
}

/** @param {CaptureKey} capture @param {CaptureMessage} item @param {Awaited<ReturnType<CaseContext["adapter"]["keys"]["userKey"]>>} [key]
 * @returns {Promise<TextFact>}
 */
async function textFact(capture, item, key) {
  return { ...factBase(capture, "forget-text"), kind: "text", mode: "exact", text: { digests: [await coreDigest(item.content, key)] } };
}

/** @param {CaseContext} ctx @param {SuppressionFact} fact @returns {Promise<StoredFact>} */
async function storeFact(ctx, fact) {
  const incarnation = (await ctx.hash(factIncarnationBody(fact))).slice(7);
  const { factId, epoch, createdAtMs } = await ctx.adapter.uow.run(fact.owner, { pauseLock: true },
    (tx) => ctx.adapter.suppressions.writeFact(tx, fact, incarnation));
  return { fact, factId, epoch, createdAtMs, incarnation };
}

/** @param {RawSegment[]} rows */
const messageIds = (rows) => rows.map(({ messageId }) => messageId).sort(compareUtf8);

/** @param {ReturnType<typeof fixture>} f @param {string[]} expected @param {string} label */
async function visible(f, expected, label) {
  const { segments } = await f.search();
  equal(messageIds(segments), expected, `${label} must be enforced by raw search`);
  equal(messageIds((await f.page()).items), expected, `${label} must be enforced by listRaw`);
}

/** @param {CaseContext} ctx */
async function revision(ctx) {
  const capture = { ...key(ctx), sessionId: "revision-probe" };
  const { capture: port, uow } = ctx.adapter;
  return uow.run(ctx.owner, { pauseLock: true }, async (tx) => {
    const claim = await port.claim(tx, capture, [], { leaseMs: 10000 });
    check(claim.status === "claimed", "The revision probe must claim its own event");
    const { indexRevision } = await port.finish(tx, claim.token, []);
    return indexRevision;
  });
}

/** @param {CaseContext} ctx */
async function archivePositions(ctx) {
  const f = fixture(ctx);
  const messages = [message("omitted", 1), message("chosen", null, " Cedar  garden "), message("unpassed", 3)];
  const chosen = messages[1];
  equal((await f.archive([chosen, chosen])).archived, 1, "Only a new supplied position counts as archived");
  const first = (await f.page()).items;
  equal(first.length, 1, "Only supplied positions reach the archive");
  const [{ ref, role, content, occurredAtMs, messageId }] = first;
  equal([ref.type, ref.namespace, role, content, occurredAtMs, messageId],
    ["raw", null, chosen.role, chosen.content, chosen.occurredAtMs, chosen.id], "Archive must preserve the supplied message");
  check(typeof ref.id === "string" && !!ref.id, "A raw reference must have an id");
  const replay = fixture(ctx, { ...f.capture, eventId: crypto.randomUUID() });
  equal((await replay.archive([chosen])).archived, 0, "The raw key does not include the capture event");
  equal((await f.page()).items.map((row) => row.ref.id), [ref.id], "Replays must keep the stable raw reference");

  const withheld = message("withheld", 4, "cedar text suppression");
  await ctx.harness.seedFact(ctx.owner, await textFact(f.capture, withheld));
  equal((await f.archive([withheld])).archived, 1, "Archive must accept supplied text even when reads withhold it");
  await visible(f, [chosen.id], "Text withholding for an archived position");
}

/** @param {CaseContext} ctx */
async function windowRefusal(ctx) {
  const f = fixture(ctx);
  const before = message("before", -3);
  const start = message("start", -2);
  const inside = message("inside", 1);
  const end = message("end", 2);
  const unknown = message("unknown", null);
  await ctx.harness.seedFact(ctx.owner, windowFact(f.capture));
  const stored = await readDump(ctx.harness);
  equal((await f.archive([start, inside])).archived, 0, "Late arrivals in the half-open window must be refused");
  equal(await readDump(ctx.harness), stored, "Refused window messages must never be stored");
  equal((await f.archive([before, start, inside, end, unknown])).archived, 3,
    "Window refusal must allow arrivals before the start, at the end and with unknown time");
  await visible(f, ["before", "end", "unknown"], "Window refusal");
  equal((await f.remove()).rawDeleted, 3, "Conversation deletion must count only stored window survivors");
  await ctx.harness.seedFact(ctx.owner, windowFact(f.capture, true));
  const known = await readDump(ctx.harness);
  const unknownTime = fixture(ctx, { ...f.capture, sessionId: "other-conversation" });
  equal((await unknownTime.archive([unknown])).archived, 0, "unknownTime must refuse arrivals without a time");
  equal(await readDump(ctx.harness), known, "A refused unknown-time message must never be stored");
}

/** @param {CaseContext} ctx */
async function spanRefusal(ctx) {
  if (ctx.sessionRefs === "plain" && !ctx.harness.hashSessionKey) return "raw span fixtures require harness.hashSessionKey";
  const f = fixture(ctx);
  const refused = message("spanned", 1);
  const other = message("other", 1);
  await ctx.harness.seedFact(ctx.owner, await spanFact(ctx, f.capture, refused));
  const before = await readDump(ctx.harness);
  equal((await f.archive([refused])).archived, 0, "An overlapping raw span must refuse the message");
  equal(await readDump(ctx.harness), before, "A refused span message must never be stored");
  equal((await f.archive([refused, other])).archived, 1, "Span refusal must apply per message");
  const unrelated = fixture(ctx, { ...f.capture, sessionId: "other-conversation" });
  equal((await unrelated.archive([refused])).archived, 1, "Span refusal must apply only to the matching conversation");
  equal((await f.remove()).rawDeleted, 1, "Conversation deletion must count only stored span survivors");
}

/** @param {CaseContext} ctx */
async function sessionTextFenceReads(ctx) {
  const f = fixture(ctx);
  const session = sessionFact(ctx, f.capture);
  const fenced = fixture(ctx, { ...f.capture, sessionId: "fenced-conversation" });
  const survivor = fixture(ctx, { ...f.capture, client: otherClient });
  const hidden = message("text", 3, "cedar withhold this passage");
  const fingerprintKey = await ctx.adapter.keys.userKey(ctx.owner);
  await f.archive([message("session", 1)]);
  await fenced.archive([message("fenced", 2)]);
  await survivor.archive([hidden, message("visible", 4)]);
  await ctx.harness.seedFact(ctx.owner, session);
  await ctx.harness.seedFact(ctx.owner, await textFact(survivor.capture, hidden, fingerprintKey));
  await fenced.fence();
  await visible(f, ["visible"], "Session, text and fence visibility");
  equal(await f.allowed(), false, "A matching session fact must close archive admission");
  equal(await survivor.allowed(), true, "A session fact must leave other clients eligible");
  equal((await f.archive([message("late", 5)])).archived, 0, "A matching session fact must refuse later archives");
}

/** @param {CaseContext} ctx */
async function windowReads(ctx) {
  const f = fixture(ctx);
  const other = fixture(ctx, { ...f.capture, client: otherClient });
  await f.archive([message("before", -3), message("start", -2), message("inside", 1), message("end", 2), message("unknown", null)]);
  await other.archive([message("other", 0)]);
  await ctx.harness.seedFact(ctx.owner, windowFact(f.capture));
  await visible(f, ["before", "end", "other", "unknown"], "Half-open window visibility");
  await ctx.harness.seedFact(ctx.owner, windowFact(f.capture, true));
  await visible(f, ["before", "end", "other"], "unknownTime visibility");
}

/** @param {CaseContext} ctx */
async function clientlessReads(ctx) {
  const { seedClientlessRaw } = ctx.harness;
  if (!seedClientlessRaw) return "client-less raw fixture requires harness.seedClientlessRaw";
  const f = fixture(ctx);
  await f.archive([message("known", 5)]);
  await seedClientlessRaw(f.capture.scope, f.capture.sessionId, message("clientless", 5));
  await seedClientlessRaw(f.capture.scope, f.capture.sessionId, message("clientless-inside", 0));
  await visible(f, ["clientless", "clientless-inside", "known"], "Visibility before a client-specific fact");
  await ctx.harness.seedFact(ctx.owner, windowFact(f.capture));
  // Without client provenance, a client-specific window hides rows inside its range and keeps rows outside it.
  await visible(f, ["clientless", "known"], "Ineligible client-specific window visibility");
}

/** @param {CaseContext} ctx */
async function spanReads(ctx) {
  if (ctx.sessionRefs === "plain" && !ctx.harness.hashSessionKey) return "raw span fixtures require harness.hashSessionKey";
  const f = fixture(ctx);
  const spanned = message("spanned", 1);
  const adjacent = message("adjacent", 1);
  await f.archive([spanned, adjacent]);
  await ctx.harness.seedFact(ctx.owner, await spanFact(ctx, f.capture, spanned));
  await ctx.harness.seedFact(ctx.owner, await spanFact(ctx, f.capture, adjacent, adjacent.content.length));
  await visible(f, ["adjacent"], "Overlapping raw span visibility");
}

/** @param {CaseContext} ctx */
async function rawSearch(ctx) {
  const f = fixture(ctx);
  const project = fixture(ctx, key(ctx, "project"));
  const other = fixture(ctx, { ...f.capture, client: otherClient });
  const hidden = fixture(ctx, { ...f.capture, sessionId: "withheld-conversation" });
  await f.archive([message("tie-b", 3), message("tie-a", 2),
    message("weak", 1, "cedar garden rose thyme basil mint")]);
  await project.archive([message("project", 4, "cedar cedar garden")]);
  await other.archive([message("other", 4, "garden thyme")]);
  await hidden.archive([message("hidden", 5, "cedar cedar cedar cedar cedar")]);
  await hidden.fence();

  const scope = { ...f.scope, namespaces: ["project", null] };
  const { items } = await f.page(20, null, scope);
  equal(messageIds(items), ["other", "project", "tie-a", "tie-b", "weak"], "Read set must list visible raw messages");
  const docs = items.map(({ ref, content }) => ({ ref, text: content }));
  const expected = createBM25(docs).search(query);
  /** @param {RawSegment["ref"]} ref */
  const refKey = ({ namespace, type, id }) => JSON.stringify([namespace, type, id]);
  const scores = new Map(expected.map(({ ref, score }) => [refKey(ref), Math.fround(score)]));
  const returnedScores = [];
  for (const limit of [1, 2, 20]) {
    const { segments, coverage } = await f.search(limit, scope);
    equal(coverage.complete, true, "A raw lexical search must be complete");
    const size = Math.min(limit, expected.length);
    equal(segments.length, size, "Raw limit must apply after visibility and ranking");
    const cutoff = Math.fround(expected[size - 1].score);
    const seen = new Set();
    let priorScore = Infinity;
    let priorRankScore = Infinity;
    for (const { ref, score } of segments) {
      const id = refKey(ref);
      const rankScore = scores.get(id);
      check(rankScore !== undefined && !seen.has(id), "Raw search must return distinct visible matching segments");
      check(rankScore >= cutoff, "Raw limit must apply after visibility and ranking");
      check(Number.isFinite(score) && score <= priorScore, "Raw store scores must be finite and non-increasing");
      check(rankScore <= priorRankScore, "Raw search must order strict BM25 ranks");
      returnedScores.push({ score, expectedScore: rankScore });
      seen.add(id);
      priorScore = score;
      priorRankScore = rankScore;
    }
    check(expected.every(({ ref, score }) => Math.fround(score) <= cutoff || seen.has(refKey(ref))),
      "Raw limit must include all segments strictly above the cutoff");
  }
  for (const { score, expectedScore } of returnedScores) {
    check(Math.fround(score) === expectedScore,
      `Raw scores must use visible-corpus BM25 (expected ${expectedScore}, got ${score})`);
  }
  equal(messageIds((await f.search()).segments), ["tie-a", "tie-b", "weak"], "Raw search must isolate namespaces");
  const clients = { ...scope, clients: [otherClient] };
  equal(messageIds((await f.search(20, clients)).segments), [], "Raw search must honor client scope");
  equal(messageIds((await f.page(20, null, clients)).items), ["other"], "Raw listing must honor client scope");
  const foreign = { ...scope, owner: ctx.otherOwner };
  equal((await f.search(20, foreign)).segments.length, 0, "Another owner must not search raw messages");
  equal((await f.page(20, null, foreign)).items.length, 0, "Another owner must not list raw messages");
}

/** @param {CaseContext} ctx */
async function listPages(ctx) {
  const f = fixture(ctx);
  await f.archive([message("unknown-b", null), message("tie-b", 2), message("last", 3),
    message("first", -1), message("unknown-a", null), message("tie-a", 2)]);
  const limit = 2;
  const first = await f.page(limit);
  check(first.nextCursor, "A partial raw page must return a cursor");
  equal(first.items.length, limit, "A raw page with a next cursor must have exactly limit items");
  const second = await f.page(limit, first.nextCursor);
  check(second.nextCursor, "A second partial raw page must return a cursor");
  equal(second.items.length, limit, "A raw page with a next cursor must have exactly limit items");
  const third = await f.page(limit, second.nextCursor);
  equal(third.nextCursor, null, "The final raw page must terminate");
  check(third.items.length <= limit, "The final raw page must have at most limit items");
  const byId = (/** @type {RawSegment} */ a, /** @type {RawSegment} */ b) => compareUtf8(a.ref.id, b.ref.id);
  const all = [...first.items, ...second.items, ...third.items];
  equal(messageIds(all), ["first", "last", "tie-a", "tie-b", "unknown-a", "unknown-b"], "Raw pages must have no gaps or duplicates");
  const expected = [all.find(({ messageId }) => messageId === "first"),
    ...all.filter(({ occurredAtMs }) => occurredAtMs === 2).sort(byId),
    all.find(({ messageId }) => messageId === "last"),
    ...all.filter(({ occurredAtMs }) => occurredAtMs === null).sort(byId)];
  equal(all.map(({ messageId }) => messageId), expected.map((item) => item?.messageId), "Raw pages must order times, nulls last, then ids");
  const cursor = first.nextCursor;
  await fixture(ctx, key(ctx, "project")).archive([message("unrelated", 3)]);
  await rejects(() => f.page(limit, cursor), "cursor_stale");
  const { items, nextCursor: fresh } = await f.page(limit);
  check(fresh, "A new snapshot must still page");
  equal(items.length, limit, "A raw page with a next cursor must have exactly limit items");
  await rejects(() => f.page(limit, fresh, { ...f.scope, clients: [client] }), "cursor_stale");
  await rejects(() => f.page(limit, fresh, { ...f.scope, owner: ctx.otherOwner }), "cursor_stale");
}

/** @param {CaseContext} ctx */
async function rawStore(ctx) {
  const f = fixture(ctx);
  const second = fixture(ctx, { ...f.capture, sessionId: "second-conversation" });
  const third = fixture(ctx, { ...f.capture, sessionId: "third-conversation" });
  const otherNamespace = fixture(ctx, { ...f.capture, scope: ctx.scope("project") });
  const first = message("first", 1);
  let expected = await revision(ctx);
  /** @param {number} delta @param {string} operation */
  const advances = async (delta, operation) => {
    expected += delta;
    equal(await revision(ctx), expected, `${operation} must advance the revision by ${delta}`);
  };

  await f.write(async (tx) => {
    await f.raw.recordLineage(tx, f.capture, [first]);
    await f.raw.archive(tx, f.capture, [first, message("second", 2)]);
    await f.raw.archive(tx, second.capture, [message("other", 3)]);
  });
  await advances(2, "Two changing archives in the same run");
  await f.archive([first]);
  await f.archive([]);
  await advances(0, "Idempotent and empty archives");
  await f.fence();
  await advances(1, "A new fence");
  await f.fence();
  equal(await f.allowed(), false, "A fenced conversation must close archive admission");
  equal((await f.archive([message("late", 2)])).archived, 0, "A fenced conversation must refuse later archives");
  await advances(0, "A repeated fence and an archive refusal");
  await visible(f, ["other"], "Fenced conversation visibility");

  await otherNamespace.archive([first]);
  await advances(1, "An archive in another namespace");
  equal((await f.remove()).rawDeleted, 2, "Conversation deletion must count its stored messages only");
  await advances(1, "A changing deletion");
  equal((await f.remove()).rawDeleted, 0, "Repeated conversation deletion must count zero");
  await advances(0, "A repeated deletion");
  equal(await f.allowed(), false, "A fence must survive conversation deletion");
  await visible(otherNamespace, ["first"], "A fence and deletion must stay in their namespace");

  await third.archive([message("third", 4)]);
  await advances(1, "Another changing archive");
  // This test exercises the store with known members. Production callers obtain the brand from session lineage.
  const closure = /** @type {ProvenClosure} */ (/** @type {unknown} */ ([
    { client, sessionId: second.capture.sessionId }, { client, sessionId: third.capture.sessionId },
  ]));
  const erase = () => f.write((tx) => f.raw.eraseSessions(tx, f.capture.scope, closure));
  const erased = await erase();
  equal([erased.rawDeleted, erased.ledgerBlanked], [2, 0], "Closure erasure must count both stored conversations");
  await advances(1, "A changing closure erasure");
  equal((await erase()).rawDeleted, 0, "Repeated closure erasure must count zero");
  await advances(0, "A repeated closure erasure");
}

/** @param {CaseContext} ctx */
async function keyConflict(ctx) {
  const f = fixture(ctx);
  const first = message("same", 1);
  await f.archive([first]);
  const before = (await ctx.harness.counters()).rawKeyConflict ?? 0;
  const result = await f.archive([{ ...first, content: "cedar different" }]);
  equal((await f.page()).items.map(({ content }) => content), [first.content], "A raw key conflict must keep the first row");
  equal(result.archived, 0, "A raw key conflict must not count as an archive");
  equal((await ctx.harness.counters()).rawKeyConflict, before + 1, "A raw key conflict must increment rawKeyConflict");
}

/** @param {CaseContext} ctx */
async function purgeSafety(ctx) {
  const f = fixture(ctx);
  const matching = message("matching", 1, "cedar remove this passage");
  const ineligible = fixture(ctx, key(ctx, "ineligible"));
  await f.archive([matching, message("visible", 1)]);
  await ineligible.archive([message("ineligible", 1)]);
  const text = await storeFact(ctx, await textFact(f.capture, matching));
  const missingKey = await textFact(ineligible.capture, message("different", 3));
  const [digest] = missingKey.text.digests;
  const doubt = await storeFact(ctx, { ...missingKey, text: { digests: [{ ...digest, alg: "hmac", keyId: "unavailable-key" }] } });
  const before = await revision(ctx);
  const deleted = await purge(f, [text, doubt]);
  equal([deleted.rawDeleted, deleted.ledgerBlanked], [1, 0], "Purge must delete only the definite text match");
  equal(await revision(ctx), before + 1, "Changing purge must advance the revision once");
  equal((await purge(f, [text])).rawDeleted, 0, "A repeated purge must delete zero");
  equal((await purge(ineligible, [doubt])).rawDeleted, 0, "Purge must retain ineligible rows");
  equal(await revision(ctx), before + 1, "No-op purges must preserve the revision");
  await visible(f, ["visible"], "Text visibility after purge");
  await visible(ineligible, [], "Ineligible visibility after purge");
  equal((await f.remove()).rawDeleted, 1, "The definite text match must be physically deleted");
  equal((await ineligible.remove()).rawDeleted, 1, "An ineligible row must remain physically stored");

  const sessionOnly = fixture(ctx, { ...f.capture, sessionId: "session-only" });
  const session = sessionFact(ctx, sessionOnly.capture);
  await sessionOnly.archive([message("session-only", 2)]);
  const storedSession = await storeFact(ctx, session);
  const secondMatch = fixture(ctx, { ...f.capture, sessionId: "other-conversation" });
  await secondMatch.archive([{ ...matching, id: "second-match" }]);
  const deletedWithSession = await purge(f, [text]);
  equal([deletedWithSession.rawDeleted, deletedWithSession.ledgerBlanked], [1, 0],
    "Text purge must retain session-only-hidden rows");
  await visible(f, [], "Session-only visibility after text purge");
  equal((await purge(f, [storedSession])).rawDeleted, 0, "Purge must retain session-only-hidden rows");
  await visible(f, [], "Session-only visibility after purge");
  equal((await sessionOnly.remove()).rawDeleted, 1, "A session-only-hidden row must remain physically stored");
}

/** @param {CaseContext} ctx */
async function purgeWindow(ctx) {
  const f = fixture(ctx);
  await f.archive([message("window-only", 0), message("visible", 2)]);
  const window = await storeFact(ctx, windowFact(f.capture));
  equal((await purge(f, [window])).rawDeleted, 0, "Purge must retain window-only-hidden rows");
  await visible(f, ["visible"], "Window-only visibility after purge");
  equal((await f.remove()).rawDeleted, 2, "A window-only-hidden row must remain physically stored");
}

/** @param {CaseContext} ctx */
async function purgeSpan(ctx) {
  if (ctx.sessionRefs === "plain" && !ctx.harness.hashSessionKey) return "raw span fixtures require harness.hashSessionKey";
  const f = fixture(ctx);
  const spanned = message("spanned", 1);
  await f.archive([spanned, message("visible", 2)]);
  const span = await storeFact(ctx, await spanFact(ctx, f.capture, spanned));
  const deleted = await purge(f, [span]);
  equal([deleted.rawDeleted, deleted.ledgerBlanked], [1, 0], "Purge must delete the definite raw span match");
  await visible(f, ["visible"], "Raw span visibility after purge");
  equal((await f.remove()).rawDeleted, 1, "The definite raw span match must be physically deleted");
}

/** @type {readonly ConformanceCase[]} */
export const RAW_CASES = [
  { id: "K-RAW-1", title: "archive stores supplied messages once", needs: ["rawArchive"], run: archivePositions },
  { id: "K-RAW-2", title: "archive refuses windowed messages", needs: ["rawArchive", "rawWindowHide"], run: windowRefusal },
  { id: "K-RAW-2s", title: "archive refuses messages covered by raw spans", needs: ["rawArchive", "rawSpans"], run: spanRefusal },
  { id: "K-RAW-3", title: "reads hide session, text and fenced messages", needs: ["rawArchive"],
    requests: { fingerprintKey: true }, run: sessionTextFenceReads },
  { id: "K-RAW-3w", title: "reads hide windowed messages", needs: ["rawArchive", "rawWindowHide"], run: windowReads },
  { id: "K-RAW-3c", title: "reads fail closed on missing client provenance",
    needs: ["rawArchive", "rawWindowHide"], run: clientlessReads },
  { id: "K-RAW-3s", title: "reads hide overlapping raw spans", needs: ["rawArchive", "rawSpans"], run: spanReads },
  { id: "K-RAW-4", title: "search ranks visible raw messages in the read set", needs: ["rawArchive"], run: rawSearch },
  { id: "K-RAW-5", title: "listing pages over a bound snapshot", needs: ["rawArchive"], run: listPages },
  { id: "K-RAW-6", title: "raw store operations count and advance revisions", needs: ["rawArchive"], run: rawStore },
  { id: "K-RAW-7", title: "conflicting content preserves the archived message", needs: ["rawArchive"], run: keyConflict },
  { id: "K-RAW-8", title: "purge distinguishes definite text matches from doubt and session facts",
    needs: ["rawArchive"], run: purgeSafety },
  { id: "K-RAW-8w", title: "purge retains window-only-hidden rows", needs: ["rawArchive", "rawWindowHide"], run: purgeWindow },
  { id: "K-RAW-8s", title: "purge deletes definite raw span matches", needs: ["rawArchive", "rawSpans"], run: purgeSpan },
];

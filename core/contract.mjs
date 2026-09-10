import { createHmac, timingSafeEqual } from "node:crypto";
import { createMemoryRuntime } from "./runtime.mjs";
import { uniqueIds, memoryGuards, placementProposal } from './placement-input.mjs';
import { countTokens } from './model-budget.mjs';
import { classify } from './classification.mjs';
import { memoryRefs, fetchMemories } from './fetch.mjs';
import { recallMemories } from './recall.mjs';
import { captureMessages } from './capture.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import {
  boundedText, fingerprint, identifier, limit, MemoryStoreError, object, revision, denseArray,
} from "./validation.mjs";

const kinds = ["fact", "preference", "decision", "instruction", "context"];
const statusOrder = ["filed", "unfiled"];

function contractNamespace(input) {
  object(input, ["ownerId", "scope", "projectId"]);
  if (!Object.hasOwn(input, "ownerId") || !Object.hasOwn(input, "scope") ||
      !Object.hasOwn(input, "projectId")) throw new MemoryStoreError("invalid_input");
  let ownerId;
  try { ownerId = identifier(input.ownerId); } catch { throw new MemoryStoreError("invalid_input"); }
  if (input.scope === "personal" && input.projectId === null) {
    return { ownerId, scope: "personal", projectId: "" };
  }
  if (input.scope === "project" && input.projectId !== null) {
    let projectId;
    try { projectId = identifier(input.projectId); } catch {
      throw new MemoryStoreError("invalid_input");
    }
    return { ownerId, scope: "project", projectId };
  }
  throw new MemoryStoreError("invalid_input");
}

function publicNamespace(ns) {
  return { ownerId: ns.ownerId, scope: ns.scope, projectId: ns.projectId || null };
}

function contractReceipt(input) {
  object(input, ["client", "sessionId", "eventId", "role", "excerpt"]);
  if (!["user", "assistant"].includes(input.role)) throw new MemoryStoreError("invalid_input");
  try {
    return {
      client: identifier(input.client),
      sessionId: identifier(input.sessionId),
      eventId: identifier(input.eventId),
      role: input.role,
      excerpt: boundedText(input.excerpt, 800, true),
    };
  } catch {
    throw new MemoryStoreError("invalid_input");
  }
}

function contractMemory(input, maxContent = 4000) {
  object(input, ["content", "kind"]);
  if (!kinds.includes(input.kind)) throw new MemoryStoreError("invalid_input");
  let content;
  try { content = boundedText(input.content, maxContent); } catch {
    throw new MemoryStoreError("invalid_input");
  }
  return { content, kind: input.kind, origin: "explicit", confidence: 1,
    fingerprint: fingerprint(content) };
}

function contractId(value) {
  try { return identifier(value); } catch { throw new MemoryStoreError("invalid_input"); }
}

function contractRevision(value) {
  try { return revision(value); } catch { throw new MemoryStoreError("invalid_input"); }
}

function contractConflictHints(value = []) {
  const hints = denseArray(value, 0, 5).map((hint) => {
    object(hint, ['memoryId', 'expectedRevision', 'relation']);
    if (hint.relation !== 'contradicts') throw new MemoryStoreError('invalid_input');
    return { memoryId: contractId(hint.memoryId),
      expectedRevision: contractRevision(hint.expectedRevision), relation: 'contradicts' };
  });
  if (new Set(hints.map((hint) => hint.memoryId)).size !== hints.length) {
    throw new MemoryStoreError('invalid_input');
  }
  return hints;
}

function contractLimit(value) {
  try { return limit(value); } catch { throw new MemoryStoreError("invalid_input"); }
}

function statuses(value = statusOrder) {
  if (!Array.isArray(value) || value.length === 0 ||
      value.some((item) => !statusOrder.includes(item)) || new Set(value).size !== value.length) {
    throw new MemoryStoreError("invalid_input");
  }
  return statusOrder.filter((item) => value.includes(item));
}

function success(value) {
  return { ok: true, value };
}

function failure(error) {
  let code = error instanceof MemoryStoreError ? error.code : "storage_error";
  if (error?.code === "ERR_SQLITE_ERROR" && Number.isInteger(error.errcode) &&
      [5, 6].includes(error.errcode & 0xff)) code = "storage_busy";
  if (["invalid_identifier", "invalid_text", "invalid_memory", "invalid_receipt",
    "invalid_revision", "invalid_limit"].includes(code)) code = "invalid_input";
  return { ok: false, error: { code, retryable: code === "storage_busy" } };
}

/** Model-free exact-namespace lifecycle and inspection facade. */
export function openMemoryCore(input) {
  object(input, ['path', 'model']);
  const model = input.model;
  if (model?.onDiagnostic !== undefined && typeof model.onDiagnostic !== 'function') throw new MemoryStoreError('invalid_input');
  const runtime = createMemoryRuntime({ path: input.path });
  const { storeId, cursorSecret } = runtime.identity;

  function namespaceBinding(ns) {
    return createHmac("sha256", cursorSecret)
      .update(JSON.stringify(publicNamespace(ns))).digest("base64url");
  }

  function encodeCursor(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", cursorSecret).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  function decodeCursor(cursor, binding) {
    if (typeof cursor !== "string" || cursor.length > 8_192) {
      throw new MemoryStoreError("invalid_cursor");
    }
    const parts = cursor.split(".");
    if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
      throw new MemoryStoreError("invalid_cursor");
    }
    const expected = createHmac("sha256", cursorSecret).update(parts[0]).digest();
    const supplied = Buffer.from(parts[1], "base64url");
    if (supplied.toString("base64url") !== parts[1] || supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)) {
      throw new MemoryStoreError("invalid_cursor");
    }
    let payload;
    try {
      const decoded = Buffer.from(parts[0], "base64url");
      if (decoded.toString("base64url") !== parts[0]) throw new Error("noncanonical");
      payload = JSON.parse(decoded.toString("utf8"));
    } catch {
      throw new MemoryStoreError("invalid_cursor");
    }
    const allowedKeys = [...Object.keys(binding), "e", "a"];
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).length !== allowedKeys.length ||
        Object.keys(payload).some((key) => !allowedKeys.includes(key)) ||
        Object.keys(binding).some((key) => payload[key] !== binding[key])) {
      throw new MemoryStoreError("invalid_cursor");
    }
    if (!Number.isSafeInteger(payload.e) || payload.e < 1 || !payload.a ||
        typeof payload.a !== "object" || Array.isArray(payload.a)) {
      throw new MemoryStoreError("invalid_cursor");
    }
    return payload;
  }

  function invoke(work) {
    try { return success(work()); } catch (error) { return failure(error); }
  }

  function admit(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ["namespace", "memory", "receipts", "conflictHints"]);
      const ns = contractNamespace(input.namespace);
      const memory = contractMemory(input.memory);
      if (!Array.isArray(input.receipts) || input.receipts.length < 1 || input.receipts.length > 4) {
        throw new MemoryStoreError("invalid_input");
      }
      const receipts = input.receipts.map(contractReceipt);
      const conflictHints = contractConflictHints(input.conflictHints);
      const result = runtime.admit(ns, { ...memory, receipts, conflictHints });
      return { memory: { id: result.memory.id, revision: result.memory.revision },
        deduplicated: result.deduplicated, indexRevision: result.indexRevision };
    });
  }

  function list(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ["namespace", "statuses", "limit", "cursor"]);
      const ns = contractNamespace(input.namespace);
      const selected = statuses(input.statuses);
      const count = contractLimit(input.limit);
      const binding = { v: 1, s: storeId, n: namespaceBinding(ns), o: "list",
        f: selected.join(","), l: count };
      let cursor;
      if (input.cursor !== undefined) cursor = decodeCursor(input.cursor, binding);
      const page = runtime.listPage(ns, selected, count, cursor?.a, cursor?.e);
      const memories = page.rows.slice(0, count);
      const exhausted = page.rows.length <= count;
      const last = memories.at(-1);
      return { memories,
        nextCursor: exhausted ? null : encodeCursor({ ...binding, e: page.epoch,
          a: { updatedAt: last.updatedAt, id: last.id } }), exhausted };
    });
  }

  function get(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ["namespace", "memoryId", "receiptLimit", "receiptCursor"]);
      const ns = contractNamespace(input.namespace);
      const memoryId = contractId(input.memoryId);
      const count = contractLimit(input.receiptLimit);
      const binding = { v: 1, s: storeId, n: namespaceBinding(ns), o: "get",
        m: memoryId, l: count };
      let cursor;
      if (input.receiptCursor !== undefined) cursor = decodeCursor(input.receiptCursor, binding);
      const page = runtime.getPage(ns, memoryId, count, cursor?.a, cursor?.e);
      const receipts = page.receipts.slice(0, count);
      const exhausted = page.receipts.length <= count;
      const last = receipts.at(-1);
      return { memory: page.memory, receipts, placements: page.placements, conflicts: page.conflicts,
        nextReceiptCursor: exhausted ? null : encodeCursor({ ...binding, e: page.epoch,
          a: { createdAt: last.createdAt, id: last.id } }), exhausted };
    });
  }

  function correct(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ["namespace", "memoryId", "expectedRevision", "content", "kind", "receipt"]);
      const ns = contractNamespace(input.namespace);
      const memoryId = contractId(input.memoryId);
      const expectedRevision = contractRevision(input.expectedRevision);
      const memory = contractMemory({ content: input.content, kind: input.kind });
      const receipt = contractReceipt(input.receipt);
      const result = runtime.correct(ns, memoryId, { ...memory, receipts: [receipt] },
        expectedRevision, { detail: true });
      return { memory: result.detail, indexRevision: result.indexRevision };
    });
  }

  function forget(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ["namespace", "memoryId", "expectedRevision"]);
      const ns = contractNamespace(input.namespace);
      return runtime.forget(ns, contractId(input.memoryId),
        contractRevision(input.expectedRevision));
    });
  }

  function admissionKey(input) {
    if (typeof input.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.payloadDigest)) {
      throw new MemoryStoreError('invalid_input');
    }
    return { client: contractId(input.client), eventId: contractId(input.eventId),
      payloadDigest: input.payloadDigest };
  }

  function claimAdmission(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'client', 'eventId', 'payloadDigest', 'leaseMs']);
      const ns = contractNamespace(input.namespace);
      const key = admissionKey(input);
      const leaseMs = contractRevision(input.leaseMs);
      if (leaseMs > 125000) throw new MemoryStoreError('invalid_input');
      return runtime.claimAdmission(ns, { ...key, leaseMs });
    });
  }

  function finishAdmission(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'client', 'eventId', 'payloadDigest', 'token', 'items']);
      const ns = contractNamespace(input.namespace);
      const key = admissionKey(input);
      const token = contractId(input.token);
      const items = denseArray(input.items, 0, 5).map((item) => {
        object(item, ['content', 'kind', 'confidence', 'receipts', 'conflictHints']);
        if (typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) ||
            item.confidence < 0 || item.confidence > 1) throw new MemoryStoreError('invalid_input');
        const memory = contractMemory({ content: item.content, kind: item.kind }, 600);
        const receipts = denseArray(item.receipts, 1, 4).map(contractReceipt);
        const conflictHints = contractConflictHints(item.conflictHints);
        return { ...memory, origin: 'agent-inferred', confidence: item.confidence, receipts, conflictHints };
      });
      return runtime.finishAdmission(ns, { ...key, token, items });
    });
  }

  function abandonAdmission(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'client', 'eventId', 'payloadDigest', 'token']);
      const ns = contractNamespace(input.namespace);
      return runtime.abandonAdmission(ns, { ...admissionKey(input), token: contractId(input.token) });
    });
  }

  function rebuildIndex(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'expectedIndexRevision', 'limit', 'cursor']);
      const ns = contractNamespace(input.namespace);
      const expectedIndexRevision = contractRevision(input.expectedIndexRevision);
      const count = input.limit === undefined ? 500 : input.limit;
      if (!Number.isInteger(count) || count < 1 || count > 500) {
        throw new MemoryStoreError('invalid_input');
      }
      const binding = { v: 1, s: storeId, n: namespaceBinding(ns), o: 'rebuild',
        l: count, r: expectedIndexRevision };
      const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor, binding);
      if (cursor && cursor.e !== expectedIndexRevision) throw new MemoryStoreError('invalid_cursor');
      const result = runtime.rebuildIndex(ns, { expectedIndexRevision, limit: count,
        ...(cursor ? { progress: cursor.a } : {}) });
      return { state: result.state, indexRevision: result.indexRevision,
        nextCursor: result.progress === null ? null : encodeCursor({ ...binding,
          e: expectedIndexRevision, a: result.progress }),
        exhausted: result.exhausted, invalidRefs: result.invalidRefs };
    });
  }

  function applyPlacement(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'proposal', 'expectedMemoryRevisions', 'expectedIndexRevision']);
      const ns = contractNamespace(input.namespace);
      const proposal = placementProposal(input.proposal);
      const guards = memoryGuards(input.expectedMemoryRevisions, proposal.items.map((item) => item.memoryId));
      return runtime.applyPlacement(ns, proposal, guards, contractRevision(input.expectedIndexRevision));
    });
  }

  function linkMocs(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'parentId', 'expectedParentRevision', 'childId',
        'expectedChildRevision', 'expectedIndexRevision']);
      return runtime.linkMocs(contractNamespace(input.namespace), {
        parentId: contractId(input.parentId), childId: contractId(input.childId),
        expectedParentRevision: contractRevision(input.expectedParentRevision),
        expectedChildRevision: contractRevision(input.expectedChildRevision),
        expectedIndexRevision: contractRevision(input.expectedIndexRevision),
      });
    });
  }

  function map(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'purpose', 'parentRef', 'limit', 'cursor', 'tokenBudget']);
      const ns = contractNamespace(input.namespace);
      const purpose = input.purpose ?? 'recall';
      if (!['recall', 'classification'].includes(purpose)) throw new MemoryStoreError('invalid_input');
      const count = contractLimit(input.limit ?? 100);
      const budget = contractRevision(input.tokenBudget ?? 4000);
      if (budget > 4000) throw new MemoryStoreError('invalid_input');
      let parentRef;
      if (input.parentRef !== undefined) {
        object(input.parentRef, ['mocId', 'revision']);
        parentRef = { mocId: contractId(input.parentRef.mocId), revision: contractRevision(input.parentRef.revision) };
      }
      // Require a counter before accessing content, even for an empty map.
      countTokens(model, '');
      const binding = { v: 1, s: storeId, n: namespaceBinding(ns), o: 'map',
        p: parentRef ? JSON.stringify(parentRef) : '', f: purpose, l: count, b: budget };
      const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor, binding);
      if (cursor && (!Number.isSafeInteger(cursor.a.offset) || cursor.a.offset < 0 ||
          Object.keys(cursor.a).length !== 1)) throw new MemoryStoreError('invalid_cursor');
      const offset = cursor?.a.offset ?? 0;
      const page = runtime.mapRows(ns, { purpose, parentRef, limit: count, offset, expectedEpoch: cursor?.e });
      const capacity = Math.min(count, page.rows.length);
      for (let take = capacity; take >= 0; take--) {
        if (take === 0 && page.rows.length > 0) throw new MemoryStoreError('context_item_too_large');
        const selected = page.rows.slice(0, take);
        const exhausted = take === page.rows.length;
        const value = { items: selected.filter((row) => row.item).map((row) => row.item),
          nextCursor: exhausted ? null : encodeCursor({ ...binding, e: page.epoch, a: { offset: offset + take } }),
          exhausted, truncatedBy: exhausted ? null : take < capacity ? 'token_budget' : 'page_limit',
          indexRevision: page.epoch,
          invalidRefs: selected.filter((row) => row.invalidRef).map((row) => row.invalidRef) };
        if (countTokens(model, JSON.stringify(success(value))) <= budget) {
          runtime.assertEpoch(ns, page.epoch);
          return value;
        }
      }
      throw new MemoryStoreError('context_item_too_large');
    });
  }

  function fetch(input) {
    return invoke(() => {
      runtime.ready();
      object(input, ['namespace', 'refs', 'cursor', 'tokenBudget']);
      const ns = contractNamespace(input.namespace);
      const refs = memoryRefs(input.refs);
      const budget = contractRevision(input.tokenBudget ?? 4000);
      if (budget > 4000) throw new MemoryStoreError('invalid_input');
      const binding = { v: 1, s: storeId, n: namespaceBinding(ns), o: 'fetch', b: budget,
        r: createHmac('sha256', cursorSecret).update(JSON.stringify(refs)).digest('base64url') };
      const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor, binding);
      return fetchMemories({ runtime, model, ns, refs, budget, cursor, binding, encodeCursor });
    });
  }

  async function recall(input) {
    try {
      runtime.ready();
      object(input, ['readSet', 'query', 'limit']);
      let namespaces;
      try {
        denseArray(input.readSet, 1, 2);
        namespaces = input.readSet.map(contractNamespace);
        if (namespaces.length === 2 && (namespaces[0].ownerId !== namespaces[1].ownerId ||
            namespaces[0].scope === namespaces[1].scope)) throw new Error();
      } catch { throw new MemoryStoreError('invalid_read_set'); }
      const query = boundedText(input.query, 4000);
      const count = contractRevision(input.limit ?? 6);
      if (count > 12) throw new MemoryStoreError('invalid_input');
      return success(await recallMemories({ model, readSet: namespaces.map(publicNamespace), query,
        limit: count, map, fetch,
        finalize: (candidates, selected) => runtime.recallSnapshot(candidates.map((candidate) => ({
          namespace: namespaces[candidate.namespaceIndex], memoryId: candidate.memoryId,
          revision: candidate.revision, receiptLimit: candidate.item.receipts.length,
        })), selected),
      }));
    } catch (error) { return failure(error); }
  }

  async function capture(input) {
    try {
      runtime.ready();
      object(input, ['namespace', 'client', 'eventId', 'sessionId', 'messages']);
      const namespace = publicNamespace(contractNamespace(input.namespace));
      return success(await captureMessages({ model, input: { ...input, namespace },
        operations: { claimAdmission, finishAdmission, abandonAdmission, get, map,
          classifyPlacement, applyPlacement } }));
    } catch (error) { return failure(error); }
  }

  async function classifyPlacement(input) {
    try {
      runtime.ready();
      object(input, ['namespace', 'memoryIds', 'expectedMemoryRevisions', 'mapRevision']);
      const ns = contractNamespace(input.namespace);
      const ids = uniqueIds(input.memoryIds, 5, 1);
      const guards = memoryGuards(input.expectedMemoryRevisions, ids);
      const index = contractRevision(input.mapRevision);
      if (typeof model?.classify !== 'function') {
        emitDiagnostic(model, 'classify', 'core_call', 'model_not_configured');
        throw new MemoryStoreError('model_not_configured');
      }
      const snapshot = runtime.classificationSnapshot(ns, ids, guards, index);
      const mapped = map({ namespace: input.namespace, purpose: 'classification' });
      if (!mapped.ok) return mapped;
      if (mapped.value.indexRevision !== index) throw new MemoryStoreError('index_revision_conflict');
      const validateFresh = () => runtime.classificationSnapshot(ns, ids, guards, index);
      const value = await classify({ model, snapshot, map: mapped.value, validateFresh });
      return success(value);
    } catch (error) { return failure(error); }
  }

  return Object.freeze({
    admit, list, get, correct, forget, claimAdmission, finishAdmission, abandonAdmission,
    applyPlacement, linkMocs, map, fetch, recall, capture, classifyPlacement, rebuildIndex,
    close() {
      runtime.close();
      return success(null);
    },
  });
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { createMemoryRuntime } from "./runtime.mjs";
import {
  boundedText, fingerprint, identifier, limit, MemoryStoreError, object, revision,
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

function contractMemory(input) {
  object(input, ["content", "kind"]);
  if (!kinds.includes(input.kind)) throw new MemoryStoreError("invalid_input");
  let content;
  try { content = boundedText(input.content, 4_000); } catch {
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
  const runtime = createMemoryRuntime(input);
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
      object(input, ["namespace", "memory", "receipts"]);
      const ns = contractNamespace(input.namespace);
      const memory = contractMemory(input.memory);
      if (!Array.isArray(input.receipts) || input.receipts.length < 1 || input.receipts.length > 4) {
        throw new MemoryStoreError("invalid_input");
      }
      const receipts = input.receipts.map(contractReceipt);
      const result = runtime.admit(ns, { ...memory, receipts });
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
      return { memory: page.memory, receipts, placements: [], conflicts: [],
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

  return Object.freeze({
    admit, list, get, correct, forget,
    close() {
      runtime.close();
      return success(null);
    },
  });
}

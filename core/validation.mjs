import { createHash } from "node:crypto";
import { redactSecrets } from "../plugins/cairn-memory/lib/redact.mjs";

export class MemoryStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = "MemoryStoreError";
    this.code = code;
  }
}

export function fail(code) {
  throw new MemoryStoreError(code);
}

export function object(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) fail("invalid_input");
  return value;
}

export function identifier(value) {
  if (typeof value !== "string" || !value || value.length > 200 ||
      value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) fail("invalid_identifier");
  return value;
}

export function boundedText(value, max, truncate = false) {
  if (typeof value !== "string" || value.length > 20_000) fail("invalid_text");
  const clean = redactSecrets(value.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  if (!clean || clean === "[REDACTED]" || clean.includes("\0")) fail("invalid_text");
  if (!truncate && clean.length > max) fail("invalid_text");
  let result = "";
  for (const point of clean) {
    if (result.length + point.length > max) break;
    result += point;
  }
  return result;
}

export function fingerprint(content) {
  return createHash("sha256").update(content.toLowerCase()).digest("hex");
}

export function namespace(input) {
  object(input, ["ownerId", "projectId"]);
  return {
    ownerId: identifier(input.ownerId),
    projectId: input.projectId === undefined ? "" : identifier(input.projectId),
    scope: input.projectId === undefined ? "personal" : "project",
  };
}

export function memoryInput(input) {
  object(input, ["content", "kind", "origin", "confidence", "receipt"]);
  const kind = input.kind ?? "fact";
  const origin = input.origin ?? "explicit";
  const confidence = input.confidence ?? (origin === "explicit" ? 1 : undefined);
  if (!["fact", "preference", "decision", "instruction", "context"].includes(kind) ||
      !["explicit", "agent-inferred"].includes(origin) ||
      typeof confidence !== "number" || !Number.isFinite(confidence) ||
      confidence < 0 || confidence > 1 || (origin === "explicit" && confidence !== 1)) {
    fail("invalid_memory");
  }
  const content = boundedText(input.content, 4_000);
  object(input.receipt, ["client", "sessionId", "eventId", "role", "excerpt"]);
  const receipt = {
    client: identifier(input.receipt.client),
    sessionId: identifier(input.receipt.sessionId),
    eventId: identifier(input.receipt.eventId),
    role: input.receipt.role,
    excerpt: boundedText(input.receipt.excerpt, 800, true),
  };
  if (!["user", "assistant"].includes(receipt.role)) fail("invalid_receipt");
  return { content, kind, origin, confidence, receipt, fingerprint: fingerprint(content) };
}

export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail("invalid_revision");
  return value;
}

export function limit(value = 20) {
  if (!Number.isInteger(value) || value < 1 || value > 100) fail("invalid_limit");
  return value;
}

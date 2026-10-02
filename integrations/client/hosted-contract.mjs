import { HOSTED_SCHEMAS } from "./hosted-schemas.mjs";

// UTC RFC 3339, finite calendar instant. Date.parse alone normalizes February 30.
export function utcInstant(value) {
  if (typeof value !== "string") return false;
  const pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|\+00:00)$/;
  const match = pattern.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour < 24 && minute < 60 && second < 60;
}

function dateTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(.*)([+-])(\d{2}):(\d{2})$/.exec(value);
  if (!match) return utcInstant(value);
  return Number(match[3]) <= 23 && Number(match[4]) <= 59 &&
    utcInstant(match[1] + "Z") && Number.isFinite(Date.parse(value));
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// This interpreter supports only the keywords used by the frozen hosted schemas.
// It is not a general JSON Schema implementation. New keywords must be added
// here and to conformance tests before a schema starts using them.
export function conforms(name, value) {
  const root = HOSTED_SCHEMAS[name];
  if (!root) return false;
  function check(schema, input) {
    if (schema.$ref) return check(root.$defs[schema.$ref.slice("#/$defs/".length)], input);
    if (schema.oneOf && schema.oneOf.filter((s) => check(s, input)).length !== 1) return false;
    if (schema.anyOf && !schema.anyOf.some((s) => check(s, input))) return false;
    if (Object.hasOwn(schema, "const") && input !== schema.const) return false;
    if (schema.enum && !schema.enum.includes(input)) return false;
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => ({
        object: object(input), array: Array.isArray(input), null: input === null,
        string: typeof input === "string", boolean: typeof input === "boolean",
        number: typeof input === "number" && Number.isFinite(input),
        integer: Number.isSafeInteger(input),
      })[type])) return false;
    }
    if (object(input)) {
      if (schema.required?.some((key) => !Object.hasOwn(input, key))) return false;
      if (schema.additionalProperties === false &&
          Object.keys(input).some((key) => !Object.hasOwn(schema.properties, key))) return false;
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (Object.hasOwn(input, key) && !check(sub, input[key])) return false;
      }
    }
    if (Array.isArray(input)) {
      if (input.length < (schema.minItems ?? 0) || input.length > (schema.maxItems ?? Infinity)) {
        return false;
      }
      if (schema.items && !input.every((item) => check(schema.items, item))) return false;
    }
    if (typeof input === "string") {
      // JSON Schema counts Unicode code points; session budgets separately count UTF-16 units.
      const length = [...input].length;
      if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) return false;
      if (schema.pattern && !new RegExp(schema.pattern).test(input)) return false;
      if (schema.format === "date-time" && !dateTime(input)) return false;
      if (schema.format === "uuid" &&
          !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input)) return false;
    }
    if (typeof input === "number" &&
        (input < (schema.minimum ?? -Infinity) || input > (schema.maximum ?? Infinity))) {
      return false;
    }
    return true;
  }
  return check(root, value);
}

export function parseSessionStartRequest(value) {
  if (!conforms("session-start-request", value)) throw new Error("invalid_memory_input");
  return { max_tokens: 1500, max_chars: 6000, ...value };
}

// Take only the host hook's field. Never derive an identity from prompt text,
// transcript contents, another key or a model-supplied fallback.
export function optionalHostSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}(?![\s\S])/.test(value) ? value : undefined;
}

export function parsePauseState(value) {
  if (!conforms("pause-state", value)) throw new Error("invalid_reply");
  return value;
}

export function parseSessionStartResponse(value, request = { version: 1 }, limits = {}) {
  const input = parseSessionStartRequest(request);
  if (typeof limits.countTokens !== "function") throw new Error("invalid_reply");
  if (!conforms("session-start-response", value)) throw new Error("invalid_reply");
  const groups = value.groups;
  if (Object.values(groups).some((g) => g.returned !== g.items.length) ||
      groups.procedural.enabled !== groups.background.enabled ||
      Object.values(groups).reduce((n, g) => n + g.returned, 0) > 12) {
    throw new Error("invalid_reply");
  }
  if (input.project_id ? value.namespace.scope !== "project" ||
      value.namespace.projectId !== input.project_id : value.namespace.scope !== "personal") {
    throw new Error("invalid_reply");
  }
  if (limits.ownerId !== undefined && value.namespace.ownerId !== limits.ownerId) {
    throw new Error("invalid_reply");
  }
  for (const name of ["procedural", "background"]) {
    const kinds = name === "procedural" ? ["instruction", "preference"] : ["fact", "context"];
    if (groups[name].items.some((item) => !kinds.includes(item.memory.kind))) {
      throw new Error("invalid_reply");
    }
  }
  for (const item of groups.nextSteps.items) {
    if (item.nextStep.anchors.some((a) => a.end <= a.start ||
        !item.sources.some((source) => source.id === a.sourceId && source.digest === a.digest))) {
      throw new Error("invalid_reply");
    }
  }
  for (const name of ["procedural", "background"]) {
    for (const item of groups[name].items) {
      if (name === "procedural" && item.memory.kind === "preference" &&
          item.procedural?.procedural !== true) throw new Error("invalid_reply");
      const tag = item.procedural;
      if (tag && (tag.procedural ? tag.origin === null || tag.anchors.length === 0 ||
          tag.anchors.some((a) => a.end <= a.start ||
            !item.receipts.some((r) => r.id === a.receiptId)) :
          tag.origin !== null || tag.anchors.length !== 0)) throw new Error("invalid_reply");
    }
  }
  // Token counts must come from the same conservative local o200k contract.
  // Parsing never invents a tokenizer or shortens evidence to fit.
  const serialized = JSON.stringify(value);
  if (serialized.length > input.max_chars || Buffer.byteLength(serialized) > 24000 ||
      JSON.stringify(groups.background.items).length > 2000) throw new Error("invalid_reply");
  if (limits.countTokens) {
    const total = limits.countTokens(serialized);
    const background = limits.countTokens(JSON.stringify(groups.background.items));
    if (!Number.isSafeInteger(total) || total < 0 || total > input.max_tokens ||
        !Number.isSafeInteger(background) || background < 0 || background > 500) {
      throw new Error("invalid_reply");
    }
  }
  return value;
}

// Retry-After is a rate-limit delay, not evidence of a quota reset.
export function retryAfterDelay(value, now = Date.now()) {
  const day = 24 * 60 * 60 * 1000;
  const fallback = 5 * 60 * 1000;
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  let delay;
  if (/^\d+$/.test(text)) delay = Number(text) * 1000;
  else {
    const instant = Date.parse(text);
    if (!Number.isFinite(instant) || new Date(instant).toUTCString() !== text) return fallback;
    delay = instant - now;
  }
  return Math.max(1000, Math.min(day, delay));
}

export function classifyHostedReply(path, status, value, request, limits, retryAfter) {
  if (status === 429) {
    if (["/api/memory/recall", "/api/memory/capture"].includes(path) &&
        conforms(path.endsWith("recall") ? "recall-response" : "capture-response", value) &&
        value.error === "quota_reached") {
      return { status: "quota_reached", resetAt: value.resetAt ?? null };
    }
    return { status: "unavailable", code: "rate_limited", cooldownMs: retryAfterDelay(retryAfter) };
  }
  if (status === 202 && path === "/api/memory/capture" &&
      conforms("capture-response", value) && value.processing === true) {
    return { status: "processing", memoryCount: value.memoryCount };
  }
  if (status === 404 || status === 503) return { status: "unavailable" };
  if (status !== 200) return { status: "error", code: "http_error" };
  try {
    if (path === "/api/memory/session-start") {
      return { status: "complete", context: parseSessionStartResponse(value, request, limits) };
    }
    if (path === "/api/memory/recall" && conforms("recall-response", value) &&
        !Object.hasOwn(value, "error")) return { status: "complete", memories: value.memories };
    if (path === "/api/memory/capture" && conforms("capture-response", value) &&
        !Object.hasOwn(value, "error")) {
      return { status: value.processing ? "processing" : value.duplicate ? "duplicate" :
        value.memoryCount === 0 ? "empty" : "complete", memoryCount: value.memoryCount };
    }
  } catch { /* Invalid success cannot become an acknowledgement. */ }
  return { status: "error", code: "invalid_reply" };
}

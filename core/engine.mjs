import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { boundedText, fail, identifier, namespace, object } from "./validation.mjs";

const extractionPrompt = readFileSync(new URL("./prompts/extract.md", import.meta.url), "utf8");
const recallPrompt = readFileSync(new URL("./prompts/recall.md", import.meta.url), "utf8");
const kinds = ["fact", "preference", "decision", "instruction", "context"];
export const extractionSchema = {
  type: "object", additionalProperties: false, required: ["memories"], properties: {
    memories: { type: "array", maxItems: 5, items: {
      type: "object", additionalProperties: false,
      required: ["content", "kind", "confidence", "evidence_indices"], properties: {
        content: { type: "string", minLength: 1, maxLength: 600 },
        kind: { type: "string", enum: kinds },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence_indices: { type: "array", minItems: 1, maxItems: 4,
          items: { type: "integer", minimum: 0 } },
      },
    } },
  },
};
const recallSchema = { type: "object", additionalProperties: false, required: ["ids"],
  properties: { ids: { type: "array", maxItems: 12, items: { type: "string" } } } };

function captureInput(input) {
  object(input, ["client", "eventId", "sessionId", "messages"]);
  identifier(input.client); identifier(input.eventId); identifier(input.sessionId);
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 24) {
    fail("invalid_messages");
  }
  const messages = input.messages.map((message) => {
    object(message, ["id", "role", "content"]);
    identifier(message.id);
    if (!["user", "assistant"].includes(message.role)) fail("invalid_role");
    return { id: message.id, role: message.role, content: boundedText(message.content, 20_000) };
  });
  if (new Set(messages.map((m) => m.id)).size !== messages.length ||
      messages.reduce((n, m) => n + m.content.length, 0) > 24_000) fail("invalid_messages");
  return { client: input.client, eventId: input.eventId, sessionId: input.sessionId, messages };
}

function extractedItems(result, input) {
  object(result, ["memories"]);
  if (!Array.isArray(result.memories) || result.memories.length > 5) fail("invalid_model_output");
  return result.memories.map((value) => {
    object(value, ["content", "kind", "confidence", "evidence_indices"]);
    if (!kinds.includes(value.kind) || typeof value.confidence !== "number" ||
        !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
        !Array.isArray(value.evidence_indices) || value.evidence_indices.length < 1 ||
        value.evidence_indices.length > 4 || value.evidence_indices.some((index) =>
          !Number.isInteger(index) || index < 0 || index >= input.messages.length)) {
      fail("invalid_model_output");
    }
    const content = boundedText(value.content, 600);
    if (content.includes("[REDACTED]")) fail("invalid_model_output");
    const receipts = [...new Set(value.evidence_indices)].map((index) => ({
      client: input.client, sessionId: input.sessionId,
      // Include the message id in the source identity, without trusting model metadata.
      eventId: createHash("sha256").update(JSON.stringify([input.eventId, input.messages[index].id])).digest("hex"),
      role: input.messages[index].role, excerpt: input.messages[index].content,
    }));
    return { content, kind: value.kind, confidence: value.confidence, receipts };
  });
}

/** The same engine is intended for local MCP, future host adapters and hosted use. */
export function createMemoryEngine({ store, ownerId, projectId, model, timeoutMs = 30_000 }) {
  const ns = namespace({ ownerId, ...(projectId === undefined ? {} : { projectId }) });
  const memory = store.scope({ ownerId: ns.ownerId, ...(projectId === undefined ? {} : { projectId }) });
  const personal = projectId === undefined ? memory : store.scope({ ownerId: ns.ownerId });
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail("invalid_timeout");

  async function generate(task, schema, system, data, signal) {
    if (!model || typeof model.generate !== "function") fail("model_not_configured");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) fail("model_cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => model.generate({ task, schema, system,
          prompt: JSON.stringify(data), signal: controller.signal })),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("model_cancelled")), { once: true });
          timer = setTimeout(() => { reject(new Error("model_timeout")); controller.abort(); }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  return Object.freeze({
    remember: memory.remember,
    correct: memory.correct,
    forget: memory.forget,

    async capture(raw, { signal } = {}) {
      const input = captureInput(raw);
      const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const key = { client: input.client, eventId: input.eventId, digest };
      const claim = memory.claimCapture({ ...key, leaseMs: timeoutMs + 5_000 });
      if (!claim.token) return claim;
      try {
        const existing = memory.list({ limit: 10 }).map((m) => m.content.slice(0, 600));
        const result = await generate("extract", extractionSchema, extractionPrompt,
          { existing, messages: input.messages.map((m, index) => ({ index, role: m.role, content: m.content })) }, signal);
        if (signal?.aborted) fail("model_cancelled");
        return memory.finishCapture({ ...key, token: claim.token }, extractedItems(result, input));
      } catch (error) {
        memory.abandonCapture({ ...key, token: claim.token });
        throw error;
      }
    },

    async recall(query, { limit = 6, signal } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 12) fail("invalid_limit");
      if (typeof query !== "string" || query.length > 4_000) fail("invalid_query");
      if (!query.trim()) return [];
      const clean = boundedText(query, 4_000);
      const recent = [...memory.list({ limit: 40 }), ...(personal === memory ? [] : personal.list({ limit: 40 }))]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      let budget = 24_000;
      const candidates = [];
      for (const value of recent) {
        if (value.content.length > budget || candidates.length === 40) continue;
        budget -= value.content.length;
        candidates.push(value);
      }
      if (candidates.length === 0) return [];
      const result = await generate("recall", recallSchema, recallPrompt,
        { query: clean, limit, candidates: candidates.map(({ id, content }) => ({ id, content })) }, signal);
      if (signal?.aborted) fail("model_cancelled");
      object(result, ["ids"]);
      if (!Array.isArray(result.ids) || result.ids.length > 12 ||
          new Set(result.ids).size !== result.ids.length || result.ids.some((id) =>
            typeof id !== "string" || !candidates.some((candidate) => candidate.id === id))) fail("invalid_model_output");
      return result.ids.slice(0, limit).flatMap((id) => {
        const previous = candidates.find((candidate) => candidate.id === id);
        const current = (previous.scope === "personal" ? personal : memory).get(id);
        return current && current.revision === previous.revision ? [current] : [];
      });
    },
  });
}

import { countTokens as checkedTokenCount, MODEL_INPUT_TOKENS, modelRequestText } from "../capture/request-size.mjs";
import { cleanContent } from "../privacy/text.mjs";
import { compareUtf8 } from "../utf8.mjs";
import { SYS_DETECT, SYS_VERIFY } from "./amendment-prompts.mjs";
import { redactAmendmentText } from "./redaction.mjs";
import { SPACE } from "./text.mjs";

export { SYS_DETECT, SYS_VERIFY };
export { selectAmendmentsForRead, renderCardAmendments, documentCardAmendmentVisible } from "./amendment-read.mjs";

/** @import { AmendmentConversation, AmendmentCounters, CheckedChange, DetectedCardAmendment } from "./amendments.mjs" */
/** @import { DocumentCardSession, DocumentCardSourceMessage } from "../ports/document-card.d.ts" */
/** @import { ModelRequest } from "../ports/model.d.ts" */

const DEFAULT_TIMEOUT_MS = 30_000;
const VERIFY_LIMIT = 4;
const WHITESPACE = new RegExp(`${SPACE}+`, "gu");
const EDGE_WHITESPACE = new RegExp(`^${SPACE}+|(?<!${SPACE})${SPACE}+(?![\\s\\S])`, "gu");
const encoder = new TextEncoder();

/** @param {Record<string, object>} properties */
function strictObject(properties) {
  return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) };
}

const detectSchema = () => strictObject({
  changes: {
    type: "array",
    items: strictObject({ card_id: { type: "string" }, quote: { type: "string" }, new_value: { type: "string" } }),
  },
});
const verifySchema = () => strictObject({ applies: { type: "boolean" }, line: { type: "string" } });

/** @param {string} text */
const norm = (text) => text.replace(WHITESPACE, " ").replace(/^ | $/gu, "");

/** @param {string} text @param {number} size */
const prefix = (text, size) => Array.from(text).slice(0, size).join("");

/** @param {DocumentCardSession} left @param {DocumentCardSession} right */
const sameSession = (left, right) => left.client === right.client && left.sessionId === right.sessionId;

/** @param {{date: string, sessionId: string}} left @param {{date: string, sessionId: string}} right */
const sessionOrder = (left, right) => compareUtf8(left.date, right.date) || compareUtf8(left.sessionId, right.sessionId);

/** @param {ModelRequest & {input: string}} request @param {(text: string) => number} countTokens @param {number} limit */
const requestFits = ({ system, input, maxOutputTokens }, countTokens, limit) =>
  checkedTokenCount({ countTokens }, modelRequestText(system, input, maxOutputTokens)) <= Math.min(limit, MODEL_INPUT_TOKENS);

/** @param {AmendmentConversation["messages"]} messages */
function redactCaptureMessages(messages) {
  /** @type {AmendmentConversation["messages"][number][]} */
  const redacted = [];
  let index = 0;
  for (const message of messages) {
    const defaultTurn = ++index;
    if (message == null) continue;
    const { id, role, content, turn } = message;
    if (typeof id !== "string" || (role !== "user" && role !== "assistant") ||
        (turn !== undefined && typeof turn !== "number") ||
        typeof content !== "string" || cleanContent(content) !== content) continue;
    const safeContent = redactAmendmentText(content);
    if (safeContent !== null) redacted.push({ id, role, content: safeContent, turn: turn ?? defaultTurn });
  }
  return redacted;
}

/** @type {typeof import("./amendments.mjs").buildDetectRequest} */
export function buildDetectRequest({ conversation, cards, countTokens, inputLimit }) {
  const { client, sessionId, date, scope, messages } = conversation;
  return buildDetectRequestFromCapture({
    conversation: { client, sessionId, date, scope, messages: redactCaptureMessages(messages) },
    cards, countTokens, inputLimit,
  });
}

/** @type {typeof buildDetectRequest} */
function buildDetectRequestFromCapture({ conversation, cards, countTokens, inputLimit = MODEL_INPUT_TOKENS }) {
  /** @param {keyof AmendmentCounters} reason */
  const skip = (reason) => ({ request: null, listedCards: [], counters: { [reason]: 1 } });
  if (!conversation.messages.some(({ role }) => role === "user")) return skip("detect_skipped_no_user");

  const earlier = cards.flatMap(card => {
    if (!card.date || card.scope.owner !== conversation.scope.owner ||
        card.scope.namespace !== conversation.scope.namespace || sameSession(card.sourceMessage, conversation) ||
        sessionOrder({ date: card.date, sessionId: card.sourceMessage.sessionId }, conversation) >= 0) return [];
    return [{ ...card, date: card.date }];
  }).sort((a, b) => sessionOrder(
    { date: a.date, sessionId: a.sourceMessage.sessionId },
    { date: b.date, sessionId: b.sourceMessage.sessionId },
  ));
  if (!earlier.length) return skip("detect_skipped_no_earlier_cards");
  if (!Number.isSafeInteger(inputLimit) || inputLimit < 0) return skip("detect_skipped_oversize");

  const turns = conversation.messages.map(({ turn, role, content }, index) =>
    `[turn ${turn ?? index + 1}] ${role}: ${content}`);
  const header = `CONVERSATION (${conversation.date}):\n${turns.join("\n")}\n\nEARLIER DOCUMENTS:\n`;

  /** @type {import("../ports/model.d.ts").DetectChangesRequest} */
  const request = {
    system: SYS_DETECT, input: "", schema: detectSchema(),
    schemaName: "detect_changes", temperature: 0, maxOutputTokens: 900,
  };

  let blocks = "";
  let start = earlier.length;
  try {
    while (start > 0) {
      const { id, date, body } = earlier[start - 1];
      const firstLine = body.replace(EDGE_WHITESPACE, "").split("\n", 1)[0];
      const block = `[${id}] date ${date}\nfirst line: ${prefix(firstLine, 120)}\nbeginning: ${prefix(body, 300)}`;
      const next = blocks ? `${block}\n\n${blocks}` : block;
      const input = header + next;
      if (!requestFits({ ...request, input }, countTokens, inputLimit)) break;
      blocks = next;
      request.input = input;
      start--;
    }
  } catch {
    return skip("detect_skipped_token_count_unavailable");
  }
  if (start === earlier.length) return skip("detect_skipped_oversize");
  return {
    request,
    listedCards: earlier.slice(start),
    counters: start > 0 ? { detect_card_list_truncated: 1 } : {},
  };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, unknown>} value @param {string[]} required @param {string[]} [optional] */
function hasKeys(value, required, optional = []) {
  return required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}

/** @param {unknown} value @returns {value is string} */
const nonblank = (value) => typeof value === "string" && norm(value).length > 0;

/** @param {Record<string, unknown>} value @param {string} key */
function ownString(value, key) {
  if (!Object.hasOwn(value, key)) return "";
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string"
    ? descriptor.value : "";
}

/** @param {string} normalizedQuote */
function quotePattern(normalizedQuote) {
  const parts = normalizedQuote.split(" ").map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  return new RegExp(parts.join(`${SPACE}+`), "u");
}

/** @type {typeof import("./amendments.mjs").checkChangeCandidates} */
export function checkChangeCandidates({ changes, listedCards, captureMessages, captureSession }) {
  return checkChangeCandidatesFromCapture({
    changes, listedCards, captureMessages: redactCaptureMessages(captureMessages), captureSession,
  });
}

/** @type {typeof checkChangeCandidates} */
function checkChangeCandidatesFromCapture({ changes, listedCards, captureMessages, captureSession }) {
  const byId = new Map(listedCards.map(card => [card.id, card]));
  /** @type {CheckedChange[]} */
  const candidates = [];
  /** @type {ReturnType<typeof import("./amendments.mjs").checkChangeCandidates>["drops"]} */
  const drops = {};

  for (const change of changes) {
    if (!record(change) || Array.isArray(change)) {
      drops.malformed = (drops.malformed ?? 0) + 1;
      continue;
    }
    const cardId = ownString(change, "card_id");
    const quote = ownString(change, "quote");
    const value = ownString(change, "new_value");
    if (cleanContent(cardId) !== cardId || cleanContent(quote) !== quote || cleanContent(value) !== value) {
      drops.ill_formed_model_text = (drops.ill_formed_model_text ?? 0) + 1;
      continue;
    }
    // Each required field is checked above. The key count rules out extra fields.
    if (!nonblank(cardId) || !nonblank(quote) || !nonblank(value) || Reflect.ownKeys(change).length !== 3) {
      drops.malformed = (drops.malformed ?? 0) + 1;
      continue;
    }
    const card = byId.get(cardId);
    if (!card) {
      drops.unknown_card = (drops.unknown_card ?? 0) + 1;
      continue;
    }
    if (sameSession(card.sourceMessage, captureSession)) {
      drops.same_session = (drops.same_session ?? 0) + 1;
      continue;
    }
    const pattern = quotePattern(norm(quote));
    let assistantMatch = false;
    let accepted = false;
    for (const message of captureMessages) {
      const verbatimQuote = pattern.exec(message.content)?.[0];
      if (!verbatimQuote) continue;
      if (message.role === "user") {
        accepted = true;
        const newValue = redactAmendmentText(value);
        if (nonblank(newValue)) {
          candidates.push({
            card, quote: verbatimQuote, verbatimQuote, newValue,
            sourceMessage: { client: captureSession.client, sessionId: captureSession.sessionId, messageId: message.id },
          });
        } else {
          drops.redaction_unavailable = (drops.redaction_unavailable ?? 0) + 1;
        }
        break;
      }
      assistantMatch = true;
    }
    if (!accepted) {
      const reason = assistantMatch ? "quote_from_assistant" : "quote_not_verbatim";
      drops[reason] = (drops[reason] ?? 0) + 1;
    }
  }

  return { candidates, drops };
}

/** @type {typeof import("./amendments.mjs").buildVerifyRequest} */
export function buildVerifyRequest({ card, sessionDate, quote, newValue }) {
  return {
    system: SYS_VERIFY,
    input: `DOCUMENT (saved ${card.date}):\n${card.body}\n\nLATER CONVERSATION DATE: ${sessionDate}\nQUOTE: ${quote}\nNEW VALUE: ${newValue}`,
    schema: verifySchema(), schemaName: "verify_change", temperature: 0, maxOutputTokens: 400,
  };
}

/** @param {string} cardId @param {DocumentCardSourceMessage} sourceMessage @param {string} quote */
export async function amendmentId(cardId, { client, sessionId, messageId }, quote) {
  const identity = ["document-card-amendment", cardId, client, sessionId, messageId, norm(quote)];
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(identity)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {(signal: AbortSignal) => Promise<unknown>} send @param {number} timeoutMs */
async function withTimeout(send, timeoutMs) {
  const controller = new AbortController();
  const reason = new DOMException("Model deadline exceeded", "TimeoutError");
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(reason);
      controller.abort(reason);
    }, timeoutMs);
  });
  try {
    const pending = Promise.resolve().then(() => send(controller.signal));
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {unknown} error */
function isTimeout(error) {
  try {
    return error != null && typeof error === "object" &&
      (("name" in error && error.name === "TimeoutError") || ("code" in error && error.code === "model_timeout"));
  } catch {
    return false;
  }
}

/** @type {typeof import("./amendments.mjs").detectCardAmendments} */
export async function detectCardAmendments(options) {
  /** @type {AmendmentCounters} */
  const counters = {};
  /** @type {DetectedCardAmendment[]} */
  const amendments = [];
  /** @param {keyof AmendmentCounters} reason @param {number} [amount] */
  const count = (reason, amount = 1) => { counters[reason] = (counters[reason] ?? 0) + amount; };
  /** @param {keyof AmendmentCounters} reason */
  const fail = (reason) => {
    count(reason);
    return { amendments: [], counters };
  };

  /** @param {"detect" | "verify"} stage @param {unknown} usage */
  const meter = (stage, usage) => {
    if (!record(usage)) return;
    const keys = /** @type {const} */ ([["inputTokens", "input_tokens"], ["outputTokens", "output_tokens"]]);
    for (const [key, suffix] of keys) {
      const tokens = usage[key];
      if (typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0) {
        count(`${stage}_${suffix}`, tokens);
      }
    }
  };

  /** @type {"detect" | "verify"} */
  let stage = "detect";
  try {
    const { model, capture, cards, limits } = options;
    const { client, sessionId, date, scope: { owner, namespace }, messages } = capture;
    const conversation = {
      client, sessionId, date, scope: { owner, namespace },
      messages: redactCaptureMessages(messages),
    };
    let timeoutMs = limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) timeoutMs = DEFAULT_TIMEOUT_MS;
    const inputLimit = limits?.inputLimit ?? MODEL_INPUT_TOKENS;

    /** @param {"detect" | "verify"} stage @param {(signal: AbortSignal) => Promise<unknown>} send */
    const call = async (stage, send) => {
      count(`${stage}_calls`);
      try {
        return { ok: true, output: await withTimeout(send, timeoutMs) };
      } catch (error) {
        count(isTimeout(error) ? `${stage}_timeout` : `${stage}_failed`);
        return { ok: false };
      }
    };

    const detect = model?.detectChanges;
    const verify = model?.verifyChange;
    if (!model || typeof detect !== "function" || typeof verify !== "function") {
      return fail("detect_skipped_missing_model");
    }

    /** @param {string} text */
    const countTokens = text => model.countTokens(text);
    const { request, listedCards, counters: planning } = buildDetectRequestFromCapture({
      conversation, cards, countTokens, inputLimit,
    });
    Object.assign(counters, planning);
    if (!request) return { amendments, counters };

    const detected = await call("detect", signal => detect.call(model, request, { signal }));
    if (!detected.ok) return { amendments: [], counters };
    const output = detected.output;
    if (!record(output)) return fail("detect_malformed_output");
    meter("detect", output.usage);
    if (!hasKeys(output, ["changes"], ["usage"]) || !Array.isArray(output.changes)) return fail("detect_malformed_output");
    const { candidates, drops } = checkChangeCandidatesFromCapture({
      changes: output.changes, listedCards, captureMessages: conversation.messages, captureSession: conversation,
    });
    Object.assign(counters, drops);

    stage = "verify";
    const appliedQuotes = new Set();
    for (const candidate of candidates) {
      const { card, quote, verbatimQuote, newValue, sourceMessage } = candidate;
      const normalizedQuote = norm(quote);
      if (appliedQuotes.has(normalizedQuote)) {
        count("verify_skipped_quote_already_applied");
        continue;
      }
      if (counters.verify_calls === VERIFY_LIMIT) {
        count("verify_skipped_limit");
        continue;
      }

      const verifyRequest = buildVerifyRequest({ card, sessionDate: conversation.date, quote, newValue });
      let fits;
      try { fits = requestFits(verifyRequest, countTokens, inputLimit); }
      catch { return fail("verify_skipped_token_count_unavailable"); }
      if (!fits) {
        count("verify_skipped_oversize");
        continue;
      }

      const verified = await call("verify", signal => verify.call(model, verifyRequest, { signal }));
      if (!verified.ok) return { amendments: [], counters };
      const verdict = verified.output;
      if (!record(verdict)) return fail("verify_malformed_output");
      meter("verify", verdict.usage);
      if (!hasKeys(verdict, ["applies", "line"], ["usage"]) ||
          typeof verdict.applies !== "boolean" || typeof verdict.line !== "string") return fail("verify_malformed_output");
      if (!verdict.applies) {
        count("verify_rejected");
        continue;
      }

      const id = await amendmentId(card.id, sourceMessage, verbatimQuote);
      amendments.push({ cardId: card.id, amendment: {
        amendmentId: id, date: conversation.date, sentence: newValue.replace(EDGE_WHITESPACE, ""),
        sourceMessage, quote: verbatimQuote,
      } });
      appliedQuotes.add(normalizedQuote);
    }
    return { amendments, counters };
  } catch {
    return fail(`${stage}_failed`);
  }
}

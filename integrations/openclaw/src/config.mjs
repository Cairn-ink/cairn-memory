export const PLUGIN_ID = "cairn-memory";
export const DEFAULT_ENDPOINT = "https://cairn.ink";
export const TOOLS = ["cairn_recall_memory", "cairn_remember_memory", "cairn_forget_memory"];
export const OFF_SWITCH = "openclaw config set plugins.entries.active-memory.enabled false";
export const DEFAULT_TIMEOUT_MS = 5000;
export const RECALL_PROMPT = recallPrompt();
// OpenClaw recommended-setup: timeout + setup grace (setup sets 0) + 1500 ms preflight + 1500 ms settlement.
export function worstCaseBlockingMs(timeoutMs = DEFAULT_TIMEOUT_MS) { return timeoutValue(timeoutMs) + 3000; }
export function recallPrompt(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return `Turn on automatic recall? It makes one extra call to your model before each reply in direct chats, using your usage; it can add up to about ${worstCaseBlockingMs(timeoutMs) / 1000} s. [Y/n]`;
}
export const configSchema = {
  type: "object", additionalProperties: false,
  properties: {
    endpoint: { type: "string", default: DEFAULT_ENDPOINT },
    token: { type: "object", additionalProperties: false, required: ["source", "provider", "id"],
      properties: { source: { const: "file" }, provider: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
        id: { const: "value" } } },
    activeMemoryTimeoutMs: { type: "integer", minimum: 250, maximum: 120000, default: DEFAULT_TIMEOUT_MS },
  },
};
export function endpointOrigin(value) {
  try {
    if (typeof value !== "string" || !/^https?:\/\/[^/]+\/?$/.test(value) || /[\s\\?#\x00-\x1f]/u.test(value)) throw 0;
    const url = new URL(value);
    if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.port === "0" ||
        !["https:", "http:"].includes(url.protocol) ||
        (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw 0;
    return value.replace(/\/$/, "");
  } catch { throw new Error("cairn_invalid_configuration"); }
}
export function timeoutValue(value = DEFAULT_TIMEOUT_MS) {
  if (!Number.isInteger(value) || value < 250 || value > 120000) throw new Error("cairn_invalid_configuration");
  return value;
}
export function validToken(token) {
  return typeof token === "string" && /^[\x21-\x7e]+$/.test(token) && token.length <= 16384;
}
export function mergeSetup(draft, { endpoint, provider, secretPath, automatic, timeoutMs }) {
  draft.secrets ??= {};
  draft.secrets.providers ??= {};
  if (Object.hasOwn(draft.secrets.providers, provider)) throw new Error("cairn_setup_conflict");
  draft.secrets.providers[provider] = { source: "file", path: secretPath, mode: "singleValue" };
  draft.plugins ??= {};
  draft.plugins.entries ??= {};
  draft.plugins.entries[PLUGIN_ID] = { ...draft.plugins.entries[PLUGIN_ID], enabled: true,
    config: { endpoint, token: { source: "file", provider, id: "value" }, activeMemoryTimeoutMs: timeoutMs } };
  draft.agents ??= {};
  draft.agents.entries ??= {};
  draft.agents.entries.main ??= {};
  const policy = draft.agents.entries.main.tools ??= {};
  if (policy.allow !== undefined && policy.alsoAllow !== undefined) throw new Error("cairn_setup_conflict");
  const key = policy.allow !== undefined ? "allow" : "alsoAllow";
  if (policy[key] !== undefined && (!Array.isArray(policy[key]) || !policy[key].every((x) => typeof x === "string"))) {
    throw new Error("cairn_setup_conflict");
  }
  policy[key] = [...new Set([...(policy[key] ?? []), ...TOOLS])];
  const active = draft.plugins.entries["active-memory"] ?? {};
  draft.plugins.entries["active-memory"] = { ...active, enabled: automatic,
    config: { ...active.config, agents: ["main"], mode: "always", allowedChatTypes: ["direct"],
      queryMode: "message", toolsAllow: [TOOLS[0]], timeoutMs, setupGraceTimeoutMs: 0 } };
}

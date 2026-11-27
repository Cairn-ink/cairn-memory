import { createMemoryService } from "../../src/service/index.mjs";
import { hostedScope, memory, serviceFake } from "./service-fake.mjs";

export const scope = hostedScope;
export const query = "cedar cabinet";
export const kinds = ["memory", "card", "raw"];
export const options = { limit: 2, kinds, clients: ["fixture"], sinceMs: 10, untilMs: 30 };
export const unavailable = code => ({ status: "unavailable", count: 0, code, nextCursor: null });
export const skipped = { status: "not_searched", count: 0 };

export function stripCursors(result) {
  const { layers, ...items } = result;
  return { ...items, layers: Object.fromEntries(Object.entries(layers).map(([kind, { nextCursor, ...layer }]) => [kind, layer])) };
}

export function findFixture({ semantic = true, count = 6 } = {}) {
  const memories = Array.from({ length: count }, (_, i) =>
    memory(`memory-${i}`, { text: `${query} memory ${i}`, updatedAtUs: BigInt(30 - i) }));
  const fake = serviceFake({ rows: memories, recall: true, semantic, leakForgotten: true });
  const { deps, hooks, storage } = fake;
  const state = { card: 0, raw: 0, model: "query-model" };
  hooks.lexicalScore = ({ id }) => 10 - Number(id.split("-").at(-1));
  hooks.vectorDistance = ({ id }) => Number(id.split("-").at(-1)) / 20;
  const initialEmbedder = deps.embedQuery.embedQuery;
  deps.embedQuery.embedQuery = async (...args) => ({ ...await initialEmbedder(...args), model: state.model });
  const cards = Array.from({ length: count }, (_, i) => ({
    id: `card-${i}`, scope, origin: "manual", title: `Cabinet ${i}`, body: `${query} card ${i}`, date: 20,
    sourceMessage: null, sourceMemories: [],
  }));
  const raw = Array.from({ length: count }, (_, i) => ({
    ref: { type: "raw", id: `raw-${i}`, namespace: scope.namespace }, client: "fixture",
    sessionId: `source-${i}`, messageId: `message-${i}`, content: `${query} raw ${i}`, role: "user",
    occurredAtMs: 20, score: count - i,
  }));
  const refOf = ({ id }) => ({ type: "card", id, namespace: scope.namespace });
  Object.assign(storage.capabilities, { documentCards: true, documentCardSearch: true, rawArchive: true });
  storage.documentCardCandidates = {
    async lexical() {
      return { rows: cards.map((card, i) => ({ ref: refOf(card), score: count - i, updatedAtUs: BigInt(count - i) })) };
    },
    async vector() {
      return { rows: cards.map((card, i) => ({
        ref: refOf(card), distance: (count - i) / 20, updatedAtUs: BigInt(count - i),
      })), coverage: { complete: true } };
    },
    async stateToken() { return String(state.card); },
  };
  storage.documentCards = {
    async get(_tx, _scope, id) { return cards.find(card => card.id === id); },
    async visibilityInputs(_tx, _scope, refs) {
      return refs.map(({ id }) => {
        const card = cards.find(card => card.id === id);
        return card && { card, requestedScope: scope, memoryStates: new Map(), textFacts: [] };
      });
    },
  };
  storage.raw = {
    async raw(_tx, _scope, _query, _intent, { limit, offset = 0 }) {
      return { segments: raw.slice(offset, offset + limit), coverage: { complete: true },
        page: { state: String(state.raw), hasMore: offset + limit < raw.length } };
    },
  };
  return { ...fake, memories, cards, raw, state, service: createMemoryService(deps) };
}

export function takeCursors(layers) {
  return Object.fromEntries(kinds.flatMap(kind => layers[kind].nextCursor ? [[kind, layers[kind].nextCursor]] : []));
}

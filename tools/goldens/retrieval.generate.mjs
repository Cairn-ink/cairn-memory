import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const engineDir = process.env.ENGINE_DIR;
if (!engineDir) {
  console.error("Usage: ENGINE_DIR=<engine extract root> node tools/goldens/retrieval.generate.mjs");
  process.exit(2);
}

const load = name => import(pathToFileURL(resolve(engineDir, "core", "context-read-" + name + ".mjs")));
const [{ tokenizeT1, termFrequencies, TOKENIZER_VERSION, REPRESENTATION_VERSION, ENGLISH_STOPWORDS },
  { createBM25, compareCanonical }, { fuseCandidates, RRF_PRESETS, COMPACT_RRF_PRESETS }] =
  await Promise.all(["tokenize", "bm25", "fusion"].map(load));

const seed = 0x71a7;
let state = seed;
function random(upper) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state % upper;
}
function shuffle(rows) {
  const result = [...rows];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const personal = { ownerId: "owner", scope: "personal", projectId: null };
const project = { ownerId: "owner", scope: "project", projectId: "合成" };
function document(id, text, namespace = personal, type = "memory") {
  return { ref: { namespace, type, [type === "card" ? "cardId" : "memoryId"]: id }, text };
}
const sample = [
  document("\u{1f600}", "atlas tie"), document("\ue000", "atlas tie"),
  document("same", "atlas tie"), document("same", "atlas tie", project),
  document("same", "atlas tie", personal, "card"),
  document("single", "中 atlas"), document("multi", "中文人 atlas"),
  document("mixed", "ＡＴＬＡＳ中文Atlas １２ café, and THE."),
  document("empty", "the AND was I yours"),
];
const fragments = [" 中文人", " 中", " atlas", " café", " trail", " ＴＲＡＩＬ", " and", " 漢A字"];
const documents = shuffle([...sample, ...Array.from({ length: 76 }, (_, i) =>
  document("doc-" + String(i).padStart(2, "0"), "atlas" + fragments[random(8)] + fragments[random(8)],
    i % 2 ? project : personal))]);

function capture(run) {
  try {
    return { value: run() };
  } catch (error) {
    return { error: error.code ?? error.message };
  }
}
const tokens = ["", "One two TWO 21.", "中", "中文", "中文人", "中文Atlas漢A字", "ＡＴＬＡＳ １２ Café",
  "\u{20000}字|字", "e\u0301 é", "The and i WAS yours", [...ENGLISH_STOPWORDS].join(" ")]
  .map(text => {
    const { length, frequencies } = termFrequencies(text);
    return { text, tokens: tokenizeT1(text), length, frequencies: [...frequencies] };
  });
const stopwordMutations = ["add", "delete", "clear"].map(method =>
  ({ method, ...capture(() => ENGLISH_STOPWORDS[method]("the")) }));

const index = createBM25(documents);
const queryCases = [
  ["atlas", 1], ["atlas", 24], ["atlas", 25], ["atlas", 0], ["atlas", 1.5], ["atlas"],
  ["atlas tie", 24], ["中", 24], ["中文", 24], ["漢a字", 24], ["ＡＴＬＡＳ 中文 café １２", 24],
  ["café café atlas", 24], ["the and", 24], ["absent", 24],
];
const search = queryCases.map(([query, depth]) => ({ query, depth, ...capture(() => index.search(query, depth)) }));
const duplicateDocument = capture(() => createBM25([...documents, { ...documents[0], text: "other" }]));
const canonicalOrder = [...documents].sort(compareCanonical).map(doc => doc.ref);

const presets = { ...RRF_PRESETS, ...COMPACT_RRF_PRESETS };
const all = sample.concat(documents.filter(doc => !sample.includes(doc)));
const channel = (docs, source) => shuffle(docs.map(({ ref }) => ({ ref, score: 1 + random(8) / 8, source })));
const inputs = {
  lexical: channel(all.slice(0, 72), "lexical"),
  semantic: channel(all.slice(13), "semantic"),
  moc: channel(all.filter((_, i) => i % 2 === 0), "moc"),
};
const tied = sample.slice(0, 5).map(({ ref }) => ({ ref, score: 1 }));
const lookup = {
  ...inputs,
  tied: [...tied].reverse(),
  duplicate: [tied[0], tied[0]],
  noScore: [{ ref: tied[0].ref }],
  empty: [],
};
const ready = { semanticState: "ready", coverageComplete: true };
const fusion = [];
function fusionCase(name, opts, lexical = "lexical", semantic = "semantic", moc = "moc") {
  const args = opts && { ...opts, moc: lookup[moc] };
  fusion.push({ name, opts, lexical, semantic, moc,
    ...capture(() => fuseCandidates(lookup[lexical], lookup[semantic], args)) });
}
for (const [preset, config] of Object.entries(presets)) {
  const horizon = Object.hasOwn(COMPACT_RRF_PRESETS, preset) ? config.depth : 24;
  for (const limit of [1, horizon, horizon + 1]) {
    fusionCase(preset + "/" + limit, { preset, limit, ...ready });
  }
}
fusionCase("default", undefined);
fusionCase("canonical ties", { ...ready }, "tied", "empty", "empty");
fusionCase("disabled and absent semantic", { semanticState: "disabled", coverageComplete: true }, "lexical", null);
fusionCase("partial semantic state", { semanticState: "partial", coverageComplete: true });
fusionCase("ready with partial coverage", { semanticState: "ready", coverageComplete: false });
fusionCase("empty semantic channel", { ...ready }, "lexical", "empty");
fusionCase("semantic only", { ...ready }, "empty");
fusionCase("moc without semantic coverage", { preset: "rrf-k60-d12-moc-v1", coverageComplete: false }, "lexical", "noScore");
fusionCase("compact moc without semantic coverage", { preset: "rrf-k60-d64-moc-compact", coverageComplete: false });
fusionCase("duplicate lexical", { ...ready }, "duplicate");
fusionCase("missing semantic score", { ...ready }, "lexical", "noScore");
fusionCase("duplicate moc", { ...ready, preset: "rrf-k60-d12-moc-v1" }, "lexical", "semantic", "duplicate");
fusionCase("invalid preset", { ...ready, preset: "unknown-preset" });
fusionCase("invalid limit", { ...ready, limit: 1.5 });
fusionCase("zero limit", { ...ready, limit: 0 });

const golden = {
  seed, TOKENIZER_VERSION, REPRESENTATION_VERSION, stopwords: [...ENGLISH_STOPWORDS], tokens, stopwordMutations,
  documents, index: { N: index.N, totalLength: index.totalLength, avgLength: index.avgLength, df: [...index.df] },
  search, duplicateDocument, canonicalOrder, presets, channels: lookup, fusion,
};
await writeFile(new URL("../../packages/core/test/fixtures/retrieval/engine-goldens.json", import.meta.url),
  JSON.stringify(golden, null, 2) + "\n");

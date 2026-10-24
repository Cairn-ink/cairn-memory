#!/usr/bin/env node
// Offline §13 gate. No transport, credentials, subprocesses, or network clients.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative, resolve } from 'node:path';
import { engineeringStressFixtures, STRESS_SPEC } from './cap-stress-fixtures.mjs';
import { DEFAULT_SEED, canonical, sha256 } from '../generator/common.mjs';
import { answerSchema, extractionSchema, providerSchema, validateExtraction } from './schema.mjs';
import { validate } from '../scorer/schema.mjs';
import { extractionInput } from './extraction.mjs';
import { verifiedInputs } from './inputs.mjs';
import { responseRequest, OUTPUT_CAPS } from './requests.mjs';

const repo = new URL('../../../', import.meta.url);
const local = name => new URL(name, repo);
const readJSON = url => JSON.parse(readFileSync(url, 'utf8'));
const requireTokenizer = createRequire(local('adapters/openai/package.json'));
export const CAPS = OUTPUT_CAPS;
export const MINIMUM_MARGIN_PERCENT = 10;
export const meetsMargin = (tokens, cap) => tokens * 100 <= cap * (100 - MINIMUM_MARGIN_PERCENT);
export function pilotReferenceBundles() {
  const data = verifiedInputs(fileURLToPath(local('evaluation/hr3/generator/artifacts/pilot/')));
  return data.families.map(family => ({family,gold:data.gold.find(r=>r.family_id===family.family_id),support:data.support.find(r=>r.family_id===family.family_id)}));
}

// Strict output schemas specify property order. Count the compact output JSON
// itself, without a request schema, API response envelope, fence, or newline.
export function serializeOutput(schema, value) {
  assert.deepEqual(validate(schema, value), []);
  function order(s, v) {
    if (s.$ref) return order(schema.$defs[s.$ref.split('/').at(-1)], v);
    if (s.oneOf || s.anyOf) {
      const branch = (s.oneOf ?? s.anyOf).find(b => !validate({ ...b, $defs: schema.$defs }, v).length);
      assert.ok(branch, 'No matching schema branch');
      return order(branch, v);
    }
    if (s.properties) return Object.fromEntries(Object.entries(s.properties).map(([k, sub]) => [k, order(sub, v[k])]));
    if (s.items) return v.map(item => order(s.items, item));
    return v;
  }
  return JSON.stringify(order(schema, value));
}

function cleanSpan({turn_id,start,quote},input) {
  const text=input.turns.find(t=>t.turn_id===turn_id)?.text;
  assert.equal(text?.slice(start,start+quote.length),quote);
  let at=-1,occurrence=0;
  do {at=text.indexOf(quote,at+1);occurrence++;}while(at>=0&&at<start);
  assert.equal(at,start);
  return {turn_id,quote,occurrence};
}

export function extractionReference(family, ordinal) {
  const input = extractionInput(family, ordinal);
  const turns = new Set(input.turns.map(t => t.turn_id));
  const events = family.ast.events.filter(e => e.source_turns.some(t => turns.has(t))).map((event, i) => {
    // Whitelist the schema fields: omit AST-only metadata, never emit gold IDs.
    const e = Object.fromEntries(Object.keys(extractionSchema.properties.events.items.properties).map(k => [k, structuredClone(event[k])]));
    e.event_id = `e${i + 1}`;
    e.source_quotes = e.source_quotes.map(q=>cleanSpan(q,input));
    e.reason_edges = event.reason_edges.map(({ from, to, support }) => ({
      from, to, source_quotes: [...new Map(support.flat().map(q => [canonical(cleanSpan(q,input)), cleanSpan(q,input)])).values()],
    }));
    return e;
  });
  const validated=validateExtraction({events},input);
  assert.equal(validated.diagnostics.rejectedEvents,0,'Reference events must all remain valid');
  // Certificate serializes model output, not computed offsets or diagnostics.
  return {events};
}

// A reference delivery, not a simulated P/T/U/O retrieval result. Each observed
// source turn is an untruncated receipt. Both intents address the same source;
// source offsets never masquerade as delivered offsets.
export function referenceDelivery(family, batch) {
  return family.batches.filter(b => b.ordinal <= batch).flatMap(b => b.turns.flatMap((t, source) =>
    ['current', 'history'].map(intent => ({
      intent, item: b.ordinal - 1, unit: 'receipt', source, aliases: [],
      segments: [{ origin: t.turn_id, start: 0, text: t.text }], normalize: false, truncate: null,
    }))));
}

export function readerReference(bundle, batch, { graph = 'union', assertionCitations = true } = {}) {
  const { family, gold, support } = bundle;
  const g = gold.checkpoints.find(c => c.batch === batch).G_correct;
  const s = support.checkpoints.find(c => c.batch === batch);
  const answer = structuredClone({ current: g.current, old: g.old, reason: g.reason });
  const checkpoint = family.checkpoints.find(c => c.batch === batch);
  const focal = family.ast.events.find(e => e.source_turns.includes(checkpoint.focal_turn) && !e.distractor);
  const citation = (q, intent) => {
    const b = family.batches.find(b => b.turns.some(t => t.turn_id === q.turn_id));
    const source = b.turns.findIndex(t => t.turn_id === q.turn_id), text = b.turns[source].text;
    assert.equal(text.slice(q.start, q.end), q.quote);
    // Count occurrences in delivered text, including repeated source phrases.
    let at = -1, occurrence = 0;
    do { at = text.indexOf(q.quote, at + 1); occurrence++; } while (at >= 0 && at < q.start);
    assert.equal(at, q.start);
    return { intent, item: b.ordinal - 1, unit: 'receipt', source, quote: q.quote, occurrence };
  };
  const assertionCitation = (event, intent) => {
    const q = structuredClone(event.source_quotes[0]);
    // Omit separately authored rationale sentences from an assertion citation.
    const cuts = [' Confirmed condition:', ' 已確認的狀況：', ' No reason for', ' 這次變更沒有'].map(x => q.quote.indexOf(x)).filter(x => x >= 0);
    if (cuts.length) { q.quote = q.quote.slice(0, Math.min(...cuts)); q.end = q.start + q.quote.length; }
    return citation(q, intent);
  };
  if (assertionCitations) {
    const observed = family.ast.events.filter(e => !e.distractor && Date.parse(e.observed_at) <= Date.parse(checkpoint.at));
    answer.current.claims.forEach(c => {
      // Value + source-claimed interval identifies the contributing record.
      const event = observed.find(e => canonical(e.effective_interval) === canonical(c.valid) && e.claims.some(a => a.field === 'value' && canonical(a.value) === canonical(c.value))) ?? focal;
      const sources = family.change_type === 'refinement' ? [observed[0], event] : [event];
      c.citations = [...new Set(sources)].map(e => assertionCitation(e, 'current'));
    });
    answer.old.records.forEach((record, i) => {
      const anchor = focal.predecessor_anchors[i];
      const event = observed.find(e => e.source_turns.includes(anchor.source_turn));
      const sources = family.change_type === 'refinement' ? [observed[0], event] : [event];
      record.claims.forEach(c => { c.citations = [...new Set(sources)].map(e => assertionCitation(e, 'history')); });
    });
  }
  const selected = graph === 'union' ? s.acceptedGraphs : s.acceptedGraphs.slice(graph, graph + 1);
  const edges = [...new Map(selected.flatMap(g => g.edges).map(e => [`${e.from}:${e.to}`, e])).values()];
  if (graph !== 'union' && edges.length) {
    const ids = new Set(edges.flatMap(e => [e.from, e.to]));
    answer.reason.nodes = answer.reason.nodes.filter(n => ids.has(n.id));
  }
  answer.reason.edges = edges.map(e => ({ from: e.from, to: e.to,
    citations: e.support[0].map(q => citation(q, 'history')) }));
  assert.deepEqual(validate(answerSchema, answer), []);
  assert.deepEqual(answer.current.claims.map(c => ({ ...c, citations: [] })), g.current.claims);
  assert.deepEqual(answer.old.records.map(r => ({ ...r, claims: r.claims.map(c => ({ ...c, citations: [] })) })), g.old.records);
  return answer;
}

function dimensions(operation, value) {
  const claims = operation === 'reader' ? [...value.current.claims, ...value.old.records.flatMap(r => r.claims), ...value.reason.nodes.map(n => n.claim)] : value.events.flatMap(e => e.reason_nodes.map(n => n.claim));
  const reasons = operation === 'reader' ? [value.reason] : value.events.map(e => ({ nodes: e.reason_nodes, edges: e.reason_edges }));
  return {
    currentClaims: value.current?.claims.length ?? 0, oldRecords: value.old?.records.length ?? 0,
    oldClaims: value.old?.records.reduce((n, r) => n + r.claims.length, 0) ?? 0,
    events: value.events?.length ?? 0,
    assignments: value.events?.reduce((n, e) => n + e.claims.length, 0) ?? 0,
    predecessors: value.events?.reduce((n, e) => n + e.predecessor_anchors.length, 0) ?? 0,
    reasonNodes: reasons.reduce((n, r) => n + r.nodes.length, 0),
    reasonEdges: reasons.reduce((n, r) => n + r.edges.length, 0),
    maxQualifiersPerClaim: Math.max(0, ...claims.map(c => c.qualifiers.length)),
    maxAssignmentsPerEvent: Math.max(0, ...(value.events ?? []).map(e => e.claims.length)),
    maxPredecessorsPerEvent: Math.max(0, ...(value.events ?? []).map(e => e.predecessor_anchors.length)),
    citations: claims.reduce((n, c) => n + c.citations.length, 0) + reasons.reduce((n, r) => n + r.edges.reduce((m, e) => m + (e.citations?.length ?? 0), 0), 0),
    sourceQuotes: value.events?.reduce((n, e) => n + e.source_quotes.length + e.reason_edges.reduce((m, edge) => m + edge.source_quotes.length, 0), 0) ?? 0,
  };
}

function provenance() {
  const freeze = readJSON(local('evaluation/hr3/generator/freeze.json'));
  const SOURCE_NAMES = Object.keys(freeze.hashes).filter(name => !name.startsWith('artifacts/'));
  for (const name of SOURCE_NAMES) assert.equal(sha256(readFileSync(local(`evaluation/hr3/generator/${name}`))), freeze.hashes[name].sha256, `Generator freeze mismatch: ${name}`);
  const names = [
    'evaluation/hr3/protocol/protocol-v0.3.4.md', 'evaluation/hr3/protocol/errata.md',
    'evaluation/hr3/generator/freeze.json', ...SOURCE_NAMES.map(n => `evaluation/hr3/generator/${n}`),
    ...['schema.mjs', 'requests.mjs', 'inputs.mjs', 'extraction.mjs', 'cap-certification.mjs', 'cap-stress-fixtures.mjs', 'reports/inspected-heldout-references.json', 'reports/cap-certification-a2-pre-cap-revision.json'].map(n => `evaluation/hr3/harness/${n}`),
    ...['schema.mjs', 'canonical.mjs', 'citations.mjs', 'scorer.mjs'].map(n => `evaluation/hr3/scorer/${n}`),
  ];
  assert.equal(sha256(readFileSync(local(names[0]))), freeze.protocol_sha256);
  const errata = readFileSync(local(names[1]), 'utf8');
  const amendment = errata.indexOf('## A-2 (2026-10-25):');
  assert.ok(amendment > 0, 'A-2 amendment missing');
  assert.equal(sha256(errata.slice(0, amendment).trimEnd() + '\n'), freeze.errata_sha256, 'Pre-A-2 errata changed');
  const revision=errata.indexOf('### A-2 cap revision after the engineering stress certificate');
  assert.ok(revision>amendment,'Engineering-stress cap revision missing');
  assert.match(errata.slice(revision), /2,176/);
  assert.match(errata.slice(revision), /4,352/);
  assert.match(errata.slice(amendment), /10%/);
  return Object.fromEntries(names.map(name => [name, sha256(readFileSync(local(name)))]));
}

export function certify({ progress = () => {} } = {}) {
  const sources = provenance();
  for (const operation of ['reader', 'extraction']) assert.equal(responseRequest(operation, {}).max_output_tokens, CAPS[operation]);
  const tokenizerPackage = readJSON(local('adapters/openai/node_modules/tiktoken/package.json'));
  const { get_encoding } = requireTokenizer('tiktoken');
  const encoding = get_encoding('o200k_base');
  const cohorts = [{split:'pilot',bundles:pilotReferenceBundles()},{split:STRESS_SPEC.split,bundles:engineeringStressFixtures()}];
  const inspected = readJSON(new URL('./reports/inspected-heldout-references.json',import.meta.url));
  assert.equal(inspected.errataSHA256,sources['evaluation/hr3/protocol/errata.md']);
  const groups = new Map(), counts = [], pilotReferences = [], summary = [];
  const maxima = { reader: {}, extraction: {} };
  let firstFailure = null;
  function measure(operation, value, metadata) {
    const schema = providerSchema(operation === 'reader' ? answerSchema : extractionSchema);
    const serialization = serializeOutput(schema, value);
    const tokens = encoding.encode(serialization, [], []).length;
    const row = { ...metadata, operation, tokens, cap: CAPS[operation], margin: CAPS[operation] - tokens,
      withinCap: tokens <= CAPS[operation], marginPercent: (CAPS[operation] - tokens) / CAPS[operation] * 100,
      pass: meetsMargin(tokens, CAPS[operation]), dimensions: dimensions(operation, value), sha256: sha256(serialization), serialization };
    for (const [k, v] of Object.entries(row.dimensions)) maxima[operation][k] = Math.max(maxima[operation][k] ?? 0, v);
    const key = [metadata.split, operation, metadata.changeType, metadata.causalClass, metadata.batch, metadata.variant].join('/');
    const prev = groups.get(key);
    if (!prev) groups.set(key, { structure: key, cases: 1, failures: Number(!row.pass), worst: row });
    else { prev.cases++; prev.failures += Number(!row.pass); if (tokens > prev.worst.tokens) prev.worst = row; }
    if (!row.pass && !firstFailure) { firstFailure = { ...metadata, operation, tokens, cap: CAPS[operation], margin: row.margin }; progress(`STOP gate: ${operation} reference fails A-2's 10% margin (${tokens} tokens, cap ${CAPS[operation]}). Completing offline failure evidence only.`); }
    return row;
  }
  try {
    for (const {split,bundles} of cohorts) {
      progress(`Certifying ${split}: ${bundles.length} references; no held-out generation`);
      counts.push({split,lineages:new Set(bundles.map(b=>b.family.lineage_id)).size,families:bundles.length,checkpoints:bundles.length*2,extractionBatches:bundles.length*4});
      let completed=0;
      for (const bundle of bundles) {
        const {family,gold,support}=bundle;
        const metadata = { split, familyId: family.family_id, language: family.language, changeType: family.change_type, causalClass: family.causal_class };
        for (const checkpoint of family.checkpoints) {
          const full = measure('reader', readerReference(bundle, checkpoint.batch), { ...metadata, batch: checkpoint.batch, variant: 'supported_union' });
          if (split === 'pilot') pilotReferences.push(full);
          const graphs = support.checkpoints.find(c => c.batch === checkpoint.batch).acceptedGraphs;
          // Also prove whether complete individual accepted graphs fit without
          // optional C/O citations or nodes belonging only to alternative paths.
          for (let i = 0; i < Math.max(1, graphs.length); i++) measure('reader', readerReference(bundle, checkpoint.batch, { graph: i, assertionCitations: false }), { ...metadata, batch: checkpoint.batch, variant: `required_graph_${i + 1}` });
        }
        for (const batch of family.batches) measure('extraction', extractionReference(family, batch.ordinal), { ...metadata, batch: batch.ordinal, variant: 'all_explicit_events' });
        if (++completed % 200 === 0) progress(`${split}: validated/tokenized ${completed}/${bundles.length} families`);
      }
      for (const operation of ['reader', 'extraction']) for (const variant of operation === 'reader' ? ['supported_union', 'required_graph'] : ['all_explicit_events']) {
        const relevant = [...groups.values()].filter(g => g.worst.split === split && g.worst.operation === operation && g.worst.variant.startsWith(variant));
        const worst = relevant.map(g => g.worst).sort((a, b) => b.tokens - a.tokens)[0];
        summary.push({ split, operation, variant, cases: relevant.reduce((n, g) => n + g.cases, 0), failures: relevant.reduce((n, g) => n + g.failures, 0), tokens: worst.tokens, cap: worst.cap, margin: worst.margin, marginPercent: worst.marginPercent, pass: relevant.every(g => g.failures === 0), worstStructure: relevant.find(g => g.worst === worst).structure, familyId: worst.familyId });
      }
      progress(`Finished ${split}`);
    }
    const structures = [...groups.values()].sort((a, b) => a.structure.localeCompare(b.structure, 'en'));
    const gates = Object.fromEntries(['reader', 'extraction'].map(operation => {
      const rows = structures.filter(g => g.worst.operation === operation);
      const worst = rows.map(g => g.worst).sort((a, b) => b.tokens - a.tokens)[0];
      return [operation, { pass: rows.every(r => !r.failures), cap: CAPS[operation], worstTokens: worst.tokens, margin: worst.margin, marginPercent: worst.marginPercent, worstStructure: rows.find(g => g.worst === worst).structure, familyId: worst.familyId }];
    }));
    const historicalDominance=Object.fromEntries(['reader','extraction'].map(operation=>{
      const stressWorst=Math.max(...structures.filter(g=>g.worst.operation===operation&&g.worst.split===STRESS_SPEC.split).map(g=>g.worst.tokens));
      assert.ok(stressWorst>=inspected.previousWorstTokens[operation],`Engineering ${operation} must dominate the historical bound`);
      return [operation,{previousWorstTokens:inspected.previousWorstTokens[operation],engineeringWorstTokens:stressWorst,dominates:true}];
    }));
    return {
      version: 'hr3-cap-certification-a2-audited', protocol: 'v0.3.4 + E-1/E-2/A-1/A-2', seed: DEFAULT_SEED,
      status: Object.values(gates).every(g => g.pass) ? 'PASS' : 'FAIL_AMENDMENT_REQUIRED',
      minimumMarginPercent: MINIMUM_MARGIN_PERCENT, historicalDominance, stressSpec:STRESS_SPEC,
      inspectedHeldOutManifest:{path:'evaluation/hr3/harness/reports/inspected-heldout-references.json',sha256:sources['evaluation/hr3/harness/reports/inspected-heldout-references.json']},
      historicalReport: { path: 'evaluation/hr3/harness/reports/cap-certification.json', sha256: sha256(readFileSync(new URL('./reports/cap-certification.json', import.meta.url))) },
      paidWorkAllowedByThisGate: Object.values(gates).every(g => g.pass), firstFailure, gates,
      method: {
        scope: 'Frozen pilot references plus independent engineering stress fixtures. No development/test rendering or generation imports; no unbounded-schema or future-bank claim.',
        serialization: 'Compact JSON in strict provider schema property order, literal Unicode, no trailing newline or envelope; count output text only.',
        tokenizer: { encoding: 'o200k_base', package: 'tiktoken', version: tokenizerPackage.version, installation: 'adapters/openai/node_modules/tiktoken', entrySHA256: sha256(readFileSync(requireTokenizer.resolve('tiktoken'))), wasmSHA256: sha256(readFileSync(local('adapters/openai/node_modules/tiktoken/tiktoken_bg.wasm'))) },
        requiredGraph: 'Every accepted graph separately, incident nodes only, required directed-edge source citations, no optional current/old citations. Unstated retains its exact empty gold structure.',
        supportedUnion: 'All gold current claims, requested old records, qualifiers and reason nodes; union of all supported accepted graphs, exact edge citations and assertion citations. Refinement cites both inherited fields and amendment.',
        extraction: 'Every explicit focal/distractor AST event per independent batch; schema field whitelist; local event IDs; all reason nodes/edges and frozen verbatim source quotes. No control actions: controls are outside extractionInput.',
        validation: 'Frozen pilot/source hashes; independently constructed engineering fixtures respect grammar cardinalities and source byte guards; every output passes provider schema and extraction provenance/quote validator; exact C/O gold preservation; citation addresses/occurrences derived from observed source receipts.',
        allocationCrossCheck: { routes: ['verified frozen pilot rows + explicit stress Cartesian product', 'cohort family/lineage identifiers and reference counts'], families: counts.reduce((n, c) => n + c.families, 0) },
        limits: [
          'Schemas have no maxItems/maxLength: no finite maximum over all schema-valid spellings, redundant citations, equivalent scope partitions, identifiers, or whitespace. These are grammar-derived reference structures, without artificial padding.',
          'Development/test R3 expiry banks are provisional; fresh semantic banks are still required by the existing pre-development gate. Changed banks/allocation/schemas require recertification.',
          'Reference receipts validate serialization/support addresses only; they make no claim about actual arm retrieval, support preservation, or paid readiness.',
          'A-1 retains this non-adjudication preflight gate. Any failure requires a cap/budget/design amendment before paid work. No fields, edges, qualifiers or predecessor records were removed to fit.',
        ],
      },
      derivation: {
        authority: ['protocol §2/§6/§7/§9/§10/§13', 'errata E-1/E-2/A-1/A-2', 'generator inventory.mjs GRAMMAR/SPLITS', 'generator generate.mjs frozen source bounds (hashed only, never imported)', 'harness extractionSchema; scorer answerSchema'],
        sourceBounds: { batchesPerFamily: 4, checkpoints: [2, 4], audienceCells: 12, initialCap: [100, 899], amendedCap: [120, 939], baseDay: [1, 15], byteGuards: {batchSourceBytes:STRESS_SPEC.bounds.batchSourceBytes,familySourceBytes:STRESS_SPEC.bounds.familySourceBytes} },
        reasoning: [
          'Scope change has two current groups and at checkpoint four requests A and B: two historical records. Other changes request one predecessor; expiry has zero current claims.',
          'Correction uses route+approval; other full records use route+approval+cap. Refinement patches cap only and inherits route+approval; answers preserve two qualifiers.',
          'Direct/unstated/serial-2/serial-3/conjunctive/alternative classes require respectively 1/0/2/3/3/4 union edges and 2/0/3/4/4/5 nodes. E-1 deadline expiry adds the trigger alternative, giving 3 nodes and 2 union edges in the frozen direct-expiry allocation.',
          'Each batch contains six explicit distractor events plus at most one focal event. Initial expiry batch three also has seven; idle batches have six. At most three assignments and two predecessor anchors per focal event.',
          'No Range value, 12 distinct current values, arbitrary DNF expansion, control assertion, or additional old record is required by this grammar. Such invented combinations are not used as maxima.',
        ], observedMaxima: maxima,
      }, sources, counts, summary, structures, pilotReferences,
    };
  } finally { encoding.free(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Only the fixed harness report is writable through this CLI.
  assert.equal(process.argv.length, 2, 'No CLI arguments supported');
  const report = certify({ progress: message => process.stderr.write(message + '\n') });
  const output = new URL('./reports/cap-certification-a2.json', import.meta.url);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(readJSON(output), report);
  process.stdout.write(JSON.stringify({ status: report.status, gates: report.gates, summary: report.summary, report: relative(fileURLToPath(repo), fileURLToPath(output)) }, null, 2) + '\n');
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

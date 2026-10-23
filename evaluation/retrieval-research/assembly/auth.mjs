import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CATEGORIES, compareIds, eligibleMemory, atScale } from '../lib/fixture.mjs';

export const PROTOCOL = 'HR-2 v1.1';
export const PROTOCOL_COMMIT = 'c863e9d674f23ccebffaf3ad96ab1c4b34eabc82';
export const FILES = Object.freeze(['hr1-facts.json', 'hr1-corpus.json', 'hr1-facts-view.json', 'hr1-queries.json', 'hr1-split.json', 'hr1-labels.json', 'hr1-label-audit.json']);
export const RANKINGS = Object.freeze({
  A1: { arm: 'A1', config: 'BM25-T1', model: null, lexical: null, member: 'with-foreign/base-S1000/A1.json', dev: 'lexical-S1000/A1.json' },
  'A3--bge-m3': { arm: 'A3', config: 'A3', model: 'bge-m3', lexical: 'A1', member: 'with-foreign/local-S1000/A3--bge-m3.json', dev: 'local-S1000/A3--bge-m3.json' },
  'F-RRF10--openai-3-small': { arm: 'F-RRF10', config: 'F-RRF10', model: 'openai-3-small', lexical: 'A1', member: 'with-foreign/hosted-S1000/F-RRF10--openai-3-small.json', dev: 'hosted-S1000/F-RRF10--openai-3-small.json' },
});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function fail(code) { throw new Error(code); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function frozenHashes(markdown) {
  const pairs = [...markdown.matchAll(/\| `([^`]+\.json)` \| `([a-f0-9]{64})` \|/g)].map(match => [match[1], match[2]]);
  if (pairs.length !== 7 || !same(pairs.map(([name]) => name).sort(compareIds), [...FILES].sort(compareIds))) fail('frozen_manifest_files');
  return Object.fromEntries(pairs);
}

// Hash every fixture file, but parse no labels, facts or evidence annotations.
export async function authenticateFixture(dir) {
  const expected = frozenHashes(await readFile(join(dir, 'FROZEN.md'), 'utf8'));
  const bytes = {}, hashes = {};
  for (const name of FILES) {
    bytes[name] = await readFile(join(dir, name)); hashes[name] = sha256(bytes[name]);
    if (hashes[name] !== expected[name]) fail(`fixture_hash_mismatch:${name}`);
  }
  return { hashes, corpus: JSON.parse(bytes['hr1-corpus.json']), queries: JSON.parse(bytes['hr1-queries.json']), split: JSON.parse(bytes['hr1-split.json']) };
}

export function selectedQueries(fixture, split, scored = true) {
  return fixture.queries.queries.filter(query => fixture.split[query.family] === split && (!scored || CATEGORIES.includes(query.category))).sort((a, b) => compareIds(a.id, b.id));
}

export function authenticateRanking(fixture, ranking, { selection, split, scale }) {
  const expected = RANKINGS[selection], run = ranking?.run;
  if (!expected || !['test', 'dev'].includes(split) || scale !== 'S1000') fail('invalid_input_selection');
  if (ranking?.format !== 'hr1-rankings-v1' || !run || !ranking.queries || Array.isArray(ranking.queries)) fail('rankings_format');
  if (run.split !== split) fail('rankings_split');
  if (run.scale !== scale) fail('rankings_scale');
  for (const key of ['arm', 'model', 'config', 'lexical']) if (run[key] !== expected[key]) fail(`rankings_configuration:${key}`);
  if (run.status !== 'complete' || run.store != null) fail('rankings_incomplete');
  if (!same(Object.keys(run.fixtureHashes ?? {}).sort(compareIds), [...FILES].sort(compareIds))) fail('rankings_fixture_hash_set');
  for (const name of FILES) if (run.fixtureHashes[name] !== fixture.hashes[name]) fail(`rankings_fixture_hash_mismatch:${name}`);
  // HR-1 files contain C8 and FOREIGN diagnostics too. Require the entire
  // frozen split so no dropped scored query can be hidden by filtering.
  const queries = selectedQueries(fixture, split, false);
  if (!same(Object.keys(ranking.queries).sort(compareIds), queries.map(query => query.id))) fail('rankings_query_set');
  const memories = new Map(fixture.corpus.memories.map(memory => [memory.id, memory]));
  for (const query of queries) {
    const ranked = ranking.queries[query.id]?.ranked;
    if (!Array.isArray(ranked) || ranked.length > 24 || ranked.some(id => typeof id !== 'string') || new Set(ranked).size !== ranked.length) fail(`invalid_ranking:${query.id}`);
    for (const id of ranked) {
      const memory = memories.get(id);
      if (!memory) fail(`unknown_memory:${id}`);
      if (memory.namespace !== 'target') fail(`target_namespace:${id}`);
      if (!atScale(memory, scale) || !eligibleMemory(memory, query.intent)) fail(`ineligible_memory:${id}`);
    }
  }
  return selectedQueries(fixture, split);
}

export async function inputManifest() {
  const markdown = await readFile(new URL('./INPUTS.md', import.meta.url), 'utf8');
  const match = markdown.match(/```json\n([\s\S]*?)\n```/);
  if (!match) fail('hr2_manifest_missing');
  return JSON.parse(match[1]);
}

export function authenticateMember(bytes, member, manifest) {
  const hash = sha256(bytes);
  if (hash !== manifest.members?.[member]) fail(`ranking_member_hash_mismatch:${member}`);
  return hash;
}

export async function readRanking(dir, selection, split) {
  const expected = RANKINGS[selection];
  if (!expected) fail('invalid_ranking_selection');
  // Accept the extraction root or its with-foreign directory explicitly.
  const relative = split === 'dev' ? expected.dev : expected.member;
  let bytes, path = join(dir, relative);
  try { bytes = await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || split !== 'test') throw error;
    path = join(dir, relative.slice('with-foreign/'.length)); bytes = await readFile(path);
  }
  const hash = sha256(bytes);
  if (split === 'test') {
    const manifest = await inputManifest();
    authenticateMember(bytes, expected.member, manifest);
  }
  return { ranking: JSON.parse(bytes), path, hash, member: relative };
}

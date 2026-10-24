// W1-only comparison. No W2/W3 product or retained validation file is opened.
// Invoked by check-world.mjs; importing this helper does not render anything.
import { openSync, closeSync, unlinkSync, fstatSync, readSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const ROOT = fileURLToPath(new URL('../',import.meta.url));
export const REPO = fileURLToPath(new URL('../../../../',import.meta.url));
export const PREFIX = 'evaluation/retrieval-research/fixtures-hr2b/';
// An explicit allowlist also protects whitespace/inventory reads this round.
export const OWNED_FILES = [
  'README.md','W1-REPORT.md','build/build-world.mjs','build/check-identity.mjs',
  'build/check-world.mjs','build/config.mjs','build/development-diagnostics.json',
  'build/distractors.mjs','build/filler.mjs','build/foreign.mjs','build/source.mjs',
  'build/targets.mjs','build/world-stats.json','hr1-corpus.json','hr1-facts.json',
].sort();

export function gitText(args) {
  const scratch = join(ROOT,'build/.w1-git.tmp'), fd = openSync(scratch,'wx+');
  unlinkSync(scratch); // Do not enumerate a transient capture as a deliverable.
  try {
    const child = spawnSync('git',['--no-optional-locks',...args],{cwd:REPO,stdio:['ignore',fd,'inherit']});
    if (child.error || child.status !== 0) throw new Error(`git_failed:${child.status}:${child.error?.message ?? child.signal}`);
    const bytes = Buffer.alloc(fstatSync(fd).size);
    for (let offset = 0; offset < bytes.length;) {
      const read = readSync(fd,bytes,offset,bytes.length-offset,offset);
      if (!read) throw new Error('git_capture_short_read');
      offset += read;
    }
    return bytes.toString('utf8');
  } finally { closeSync(fd); }
}
export const headBytes = name => gitText(['show',`HEAD:${PREFIX}${name}`]);
const sorted = items => [...items].sort((a,b)=>a.id.localeCompare(b.id,'en'));
const factPlan = corpus => sorted(corpus.memories).map(memory=>({id:memory.id,facts:memory.expresses.map(expression=>expression.fact).sort()}));

export function checkIdentity(allocation) {
  const beforeBytes = headBytes('hr1-facts.json'), afterBytes = readFileSync(join(ROOT,'hr1-facts.json'),'utf8');
  const before = JSON.parse(beforeBytes), after = JSON.parse(afterBytes);
  const previous = JSON.parse(headBytes('build/world-stats.json')).generation.placementAllocation;
  const baselineCorpus = JSON.parse(headBytes('hr1-corpus.json'));
  const corpus = JSON.parse(readFileSync(join(ROOT,'hr1-corpus.json'),'utf8'));
  const fields = [], comparisons = {};
  function compare(field,a,b) { comparisons[field] = isDeepStrictEqual(a,b);if(!comparisons[field]) fields.push(field); }
  const oldFacts = sorted(before.facts), newFacts = sorted(after.facts);
  compare('facts.ids',oldFacts.map(fact=>fact.id),newFacts.map(fact=>fact.id));
  compare('families',sorted(before.families),sorted(after.families));
  for (const field of [...new Set([...oldFacts,...newFacts].flatMap(fact=>Object.keys(fact)))].sort())
    compare(`facts.${field}`,oldFacts.map(fact=>[fact.id,fact[field]]),newFacts.map(fact=>[fact.id,fact[field]]));
  compare('facts.forbiddenLexicon',before.forbiddenLexicon,after.forbiddenLexicon);
  compare('generation.placementAllocation',previous,allocation);
  compare('factToMemoryPlan',factPlan(baselineCorpus),factPlan(corpus));
  const unchangedSources = ['build/build-world.mjs','build/targets.mjs','build/distractors.mjs','build/foreign.mjs','build/filler.mjs','build/source.mjs'];
  for (const name of unchangedSources) compare(name,headBytes(name),readFileSync(join(ROOT,name),'utf8'));
  const stripReceipts = source => source.replace(/^export const RECEIPT_COUNTS = .*$/mu,'RECEIPT_COUNTS:amended');
  compare('config.exceptReceiptCounts',stripReceipts(headBytes('build/config.mjs')),stripReceipts(readFileSync(join(ROOT,'build/config.mjs'),'utf8')));
  const role = new Map(before.families.map(family=>[family.id,family.role])), factMap = new Map(before.facts.map(fact=>[fact.id,fact]));
  const placementDifferences = [...new Set([...Object.keys(previous),...Object.keys(allocation)])].sort().filter(id=>previous[id]!==allocation[id])
    .map(id=>({fact:id,role:role.get(factMap.get(id)?.family),before:previous[id] ?? null,after:allocation[id] ?? null}));
  const placementDifferencesByRole = Object.fromEntries(['target','distractor','foreign'].map(role=>[role,placementDifferences.filter(row=>row.role===role).length]));
  return {ok:fields.length===0,baselineCommit:gitText(['rev-parse','HEAD']).trim(),differingFields:fields,
    factsByteIdentical:beforeBytes===afterBytes,factCount:after.facts.length,familyCount:after.families.length,
    placementFacts:Object.keys(allocation).length,placementDifferencesByRole,comparisons,placementDifferences};
}
export function identityOutput(result) {
  const {ok,baselineCommit,differingFields,factsByteIdentical,factCount,familyCount,placementFacts,placementDifferencesByRole} = result;
  return {ok,baselineCommit,differingFields,factsByteIdentical,factCount,familyCount,placementFacts,placementDifferencesByRole};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const allocation = JSON.parse(readFileSync(join(ROOT,'build/world-stats.json'),'utf8')).generation.placementAllocation;
  const result = checkIdentity(allocation);console.log(JSON.stringify(identityOutput(result)));process.exitCode = result.ok?0:1;
}

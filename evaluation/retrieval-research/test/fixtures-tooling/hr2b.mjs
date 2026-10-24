import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HR2B_VERSION, writeJson } from '../../lib/fixture.mjs';
import { buildLabels } from '../../tools/labels.mjs';
import { factsView } from '../../tools/facts-view.mjs';
import { tokenizers } from './toy.mjs';
import { FILES, sha256 } from '../../assembly/auth.mjs';
import { hr2bConfiguration } from '../../lib/hr2b-configuration.mjs';
import { calibration } from '../../assembly/calibrate-host-v2.mjs';

export async function freeze(dir, names) {
  const pairs = [];
  for (const name of names) pairs.push([name, sha256(await readFile(join(dir, name)))]);
  await writeFile(join(dir, 'FROZEN.md'), '| File | SHA-256 |\n| --- | --- |\n' + pairs.map(([name, hash]) => `| \`${name}\` | \`${hash}\` |`).join('\n') + '\n');
  return Object.fromEntries(pairs);
}
export async function hr2bToy(workspace) {
  const dir = join(workspace.path, 'fixture'), rankingsDir = join(workspace.path, 'rankings');
  await mkdir(dir); await mkdir(rankingsDir);
  const fixture = { facts: { version: HR2B_VERSION, families: [], facts: [] }, corpus: { version: HR2B_VERSION, memories: [] },
    queries: { version: HR2B_VERSION, queries: [] }, split: {}, labels: null, audit: { overrides: [] }, hashes: {} };
  for (const split of ['dev', 'test']) for (let i = 0; i < (split === 'dev' ? 12 : 14); i++) {
    const family = `${split}-f${i}`;
    fixture.facts.families.push({ id: family, role: 'target', domain: 'engineering', summary: family });
    fixture.split[family] = split;
    const requiredFacts = [];
    for (const placement of ['body', 'first-receipt', 'later-receipt']) for (let j = 0; j < 3; j++) {
      const fact = `${family}-${placement}-${j}`, id = `m-${fact}`;
      fixture.facts.facts.push({ id: fact, family, kind: 'fact', state: 'current', statementLang: 'en', statement: 'KEY', eventTime: '2026-01-01T00:00:00Z',
        rendered: true, coverage: placement === 'body' ? 'body' : 'span-only', supersedes: null, reasonFor: null, nearDuplicateOf: null, entities: ['KEY'] });
      fixture.corpus.memories.push({ id, namespace: 'target', scale: 'S300', lang: 'en', state: 'current', content: 'KEY note',
        spans: [1, 2].map(n => ({ id: `${id}#s${n}`, role: 'user', eventTime: `2026-01-01T00:00:0${n}Z`, text: 'KEY receipt' })),
        expresses: [{ fact, where: placement === 'body' ? 'body' : 'span', span: placement === 'body' ? null : `${id}#s${placement === 'first-receipt' ? 1 : 2}` }] });
      requiredFacts.push(fact);
    }
    fixture.queries.queries.push({ id: `q-${family}`, family, category: 'C1', lang: 'en', intent: 'current', text: 'KEY', keyTerm: 'KEY', note: 'toy', secondaryTags: [], requiredFacts });
  }
  fixture.labels = buildLabels(fixture, tokenizers);
  const documents = { 'hr1-facts.json': fixture.facts, 'hr1-corpus.json': fixture.corpus, 'hr1-facts-view.json': factsView(fixture),
    'hr1-queries.json': fixture.queries, 'hr1-split.json': fixture.split, 'hr1-labels.json': fixture.labels, 'hr1-label-audit.json': fixture.audit };
  for (const [name, value] of Object.entries(documents)) await writeJson(join(dir, name), value);
  fixture.hashes = await freeze(dir, FILES);
  const configuration = hr2bConfiguration(fixture.hashes);
  await writeJson(join(rankingsDir, 'configuration.json'), configuration);
  await writeJson(join(rankingsDir, 'host-v2-calibration.json'), calibration({ bodies: [4], receipts: [3], counts: [2], itemCounts: [1] }));
  const members = ['configuration.json', 'host-v2-calibration.json'];
  for (const split of ['dev', 'test']) {
    await mkdir(join(rankingsDir, split));
    for (const selection of ['A1', 'A3--bge-m3']) {
      const member = `${split}/${selection}.json`;
      await writeJson(join(rankingsDir, member), { format: 'hr1-rankings-v1', run: { arm: selection === 'A1' ? 'A1' : 'A3',
        model: selection === 'A1' ? null : 'bge-m3', config: selection === 'A1' ? 'BM25-T1' : 'A3', lexical: selection === 'A1' ? null : 'A1',
        split, scale: 'S1000', fixtureVersion: HR2B_VERSION, fixtureHashes: fixture.hashes, configuration, store: null,
        status: 'complete', isolationVariant: 'with-foreign' }, queries: Object.fromEntries(fixture.labels.queries.filter(label => label.split === split).map(label =>
        [label.id, { ranked: label.groups.flatMap(group => group.members.map(member => member.memory)) }])) });
      members.push(member);
    }
  }
  await freeze(rankingsDir, members);
  return { fixture, dir, rankingsDir };
}

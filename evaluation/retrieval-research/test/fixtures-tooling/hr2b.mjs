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
export async function hr2bToy(workspace, { devFamilies = 12, categoryFor = () => 'C1' } = {}) {
  const dir = join(workspace.path, 'fixture'), rankingsDir = join(workspace.path, 'rankings');
  await mkdir(dir); await mkdir(rankingsDir);
  const fixture = { facts: { version: HR2B_VERSION, families: [], facts: [] }, corpus: { version: HR2B_VERSION, memories: [] },
    queries: { version: HR2B_VERSION, queries: [] }, split: {}, labels: null, audit: { overrides: [] }, hashes: {} };
  for (const split of ['dev', 'test']) for (let i = 0; i < (split === 'dev' ? devFamilies : 14); i++) {
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
    fixture.queries.queries.push({ id: `q-${family}`, family, category: categoryFor(split, i), lang: 'en', intent: 'current', text: 'KEY', keyTerm: 'KEY', note: 'toy', secondaryTags: [], requiredFacts });
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

// Complete authoring-tool flow for audit regressions. Small texts and one fact
// per memory deliberately keep this a toy, not an HR-2b authored world.
export async function auditedPipelineToy(workspace, mode) {
  const { assignSplit } = await import('../../tools/split.mjs');
  const { applyAudit } = await import('../../tools/apply-audit.mjs');
  const { runRankings } = await import('../../run.mjs');
  const { auditedHR2bQueries } = await import('../../lib/hr2b-queries.mjs');
  const fixture = { facts: { version: HR2B_VERSION, families: [], facts: [] }, corpus: { version: HR2B_VERSION, memories: [] },
    queries: { version: HR2B_VERSION, queries: [] }, labels: null, audit: { overrides: [] }, hashes: {} };
  for (let i = 0; i < 40; i++) {
    const family = `f${String(i).padStart(2, '0')}`;
    fixture.facts.families.push({ id: family, role: 'target', domain: 'engineering', summary: 'Synthetic audit-flow family' });
    for (const [name, placement, kind, state] of [['old', 'body', 'decision', 'historical'], ['new', 'first-receipt', 'decision', 'current'],
      ['reason', 'later-receipt', 'reason', 'current'], ['amount', 'body', 'fact', 'current'], ['assign', 'later-receipt', 'fact', 'current'],
      ['cross', 'first-receipt', 'fact', 'current'], ['proposal', 'body', 'fact', 'proposed'], ['absent', null, 'fact', 'current']]) {
      const id = `${family}-${name}`, memory = `m-${id}`;
      fixture.facts.facts.push({ id, family, kind, state, statementLang: 'zh', statement: `KEY canonical ${name}`, entities: ['KEY'],
        eventTime: '2026-08-14T09:00:00Z', rendered: name !== 'absent', coverage: placement === null ? null : placement === 'body' ? 'body' : 'span-only',
        supersedes: name === 'new' ? `${family}-old` : null, reasonFor: name === 'reason' ? `${family}-new` : null, nearDuplicateOf: null });
      if (name === 'absent') continue;
      fixture.corpus.memories.push({ id: memory, namespace: 'target', scale: 'S300', lang: name === 'cross' ? 'en' : 'zh',
        kind: kind === 'reason' ? 'context' : kind, state: state === 'historical' ? 'historical' : 'current',
        supersedes: name === 'new' ? `m-${family}-old` : null, content: `KEY 啟用觀測系統 note ${id}`,
        spans: [1, 2].map(n => ({ id: `${memory}#s${n}`, role: 'user', eventTime: `2026-08-14T09:00:0${n}Z`, text: `KEY 啟用觀測系統 receipt ${id} ${n}` })),
        expresses: [{ fact: id, where: placement === 'body' ? 'body' : 'span', span: placement === 'body' ? null : `${memory}#s${placement === 'first-receipt' ? 1 : 2}` }] });
    }
  }
  const view = factsView(fixture);
  for (let c = 1; c <= 7; c++) for (let i = 0; i < 20; i++) {
    const family = `f${String(((c - 1) * 4 + i) % 40).padStart(2, '0')}`;
    fixture.queries.queries.push({ id: `q-C${c}-${family}`, family, category: `C${c}`, secondaryTags: [], lang: 'zh',
      intent: 'current', text: 'KEY 觀測', keyTerm: c === 2 ? '觀測' : 'KEY', note: 'Toy category checks are independently recomputed.',
      requiredFacts: c === 4 ? [`${family}-cross`] : [`${family}-new`, `${family}-reason`] });
  }
  if (mode === 'drop') fixture.queries.queries.push({ ...structuredClone(fixture.queries.queries[8]), id: 'q-extra' });
  fixture.split = assignSplit(fixture.queries.queries, { seed: 'hr2b-fix2-e2e' });
  fixture.labels = buildLabels(fixture, tokenizers);
  const originalQueries = structuredClone(fixture.queries), beforePlacement = structuredClone(fixture.labels.placement);
  const override = (query, action, detail) => ({ query, action, detail, reason: 'Synthetic W3 audit regression.' });
  const devC1 = fixture.queries.queries.filter(query => query.category === 'C1' && fixture.split[query.family] === 'dev');
  const first = devC1.find(query => fixture.queries.queries.some(other => other.category === 'C3' && other.family === query.family));
  if (!first) throw new Error('toy_audit_pair_unavailable');
  const second = fixture.queries.queries.find(query => query.category === 'C3' && query.family === first.family);
  const auditIds = mode === 'drop' ? [devC1[0].id] : [first.id, second.id];
  fixture.audit = { version: HR2B_VERSION, overrides: mode === 'drop' ? [override(auditIds[0], 'drop-query', {})] : [
    override(first.id, 'recategorize', { category: 'C3' }), override(second.id, 'recategorize', { category: 'C1' })] };
  fixture.labels = applyAudit(fixture, fixture.audit, tokenizers);
  const dir = join(workspace.path, 'fixture'), rankingsDir = join(workspace.path, 'rankings');
  await mkdir(dir); await mkdir(rankingsDir);
  for (const [name, value] of Object.entries({ facts: fixture.facts, corpus: fixture.corpus, 'facts-view': view, queries: fixture.queries,
    split: { version: HR2B_VERSION, ...fixture.split }, labels: fixture.labels, 'label-audit': fixture.audit })) await writeJson(join(dir, `hr1-${name}.json`), value);
  fixture.hashes = await freeze(dir, FILES);
  const configuration = hr2bConfiguration(fixture.hashes);
  await writeJson(join(rankingsDir, 'configuration.json'), configuration);
  await writeJson(join(rankingsDir, 'host-v2-calibration.json'), calibration({ bodies: [4], receipts: [3], counts: [2], itemCounts: [1] }));
  // Only dev is executed, using deterministic fake vectors. Test members are
  // literal empty-ranking toy inputs; no test split is run or inferred.
  await mkdir(join(rankingsDir, 'test'));
  const members = ['configuration.json', 'host-v2-calibration.json'];
  for (const selection of ['A1', 'A3--bge-m3']) {
    const member = `test/${selection}.json`;
    await writeJson(join(rankingsDir, member), { format: 'hr1-rankings-v1', run: { arm: selection === 'A1' ? 'A1' : 'A3', config: selection === 'A1' ? 'BM25-T1' : 'A3',
      model: selection === 'A1' ? null : 'bge-m3', lexical: selection === 'A1' ? null : 'A1', split: 'test', scale: 'S1000', fixtureVersion: HR2B_VERSION,
      fixtureHashes: fixture.hashes, configuration, store: null, status: 'complete', isolationVariant: 'with-foreign' },
      queries: Object.fromEntries(auditedHR2bQueries(fixture, { split: 'test' }).map(query => [query.id, { ranked: [] }])) });
    members.push(member);
  }
  const generated = await runRankings({ fixtureDir: dir, fixtureVersion: HR2B_VERSION, split: 'dev', scale: 'S1000', arms: ['A1', 'A3'], models: ['bge-m3'],
    out: join(rankingsDir, 'dev'), isolationVariant: 'with-foreign', threads: 1 }, { embedderFactory: async () => ({ metadata: { stub: true },
      embed: async texts => texts.map(() => Float32Array.of(1, 0)), close: async () => {} }) });
  members.push('dev/A1.json', 'dev/A3--bge-m3.json');
  await freeze(rankingsDir, members);
  return { fixture, dir, rankingsDir, originalQueries, beforePlacement, generated, auditIds };
}

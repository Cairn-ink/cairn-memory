import { VERSION } from '../../lib/fixture.mjs';
import { buildLabels } from '../../tools/labels.mjs';

// Deliberately simple injected tokens test the tooling's plumbing. Tokenizer
// semantics and frozen stopwords belong to W4b's independent suite.
export const tokenizers = {
  tokenizeT1: text => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  tokenizeT1Plus: text => (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(word => word.replace(/s$/, '')),
};
const timestamp = '2026-08-14T09:00:00Z';
const langAt = i => i % 20 < 11 ? 'zh' : i % 20 < 17 ? 'en' : 'mixed';

export function toyFixture() {
  const fixture = { facts: { version: VERSION, families: [], facts: [] }, corpus: { version: VERSION, memories: [] },
    queries: { version: VERSION, queries: [] }, split: {}, labels: null, audit: { overrides: [] }, hashes: {} };
  let serial = 0;
  function family(id, role) { fixture.facts.families.push({ id, role, domain: 'engineering', summary: `Scenario ${id}` }); }
  function fact(id, familyId, fields = {}) {
    const result = { id, family: familyId, kind: 'fact', state: 'current', supersedes: null, reasonFor: null, nearDuplicateOf: null,
      eventTime: timestamp, entities: [familyId], statementLang: 'zh', statement: `Canonical ${id}`, rendered: true, coverage: 'body', ...fields };
    fixture.facts.facts.push(result); return result;
  }
  function memory(fact, { scale = 'S300', namespace = 'target', lang = 'zh', spanOnly = false, state = 'current', supersedes = null, spanCount = 1, authoring = 'hand', extraText = '' } = {}) {
    const id = `opaque-${String(++serial).padStart(4, '0')}`;
    const content = `${spanOnly ? 'A retained note without its concrete details.' : 'KEY_shared 啟用觀測系統 note with concrete details.'}${extraText}`;
    const spans = Array.from({ length: spanCount }, (_, i) => ({ id: `${id}#s${i + 1}`, role: 'user', eventTime: timestamp, text: `KEY_shared 啟用觀測系統 ${'quoted evidence '.repeat(4)}` }));
    const item = { id, namespace, scale, lang, kind: fact.kind === 'reason' ? 'context' : fact.kind, state, supersedes,
      eventTime: timestamp, domain: 'engineering', authoring, content, spans,
      expresses: [{ fact: fact.id, where: spanOnly ? 'span' : 'body', span: spans[0].id }] };
    fixture.corpus.memories.push(item); return item;
  }
  function query(i, category, requiredFacts, fields = {}) {
    const id = `q-${category}-${String(i).padStart(2, '0')}`;
    fixture.queries.queries.push({ id, family: `fam-${i}`, category, secondaryTags: [], lang: langAt(i), intent: 'current',
      text: 'KEY_shared 觀測 what happened', requiredFacts, keyTerm: 'KEY_shared', note: 'Necessary synthetic supports.', ...fields });
  }
  for (let i = 0; i < 40; i++) family(`fam-${i}`, 'target');
  for (let i = 0; i < 20; i++) {
    fixture.split[`fam-${i}`] = i < 6 ? 'dev' : 'test';
    const spanOnly = i >= 12, coverage = spanOnly ? 'span-only' : 'body';
    const old = fact(`old-${i}`, `fam-${i}`, { kind: 'decision', state: 'historical', coverage });
    const current = fact(`new-${i}`, `fam-${i}`, { kind: 'decision', supersedes: old.id, coverage });
    const reason = fact(`reason-${i}`, `fam-${i}`, { kind: 'reason', reasonFor: current.id, coverage });
    const before = memory(old, { state: 'historical', lang: langAt(i), spanOnly });
    memory(current, { lang: langAt(i), spanOnly, supersedes: before.id });
    memory(reason, { lang: langAt(i), spanOnly });
    const cross = fact(`cross-${i}`, `fam-${i}`, { coverage });
    memory(cross, { lang: i % 2 ? 'zh' : 'en', spanOnly });
    const near = fact(`near-${i}`, `fam-${i}`); memory(near, { lang: langAt(i) });
    const absent = fact(`absent-${i}`, `fam-${i}`, { rendered: false });
    query(i, 'C1', [current.id]);
    query(i, 'C2', [current.id], { lang: 'zh', keyTerm: '觀測' });
    query(i, 'C3', [current.id], { text: 'unrelatedword' });
    query(i, 'C4', [cross.id], { lang: i % 2 ? 'en' : 'zh' });
    query(i, 'C5', [current.id, reason.id]);
    query(i, 'C6', i % 2 ? [old.id, current.id, reason.id] : [current.id, reason.id], { intent: i % 2 ? 'history' : 'current' });
    query(i, 'C7', [current.id]);
    if (i < 10) query(i, 'C8', [absent.id]);
  }
  // Padding is authored independently of query support; all corpus sizes and
  // language distributions are then matched exactly for validator tests.
  while (fixture.corpus.memories.length < 300) {
    const index = fixture.corpus.memories.length;
    memory(fact(`padding-${index}`, `fam-${20 + index % 20}`), { lang: langAt(index) });
  }
  family('extras-family', 'distractor');
  for (let i = 0; i < 700; i++) memory(fact(`extra-${i}`, 'extras-family'), { scale: 'S1000-extra', lang: langAt(i), authoring: i < 350 ? 'template' : 'hand' });
  for (let i = 0; i < 10; i++) {
    const familyId = `foreign-${i}`;
    family(familyId, 'foreign'); fixture.split[familyId] = i < 3 ? 'dev' : 'test';
    const facts = [];
    for (let j = 0; j < 10; j++) {
      const f = fact(`foreign-fact-${i}-${j}`, familyId, { nearDuplicateOf: j === 0 ? `new-${i}` : null }); facts.push(f);
      memory(f, { namespace: 'foreign', scale: 'foreign', lang: langAt(i * 10 + j) });
    }
    fixture.queries.queries.push({ id: `q-FOREIGN-${i}`, family: familyId, category: 'FOREIGN', secondaryTags: [], lang: 'zh', intent: 'current', text: 'foreign question', requiredFacts: [facts[0].id], note: 'Isolation control.' });
  }
  // Match the measured S300 distribution, avoiding metadata accidents from
  // the cross-lingual support constructions above.
  for (const [index, item] of fixture.corpus.memories.filter(memory => memory.scale === 'S1000-extra').entries()) {
    item.lang = langAt(index);
  }
  fixture.labels = buildLabels(fixture, tokenizers);
  return fixture;
}

export function rankingsFor(fixture, { arm = 'A1', config = 'BM25-T1', model = null, split = 'test', scale = 'S1000', store = null,
  ranking = label => label.groups.flatMap(group => group.members.filter(member => member.namespace === 'target').map(member => member.memory)) } = {}) {
  return { format: 'hr1-rankings-v1', run: { arm, config, model, split, scale, store, fixtureHashes: fixture.hashes, env: {} },
    queries: Object.fromEntries(fixture.labels.queries.filter(label => label.split === split && !label.dropped).map(label => [label.id, { ranked: [...new Set(ranking(label))].slice(0, 24),
      ...(arm.startsWith('A0-') ? { pages: 1, scannedRows: 128, coverage: 1, errors: [] } : {}) }])), costs: { indexBuildMs: 1 } };
}

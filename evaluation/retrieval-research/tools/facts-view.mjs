import { join } from 'node:path';
import { fixtureProfile, HR2B_VERSION, unique, compareIds, loadFixture, writeJson, cliMain, requiredOption } from '../lib/fixture.mjs';

export function factsView(fixture) {
  const families = fixture.facts.families.filter(family => ['target', 'foreign'].includes(family.role));
  const allowed = new Set(families.map(family => family.id));
  const facts = fixture.facts.facts.filter(fact => allowed.has(fact.family)).sort((a, b) => compareIds(a.id, b.id)).map(fact => {
    const memories = fixture.corpus.memories.filter(memory => memory.expresses.some(expression => expression.fact === fact.id));
    const body = memories.some(memory => memory.expresses.some(expression => expression.fact === fact.id && expression.where === 'body'));
    // Deliberate allowlist: additions to corpus objects cannot cross the W2 barrier.
    return { id: fact.id, family: fact.family, statement: fact.statement, statementLang: fact.statementLang,
      kind: fact.kind, state: fact.state, supersedes: fact.supersedes, reasonFor: fact.reasonFor,
      nearDuplicateOf: fact.nearDuplicateOf, eventTime: fact.eventTime, entities: [...fact.entities],
      rendered: fact.rendered, coverage: fact.coverage, memoryLangs: unique(memories.map(memory => memory.lang)),
      actualCoverage: memories.length ? body ? 'body' : 'span-only' : 'absent',
      memoryCount: memories.length, memoryStates: unique(memories.map(memory => memory.state)) };
  });
  return { version: fixtureProfile(fixture).version, families: families.map(({ id, role, domain, summary }) => ({ id, role, domain, summary })), facts };
}

await cliMain(import.meta.url, async options => {
  const dir = requiredOption(options, 'fixture');
  const view = factsView(await loadFixture(dir));
  await writeJson(options.out ?? join(dir, 'hr1-facts-view.json'), view);
  console.log(JSON.stringify({ ok: true, facts: view.facts.length }));
});

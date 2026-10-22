import { join } from 'node:path';
import { VERSION, compareIds, unique, eligibleMemory, loadFixture, writeJson, cliMain, requiredOption } from '../lib/fixture.mjs';

export function memberTexts(memory, member) {
  return [...(member.where === 'body' ? [{ where: 'body', text: memory.content }] : []),
    ...member.spans.map(id => ({ where: 'span', span: id, text: memory.spans.find(span => span.id === id)?.text ?? '' }))];
}
export function memberText(memory, member) { return memberTexts(memory, member).map(source => source.text).join('\n'); }
export function groupFidelity(members) { return members.some(member => member.where === 'body') ? 'body-covered' : 'span-only'; }
export function makeMember(memory, expressions) {
  const sources = Array.isArray(expressions) ? expressions : [expressions];
  return { memory: memory.id, where: sources.some(source => source.where === 'body') ? 'body' : 'span',
    spans: unique(sources.flatMap(source => source.spans ?? (source.span ? [source.span] : []))),
    scale: memory.scale, namespace: memory.namespace, lang: memory.lang, spanCount: memory.spans.length };
}

function tokenOverlap(text, query, tokenize) {
  const a = new Set(tokenize(query)), b = new Set(tokenize(text));
  const shared = [...a].filter(token => b.has(token)).sort(compareIds);
  return { count: shared.length, queryCount: a.size, ratio: shared.length / Math.max(1, a.size), shared };
}

export function hardNegativesFor(fixture, query) {
  const facts = new Map(fixture.facts.facts.map(fact => [fact.id, fact]));
  const required = new Set(query.requiredFacts);
  const entities = new Set(query.requiredFacts.flatMap(id => facts.get(id)?.entities ?? []));
  return unique(fixture.corpus.memories.filter(memory => {
    if (!eligibleMemory(memory, query.intent) || memory.expresses.some(expression => required.has(expression.fact))) return false;
    const conveyed = memory.expresses.map(expression => facts.get(expression.fact)).filter(Boolean);
    return conveyed.some(fact => fact.family === query.family) && conveyed.some(fact => fact.entities.some(entity => entities.has(entity)));
  }).map(memory => memory.id));
}

// Every primary category has a check, so recategorization can be validated
// without trusting a pre-audit pass flag.
export function categoryChecks(fixture, query, label) {
  const memories = new Map(fixture.corpus.memories.map(memory => [memory.id, memory]));
  const facts = new Map(fixture.facts.facts.map(fact => [fact.id, fact]));
  const families = new Map(fixture.facts.families.map(family => [family.id, family]));
  const required = query.requiredFacts.map(id => facts.get(id)).filter(Boolean);
  const groups = label.groups;
  const term = query.keyTerm;
  const witnesses = (embedded = false) => groups.map(group => ({ fact: group.fact, members: group.members.flatMap(member => {
    const memory = memories.get(member.memory);
    if (!memory) return [];
    return memberTexts(memory, member).flatMap(({ text, where, span }) => {
      const found = embedded ? [...text.matchAll(/\p{Script=Han}+/gu)].some(([run]) => run.includes(term) && [...run].length > [...term].length) : text.includes(term);
      return found ? [{ memory: member.memory, where, ...(span ? { span } : {}) }] : [];
    });
  }) }));
  const exact = typeof term === 'string' && term.length > 0 && query.text.includes(term) ? witnesses() : [];
  const han = typeof term === 'string' && /^\p{Script=Han}{2,4}$/u.test(term) && query.text.includes(term) ? witnesses(true) : [];
  const allMembers = groups.flatMap(group => group.members).map(member => memories.get(member.memory)).filter(Boolean);
  const present = groups.length > 0 && groups.every(group => group.members.length > 0);
  const current = required.filter(fact => fact.kind === 'decision' && fact.state === 'current' && fact.supersedes);
  const reasons = required.filter(fact => fact.kind === 'reason');
  const history = required.filter(fact => fact.kind === 'decision' && fact.state === 'historical');
  const change = current.length === 1 && facts.get(current[0].supersedes)?.state === 'historical' &&
    reasons.length === 1 && reasons[0].reasonFor === current[0].id;
  const c6 = present && change && (query.intent === 'current'
    ? required.length === 2 && history.length === 0
    : required.length === 3 && history.length === 1 && current[0].supersedes === history[0].id);
  return {
    C1: { pass: present && exact.length === groups.length && exact.every(group => group.members.length), witnesses: exact },
    C2: { pass: present && query.lang === 'zh' && han.length === groups.length && han.every(group => group.members.length), witnesses: han },
    C3: { pass: present && allMembers.every(memory => memory.lang === query.lang) },
    C4: { pass: present && allMembers.every(memory => memory.lang !== query.lang) },
    C5: { pass: present && query.requiredFacts.length >= 2 && query.requiredFacts.length <= 3 &&
      !allMembers.some(memory => groups.every(group => group.members.some(member => member.memory === memory.id))) },
    C6: { pass: Boolean(c6), current: current.map(fact => fact.id), historical: history.map(fact => fact.id), reasons: reasons.map(fact => fact.id) },
    C7: { pass: label.hardNegatives.some(id => memories.get(id)?.scale === 'S300') },
    C8: { pass: required.length === query.requiredFacts.length && required.length > 0 && required.every(fact => fact.rendered === false) &&
      groups.every(group => !group.members.length) && !fixture.corpus.memories.some(memory => memory.expresses.some(expression => query.requiredFacts.includes(expression.fact))) },
    FOREIGN: { pass: present && required.length === query.requiredFacts.length && required.every(fact => families.get(fact.family)?.role === 'foreign') &&
      groups.every(group => group.members.every(member => member.namespace === 'foreign')) },
  };
}

export function refreshLabel(fixture, query, label, tokenizers) {
  const { tokenizeT1, tokenizeT1Plus } = tokenizers;
  if (typeof tokenizeT1 !== 'function' || typeof tokenizeT1Plus !== 'function') throw new Error('tokenizers_required');
  const memories = new Map(fixture.corpus.memories.map(memory => [memory.id, memory]));
  label.groups = label.groups.map(group => ({ ...group, fidelity: groupFidelity(group.members) }));
  label.overlap = label.groups.flatMap(group => group.members.map(member => {
    const memory = memories.get(member.memory);
    if (!memory) throw new Error(`unknown_member:${member.memory}`);
    const text = memberText(memory, member);
    return { fact: group.fact, memory: member.memory, where: member.where,
      T1: tokenOverlap(text, query.text, tokenizeT1), T1Plus: tokenOverlap(text, query.text, tokenizeT1Plus) };
  }));
  label.checks = categoryChecks(fixture, { ...query, category: label.category }, label);
  return label;
}

export function buildLabels(fixture, tokenizers) {
  const queries = [...fixture.queries.queries].sort((a, b) => compareIds(a.id, b.id)).map(query => {
    const groups = query.requiredFacts.map(fact => {
      const members = [...fixture.corpus.memories].sort((a, b) => compareIds(a.id, b.id)).flatMap(memory => {
        if (!eligibleMemory(memory, query.intent)) return [];
        const expressions = memory.expresses.filter(expression => expression.fact === fact);
        return expressions.length ? [makeMember(memory, expressions)] : [];
      });
      return { fact, members, fidelity: groupFidelity(members) };
    });
    return refreshLabel(fixture, query, { id: query.id, family: query.family, category: query.category, lang: query.lang,
      intent: query.intent, split: fixture.split?.[query.family], groups, hardNegatives: hardNegativesFor(fixture, query) }, tokenizers);
  });
  return { version: VERSION, queries };
}

export async function loadTokenizers() {
  try { return await import('../lib/tokenize.mjs'); }
  catch (error) { throw new Error(`tokenizer_import_required:${error.message}`); }
}

await cliMain(import.meta.url, async options => {
  const dir = requiredOption(options, 'fixture');
  const labels = buildLabels(await loadFixture(dir), await loadTokenizers());
  await writeJson(options.out ?? join(dir, 'hr1-labels.json'), labels);
  console.log(JSON.stringify({ ok: true, queries: labels.queries.length }));
});

import { join } from 'node:path';
import { VERSION, compareIds, eligibleMemory, loadFixture, writeJson, cliMain, requiredOption } from '../lib/fixture.mjs';
import { makeMember, refreshLabel, loadTokenizers, hardNegativesFor } from './labels.mjs';

// Detail shapes: {fact,memory,where,span?} for members; {category} for
// recategorize; {memory} for hard negatives; {} for drop-query. Originals and
// ordered reasons remain embedded so the audit does not destroy its input.
export function applyAudit(fixture, audit, tokenizers) {
  if (!Array.isArray(audit?.overrides)) throw new Error('audit_overrides_required');
  if (fixture.labels.original) throw new Error('audit_already_applied');
  const original = structuredClone(fixture.labels);
  const result = structuredClone(original);
  const labels = new Map(result.queries.map(label => [label.id, label]));
  const queries = new Map(fixture.queries.queries.map(query => [query.id, query]));
  const memories = new Map(fixture.corpus.memories.map(memory => [memory.id, memory]));
  for (const override of audit.overrides) {
    const { query: id, action, detail, reason } = override;
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`audit_reason_required:${id}`);
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error(`audit_detail_required:${id}`);
    const label = labels.get(id), query = queries.get(id);
    if (!label || !query) throw new Error(`audit_unknown_query:${id}`);
    if (['add-member', 'remove-member'].includes(action)) {
      const group = label.groups.find(item => item.fact === detail.fact);
      const memory = memories.get(detail.memory);
      if (!group || !memory) throw new Error(`audit_unknown_member_or_group:${id}`);
      const exists = group.members.some(member => member.memory === detail.memory);
      if (action === 'add-member') {
        if (exists || !eligibleMemory(memory, query.intent) || !['body', 'span'].includes(detail.where) ||
          (detail.where === 'span' && !memory.spans.some(span => span.id === detail.span))) throw new Error(`audit_invalid_add_member:${id}`);
        group.members.push(makeMember(memory, detail));
        group.members.sort((a, b) => compareIds(a.memory, b.memory));
        label.hardNegatives = label.hardNegatives.filter(member => member !== memory.id);
      } else {
        if (!exists) throw new Error(`audit_missing_member:${id}`);
        group.members = group.members.filter(member => member.memory !== detail.memory);
      }
    } else if (action === 'recategorize') {
      if (!/^C[1-8]$|^FOREIGN$/.test(detail.category)) throw new Error(`audit_invalid_category:${id}`);
      label.category = detail.category;
    } else if (action === 'drop-query') {
      if (label.dropped) throw new Error(`audit_already_dropped:${id}`);
      label.dropped = true;
    } else if (['add-hard-negative', 'remove-hard-negative'].includes(action)) {
      const memory = memories.get(detail.memory), exists = label.hardNegatives.includes(detail.memory);
      if (!memory || !eligibleMemory(memory, query.intent) || (action === 'add-hard-negative' ? exists || !hardNegativesFor(fixture, query).includes(memory.id) || label.groups.some(group => group.members.some(member => member.memory === memory.id)) : !exists)) {
        throw new Error(`audit_invalid_hard_negative:${id}`);
      }
      label.hardNegatives = action === 'add-hard-negative' ? [...label.hardNegatives, detail.memory].sort(compareIds) : label.hardNegatives.filter(memory => memory !== detail.memory);
    } else throw new Error(`audit_unknown_action:${action}`);
    label.audit ??= [];
    label.audit.push(structuredClone(override));
  }
  for (const label of result.queries) refreshLabel(fixture, queries.get(label.id), label, tokenizers);
  return { ...result, version: VERSION, original, audit: structuredClone(audit) };
}

await cliMain(import.meta.url, async options => {
  const dir = requiredOption(options, 'fixture'), fixture = await loadFixture(dir);
  const labels = applyAudit(fixture, fixture.audit, await loadTokenizers());
  await writeJson(options.out ?? join(dir, 'hr1-labels.json'), labels);
  console.log(JSON.stringify({ ok: true, overrides: fixture.audit.overrides.length }));
});

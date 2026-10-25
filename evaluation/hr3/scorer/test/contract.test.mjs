import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consumeContract, validateContract, SLOT_INTERFACE, projectFields, projectClaimFields } from '../contract.mjs';
import { fieldRepresentationsEqual } from '../slots.mjs';
import { score } from '../scorer.mjs';
import { claim, copy, fixture, text, quantity } from './fixtures.mjs';
const languageRow = (canonical, zh, en = canonical) => ({ canonical, 'zh-Hant': [zh], en: [en], mixed: [`${en} ${zh}`] });
function engineeringContract() {
  return {
    version: 'engineering-contract-v1',
    slots: Object.entries(SLOT_INTERFACE).map(([name, spec]) => ({ name, type: spec.type, unit: spec.unit ?? (name === 'route' ? 'literal identifier' : 'none'), legacy_field: spec.legacyField, aliases: [...spec.labels, ...(name === 'route' ? ['value'] : [])] })),
    aliases: { subjects: [languageRow('elm service', '榆服務')], predicates: [languageRow('engineering configuration', '工程設定')],
      routes: [languageRow('cedar', '雪松')], fields: [languageRow('route', '路線'), languageRow('approval', '需經核准'), languageRow('cap', '每日請求上限')] },
    values: { slot_states: ['value', 'not_specified', 'unavailable', 'unresolved'], boolean_aliases: { true: ['true', '是'], false: ['false', '否'] },
      units: [{ alias: 'requests/day', canonical: 'requests/day', numerator: '1', denominator: '1' }, { alias: 'requests/hour', canonical: 'requests/day', numerator: '24', denominator: '1' }, { alias: 'engineering-pair/day', canonical: 'requests/day', numerator: '2', denominator: '1' }] },
    answer: { current_statuses: ['active', 'no_active_decision', 'unresolved'], old_statuses: ['available', 'unavailable', 'none'], reason_statuses: ['stated', 'not_stated', 'unavailable'] },
    historical_labels: ['previously_adopted', 'erroneous', 'expired', 'unavailable', 'unresolved'].map(canonical => ({ canonical })),
    scope: { domain: { country: ['TW', 'JP', 'US'], plan: ['free', 'pro'], channel: ['web', 'app'] }, time_zone: 'Asia/Taipei' },
  };
}
async function withContract(fn) {
  const dir = await mkdtemp(new URL('../.test-contract-', import.meta.url).pathname);
  try {
    const path = join(dir, 'contract.json');
    await writeFile(path, JSON.stringify(engineeringContract()));
    await fn(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('published generator contract is consumed when present; absent contracts use only A-4 text', async () => {
  const found = consumeContract();
  assert(['validated', 'absent'].includes(found.status));
  if (found.status === 'validated') assert.deepEqual(validateContract(JSON.parse(await readFile(new URL('../../generator/public-contract.json', import.meta.url)))), []);
  const absent = consumeContract(new URL('../not-a-contract.json', import.meta.url));
  assert.equal(absent.status, 'absent');
});
test('contract mismatch stops scoring, including alias collision, unit drift, missing names and status drift', () => withContract(async path => {
  const edits = [c => c.slots[0].type = 'boolean', c => c.aliases.subjects = [],
    c => c.aliases.routes.push(languageRow('different', '雪松')),
    c => c.values.units[0].denominator = '0', c => c.values.units[0].numerator = '2',
    c => c.answer.reason_statuses.push('guessed'), c => c.scope.time_zone = 'UTC', c => delete c.aliases.fields,
    c => c.aliases.fields.push(languageRow('invented-slot', '發明欄位'))];
  for (const edit of edits) {
    const c = engineeringContract(); edit(c); await writeFile(path, JSON.stringify(c));
    assert.throws(() => consumeContract(path), /Public contract mismatch/);
    const f = fixture(); assert.throws(() => score(f.gold, f.submission, { contractPath: path }), /Public contract mismatch/);
  }
  await writeFile(path, '{bad'); assert.throws(() => consumeContract(path), /malformed JSON/);
}));
test('public subject/predicate aliases are explicit; fictional routes stay literal unless declared', () => withContract(async path => {
  const contract = consumeContract(path), name = contract.canonicalName;
  assert.equal(name('subjects', '榆服務'), 'elm service');
  assert.equal(name('predicates', '工程設定'), 'engineering configuration');
  const f = fixture(); f.submission.answer.current.rows[0].route.value = '雪松';
  assert.equal(score(f.gold, f.submission, { contractPath: path }).scores.C, 1);
  f.submission.answer.current.rows[0].route.value = 'elm service';
  assert.equal(score(f.gold, f.submission, { contractPath: path }).scores.C, 0);
}));
test('bundled versus decomposed fields project before comparison; bilingual qualifiers never cause a count/type zero', () => withContract(async path => {
  const contract = consumeContract(path), main = claim(text('cedar'));
  main.predicate = '工程設定';
  main.qualifiers = [{ key: '需經核准', value: { type: 'Boolean', value: true } }, { key: 'daily request cap', value: quantity('48', 'requests/day') }];
  const decomposed = [
    { ...claim(text('雪松')), predicate: '路線' },
    { ...claim({ type: 'Boolean', value: true }), predicate: 'approval required' },
    { ...claim(quantity('2', 'requests/hour')), predicate: '每日請求上限' },
  ];
  assert.equal(fieldRepresentationsEqual([main], decomposed, contract), 1);
  decomposed.push(copy(decomposed[0]));
  assert.equal(fieldRepresentationsEqual([main], decomposed, contract), 1);
  decomposed[1].value = text('unlicensed boolean wording');
  assert.equal(fieldRepresentationsEqual([main], decomposed, contract), null);
  decomposed[1].predicate = 'unlisted qualifier';
  assert.equal(fieldRepresentationsEqual([main], decomposed, contract), null);
  assert.throws(() => projectFields([{ key: 'unlisted', value: text('x') }]), /Unknown slot correspondence/);
  assert.equal(projectClaimFields([main], contract.canonicalName).cap.length, 1);
}));
test('declared quantity ratios are exact, NFKC normalization precedes conversion, unlisted units refer', () => withContract(async path => {
  const f = fixture(); f.gold.current.rows[0].cap.value.decimal = '9007199254740993';
  f.submission.answer.current.rows[0].cap.value = { decimal: '4503599627370496.5', unit: 'engineering-pair/day' };
  assert.equal(score(f.gold, f.submission, { contractPath: path }).scores.C, 1);
  f.submission.answer.current.rows[0].cap.value.decimal = '4503599627370496';
  assert.equal(score(f.gold, f.submission, { contractPath: path }).scores.C, 0);
  f.gold.current.rows[0].cap.value.decimal = '48';
  f.submission.answer.current.rows[0].cap.value = { decimal: '2', unit: ' ｒｅｑｕｅｓｔｓ／ｈｏｕｒ ' };
  assert.equal(score(f.gold, f.submission, { contractPath: path }).scores.C, 1);
  f.submission.answer.current.rows[0].cap.value.unit = 'unpublished-unit';
  assert.equal(score(f.gold, f.submission, { contractPath: path }).scores.C, null);
}));

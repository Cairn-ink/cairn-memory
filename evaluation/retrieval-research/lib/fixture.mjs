import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = 'hr1-fixture-v2';
export const CATEGORIES = Object.freeze(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
export const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const unique = values => [...new Set(values)].sort(compareIds);
export const labelEntries = labels => labels?.queries ?? [];
export const splitOf = (fixture, family) => fixture.split?.[family];

export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function writeJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }

// Partial fixtures support the ordered authoring pipeline. Facts and corpus are
// mandatory; later products are null until their owner has produced them.
export async function loadFixture(dir) {
  const fixture = { hashes: {} };
  for (const [key, suffix] of Object.entries({ facts: 'facts', corpus: 'corpus', queries: 'queries',
    split: 'split', labels: 'labels', audit: 'label-audit' })) {
    const filename = `hr1-${suffix}.json`;
    try {
      const bytes = await readFile(join(dir, filename));
      fixture[key] = JSON.parse(bytes.toString('utf8'));
      fixture.hashes[filename] = createHash('sha256').update(bytes).digest('hex');
    } catch (error) {
      if (error.code !== 'ENOENT' || key === 'facts' || key === 'corpus') throw error;
      fixture[key] = null;
    }
  }
  try {
    const bytes = await readFile(join(dir, 'hr1-facts-view.json'));
    fixture.hashes['hr1-facts-view.json'] = createHash('sha256').update(bytes).digest('hex');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return fixture;
}

export function eligibleMemory(memory, intent) {
  if (!['current', 'history'].includes(intent)) throw new Error('invalid_intent');
  if (memory.deleted || memory.deletedAt || memory.state === 'deleted' || memory.status === 'deleted') return false;
  if (intent === 'history') return true;
  return !['historical', 'awaiting-review', 'awaiting_review'].includes(memory.state) &&
    !['historical', 'awaiting-review', 'awaiting_review'].includes(memory.status) && !memory.awaitingReview;
}

export function atScale(memory, scale) {
  if (!['S300', 'S1000'].includes(scale)) throw new Error('invalid_scale');
  return memory.namespace === 'foreign' || memory.scale === 'S300' ||
    (scale === 'S1000' && memory.scale === 'S1000-extra');
}

export function armDocuments(fixture, { namespace, scale, intent, include }) {
  if (!['target', 'foreign'].includes(namespace)) throw new Error('invalid_namespace');
  if (!['body', 'spans', 'both'].includes(include)) throw new Error('invalid_include');
  atScale({}, scale);
  eligibleMemory({}, intent);
  return [...fixture.corpus.memories].sort((a, b) => compareIds(a.id, b.id)).flatMap(memory => {
    if (memory.namespace !== namespace || !atScale(memory, scale) || !eligibleMemory(memory, intent)) return [];
    const documents = [];
    if (include !== 'spans') documents.push({ docId: `${memory.id}#body`, memoryId: memory.id, kind: 'body', text: memory.content });
    if (include !== 'body') for (const span of memory.spans) {
      documents.push({ docId: span.id, memoryId: memory.id, kind: 'span', text: span.text });
    }
    return documents;
  });
}

export function armQueries(fixture, { split, categories } = {}) {
  if (split != null && !['dev', 'test'].includes(split)) throw new Error('invalid_split');
  const labels = new Map(labelEntries(fixture.labels).map(label => [label.id, label]));
  return [...fixture.queries.queries].sort((a, b) => compareIds(a.id, b.id)).flatMap(query => {
    const label = labels.get(query.id);
    if (label?.dropped || (split && splitOf(fixture, query.family) !== split) ||
        (categories && !categories.includes(label?.category ?? query.category))) return [];
    return [{ queryId: query.id, text: query.text, intent: query.intent }];
  });
}

// Shared CLI plumbing stays in the W4a-owned module. No implicit fixture path:
// callers must select their input directory explicitly.
export function cliArgs(argv = process.argv.slice(2)) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { options._.push(arg); continue; }
    const key = arg.slice(2);
    if (!key || argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new Error(`missing_option_value:${arg}`);
    options[key] = argv[++i];
  }
  return options;
}
export function requiredOption(options, name) {
  if (!options[name]) throw new Error(`required_option:--${name}`);
  return options[name];
}
export async function cliMain(url, action) {
  if (!process.argv[1] || pathToFileURL(resolve(process.argv[1])).href !== url) return;
  try { await action(cliArgs()); }
  catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}

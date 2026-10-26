import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWorld } from './generator.mjs';
import { parameters } from './content.mjs';
import { authoredQueries, labelQueries, auditNotes } from './query-source.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
const directory = fileURLToPath(new URL('.', import.meta.url));
export function histogram(values) {
  return Object.fromEntries([...new Set(values)].sort((a, b) => a - b).map(value => [value, values.filter(item => item === value).length]));
}
export function summarize(world) {
  const memories = world.records.filter(row => row.type === 'memory'), cards = world.records.filter(row => row.type === 'card');
  const receipts = memories.flatMap(row => row.receipts);
  return { world: world.world, records: world.records.length,
    perNamespace: world.namespaces.map(namespace => {
      const match = row => JSON.stringify(row.namespace) === JSON.stringify(namespace);
      return { namespace, memories: memories.filter(match).length, cards: cards.filter(match).length,
        historicalMemories: memories.filter(row => match(row) && row.currentness === 'historical').length,
        l1: world.mocs.filter(row => match(row) && row.level === 'L1').length,
        l2: world.mocs.filter(row => match(row) && row.level === 'L2').length };
    }),
    memoryBodyUnits: histogram(memories.map(row => row.bodyUnits)), cardBodyUnits: histogram(cards.map(row => row.bodyUnits)),
    receipts: { count: receipts.length, perMemory: histogram(memories.map(row => row.receipts.length)),
      units: histogram(receipts.map(row => row.units)), totalBytes: receipts.reduce((sum, row) => sum + row.bytes, 0) },
    sourceNoteUnits: histogram(cards.map(row => row.sourceNoteUnits)),
    groundTruth: {
      adoptionStatus: Object.fromEntries(['adopted', 'discussion', 'proposal', 'rejected-suggestion'].map(status =>
        [status, world.records.filter(row => row.groundTruth?.adoptionStatus === status).length])),
      datedRecords: world.records.filter(row => row.groundTruth?.eventDate).length,
      metadataIndexed: false,
    },
    bodyBytes: { memory: memories.reduce((sum, row) => sum + row.bodyBytes, 0), card: cards.reduce((sum, row) => sum + row.bodyBytes, 0) },
    edgeContent: Object.fromEntries(['submittedLeadingWhitespace', 'storedLeadingWhitespace', 'hasZWJ', 'hasCombiningMark']
      .map(flag => [flag, { memory: memories.filter(row => row[flag]).length, card: cards.filter(row => row[flag]).length }])) };
}
export async function freeze({ reuseDirectory } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'p2-freeze-'));
  const save = (name, value) => writeFileSync(join(directory, name), typeof value === 'string' ? value : json(value));
  const statistics = { version: parameters.version, worlds: {}, queryCounts: {}, generationEnvironment: { node: process.version, purpose: 'Fixture creation only; no P2 measurement.' } };
  async function generate(world, schema) {
    const cachedPath = reuseDirectory && join(reuseDirectory, `${world}-${schema}.sqlite.fixture.json`);
    if (cachedPath && existsSync(cachedPath)) {
      const cached = JSON.parse(readFileSync(cachedPath, 'utf8'));
      const { physical, canonicalBytes, logicalSha256, ...logical } = cached;
      assert.equal(sha256(JSON.stringify(logical)), logicalSha256, 'closed result digest');
      assert.equal(cached.world, world); assert.equal(physical.schema, schema); assert.equal(cached.version, parameters.version);
      console.error(`Reusing verified closed ${world}/v${schema} generation result`);
      return cached;
    }
    return generateWorld({ path: join(scratch, `${world}-${schema}.sqlite`), world, schema, inMemory: schema !== 23,
      onProgress: message => process.stderr.write(message) });
  }
  try {
    save('queries.json', authoredQueries().map(({ slots, ...query }) => query));
    for (const world of ['W1', 'W3']) {
      const mixed = await generate(world, 23);
      const { physical, canonicalBytes, ...catalog } = mixed;
      save(`world-${world}.json`, catalog);
      const labels = labelQueries(mixed); save(`labels-${world}.json`, labels); save(`why-${world}.txt`, auditNotes(labels, mixed));
      const stats = summarize(mixed);
      stats.variants = { 23: { ...physical, canonicalBytes, logicalSha256: mixed.logicalSha256 } };
      for (const schema of [18, 33]) {
        const variant = await generate(world, schema);
        assert.deepEqual(variant.records, mixed.records.filter(row => schema !== 18 || row.type === 'memory'));
        assert.deepEqual(variant.mocs, mixed.mocs);
        stats.variants[schema] = { ...variant.physical, canonicalBytes: variant.canonicalBytes, logicalSha256: variant.logicalSha256 };
      }
      statistics.worlds[world] = stats;
      statistics.queryCounts[world] = { categories: Object.fromEntries(['zh-Hant', 'ja', 'mixed', 'negative'].map(category => [category, labels.filter(q => q.category === category).length])),
        total: labels.length, history: labels.filter(q => q.intent === 'history').length,
        crossNamespace: labels.filter(q => q.crossNamespace).length,
        shortTemporal: labels.filter(q => q.shortTemporal).length,
        mixedProductTerm: labels.filter(q => q.productTerm).length,
        zeroSharedTokens: labels.filter(q => q.zeroSharedTokens).length,
        naturalHistory: labels.filter(q => q.naturalHistory).length,
        ownerWideOutsideMajority: labels.filter(q => q.ownerWide).length,
        distractorChallenge: labels.filter(q => q.distractorChallenge).length,
        notInMemory: labels.filter(q => q.notInMemory).length,
        languages: Object.fromEntries(['zh-Hant', 'ja', 'zh-en', 'ja-en'].map(language => [language, labels.filter(q => q.language === language).length])),
        applicableV18: labels.filter(q => q.applicableSchemas.includes(18)).length };
    }
    save('statistics.json', statistics);
    // Every local source and generated artifact is covered, except the self-referential manifest.
    const files = Object.fromEntries(readdirSync(directory).filter(name => name !== 'manifest.json').sort().map(name => {
      const bytes = readFileSync(join(directory, name)); return [name, { bytes: bytes.length, sha256: sha256(bytes) }];
    }));
    const manifest = { version: 'p2-fixture-sha256-v1', fixture: parameters.version, contract: parameters.contract,
      hashAlgorithm: 'SHA-256', encoding: 'Exact file bytes; UTF-8 JSON uses two spaces and terminal LF.',
      inventorySha256: sha256(json(files)), fileCount: Object.keys(files).length, files };
    save('manifest.json', manifest);
    console.log(json({ fileCount: manifest.fileCount, inventorySha256: manifest.inventorySha256,
      manifestSha256: sha256(readFileSync(join(directory, 'manifest.json'))), queryCounts: statistics.queryCounts,
      variants: Object.fromEntries(Object.entries(statistics.worlds).map(([name, stats]) => [name, stats.variants])) }));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await freeze({ reuseDirectory: process.env.P2_FIXTURE_REUSE });

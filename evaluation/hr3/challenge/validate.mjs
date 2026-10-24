import assert from 'node:assert/strict';
import { readFile, opendir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateShape, answerSchema } from './schema.mjs';
import { ROOT, DATASETS, LANGUAGES, STYLES, DISTORTIONS, counts, inventory, sha256, stable } from './generate.mjs';

export async function readJsonl(path) {
  const content = await readFile(path, 'utf8');
  assert.ok(content.endsWith('\n'), `${path}: missing final LF`);
  assert.ok(!content.includes('\r'), `${path}: CR is not allowed`);
  return content.slice(0, -1).split('\n').map((line, i) => {
    assert.ok(line.length, `${path}:${i + 1}: empty line`);
    try { return JSON.parse(line); } catch (error) { throw new Error(`${path}:${i + 1}: ${error.message}`); }
  });
}
const keys = (value, expected, path) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${path}: closed keys`);
const domains = { country: ['TW', 'JP', 'US'], plan: ['free', 'pro'], channel: ['web', 'app'] };
export function scopeCells(scope) {
  return domains.country.flatMap(country => domains.plan.flatMap(plan => domains.channel.map(channel => ({ country, plan, channel }))))
    .filter(cell => scope.any.some(term => term.all.every(condition => condition.values.includes(cell[condition.field]))))
    .map(cell => `${cell.country}/${cell.plan}/${cell.channel}`).sort();
}
export const claims = answer => [...answer.current.claims, ...answer.old.records.flatMap(record => record.claims), ...answer.reason.nodes.map(node => node.claim)];
export function validateAnswer(answer, path) {
  assert.deepEqual(validateShape(answer), [], `${path}: schema`);
  for (const claim of claims(answer)) {
    for (const term of claim.scope.any) for (const condition of term.all) {
      assert.ok(condition.values.every(value => domains[condition.field].includes(value)), `${path}: scope domain`);
    }
    assert.ok(scopeCells(claim.scope).length, `${path}: empty extensional scope`);
    if (claim.valid.from !== null && claim.valid.to !== null) assert.ok(Date.parse(claim.valid.from) < Date.parse(claim.valid.to), `${path}: empty interval`);
    if (claim.value.type === 'Range' && claim.value.lower !== null && claim.value.upper !== null) assert.ok(Number(claim.value.lower) <= Number(claim.value.upper), `${path}: inverted range`);
    assert.equal(new Set(claim.qualifiers.map(q => q.key)).size, claim.qualifiers.length, `${path}: qualifier keys`);
  }
  const nodeIds = new Set(answer.reason.nodes.map(node => node.id));
  assert.equal(nodeIds.size, answer.reason.nodes.length, `${path}: duplicate node id`);
  for (const edge of answer.reason.edges) assert.ok(nodeIds.has(edge.from) && nodeIds.has(edge.to), `${path}: absent causal endpoint`);
  // Structural consistency only. Incomplete graphs / missing citations are valid negatives.
  if (answer.current.status !== 'active') assert.equal(answer.current.claims.length, 0, `${path}: inactive claims`);
  if (answer.old.status !== 'available') assert.equal(answer.old.records.length, 0, `${path}: unavailable records`);
  if (answer.reason.status !== 'stated') assert.equal(answer.reason.edges.length, 0, `${path}: unstated edges`);
}

export function validateRow(row) {
  keys(row, ['id', 'set', 'world_id', 'lineage', 'language', 'style', 'scenario', 'causal_class', 'question', 'gold', 'candidate', 'delivered', 'true_label', 'provenance', 'group_id', 'role', 'referral', 'representation', 'evidence_variant'], row.id);
  assert.ok(typeof row.id === 'string' && row.id.length);
  assert.ok(typeof row.question === 'string' && row.question.length > 40, `${row.id}: question`);
  assert.ok(LANGUAGES.includes(row.language) && STYLES.includes(row.style), `${row.id}: language/style`);
  assert.ok(row.lineage.startsWith('hr3-calibration-independent-v1/'), `${row.id}: split namespace`);
  assert.equal(row.world_id, row.lineage);
  assert.equal(row.group_id, row.world_id);
  keys(row.gold, ['answer', 'acceptedGraphs'], `${row.id}.gold`);
  validateAnswer(row.gold.answer, `${row.id}.gold.answer`);
  validateAnswer(row.candidate, `${row.id}.candidate`);
  for (const claim of claims(row.gold.answer)) assert.equal(claim.citations.length, 0, `${row.id}: quotation leaked into G_correct`);
  for (const edge of row.gold.answer.reason.edges) assert.equal(edge.citations.length, 0, `${row.id}: supporting spans leaked into G_correct`);
  assert.ok(Array.isArray(row.gold.acceptedGraphs) && row.gold.acceptedGraphs.length > 0);
  const nodes = new Set(row.gold.answer.reason.nodes.map(node => node.id));
  for (const graph of row.gold.acceptedGraphs) {
    assert.ok(Array.isArray(graph));
    for (const edge of graph) {
      keys(edge, ['from', 'to'], `${row.id}.acceptedGraphs`);
      assert.ok(nodes.has(edge.from) && nodes.has(edge.to));
    }
  }
  const itemKeys = new Set();
  for (const unit of row.delivered) {
    keys(unit, ['item', 'unit', 'source', 'text'], `${row.id}.delivered`);
    assert.ok(Number.isInteger(unit.item) && unit.item >= 0);
    assert.ok(['body', 'receipt'].includes(unit.unit));
    assert.ok(unit.source === null || Number.isInteger(unit.source));
    assert.ok(typeof unit.text === 'string');
    const key = `${unit.item}/${unit.unit}/${unit.source}`;
    assert.ok(!itemKeys.has(key), `${row.id}: repeated delivered key`);
    itemKeys.add(key);
  }
  keys(row.true_label, ['equivalent', 'components', 'causal_correct', 'causal_supported', 'reason'], `${row.id}.true_label`);
  keys(row.true_label.components, ['C', 'O', 'R'], `${row.id}.components`);
  for (const value of [...Object.values(row.true_label.components), row.true_label.equivalent, row.true_label.causal_correct, row.true_label.causal_supported]) assert.equal(typeof value, 'boolean');
  assert.equal(row.true_label.equivalent, Object.values(row.true_label.components).every(Boolean), `${row.id}: conjunction`);
  assert.equal(row.true_label.components.R, row.true_label.causal_correct && row.true_label.causal_supported, `${row.id}: R correctness/support`);
  assert.ok(typeof row.true_label.reason === 'string' && row.true_label.reason.length > 30);
  keys(row.provenance, ['source', 'protocol_sections', 'transformations', 'mutations'], `${row.id}.provenance`);
  assert.equal(row.provenance.source, 'authored_semantic_AST');
  for (const mutation of row.provenance.mutations) {
    keys(mutation, ['component', 'kind', 'path', 'before', 'after', 'rationale'], `${row.id}.mutation`);
    assert.ok(['C', 'O', 'R'].includes(mutation.component));
    assert.equal(mutation.path, { C: 'current', O: 'old', R: 'reason' }[mutation.component]);
    assert.notEqual(stable(mutation.before), stable(mutation.after), `${row.id}: no-op mutation`);
    assert.equal(stable(mutation.after), stable(row.candidate[mutation.path]), `${row.id}: stale mutation snapshot`);
    assert.equal(row.true_label.components[mutation.component], false);
  }
  if (row.referral) {
    keys(row.referral, ['designated_components', 'qualification', 'selection_rule', 'rationale'], `${row.id}.referral`);
    assert.equal(row.referral.qualification, 'pending_frozen_mechanical_pipeline');
    assert.ok(row.referral.designated_components.every(c => ['C', 'O', 'R'].includes(c)));
  }
  if (row.representation) {
    keys(row.representation, ['distortion_class', 'variant', 'locally_supported_false_body'], `${row.id}.representation`);
    assert.ok(DISTORTIONS.includes(row.representation.distortion_class));
    assert.ok(['faithful', 'distorted'].includes(row.representation.variant));
    assert.equal(row.representation.locally_supported_false_body, row.representation.variant === 'distorted');
  }
}

function groups(rows) {
  const result = new Map();
  for (const row of rows) { if (!result.has(row.world_id)) result.set(row.world_id, []); result.get(row.world_id).push(row); }
  return result;
}
export function validateUniqueness(rows) {
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'duplicate case id');
  assert.equal(new Set(rows.map(r => stable([r.question, r.candidate, r.delivered]))).size, rows.length, 'duplicate challenge bundle');
}
export function validateQuotas(sets) {
  const pooled = sets[DATASETS[0]], referrals = sets[DATASETS[1]], evidence = sets[DATASETS[2]], pairs = sets[DATASETS[3]];
  assert.deepEqual(DATASETS.map(file => sets[file].length), [400, 960, 240, 384], '§8 set sizes');
  assert.deepEqual(counts(pooled).equivalent, { true: 200, false: 200 });
  assert.deepEqual(counts(pooled).negative_pattern, { none: 200, C: 60, O: 60, R: 60, COR: 20 });
  assert.deepEqual(counts(pooled).language, { en: 200, 'zh-Hant': 200 });
  for (const language of LANGUAGES.slice(0, 2)) for (const style of STYLES) {
    const rows = pooled.filter(r => r.language === language && r.style === style);
    assert.equal(rows.length, 50);
    assert.equal(rows.filter(r => r.true_label.equivalent).length, 25);
  }
  for (const component of ['C', 'O', 'R']) {
    assert.equal(pooled.filter(r => !r.true_label.components[component]).length, 80);
    assert.equal(pooled.filter(r => r.true_label.components[component]).length, 320);
  }
  assert.equal(groups(referrals).size, 240);
  for (const [worldId, rows] of groups(referrals)) {
    assert.equal(rows.length, 4, worldId);
    assert.equal(rows.filter(r => r.true_label.equivalent).length, 1);
    for (const c of ['C', 'O', 'R']) assert.equal(rows.filter(r => !r.true_label.components[c]).length, 1);
    assert.equal(new Set(rows.map(r => r.style)).size, 1);
  }
  for (const language of LANGUAGES) for (const component of ['C', 'O', 'R']) for (const style of STYLES) {
    const rows = referrals.filter(row => row.language === language && row.style === style && row.referral.designated_components.includes(component));
    assert.equal(rows.filter(r => r.true_label.components[component]).length, 20, `${language}/${component}/${style}: candidate positives (unqualified)`);
    assert.equal(rows.filter(r => !r.true_label.components[component]).length, 20, `${language}/${component}/${style}: candidate negatives (unqualified)`);
  }
  assert.equal(groups(evidence).size, 48);
  for (const [worldId, rows] of groups(evidence)) {
    assert.equal(rows.length, 5, worldId);
    assert.deepEqual(rows.map(r => r.evidence_variant).sort(), ['adequate', 'endpoint_only', 'negated', 'removed', 'truncated']);
    assert.equal(new Set(rows.map(r => stable([r.question, r.candidate, r.gold]))).size, 1, `${worldId}: evidence-only contrast`);
    assert.equal(rows.filter(r => r.true_label.equivalent).length, 1);
  }
  assert.equal(evidence.filter(r => r.true_label.causal_supported).length, 48);
  for (const language of LANGUAGES) for (const style of STYLES) assert.equal(groups(evidence.filter(r => r.language === language && r.style === style)).size, 4);
  assert.equal(groups(pairs).size, 48);
  for (const [worldId, rows] of groups(pairs)) {
    assert.equal(rows.length, 8, worldId);
    assert.equal(new Set(rows.map(r => stable(r.gold))).size, 1);
    for (const style of STYLES) {
      const matched = rows.filter(r => r.style === style);
      assert.equal(matched.length, 2);
      assert.equal(matched.filter(r => r.true_label.equivalent).length, 1);
    }
  }
  for (const language of LANGUAGES) for (const distortion of DISTORTIONS) assert.equal(groups(pairs.filter(r => r.language === language && r.representation.distortion_class === distortion)).size, 4);
}

export async function validate(root = ROOT) {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  const sets = {};
  for (const file of DATASETS) sets[file] = await readJsonl(join(root, file));
  const rows = Object.values(sets).flat();
  validateUniqueness(rows);
  rows.forEach(validateRow);
  validateQuotas(sets);
  const worlds = await readJsonl(join(root, 'worlds.jsonl'));
  assert.equal(worlds.length, 736);
  assert.equal(new Set(worlds.map(w => w.id)).size, worlds.length);
  const worldMap = new Map(worlds.map(w => [w.id, w]));
  for (const world of worlds) {
    assert.equal(world.split, 'calibration-only');
    assert.equal(stable(world.source_ast.semantics), stable(world.gold.answer));
    assert.equal(stable(world.source_ast.accepted_graphs), stable(world.gold.acceptedGraphs));
    validateAnswer(world.source_ast.semantics, world.id);
    for (const graph of world.gold.acceptedGraphs) for (const edge of graph) {
      const support = world.edge_support.find(e => e.from === edge.from && e.to === edge.to);
      assert.ok(support && support.alternatives.length && support.alternatives.every(spans => spans.length), `${world.id}: no edge support`);
      for (const span of support.alternatives.flat()) {
        const unit = world.delivered.find(u => u.item === span.item && u.unit === span.unit && u.source === span.source);
        assert.ok(unit && unit.text.includes(span.quote), `${world.id}: span absent from authored unit`);
      }
    }
  }
  for (const row of rows) {
    const world = worldMap.get(row.world_id);
    assert.ok(world, `${row.id}: missing world`);
    assert.equal(stable(row.gold), stable(world.gold), `${row.id}: gold drift`);
    assert.equal(row.question, world.question, `${row.id}: question drift`);
    assert.equal(row.language, world.language);
  }
  // Independent traversal implementations, scoped exclusively to this directory.
  const viaNode = await inventory(root);
  const viaDirectoryHandles = [];
  const queue = [''];
  for (let i = 0; i < queue.length; i++) {
    const prefix = queue[i];
    for await (const entry of await opendir(join(root, prefix))) {
      const path = join(prefix, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) viaDirectoryHandles.push(path);
      else throw new Error(`Unexpected nonregular artifact: ${path}`);
    }
  }
  assert.deepEqual(viaNode, viaDirectoryHandles.sort(), 'artifact enumeration: recursive readdir vs breadth-first opendir');
  assert.deepEqual(viaNode.filter(f => f !== 'manifest.json'), manifest.artifacts.map(a => a.path).sort(), 'manifest inventory');
  assert.equal(manifest.artifact_count_excluding_manifest, manifest.artifacts.length);
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(root, artifact.path));
    assert.equal(bytes.length, artifact.bytes, `${artifact.path}: byte count`);
    assert.equal(sha256(bytes), artifact.sha256, `${artifact.path}: SHA-256`);
  }
  const protocol = await readFile(new URL('../protocol/protocol-v0.3.4.md', import.meta.url));
  assert.equal(sha256(protocol), manifest.protocol.sha256, 'frozen protocol hash');
  assert.equal(stable(JSON.parse(await readFile(join(root, 'answer.schema.json'), 'utf8'))), stable(answerSchema), 'executable schema drift');
  assert.equal(manifest.total.bundles, 1984);
  assert.equal(manifest.worlds, worlds.length);
  assert.equal(stable(manifest.total), stable(counts(rows)), 'aggregate counts');
  for (const file of DATASETS) assert.equal(stable(manifest.sets[file]), stable(counts(sets[file])), `${file}: quota manifest drift`);
  assert.equal(manifest.qualification.certified_genuine_referrals, null, 'independent author must not self-certify referrals');
  return { bundles: rows.length, independent_worlds: worlds.length, artifact_count: viaNode.length, referral_qualification: 'PENDING', sets, worlds, manifest };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await validate();
  console.log(`VALID: ${result.bundles} bundles; ${result.independent_worlds} independent worlds; ${result.artifact_count} files cross-checked via readdir/opendir and manifest hashes. Genuine-referral qualification: ${result.referral_qualification}.`);
}

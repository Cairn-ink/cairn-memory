import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadFixtures, cells, hash, ROOT, json } from './fixtures.mjs';
import { verifyRegistration, requireHostedRegistration, digest } from './registration.mjs';
import { estimateCost, validateAuthorizationWindow } from './cost.mjs';
import { fakeEmbedder, hostedEmbedder, validateProviderSelection } from './providers.mjs';
import { pendingSafety, checkSafety } from './safety.mjs';
import { analyze } from './analysis.mjs';
import { probeProduct, withProductReader } from '../../tools/testing/p2e-product.mjs';
import { executeSafety } from '../../tools/testing/p2e-safety.mjs';
import { verifyCanonical } from '../../tools/testing/p2e-canonical.mjs';

const code = error => /^(?:[a-z][a-z0-9_]*)(?::[a-z0-9_/-]+)?$/.test(error?.message ?? '') ? error.message : 'evaluation_failed';
const refKey = ref => digest(ref);
export function parseArgs(args) {
  const names = { '--provider': 'provider', '--price-usd-per-million': 'price', '--max-usd': 'maxUsd', '--registration': 'registration', '--report': 'report', '--binding': 'binding', '--authorization-id': 'authorizationId', '--safety-report': 'safetyReport' };
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--estimate') { if (options.estimate) throw Error('duplicate_option'); options.estimate = true; continue; }
    const key = names[args[i]];
    if (!key || Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('invalid_cli_option');
    options[key] = args[++i];
  }
  return options;
}
function blockedReport(registration, fixture, inventory, probe, estimate, provider) {
  return { format: 'p2e-e10-report-v1', status: 'blocked_dependency', registrationDigest: registration.seal.digest,
    inputHashes: registration.files, runtime: process.version, provider, cost: estimate, probe, scheduledPairs: fixture.queries.length * 12,
    strata: Object.fromEntries(inventory.strata.map(s => [s.id, { status: 'not_run', positiveQueries: s.positive.length, negativeQueries: s.negative.length,
      recall12: { A: null, B: null, delta: null }, ndcg12: { A: null, B: null, delta: null }, bootstrap: null }])),
    safety: pendingSafety(), observations: [], decision: { quality: 'pending', enablement: 'pending', failures: [probe.reason] },
    summary: 'Blocked: the public semantic dependency is unavailable. No fixture retrieval or provider construction occurred; quality and safety remain pending.' };
}
function identityMap(fixture, identities, cell) {
  if (!Array.isArray(identities)) throw Error('missing_typed_identity_mapping');
  const map = new Map(), seen = new Set();
  for (const item of identities) {
    const d = fixture.documents.find(d => d.id === item.fixtureId);
    if (!d || seen.has(d.id) || item.ref.type !== d.type || digest(item.ref.namespace) !== digest(d.namespace)
      || item.ref.revision !== d.revision || d.type === 'card' && item.ref.bodyRevision !== d.bodyRevision || map.has(refKey(item.ref))) throw Error('invalid_typed_identity_mapping');
    seen.add(d.id); map.set(refKey(item.ref), d);
  }
  const eligible = fixture.documents.filter(d => d.minWorld <= cell.world && cell.types.includes(d.type) && d.intents.includes(cell.intent));
  if (map.size !== eligible.length || eligible.some(d => !seen.has(d.id))) throw Error('incomplete_typed_identity_mapping');
  return map;
}
export async function readArm(environment, cell, query, semantic, fixture, providerIdentity, withReader = withProductReader) {
  return withReader(await environment.readerOptions(cell, semantic), environment.credential, async (reader, credential) => {
    const caps = await reader.getContextReadCapabilities({}, credential);
    if (!caps.ok || caps.value.channels?.semantic?.configured !== true) throw Error('selected_semantic_capability_missing');
    const input = { readSet: cell.readSet, types: cell.types, intent: cell.intent, query: query.text, semantic, limit: 12, deadlineMs: 5000 };
    const raw = await reader.findCandidates(input, credential);
    if (!raw.ok) return { ok: false, error: raw.error, raw };
    const value = raw.value, mapping = identityMap(fixture, environment.identities, cell), ranking = [];
    let evidenceVerified = true;
    for (const item of value.items) {
      const document = mapping.get(refKey(item.ref));
      if (!document) { evidenceVerified = false; ranking.push(`unknown:${refKey(item.ref)}`); }
      else ranking.push(document.id);
    }
    let evidence = null;
    if (value.items.length) {
      evidence = await reader.fetchCandidateEvidence({ readSet: cell.readSet, refs: value.items.map(i => i.ref), intent: cell.intent, deadlineMs: 5000 }, credential);
      if (!evidence.ok || evidence.value.items.length !== value.items.length) evidenceVerified = false;
      else for (let i = 0; i < evidence.value.items.length; i++) {
        const item = evidence.value.items[i], d = mapping.get(refKey(item.ref));
        const text = item.type === 'memory' ? item.content : `${item.title}\n${item.body}`;
        if (!d || refKey(item.ref) !== refKey(value.items[i].ref) || text !== d.text) evidenceVerified = false;
      }
    }
    return { ok: true, ranking, coverage: value.coverage?.status, effective: value.trace?.effective,
      semanticCoverage: value.trace?.semantic?.coverage, queryEmbeddingAttempts: value.trace?.semantic?.queryEmbeddingAttempts,
      degradedReason: value.trace?.semantic?.degradedReason, preset: value.trace?.preset, evidenceVerified,
      providerIdentityVerified: digest(value.trace?.embedder ?? null) === digest(providerIdentity),
      // Keep exact refs/ranks/channel diagnostics, never bulk evidence text.
      raw, evidence: evidence?.ok ? { ok: true, items: evidence.value.items.map(item => ({ ref: item.ref,
        textHash: hash(item.type === 'memory' ? item.content : `${item.title}\n${item.body}`) })), snapshot: evidence.value.snapshot } : evidence };
  });
}

export async function run(options, env = process.env) {
  const registration = verifyRegistration(JSON.parse(readFileSync(options.registration ?? new URL('./registration.json', import.meta.url))));
  const provider = options.estimate ? 'fake' : validateProviderSelection(options, env);
  const { fixture, labels } = loadFixtures(), inventory = JSON.parse(readFileSync(new URL('inventory.json', ROOT)));
  const tokenTable = JSON.parse(readFileSync(new URL('tokens.json', ROOT)));
  const safetyFixture = JSON.parse(readFileSync(new URL('safety.json', ROOT)));
  const estimate = options.price ? estimateCost(fixture, tokenTable, options.price, options.maxUsd, safetyFixture) : null;
  if (options.estimate) {
    if (!estimate) throw Error('estimate_price_required');
    return { format: 'p2e-e10-estimate-v1', status: 'estimated', registrationDigest: registration.seal.digest, cost: estimate,
      summary: `Offline estimate: ${estimate.schedule.expectedUsd} USD expected; ${estimate.schedule.reservationUsd} USD conservative reservation at the supplied price. No provider constructed.` };
  }
  // Probe the actual public product handle. Never route to the legacy reader or
  // manufacture semantic results while the engine is absent.
  const probe = await probeProduct();
  if (probe.status === 'blocked_dependency') return blockedReport(registration, fixture, inventory, probe, estimate, provider);
  if (!options.binding || !registration.bindingHash) return blockedReport(registration, fixture, inventory,
    { ...probe, status: 'blocked_dependency', reason: 'sealed_public_engine_host_binding_required' }, estimate, provider);
  const bindingBytes = readFileSync(options.binding);
  if (hash(bindingBytes) !== registration.bindingHash) throw Error('engine_binding_hash_mismatch');
  const engineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (registration.engineCommit !== engineCommit) throw Error('engine_commit_mismatch');
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'core/'], { encoding: 'utf8' }).trim()) throw Error('engine_runtime_dirty');
  const binding = await import(pathToFileURL(resolve(options.binding)).href);
  if (typeof binding.prepare !== 'function' || typeof binding.providerIdentity !== 'object') throw Error('invalid_public_engine_binding');
  const safetyObservations = {};
  if (provider === 'hosted') {
    requireHostedRegistration(registration, { engineCommit, providerIdentity: binding.providerIdentity, bindingHash: hash(bindingBytes), authorization: registration.authorization });
    const a = registration.authorization;
    validateAuthorizationWindow(a);
    if (options.authorizationId !== a.id || a.maxUsd !== options.maxUsd || a.priceUsdPerMillion !== options.price
      || !Number.isSafeInteger(a.maxRequests) || a.maxRequests < 1
      || a.syntheticInputsDigest !== digest(registration.files) || typeof a.privacySurface !== 'string' || !a.privacySurface) throw Error('hosted_authorization_mismatch');
    if (!options.safetyReport || !registration.safetyEvidenceHash) throw Error('sealed_fake_safety_evidence_required');
    const safetyBytes = readFileSync(options.safetyReport);
    if (hash(safetyBytes) !== registration.safetyEvidenceHash) throw Error('fake_safety_evidence_hash_mismatch');
    const previous = JSON.parse(safetyBytes);
    if (previous.provider !== 'fake' || previous.engineCommit !== engineCommit || previous.inputHashes?.['evaluation/context-read-p2e/fixtures/safety.json'] !== registration.files['evaluation/context-read-p2e/fixtures/safety.json']) throw Error('fake_safety_evidence_provenance_mismatch');
    for (const [id, cell] of Object.entries(previous.safety ?? {})) safetyObservations[id] = cell.evidence;
    if (Object.values(checkSafety(safetyObservations)).some(s => s.status !== 'passed')) throw Error('fake_safety_evidence_incomplete_or_failed');
  }
  const providerPort = provider === 'fake' ? fakeEmbedder() : await hostedEmbedder({ ...options, maxRequests: registration.authorization.maxRequests, authorization: registration.authorization }, env, tokenTable);
  if (digest(binding.providerIdentity) !== digest(Object.fromEntries(['id','revision','dimensions','normalization'].map(k => [k, providerPort[k]])))) throw Error('provider_identity_mismatch');
  const observations = [];
  let prepared, ordinal = 0;
  try {
    prepared = await binding.prepare({ fixture, labels, provider: providerPort, registration, cost: estimate });
    for (const cell of cells()) {
      const environment = await prepared.prepareCell(cell);
      try {
        identityMap(fixture, environment.identities, cell);
        await verifyCanonical(environment.canonicalPath, cell, fixture, environment.identities);
        for (const query of fixture.queries.filter(q => q.language === cell.language)) {
          const row = { cell: cell.id, query: query.id, order: ordinal++ % 2 ? ['B', 'A'] : ['A', 'B'] };
          for (const arm of row.order) {
            try { row[arm] = await readArm(environment, cell, query, arm === 'B', fixture, binding.providerIdentity); }
            catch (error) { row[arm] = { ok: false, error: { code: code(error) } }; }
          }
          observations.push(row);
        }
      } finally { await environment.close(); }
    }
    // Safety is fake-only here. A hosted request cannot silently add mutation
    // or purge transmissions to the frozen normal-query cost schedule.
    if (provider === 'fake') Object.assign(safetyObservations, await executeSafety(prepared, { semanticCallCount: providerPort.semanticCallCount }));
  } catch (error) {
    observations.push({ cell: 'execution', query: 'failure', error: code(error) });
  } finally { await prepared?.close(); }
  const analysis = analyze({ fixture, labels, inventory, observations, safetyObservations, provider });
  return { format: 'p2e-e10-report-v1', ...analysis, registrationDigest: registration.seal.digest, inputHashes: registration.files,
    engineCommit, providerIdentity: binding.providerIdentity, cost: estimate, probe };
}
export async function main(args = process.argv.slice(2), env = process.env) {
  let options, report;
  try { options = parseArgs(args); report = await run(options, env); }
  catch (error) { report = { format: 'p2e-e10-report-v1', status: 'refused', error: code(error), cost: error.estimate ?? null, summary: `Evaluation refused: ${code(error)}.` }; }
  if (options?.report) writeFileSync(options.report, json(report));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await main();
  console.log(JSON.stringify({ status: report.status, summary: report.summary, error: report.error ?? null, cost: report.cost ?? null,
    safety: report.safety ? { cells: Object.keys(report.safety).length, passed: Object.values(report.safety).filter(s => s.status === 'passed').length,
      failed: Object.values(report.safety).filter(s => s.status === 'failed').length, pending: Object.values(report.safety).filter(s => s.status === 'not_run').length } : null }));
  process.exitCode = report.status === 'estimated' || report.decision?.quality === 'passed' ? 0 : report.status === 'blocked_dependency' ? 2 : 1;
}

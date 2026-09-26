import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedMem0NativeArtifact } from './mem0-native-artifact.mjs';
import { mem0WireProfile } from './mem0-wire.mjs';
import { runNativeGatewayKernel } from './mem0-native-runtime.mjs';

const CHILD_FILE = fileURLToPath(new URL('./testing/mem0-native-child.py', import.meta.url));
const identities = new WeakMap();
const MAX_INPUT = 8 * 1024 * 1024;

export class Mem0NativeGatewayError extends Error {
  constructor(code) {
    super(code);
    this.name = 'Mem0NativeGatewayError';
    this.code = code;
  }
}

function fail(code) { throw new Mem0NativeGatewayError(code); }
function own(value, keys, code = 'invalid_native_options') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key) || !('value' in descriptors[key]))) fail(code);
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}
function digest(tag, value) {
  return createHash('sha256').update(`${tag}\n${JSON.stringify(value)}\n`).digest('hex');
}
function childSha256() {
  let size;
  try { size = fs.statSync(CHILD_FILE).size; } catch { fail('native_child_source_invalid'); }
  if (size < 1 || size > 1024 * 1024) fail('native_child_source_invalid');
  try { return createHash('sha256').update(fs.readFileSync(CHILD_FILE)).digest('hex'); }
  catch { fail('native_child_source_invalid'); }
}
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function wellFormed(value) {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function denseDataArray(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail('invalid_native_input');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail('invalid_native_input');
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !('value' in descriptor)) fail('invalid_native_input');
    items.push(descriptor.value);
  }
  return items;
}

export function mem0NativeConfiguration(options) {
  const { topK, threshold, childTimeoutMs, httpTimeoutMs } = own(options,
    ['topK', 'threshold', 'childTimeoutMs', 'httpTimeoutMs']);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 100
    || typeof threshold !== 'number' || !Number.isFinite(threshold)
    || threshold < 0 || threshold > 1
    || !Number.isSafeInteger(childTimeoutMs) || childTimeoutMs < 1
    || childTimeoutMs > 3_600_000
    || !Number.isSafeInteger(httpTimeoutMs) || httpTimeoutMs < 1
    || httpTimeoutMs > 110_000) fail('invalid_native_configuration');
  const configuration = deepFreeze({ version: 'cairn-mem0-native-configuration-v1',
    wireProfile: structuredClone(mem0WireProfile()), topK, threshold,
    childTimeoutMs, httpTimeoutMs, terminationPolicy: 'owned-group-immediate-kill-v1',
    termGraceMs: 0, reapMs: 5_000,
    inputBytes: MAX_INPUT, outputBytes: 2 * 1024 * 1024, stderrBytes: 64 * 1024,
    connectionLimit: 4, headerLimit: 40, headerBytes: 16 * 1024,
    headerValueBytes: 256,
    headerTimeoutMs: Math.min(2_000, httpTimeoutMs),
    childSourceSha256: childSha256(),
    settings: { memoryVersion: 'v1.1', llmModel: 'gpt-4.1-mini-2025-04-14',
      embeddingModel: 'text-embedding-3-small', embeddingDimensions: 1536,
      localBaseUrl: 'http://unix-gateway/v1',
      vectorStore: 'local-qdrant', graph: false, reranker: false,
      vision: false, telemetry: false, optionalSpacy: 'unavailable-required-v1',
      sdkRetries: 0, infer: true,
      searchRerank: false, searchExplain: false, searchShowExpired: false },
    scopePolicy: 'x-schedule-case-v1', storePolicy: 'fresh-private-case-v1',
    transportPolicy: 'private-uds-v1',
    containmentPolicy: 'bwrap-user-net-pid-ipc-root-readonly-v1' });
  const result = Object.freeze({ configuration,
    configurationSha256: digest('cairn.mem0.native.configuration.v1', configuration) });
  identities.set(result, true);
  return result;
}

function inputSnapshot(value) {
  const { batches, query } = own(value, ['batches', 'query'], 'invalid_native_input');
  if (typeof query !== 'string' || query.length === 0 || !wellFormed(query)
    || Buffer.byteLength(query, 'utf8') > 16 * 1024) fail('invalid_native_input');
  let byteCount = Buffer.byteLength(JSON.stringify({ batches: [], query }), 'utf8');
  const copied = denseDataArray(batches, 1, 2500).map((batch) => {
    const messages = denseDataArray(batch, 1, 24).map((message) => {
      const { role, content } = own(message, ['role', 'content'], 'invalid_native_input');
      if (!['user', 'assistant', 'system'].includes(role) || typeof content !== 'string'
        || content.length === 0 || content.length > MAX_INPUT || !wellFormed(content)) {
        fail('invalid_native_input');
      }
      const copiedMessage = { role, content };
      byteCount += Buffer.byteLength(JSON.stringify(copiedMessage), 'utf8') + 2;
      if (byteCount > MAX_INPUT) fail('invalid_native_input');
      return copiedMessage;
    });
    byteCount += 2;
    if (byteCount > MAX_INPUT) fail('invalid_native_input');
    return messages;
  });
  const result = { batches: copied, query };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_INPUT) fail('invalid_native_input');
  return deepFreeze(result);
}

function scopeIdentity(capability, handle) {
  const snapshot = handle?.snapshot?.();
  if (snapshot?.version !== 'mixed-source-pair-scope-v1'
    || !Number.isSafeInteger(snapshot.ordinal) || snapshot.ordinal < 0
    || snapshot.phase !== 'generation' || snapshot.arm !== 'mem0'
    || snapshot.status !== 'active'
    || typeof handle?.revoke !== 'function' || typeof handle?.halt !== 'function'
    || !(handle?.revocationSignal instanceof AbortSignal)) fail('native_scope_required');
  const scheduled = capability.schedule?.[snapshot.ordinal];
  if (!scheduled || scheduled.phase !== snapshot.phase
    || typeof scheduled.caseId !== 'string') fail('native_scope_required');
  const arm = capability.roster?.flatMap((entry) => entry.arms)
    .find((entry) => entry.scopeId === scheduled.caseId);
  if (arm?.name !== 'mem0') fail('native_scope_required');
  return Object.freeze({ ordinal: snapshot.ordinal, phase: snapshot.phase,
    arm: snapshot.arm, caseId: scheduled.caseId });
}

export async function runMem0NativeCase(options) {
  const { artifact, configuration: suppliedConfiguration, guard, handle, input } = own(options,
    ['artifact', 'configuration', 'guard', 'handle', 'input']);
  const validatedInput = inputSnapshot(input);
  const capability = guard?.mixedSourcePairCapability;
  if (!capability || typeof guard?.mem0ChatFetch !== 'function'
    || typeof guard?.mem0EmbeddingFetch !== 'function'
    || typeof guard?.getState !== 'function' || typeof guard?.attempts !== 'function'
    || guard.isHalted?.()) fail('native_guard_required');
  const scope = scopeIdentity(capability, handle);
  if (!identities.has(suppliedConfiguration)) {
    handle.halt(); fail('native_configuration_identity_required');
  }
  const { configuration, configurationSha256 } = suppliedConfiguration;
  let currentChildSha256;
  try { currentChildSha256 = childSha256(); }
  catch { handle.halt(); fail('native_child_source_invalid'); }
  if (currentChildSha256 !== configuration.childSourceSha256
    || digest('cairn.mem0.native.configuration.v1', configuration) !== configurationSha256
    || JSON.stringify(configuration.wireProfile) !== JSON.stringify(mem0WireProfile())) {
    handle.halt(); fail('native_configuration_changed');
  }
  const manifest = capability.manifest?.mem0;
  if (manifest?.version !== '2.2.0'
    || manifest.sourceTreeSha256 !== artifact?.sourceTreeSha256
    || manifest.dependencyLockSha256 !== artifact?.dependencyLockSha256
    || manifest.configurationSha256 !== configurationSha256
    || JSON.stringify(manifest.wireProfile) !== JSON.stringify(mem0WireProfile())
    || configuration.httpTimeoutMs !== capability.limits?.mem0TimeoutMs) {
    handle.halt(); fail('native_manifest_mismatch');
  }
  let roots;
  try { roots = checkedMem0NativeArtifact(artifact); }
  catch { handle.halt(); fail('native_artifact_changed'); }
  return runNativeGatewayKernel({ artifact, roots, configuration,
    childFile: CHILD_FILE, guard, handle, input: validatedInput, scope });
}

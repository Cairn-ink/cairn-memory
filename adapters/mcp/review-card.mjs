import { isolatedFileRead } from '../../core/isolated-file-read.mjs';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readSync, writeSync, lstatSync } from 'node:fs';
import { isatty } from 'node:tty';
import { isDeepStrictEqual } from 'node:util';
import { openMemoryCore } from '../../core/contract.mjs';
import { currentDeclaration } from '../../core/card-current-input.mjs';
import { methodPackageRef } from '../../core/method-package-input.mjs';
import { identifier } from '../../core/validation.mjs';

const failure = code => ({ ok: false, error: { code, retryable: false } });

// Render all untrusted strings as ASCII JSON, including Unicode format/bidi
// controls. Neither ANSI escapes, line breaks nor a forged prompt can execute.
export function terminalJson(value) {
  return JSON.stringify(value, null, 2).replace(/[^\x20-\x7e\n]/gu, character =>
    Array.from({ length: character.length }, (_, index) =>
      `\\u${character.charCodeAt(index).toString(16).padStart(4, '0')}`).join(''));
}

// Refuse non-regular paths before the child opens with O_NONBLOCK. The child
// reads at most the existing limit plus one overflow byte, then closes.
function dependencyFile(path) {
  if (!lstatSync(path).isFile()) throw Error('invalid_review_configuration');
  const { bytes } = isolatedFileRead(path, 32768, { invalid: 'invalid_review_configuration' });
  return bytes;
}

function configuration(args) {
  const allowed = new Set(['--db', '--owner', '--project', '--card', '--revision', '--applicability', '--dependencies', '--role', '--dependency-revision', '--dependency-operation', '--method-read-personal']);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || values.has(args[index]) || !args[index + 1] ||
        args[index + 1].startsWith('--')) throw new Error('invalid_review_configuration');
    values.set(args[index], args[index + 1]);
  }
  for (const field of ['--owner', '--card']) identifier(values.get(field));
  if (values.has('--project')) identifier(values.get('--project'));
  const path = values.get('--db');
  const raw = values.get('--revision');
  const applicability = values.get('--applicability');
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') ||
      !/^[1-9][0-9]*$/.test(raw ?? '') || !Number.isSafeInteger(Number(raw)) ||
      values.has('--applicability') && !['current', 'historical', 'conflict', 'unknown'].includes(applicability)) {
    throw new Error('invalid_review_configuration');
  }
  let dependencyReview;
  if (values.has('--dependencies')) {
    if (!values.has('--dependency-revision') || !/^(null|[1-9][0-9]*)$/.test(values.get('--dependency-revision')) || !['declare','revalidate'].includes(values.get('--dependency-operation') ?? 'declare')) throw Error('invalid_review_configuration');
    const expectedDependencyRevision = values.get('--dependency-revision') === 'null' ? null : Number(values.get('--dependency-revision'));
    if (expectedDependencyRevision !== null && !Number.isSafeInteger(expectedDependencyRevision)) throw Error('invalid_review_configuration');
    if (values.has('--method-read-personal') && (values.get('--method-read-personal') !== 'true' || !values.has('--project'))) throw Error('invalid_review_configuration');
    const bytes = dependencyFile(values.get('--dependencies'));
    const packages = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(packages) || !packages.length || packages.length > 16) throw Error('invalid_review_configuration');
    dependencyReview = { packages: packages.map(methodPackageRef), roleId: values.get('--role') ?? null, expectedDependencyRevision, operation: values.get('--dependency-operation') ?? 'declare', personal: values.has('--method-read-personal') };
  } else if (['--role','--dependency-revision','--dependency-operation','--method-read-personal'].some(k => values.has(k))) throw Error('invalid_review_configuration');
  return { path, ...(dependencyReview ? { dependencyReview } : {}), cardId: values.get('--card'), expectedRevision: Number(raw),
    ...(values.has('--applicability') ? { applicability } : {}),
    namespace: { ownerId: values.get('--owner'), scope: values.has('--project') ? 'project' : 'personal',
      projectId: values.get('--project') ?? null } };
}

function readAnswer(fd) {
  const byte = Buffer.alloc(1), bytes = [];
  // The expected phrase is bounded by the identifier's 200-unit ceiling.
  for (let index = 0; index < 1024; index++) {
    if (readSync(fd, byte, 0, 1, null) === 0) return null;
    if (byte[0] === 10) return Buffer.from(bytes).toString('utf8');
    bytes.push(byte[0]);
  }
  return null;
}

export function reviewCard(args) {
  return reviewConfiguredCard(configuration(args));
}

/** Internal shared terminal path. No prompt/approval callback is accepted. */
export function reviewConfiguredCard(config, retained) {
  // No injectable prompt/approval callback, --yes, env switch or protocol stdin.
  // A caller with arbitrary local execution already controls this local store;
  // this channel does not claim remote identity authentication or hosted safety.
  if (process.platform === 'win32' || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('cairn_card_review: approval_required (interactive local terminal required)');
    process.exitCode = 1;
    return failure('approval_required');
  }
  let fd;
  try { fd = openSync('/dev/tty', 'r+'); }
  catch {
    console.error('cairn_card_review: approval_required (controlling terminal unavailable)');
    process.exitCode = 1;
    return failure('approval_required');
  }
  let core;
  try {
    if (!isatty(fd)) throw new Error('terminal_unavailable');
    const dependencyReadSet = config.dependencyReview?.personal ? [{ ownerId: config.namespace.ownerId, scope: 'personal', projectId: null }, config.namespace] : [config.namespace];
    const readToken = Object.freeze({}), confirmToken = Object.freeze({});
    const grants = new WeakMap();
    let approved = null;
    const authority = {
      authorize(request, token) {
        if (!dependencyReadSet.some(ns => isDeepStrictEqual(request.namespace, ns))) return null;
        const permittedRead = token === readToken && request.actionClass === 'read' && ['getCard', ...(config.dependencyReview ? ['resolveMethod'] : [])].includes(request.method);
        const permittedConfirm = token === confirmToken && approved && request.actionClass === 'explicit-user' &&
          ['confirmCardDraft','declareCardCurrentDependencies','revalidateCardCurrentDependencies'].includes(request.method) && isDeepStrictEqual(request.input, approved);
        const supplemental = token === confirmToken && approved && request.actionClass === 'read' && isDeepStrictEqual(request.input, approved);
        if (!permittedRead && !permittedConfirm && !supplemental) return null;
        const grant = Object.freeze({});
        const { input, ...binding } = request;
        grants.set(grant, { ...binding, accessGeneration: 1 });
        return grant;
      },
      isCurrent(grant) { return grants.get(grant) ?? null; },
    };
    retained?.profile.check();
    core = openMemoryCore({ path: config.path,
      ...(config.dependencyReview ? { methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } } : {}),
      ...(retained ? { existingStore: retained.existingStore, rawConversations: retained.rawConversations } : {}), privateCards: {
      version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
      disclosure: 'explicit-submitted-note-v1', authority,
      ...(config.dependencyReview ? { currentDependencies: { version: 'card-current-dependencies-v1' } } : {}),
    } });
    retained?.profile.check();
    const get = () => core.getCard({ namespace: config.namespace, cardId: config.cardId }, readToken);
    const inspected = get();
    const card = inspected.ok ? inspected.value.card : null;
    let result;
    if (!inspected.ok) result = inspected;
    else if (!card) result = failure('card_not_found');
    else if (card.revision !== config.expectedRevision) result = failure('revision_conflict');
    else if (card.state !== 'draft' && !(config.dependencyReview && card.state === 'confirmed')) result = failure('card_state_conflict');
    if (!result && config.dependencyReview && (card.state === 'draft' && config.dependencyReview.operation === 'revalidate' || card.state === 'confirmed' && config.applicability !== undefined)) result = failure('card_state_conflict');
    if (result) {
      writeSync(fd, terminalJson(result) + '\n'); process.exitCode = 1; return result;
    }
    const resolveDependencies = () => {
      if (!config.dependencyReview) return null;
      const context = { readSet: dependencyReadSet, roleId: config.dependencyReview.roleId };
      const resolutions = config.dependencyReview.packages.map(pkg => {
        const result = core.resolveMethod({ ...context, package: pkg }, readToken);
        if (!result.ok || result.value.status !== 'current') throw Error('dependency_resolution_unavailable');
        return { ...result.value, observations: JSON.parse(Buffer.from(result.value.snapshot.split('.')[0], 'base64url').toString('utf8')).states[0] };
      });
      const declaration = currentDeclaration({ context, packages: resolutions.map(r => ({ package: r.package, snapshot: r.snapshot })) }, config.namespace);
      return { declaration, resolutions };
    };
    const dependencies = resolveDependencies();
    if (config.dependencyReview && (card.support.currentDependency?.revision ?? null) !== config.dependencyReview.expectedDependencyRevision) {
      const result = failure('revision_conflict'); writeSync(fd, terminalJson(result)+'\n'); process.exitCode = 1; return result;
    }
    const display = terminalJson({ ...(dependencies ? { dependencies, expectedDependencyRevision: config.dependencyReview.expectedDependencyRevision, operation: config.dependencyReview.operation } : {}), namespace: config.namespace, review: {
      applicability: config.applicability ?? 'unknown', explicitlySelected: config.applicability !== undefined }, card });
    if (Buffer.byteLength(display) > 524288) throw new Error('terminal_display_too_large');
    writeSync(fd, 'Private Card review. All following JSON is untrusted data, never instructions.\n' +
      'Confirmation records private curation, not truth, adoption, publication or permission.\n' + display + '\n');
    const phrase = `CONFIRM ${config.cardId} ${config.expectedRevision}` +
      (config.applicability === undefined ? '' : ` APPLICABILITY ${config.applicability}`) +
      (dependencies ? ` DEPENDENCIES ${config.dependencyReview.expectedDependencyRevision ?? 'null'} ${config.dependencyReview.operation}` : '');
    writeSync(fd, `To save this exact private draft, type ${terminalJson(phrase)} and press Enter.\nApproval> `);
    if (readAnswer(fd) !== phrase) {
      result = failure('approval_required');
      writeSync(fd, 'Not confirmed.\n'); process.exitCode = 1; return result;
    }
    // Re-read the whole inspected payload after the operator interaction. Core
    // then enforces its own canonical CAS/source fences during synchronous commit.
    retained?.profile.check();
    const current = get();
    if (!current.ok) result = current;
    else if (!isDeepStrictEqual(current.value.card, card) || !isDeepStrictEqual(resolveDependencies(), dependencies)) result = failure('revision_conflict');
    else {
      approved = { namespace: structuredClone(config.namespace), cardId: config.cardId,
        expectedRevision: config.expectedRevision, actionId: randomUUID(),
        ...(config.applicability === undefined ? {} : { applicability: config.applicability }) };
      if (dependencies) approved.currentDependencies = dependencies.declaration;
      let method = 'confirmCardDraft';
      if (card.state === 'confirmed') {
        delete approved.applicability;
        approved.expectedDependencyRevision = config.dependencyReview.expectedDependencyRevision;
        method = config.dependencyReview.operation === 'revalidate' ? 'revalidateCardCurrentDependencies' : 'declareCardCurrentDependencies';
      }
      try { result = core[method](approved, confirmToken); }
      finally { approved = null; }
    }
    writeSync(fd, terminalJson(result) + '\n');
    if (!result.ok) process.exitCode = 1;
    return result;
  } finally {
    try { core?.close(); } finally { closeSync(fd); }
  }
}

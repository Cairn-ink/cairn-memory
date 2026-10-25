import { createHash } from 'node:crypto';
import { stable } from './canonical.mjs';
import {
  verifyFamilyTrivia, TRIVIA_VERSION as GENERATOR_TRIVIA_VERSION,
  TRIVIA_AUTH_VERSION, TRIVIA_RULES, TRIVIA_RULES_SHA256,
} from '../generator/trivia.mjs';

export { GENERATOR_TRIVIA_VERSION };
export const SUPPORT_VERSION = 'hr3-support-a6-v3';
export const TRIVIA_VERSION = 'hr3-trivia-a6-v3';
export const GENERATOR_RULES_VERSION = 'hr3-optional-trivia-licenses-a6-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const authorities = new WeakMap(), cases = new WeakMap(), proofs = new WeakMap(), failures = new WeakMap();
// Descriptive only: candidate emptiness never authorizes unlicensed scoring.
export const carriesTrivia = gold => Boolean(gold?.supportTrivia && (gold.supportTrivia.producer ||
  gold.supportTrivia.rules?.length || gold.supportTrivia.positions?.length || failures.has(gold.supportTrivia)));
export const UNLICENSED_AUTHORITY_VERSION = 'hr3-independent-slot-no-trivia-a6-v1';
const unlicensedAuthorities = new WeakMap(), unlicensedCases = new WeakMap(), unlicensedGold = new WeakMap();
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const originKey = (familyId, origin) => stable([familyId, origin]);
const key = (scope, origin, position) => stable([scope.familyId, scope.handleHash, scope.caseHash, origin, position]);
export const eligibleTrivia = char => char.length === 1 && (/\s/u.test(char) || '.,;:，。；：、'.includes(char));
function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
const sourceTurns = family => family.batches.flatMap(b => b.turns).map(({ turn_id, text }) => ({ turn_id, text }));

// This separate, reviewed catalog has the harness's frozen no-trivia format.
// Its exact-byte pin is trusted configuration, never computed from a candidate.
export function createUnlicensedTriviaAuthority(bytes, expectedSha256) {
  if (!sha256(expectedSha256) || hash(bytes) !== expectedSha256) throw new TypeError('Unlicensed trivia authority pin mismatch');
  const catalog = JSON.parse(bytes.toString());
  const fields = ['family', 'caseId', 'question', 'sourceSHA256', 'goldSHA256', 'trivia'];
  const ids = new Set();
  if (!catalog || Object.keys(catalog).length !== 2 || catalog.version !== UNLICENSED_AUTHORITY_VERSION || !Array.isArray(catalog.cases) ||
      catalog.cases.some(record => {
        if (!record || Object.keys(record).length !== fields.length || !fields.every(field => Object.hasOwn(record, field)) ||
            record.trivia !== 'none' || !['family', 'caseId', 'question'].every(field => typeof record[field] === 'string' && record[field].length) ||
            !sha256(record.sourceSHA256) || !sha256(record.goldSHA256)) return true;
        const id = stable([record.family, record.caseId]);
        if (ids.has(id)) return true;
        ids.add(id); return false;
      })) throw new TypeError('Invalid frozen unlicensed trivia catalog');
  const authority = Object.freeze({ authority_sha256: expectedSha256 });
  unlicensedAuthorities.set(authority, immutable(structuredClone(catalog)));
  return authority;
}

// The trusted target is the complete original source world (including its id
// and question). Bind the exact scoring gold object as well as its frozen hash.
export function createUnlicensedTriviaCase({ authority, target, gold } = {}) {
  const catalog = unlicensedAuthorities.get(authority);
  if (!catalog || typeof target?.id !== 'string' || !target.id || typeof target.question !== 'string' || !target.question ||
      !gold || carriesTrivia(target.gold) || carriesTrivia(gold)) throw new TypeError('Missing trusted unlicensed trivia binding');
  const sourceSHA256 = hash(stable(target)), caseId = target.id + '/source/' + sourceSHA256;
  const record = catalog.cases.find(r => r.family === target.id && r.caseId === caseId && r.question === target.question && r.sourceSHA256 === sourceSHA256);
  if (!record) throw new TypeError('Target is absent from frozen unlicensed trivia authority');
  if (gold.question !== record.question || hash(stable(gold)) !== record.goldSHA256) throw new TypeError('Unlicensed trivia gold/target mismatch');
  const binding = hash(stable([authority.authority_sha256, record]));
  const prior = unlicensedGold.get(gold);
  if (prior && prior.binding !== binding) throw new TypeError('Unlicensed trivia gold already bound to another target');
  const token = Object.freeze({});
  const context = { authority, record, binding, gold };
  unlicensedGold.set(gold, context); unlicensedCases.set(token, context);
  return token;
}

export function compileUnlicensedTrivia(gold, token) {
  const context = unlicensedCases.get(token), expected = unlicensedGold.get(gold);
  if (!context || !expected || context.gold !== gold || context.binding !== expected.binding || context.record !== expected.record ||
      carriesTrivia(gold) || gold.question !== context.record.question || hash(stable(gold)) !== context.record.goldSHA256) return protectedCoverage('missing_or_mismatched_unlicensed_trivia_case');
  const predicate = () => false;
  predicate.authentication = Object.freeze({ status: 'authenticated_unlicensed', authority_sha256: context.authority.authority_sha256,
    expected_case_sha256: context.binding });
  return predicate;
}

// Trusted configuration only. The expected digest must come from the primary's
// independent freeze pin, never a reader answer, gold row, or candidate registry.
// Handles are detached into a private store; a lookalike object is not authority.
export function createTriviaAuthority(freezeBytes, expectedSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') || hash(freezeBytes) !== expectedSha256) throw new TypeError('Trivia freeze pin mismatch');
  const freeze = JSON.parse(freezeBytes.toString());
  const spec = freeze.optional_trivia;
  if (spec?.version !== GENERATOR_TRIVIA_VERSION || spec.authentication_version !== TRIVIA_AUTH_VERSION || spec.rules_sha256 !== TRIVIA_RULES_SHA256 ||
      !spec.family_handles || hash(stable(spec.family_handles)) !== spec.family_handles_sha256) throw new TypeError('Invalid freeze-bound trivia handles');
  const authority = Object.freeze({ freeze_sha256: expectedSha256 });
  authorities.set(authority, immutable(structuredClone(spec.family_handles)));
  return authority;
}
// Construct this from the trusted dispatch/checkpoint being scored, separately
// from the candidate proof. Case IDs must distinguish checkpoints/queries while
// remaining shared across arms for the same question. Handles come only from
// the expected authority's independently pinned family table.
export function createTriviaCase({ family, authority, caseId, question } = {}) {
  const handles = authorities.get(authority);
  if (!handles || typeof caseId !== 'string' || !caseId.length || typeof question !== 'string' || !question.length) throw new TypeError('Missing trusted trivia case binding');
  const snapshot = immutable(structuredClone(family));
  const handle = handles[snapshot.family_id];
  if (!handle || handle.family_id !== snapshot.family_id || handle.lineage_id !== snapshot.lineage_id || handle.seed !== snapshot.seed ||
      handle.namespace_sha256 !== hash(stable(snapshot.namespace)) || handle.source_turns_sha256 !== hash(stable(sourceTurns(snapshot)))) throw new TypeError('Expected trivia family/handle mismatch');
  const context = { family: snapshot, handle, authority, caseId, question };
  const token = Object.freeze({ family_id: snapshot.family_id, case_id: caseId });
  cases.set(token, context);
  return token;
}
const scopeFor = context => ({ familyId: context.family.family_id, handleHash: hash(stable(context.handle)),
  caseHash: hash(stable([context.family, context.handle, context.authority.freeze_sha256, context.caseId, context.question])) });
function protectedRegistry(reason) {
  const registry = immutable({ version: TRIVIA_VERSION, producer: null, rules: [], positions: [] });
  failures.set(registry, reason);
  return registry;
}
function protectedCoverage(reason, expected) {
  const predicate = () => false;
  predicate.authentication = Object.freeze({ status: 'protected', reason, ...(expected ? { expected_case_sha256: scopeFor(expected).caseHash } : {}) });
  return predicate;
}

// The legacy three arguments deliberately grant no licenses. Authentication is
// supplied separately by the trusted caller, never as a field of the candidate.
export function adaptGeneratorTrivia(registry, rulesBytes, turns, { family, authority, caseId, question } = {}) {
  try {
    const handles = authorities.get(authority);
    if (!handles) return protectedRegistry('missing_trusted_freeze_authority');
    if (!handles[family?.family_id]) return protectedRegistry('missing_freeze_bound_family_handle');
    const context = cases.get(createTriviaCase({ family, authority, caseId, question }));
    const { family: snapshot, handle } = context;
    // This call checks the freeze-bound digests and replays the authenticated
    // original input tape. Never compile the mutable candidate or its offsets.
    const verified = verifyFamilyTrivia({ family: snapshot, registry }, handle);
    if (hash(rulesBytes) !== verified.rules_sha256 || stable(turns) !== stable(sourceTurns(snapshot))) return protectedRegistry('trivia_rules_or_source_mismatch');
    const source = new Map(sourceTurns(snapshot).map(t => [originKey(snapshot.family_id, t.turn_id), t.text]));
    const output = { version: TRIVIA_VERSION, producer: { version: GENERATOR_TRIVIA_VERSION, rules_sha256: verified.rules_sha256,
      freeze_sha256: authority.freeze_sha256, handle_sha256: hash(stable(handle)) }, rules: [], positions: [] };
    const normalizedRules = new Map();
    for (const origin of verified.origins) for (const segment of origin.segments) {
      for (const rule of TRIVIA_RULES.rules.filter(r => r.production === segment.production && r.language === segment.language)) {
        const part = segment.parts.find(p => p.kind === 'literal' && p.literal_index === rule.literal_index);
        const id = stable([rule.production, rule.language, rule.literal_index]);
        if (!normalizedRules.has(id)) normalizedRules.set(id, { id, production: rule.production, language: rule.language,
          literal: source.get(originKey(snapshot.family_id, origin.turn_id)).slice(part.start, part.end), optional_offsets: [] });
        const offsets = normalizedRules.get(id).optional_offsets;
        if (!offsets.includes(rule.literal_offset)) offsets.push(rule.literal_offset);
        output.positions.push({ origin: origin.turn_id, position: part.start + rule.literal_offset, char: rule.character, rule: id, literal_offset: rule.literal_offset });
      }
    }
    output.rules = [...normalizedRules.values()];
    immutable(output);
    proofs.set(output, { ...context, registry: verified });
    return output;
  } catch {
    // Authentication is fail-closed, not an attempted repair or an answer error.
    return protectedRegistry('trivia_authentication_failed');
  }
}

// No declarations, booleans, self-declared digests or serialized lookalikes can
// become a license. Every compilation rechecks the generator verifier against
// the separately pinned handle and uses only its immutable returned registry.
export function compileTrivia(registry, spans, expectedCase, question) {
  const expected = cases.get(expectedCase);
  const proof = proofs.get(registry);
  if (!proof) return protectedCoverage(failures.get(registry) ?? 'unauthenticated_trivia_registry', expected);
  if (!expected || question !== expected.question) return protectedCoverage('missing_or_mismatched_expected_trivia_case', expected);
  if (proof.caseId !== expected.caseId || proof.question !== expected.question || stable(proof.family) !== stable(expected.family) ||
      stable(proof.handle) !== stable(expected.handle) || proof.authority.freeze_sha256 !== expected.authority.freeze_sha256) return protectedCoverage('trivia_target_binding_mismatch', expected);
  try {
    // Verify against the independently expected family/handle, never only the
    // proof's own identity. Identical local source bytes do not establish scope.
    const verified = verifyFamilyTrivia({ family: expected.family, registry: proof.registry }, expected.handle);
    const scope = scopeFor(expected);
    const source = new Map(sourceTurns(expected.family).map(t => [originKey(scope.familyId, t.turn_id), t.text]));
    for (const span of spans.values()) {
      const content = source.get(originKey(scope.familyId, span.origin));
      if (typeof content !== 'string' || span.start < 0 || span.end > content.length || content.slice(span.start, span.end) !== span.text) return protectedCoverage('trivia_support_source_mismatch', expected);
    }
    const optional = new Map();
    for (const origin of verified.origins) for (const position of origin.positions) {
      const char = source.get(originKey(scope.familyId, origin.turn_id))[position];
      if (!eligibleTrivia(char)) return protectedCoverage('invalid_authenticated_trivia_character', expected);
      optional.set(key(scope, origin.turn_id, position), char);
    }
    // Wire origins remain local. Internal source/license identities include the
    // independently expected family, handle and scoring case on both lookups.
    const predicate = (origin, position, char) => optional.get(key(scope, origin, position)) === char;
    predicate.authentication = Object.freeze({ status: 'authenticated', freeze_sha256: expected.authority.freeze_sha256,
      handle_sha256: scope.handleHash, expected_case_sha256: scope.caseHash });
    return predicate;
  } catch {
    return protectedCoverage('trivia_authentication_failed', expected);
  }
}

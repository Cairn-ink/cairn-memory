import { inspectExistingStorePin } from '../../core/existing-store.mjs';
import { ownData } from '../../core/local-authority-input.mjs';
import { identifier } from '../../core/validation.mjs';
import { assertRetainedRuntime, readRetainedRawProfile, retainedProfilePath, retainedRawOptions } from './retained-raw-profile.mjs';

function options(value) {
  try {
    const input = ownData(value, ['profilePath']);
    if (Object.keys(input).length !== 1 || !retainedProfilePath(input.profilePath)) throw Error();
    return input;
  } catch { throw new Error('invalid_mcp_configuration'); }
}

/** Internal CLI preparation: negotiation instances share one immutable profile. */
export async function prepareRetainedRawServer(value) {
  assertRetainedRuntime();
  const { profilePath } = options(value), profile = await readRetainedRawProfile(profilePath);
  const [{ openMemoryCore }, { buildCairnServer }, { createScopedCardAccess }] = await Promise.all([
    import('../../core/contract.mjs'), import('./server.mjs'), import('./private-card-access.mjs'),
  ]);
  return async () => {
    profile.check();
    // Keep database refusal inside the existing MCP construction boundary.
    const pin = await inspectExistingStorePin(profile.path, profile.storeId);
    profile.check();
    const cards = createScopedCardAccess(profile.namespace, { rawSources: true });
    let core;
    try {
      core = openMemoryCore({ path: profile.path, existingStore: pin,
        privateCards: cards.configuration, rawConversations: retainedRawOptions() });
      profile.check();
    } catch (error) { cards.revoke(); core?.close(); throw error; }
    // From this point the builder owns cleanup on construction failure and close.
    return buildCairnServer({ path: profile.path, binding: profile.namespace, core, cards, retainedRaw: true,
      client: 'cairn-local-mcp', sessionId: 'explicit-tool', captureSessionId: 'submitted-capture' });
  };
}

export async function createRetainedRawServer(value) {
  const factory = await prepareRetainedRawServer(value);
  return factory();
}

function reviewConfiguration(args) {
  const allowed = new Set(['--retained-raw-profile', '--card', '--revision', '--applicability']), values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || values.has(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('invalid_mcp_configuration');
    }
    values.set(args[index], args[index + 1]);
  }
  const profilePath = values.get('--retained-raw-profile'), raw = values.get('--revision');
  const applicability = values.get('--applicability');
  try { identifier(values.get('--card')); } catch { throw new Error('invalid_mcp_configuration'); }
  if (!retainedProfilePath(profilePath) || !/^[1-9][0-9]*$/.test(raw ?? '') || !Number.isSafeInteger(Number(raw)) ||
      applicability !== undefined && !['current', 'historical', 'conflict', 'unknown'].includes(applicability)) {
    throw new Error('invalid_mcp_configuration');
  }
  return { profilePath, cardId: values.get('--card'), expectedRevision: Number(raw),
    ...(applicability === undefined ? {} : { applicability }) };
}

export async function reviewRetainedRawCard(args) {
  assertRetainedRuntime();
  const config = reviewConfiguration(args), profile = await readRetainedRawProfile(config.profilePath);
  const pin = await inspectExistingStorePin(profile.path, profile.storeId);
  const { reviewConfiguredCard } = await import('./review-card.mjs');
  return reviewConfiguredCard({ path: profile.path, namespace: profile.namespace, cardId: config.cardId,
    expectedRevision: config.expectedRevision, ...(config.applicability === undefined ? {} : { applicability: config.applicability }) },
  { profile, rawConversations: retainedRawOptions(), existingStore: pin });
}

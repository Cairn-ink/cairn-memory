import { bytes } from './confirmation-parity.mjs';
export const namespace = { ownerId: 'cf2-synthetic', scope: 'project', projectId: 'p' };
export const receipt = content => ({ client: 'synthetic', sessionId: 's', eventId: content, role: 'user', excerpt: content });
export function admit(core, content, kind = 'fact', ns = namespace) {
  const result = core.admit({ namespace: ns, memory: { content, kind }, receipts: [receipt(content)] });
  if (!result.ok) throw Error(JSON.stringify(result));
  return result.value.memory;
}
export async function parity(open, path) {
  const core = open({ path, ...episodeOptions });
  try {
    await openStep(core);
    admit(core, 'Synthetic standing instruction', 'instruction');
    admit(core, 'Synthetic explicit fact');
    admit(core, 'Synthetic context', 'context');
    return [{}, { groups: {} }, { groups: { nextSteps: false } },
      { groups: { procedural: false } }, { groups: { nextSteps: false, procedural: false } },
      { maxChars: 600, maxTokens: 200 }].map(input => ({ input, bytes: bytes(core.sessionStartContext({ namespace, ...input })) }));
  } finally { core.close(); }
}

// Scripted ports only: no provider or network generation.
export const episodeOptions = {
  sessionEpisodes: { mode: 'episode-v1' }, captureEvidence: 'staged-v1',
  captureQualification: 'source-bound-v2',
  model: { contextWindow: 8192, countTokens: text => Math.ceil(text.length / 5),
    extract: () => ({ items: [] }), interpretEpisode({ input }) {
      const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: input.sources[0].text.length }] });
      return { type: field('work'), language: 'en', gist: field('Synthetic review.'),
        outcome: null, nextStep: field('Review synthetic change.'), disposition: null };
    } },
};
export async function openStep(core) {
  const result = await core.capture({ namespace, client: 'synthetic', sessionId: 'synthetic-step', eventId: 'step',
    episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
    messages: [{ id: 'message', role: 'user', content: 'Review synthetic change.', occurredAt: '2026-09-28T00:00:00.000Z' }] });
  if (!result.ok) throw Error(JSON.stringify(result));
}

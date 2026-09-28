import { bytes } from './confirmation-parity.mjs';
export const namespace = { ownerId: 'cf2-synthetic', scope: 'project', projectId: 'p' };
export const receipt = content => ({ client: 'synthetic', sessionId: 's', eventId: content, role: 'user', excerpt: content });
export function admit(core, content, kind = 'fact', ns = namespace) {
  const result = core.admit({ namespace: ns, memory: { content, kind }, receipts: [receipt(content)] });
  if (!result.ok) throw Error(JSON.stringify(result));
  return result.value.memory;
}
export function parity(open, path) {
  const core = open({ path, model: { countTokens: text => Math.ceil(text.length / 5) } });
  try {
    admit(core, 'Synthetic standing instruction', 'instruction');
    admit(core, 'Synthetic explicit fact');
    admit(core, 'Synthetic context', 'context');
    return [{}, { groups: {} }, { groups: { nextSteps: false } },
      { groups: { procedural: false } }, { groups: { nextSteps: false, procedural: false } },
      { maxChars: 600, maxTokens: 200 }].map(input => ({ input, bytes: bytes(core.sessionStartContext({ namespace, ...input })) }));
  } finally { core.close(); }
}

import { readFileSync } from 'node:fs';
import { callModel } from './model-call.mjs';
import { object, denseArray, fail } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

const system = readFileSync(new URL('./prompts/relate-rationale.md', import.meta.url), 'utf8');
const focusGuidance = readFileSync(new URL('./prompts/relate-claim-focus.md', import.meta.url), 'utf8');

export async function proposeRationale(model, sources, validateFresh) {
  const focused = sources.some(source => source.focus);
  const output = await callModel(model, 'relate', focused ? `${system}\n${focusGuidance}` : system, {
    memories: sources.map((source, index) => ({ index,
      ...(source.focus ? { focus: { content: source.focus.content, interpretationStatus: 'unverified' } } : {}),
      receipts: source.receipts.map(({ role, excerpt }, index) => ({ index, role, excerpt })) })),
  }, { validateFresh, failureCode: 'rationale_failed' });
  try {
    object(output, ['edges']);
    const seen = new Set();
    return denseArray(output.edges, 0, 10).map(edge => {
      object(edge, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt']);
      if (!['supports-decision', 'challenges-premise'].includes(edge.relation)) fail('invalid_model_output');
      for (const side of ['from', 'to']) {
        const i = edge[side]; const r = edge[`${side}Receipt`];
        if (!Number.isSafeInteger(i) || i < 0 || i >= sources.length ||
            !Number.isSafeInteger(r) || r < 0 || r >= sources[i].receipts.length) fail('invalid_model_output');
      }
      if (edge.from === edge.to && edge.relation !== 'supports-decision') fail('invalid_model_output');
      const clean = { from: edge.from, to: edge.to, relation: edge.relation,
        fromReceipt: edge.fromReceipt, toReceipt: edge.toReceipt };
      const key = JSON.stringify(clean);
      if (seen.has(key)) fail('invalid_model_output');
      seen.add(key);
      return clean;
    });
  } catch { emitDiagnostic(model, 'relate', 'core_validation', 'invalid_rationale'); fail('invalid_model_output'); }
}

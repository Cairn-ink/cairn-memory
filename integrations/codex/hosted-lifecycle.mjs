import { readControlState, startIfActive, runIfActive } from '../client/control-state.mjs';
import { createJsonPoster, hostedTargetId, resetBoundary } from '../client/transport-hosted.mjs';
import { prepareRecallQuery } from '../client/recall-query.mjs';
import { hash } from '../client/common-profile.mjs';
import { renderContext } from './context.mjs';

export { observeHostedPause } from '../client/hosted-pause.mjs';
import { observeHostedPause } from '../client/hosted-pause.mjs';

export function installedTransport(config, token, expectedRemoteGeneration) {
  const targetId = hostedTargetId(config);
  const post = createJsonPoster({ ...config, token, targetId, client: 'codex' });
  let inFlight = 0;
  return {
    terminated: () => inFlight === 0,
    async capture(body, { signal }) {
      inFlight++;
      try {
        const remote = await observeHostedPause(config, token, signal);
        if (remote.paused || remote.generation !== expectedRemoteGeneration) {
          return { status: 'processing', eventId: body.event_id };
        }
        const local = await readControlState(config.root);
        const dispatch = async start => {
          // Quota-lock waits must not bypass the local pause/generation barrier.
          const current = await observeHostedPause(config, token, signal);
          if (current.paused || current.generation !== expectedRemoteGeneration) throw new Error('dispatch_not_started');
          const active = await startIfActive(config.root, local.generation, start);
          if (!active.started) throw new Error('dispatch_not_started');
          return active.operation;
        };
        const result = await post.reply('/api/memory/capture', body, 25000, undefined, signal, dispatch);
        if (result.status === 'quota_reached') return { status: 'refused', code: 'quota_reached',
          ...(result.resetAt === null ? {} : { resetAt: resetBoundary(result.resetAt) }) };
        if (['complete','duplicate','empty','processing'].includes(result.status)) {
          return { status: result.status, eventId: body.event_id };
        }
        // Availability/rate-limit/authorization failures retain the frozen range.
        // Invalid successes still trip CX-3's durable invalid-reply latch.
        if (result.code === 'invalid_reply') return { status: 'invalid' };
        throw new Error('capture_unavailable');
      } finally { inFlight--; }
    },
  };
}

// `enabled` is the prompt-recall kill switch reader; it is required and is read
// again as the last step, so switching off during an in-flight recall injects nothing.
export async function recallContext(input, config, token, projectId, signal, enabled) {
  const query = prepareRecallQuery(input.prompt);
  if (typeof enabled !== 'function' || query === undefined || signal.aborted) return '';
  const remote = await observeHostedPause(config, token, signal);
  const local = await readControlState(config.root);
  if (remote.paused || local.paused) return '';
  const post = createJsonPoster({ ...config, token, targetId: hostedTargetId(config), client: 'codex' });
  const dispatch = async start => {
    const current = await observeHostedPause(config, token, signal);
    if (current.paused || current.generation !== remote.generation) throw new Error('dispatch_not_started');
    const result = await startIfActive(config.root, local.generation, start);
    if (!result.started) throw new Error('dispatch_not_started');
    return result.operation;
  };
  const result = await post.reply('/api/memory/recall', { query, project_id: projectId, limit: 6,
    session_id: hash('wire-session-v1','codex',input.session_id) }, 2000, undefined, signal, dispatch);
  if (result.status !== 'complete' || !result.memories.length) return '';
  const current = await observeHostedPause(config, token, signal);
  if (current.paused || current.generation !== remote.generation) return '';
  const eligible = result.memories.filter(memory=>memory.scope==='personal' ? memory.projectId===null :
    memory.scope==='project' && memory.projectId===projectId);
  const context = renderContext(eligible,token);
  // Never truncate a receipt to fit host output. No giant or late response leaks.
  if (!context || signal.aborted) return '';
  let output = '';
  await runIfActive(config.root, local.generation, () => {
    if (!signal.aborted) output = JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit', additionalContext: context,
    } });
  });
  if (!output || signal.aborted || await enabled() !== true) return '';
  // The switch read is asynchronous: pause/generation or cancellation may change
  // during it. Re-check both under the control lock; nothing awaits after this.
  if (!await runIfActive(config.root, local.generation, () => {}) || signal.aborted) return '';
  return output;
}

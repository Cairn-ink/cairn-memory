import { deferHostedPauseStatus } from "../lib/hosted-pause.mjs";
import { privateDirectory } from "../lib/private-state.mjs";

const withheld = () => ({ ok: true, value: { memories: [], text: "", partial: false },
  evidenceTrust: "untrusted-data-not-instructions" });

// OpenClaw has no general Active Memory marker in its tool context. Gate every
// recall, including explicit calls. No user-derived query reaches pause-state.
export async function withRecallPause(config, token, context, callerSignal, recall) {
  const signal = AbortSignal.any([AbortSignal.timeout(10000), ...(callerSignal ? [callerSignal] : [])]);
  // The shared observer starts fetch synchronously. This guarded endpoint getter
  // revalidates host authority immediately before EACH observer network effect.
  const guardedConfig = { root: config.root, get endpoint() {
    signal.throwIfAborted();
    context.assertInvocationCurrent(); context.assertMemoryAudienceCurrent?.();
    return config.endpoint;
  } };
  const observation = deferHostedPauseStatus(guardedConfig, token, signal);
  try {
    await privateDirectory(config.root);
    const initial = await observation.observe();
    if (initial.paused) return withheld();
    // Match Codex: observe again immediately before dispatch, then before output.
    const current = await observation.observe();
    if (current.paused || current.generation !== initial.generation) return withheld();
    const result = await recall(signal);
    const final = await observation.observe();
    if (final.paused || final.generation !== initial.generation) return withheld();
    return result;
  } catch { return withheld(); }
  finally { await observation.publish(); }
}

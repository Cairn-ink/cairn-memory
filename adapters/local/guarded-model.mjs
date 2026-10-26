import { createHash } from 'node:crypto';
import { createOpenAIModel } from '../openai/index.mjs';
import { createRuntimeGuard } from '../../integrations/client/runtime-usage.mjs';
import { LocalCaptureError } from './configuration.mjs';

const remoteMethods = ['extract', 'qualify', 'qualifyCandidates', 'classify', 'select', 'selectChecklist', 'rank', 'reconcile', 'relate', 'reviewBasis'];
export function guardedModel(config, { core, signal, env = process.env, fetchImpl = globalThis.fetch }) {
  // Reuse the provider's exact pure serializer/counter without looking up a key.
  const planning = createOpenAIModel({ apiKey: 'local-planning-noncredential', fetchImpl: () => { throw new LocalCaptureError(); } });
  const { authority } = config;
  const targetId = createHash('sha256').update(JSON.stringify(['local-capture-budget-v1', authority.storeId, authority.targetId])).digest('hex');
  const guard = createRuntimeGuard({ root: config.usage.root, targetId, mode: 'api-key', dailyCap: config.usage.dailyCap,
    concurrency: config.usage.concurrency, client: authority.client === 'claude-code' ? 'claude' : 'codex' });
  const active = new Set(); let provider, denial;
  const unwrap = result => { if (!result.ok) throw new LocalCaptureError('capture_disabled'); return result.value; };
  function assertAuthority() {
    if (signal.aborted) throw new DOMException('Local capture cancelled', 'AbortError');
    const current = unwrap(core().getLocalCaptureControl({ namespace: authority.namespace, client: authority.client }));
    const capture = unwrap(core().getCaptureControl({ namespace: authority.namespace }));
    if (!current.automaticCaptureEnabled || current.storeId !== authority.storeId || current.targetId !== authority.targetId ||
        current.consentGeneration !== authority.expectedConsentGeneration || capture.paused || !capture.enabled ||
        capture.generation !== authority.expectedNamespaceGeneration) throw new LocalCaptureError('capture_evidence_closed');
  }
  function realProvider() {
    if (provider) return provider;
    const key = env[config.provider.apiKeyEnv];
    if (typeof key !== 'string' || !key.length || key.length > 8192 || /[\s\x00-\x1f\x7f]/u.test(key)) throw new LocalCaptureError('model_not_configured');
    provider = createOpenAIModel({ apiKey: key, fetchImpl: (url, options) => {
      assertAuthority();
      if (options.signal.aborted) throw new DOMException('Local capture cancelled', 'AbortError');
      return fetchImpl(url, options);
    } });
    return provider;
  }
  async function invoke(method, request) {
    assertAuthority();
    const selected = realProvider();
    const permit = await guard.reserve();
    if (!permit.ok) { denial = permit.code; throw new LocalCaptureError('local_capture_quota_refused'); }
    let invocation, failed = false;
    try {
      const gate = await guard.dispatch(permit.id, () => {
        assertAuthority();
        const combined = AbortSignal.any([signal, request.signal]);
        if (combined.aborted) throw new DOMException('Local capture cancelled', 'AbortError');
        invocation = Promise.resolve().then(() => selected[method]({ ...request, signal: combined }));
        invocation.catch(() => {});
        return { operation: invocation };
      });
      if (!gate.ok) { denial = gate.code; throw new LocalCaptureError('local_capture_quota_refused'); }
      return await gate.dispatch.operation;
    } catch (error) { failed = true; throw error; }
    finally {
      // Core's timeout may win its race first. This underlying invocation still
      // owns the permit until actual settlement, or process death and recovery.
      if (invocation) await invocation.catch(() => {});
      try { await guard.release(permit.id, { terminated: true }); }
      catch { if (!failed) throw new LocalCaptureError(); }
    }
  }
  const model = { contextWindow: planning.contextWindow, countTokens: planning.countTokens,
    fitsQualificationRequest: planning.fitsQualificationRequest };
  for (const method of remoteMethods) model[method] = request => {
    const operation = invoke(method, request); active.add(operation);
    operation.then(() => active.delete(operation), () => active.delete(operation));
    return operation;
  };
  return Object.freeze({ model: Object.freeze(model), targetId, get denial() { return denial; },
    async settled() { while (active.size) await Promise.allSettled([...active]); } });
}

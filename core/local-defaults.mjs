/** Local plaintext retention; hosts may supply a sealing port instead. */
export function defaultRawOptions() {
  return Object.freeze({ mode: 'raw-v1', capBytes: 200_000_000, configureCap: false,
    port: Object.freeze({ version: 'raw-seal-v1',
      async sealRaw({ text }) { return { format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) }; },
      async openRaw({ sealed }) { return { text: new TextDecoder('utf8', { fatal: true }).decode(sealed) }; },
    }),
    readPolicy: () => ({ generation: 'local-default-v1', reason: null }),
  });
}

/** Local owner driver. Managed readers keep their host's maintenance pump. */
export function startLocalContextMaintenance(core, access, { semantic = false, cards = false } = {}) {
  const { readSet } = access;
  const capabilities = core.getContextReadCapabilities?.();
  let types = capabilities?.ok ? capabilities.value.types : ['memory'];
  let closed = false, active, timer, previousProgress;
  const arm = (delay = 1000) => {
    if (closed) return;
    timer = setTimeout(() => {
      timer = null;
      // This is the existing authorized maintainer, including its resumable
      // checkpoints. No I/O runs during construction or after close.
      let nextDelay = 1000;
      active = (async () => {
        if (cards) for (const namespace of readSet) {
          if (closed) return;
          const pass = await core.maintainCards({ namespace, budget: { maxItems: 512, maxMs: 30000 } });
          if (!pass.ok || pass.value.state === 'refused') return;
        }
        if (cards) { const current = core.getContextReadCapabilities?.(); if (current?.ok) types = current.value.types; }
        if (closed || !access.call) return;
        return access.call(core, 'refreshContextIndex', {
          readSet, types, intent: 'current', budget: { maxItems: semantic || cards ? 16 : 1024, maxMs: semantic || cards ? 1000 : 25 },
        });
      })().then(result => {
        // Keep provider opportunities identical to the existing semantic lane.
        // Lexical idle observations still discover canonical invalidations, so
        // no new capture hook or maintenance authority is needed.
        if (!semantic && !cards && result?.ok) {
          const progress = JSON.stringify(result.value.progress.lexical);
          if (result.value.status !== 'complete') nextDelay = 25;
          if (result.value.status === 'complete' && result.value.progress.transformed === 0 &&
              progress === previousProgress) nextDelay = 30_000;
          previousProgress = progress;
        }
      }).catch(() => {}).finally(() => { active = null; arm(nextDelay); });
    }, delay);
    timer.unref();
  };
  arm(semantic || cards ? 1000 : 0);
  return { async close() { closed = true; clearTimeout(timer); await active; } };
}

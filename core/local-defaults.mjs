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
export function startLocalContextMaintenance(core, access, { semantic = false } = {}) {
  const { readSet } = access;
  const capabilities = core.getContextReadCapabilities();
  const types = capabilities.ok ? capabilities.value.types : ['memory'];
  let closed = false, active, timer;
  const arm = (delay = 1000) => {
    if (closed) return;
    timer = setTimeout(() => {
      timer = null;
      // This is the existing authorized maintainer, including its resumable
      // checkpoints. No I/O runs during construction or after close.
      active = Promise.resolve(access.call(core, 'refreshContextIndex', {
        readSet, types, intent: 'current', budget: { maxItems: semantic ? 16 : 1024, maxMs: 1000 },
      })).catch(() => {}).finally(() => { active = null; arm(); });
    }, delay);
    timer.unref();
  };
  arm(0);
  return { async close() { closed = true; clearTimeout(timer); await active; } };
}

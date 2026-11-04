import { isMainThread, Worker, workerData } from 'node:worker_threads';

// Keep the instrumentation in this file so fail-before needs only this file.
// The hooks wrap real factories; filesystem admission, index bodies, delivery
// fences, attribution selection and the Worker protocol remain production code.
if (!isMainThread) {
  const { registerHooks } = await import('node:module');
  const { writeFileSync } = await import('node:fs');
  const control = new Int32Array(workerData.guardControl);
  const detailBytes = new Uint8Array(workerData.guardDetail);
  const attributionUrl = new URL('../context-product-attribution.mjs', import.meta.url).href;
  const facadeUrl = new URL('../context-read-facade.mjs', import.meta.url).href;
  const indexUrl = new URL('../context-product-index.mjs', import.meta.url).href;
  globalThis.guardWrapAttribution = value => {
    const select = value.selectFailure;
    value.selectFailure = function(error) {
      if (Atomics.load(control, 0)) Atomics.add(control, 4, 1);
      return Reflect.apply(select, this, [error]);
    };
    return value;
  };
  globalThis.guardWrapFacade = value => {
    const ready = value.port.ready;
    value.port.ready = function(...args) {
      if (!Atomics.load(control, 0)) return Reflect.apply(ready, this, args);
      const call = Atomics.add(control, 1, 1) + 1;
      // Entry ready() has returned. The body now encounters a real persistent
      // refusal; the independent delivery ready() encounters a distinct error.
      if (call === 2) {
        writeFileSync(workerData.path + workerData.guardSuffix, 'synthetic refusal',
          { mode: workerData.guardSuffix === '-journal' ? 0o644 : 0o600 });
        Atomics.add(control, 5, 1);
      }
      try { const result = Reflect.apply(ready, this, args); Atomics.add(control, 2, 1); return result; }
      catch (error) { Atomics.add(control, 3, 1); throw error; }
    };
    return value;
  };
  globalThis.guardWrapIndex = (options, factory, createAttribution) => {
    // Request Workers do not normally collect maintenance attribution. Supply
    // the same real object there to exercise findCandidates/contextRead too.
    // Service cases retain the Worker's own object and its actual wire detail.
    const injected = !options.attribution;
    const attribution = options.attribution ?? createAttribution();
    const value = factory({ ...options, attribution }), run = value.run;
    value.run = function(...args) {
      if (injected) attribution.reset();
      const finish = result => {
        if (Atomics.load(control, 0)) {
          const bytes = new TextEncoder().encode(JSON.stringify(attribution.failure() ?? null));
          detailBytes.set(bytes); Atomics.store(control, 6, bytes.length);
        }
        return result;
      };
      const result = Reflect.apply(run, this, args);
      return result instanceof Promise ? result.then(finish) : finish(result);
    };
    return value;
  };
  registerHooks({ load(url, context, next) {
    const loaded = next(url, context);
    if (![attributionUrl, facadeUrl, indexUrl].includes(url)) return loaded;
    let source = Buffer.from(loaded.source).toString();
    if (url === attributionUrl) {
      source = source.replace('export function createMaintenanceAttribution(', 'function guardOriginalAttribution(');
      source += '\nexport const createMaintenanceAttribution = (...args) => globalThis.guardWrapAttribution(guardOriginalAttribution(...args));\n';
    } else if (url === facadeUrl) {
      source = source.replace('export function openContextProductFacade(', 'function guardOriginalFacade(');
      source += '\nexport const openContextProductFacade = (...args) => globalThis.guardWrapFacade(guardOriginalFacade(...args));\n';
    } else {
      source = source.replace('export function openProductIndex(', 'function guardOriginalIndex(');
      source += '\nimport { createMaintenanceAttribution as guardCreateAttribution } from "./context-product-attribution.mjs";\nexport const openProductIndex = options => globalThis.guardWrapIndex(options, guardOriginalIndex, guardCreateAttribution);\n';
    }
    return { ...loaded, source };
  } });
  await import('../context-product-worker.mjs');
} else {
  const { default: test } = await import('node:test');
  const { default: assert } = await import('node:assert/strict');
  const { unlinkSync } = await import('node:fs');
  const { openMemoryCore } = await import('../index.mjs');
  const { safetyFixture, ns, ok, receipt } = await import('../testing/content-safety-s2h-fixture.mjs');
  const { configured } = await import('../testing/context-product-owner-fixture.mjs');
  const { createProductReaderRuntime, maintenanceFailureDiagnostic } = await import('../context-product-reader.mjs');
  const { createMaintenanceAttribution } = await import('../context-product-attribution.mjs');

  test('attribution guard: real object exposes only read-only selection state and resets it', () => {
    const value = createMaintenanceAttribution(), error = Error('synthetic failure');
    assert.equal(value.failureSelected, false);
    value.captureFailure(error); assert.equal(value.failureSelected, false, 'capture alone is not selection');
    value.selectFailure(error); assert.equal(value.failureSelected, true);
    value.resetFailure(); assert.equal(value.failureSelected, false);
    value.captureFailure(error); value.selectFailure(error); assert.equal(value.failureSelected, true);
    value.reset(); assert.equal(value.failureSelected, false);
    const property = Object.getOwnPropertyDescriptor(value, 'failureSelected');
    assert.equal(typeof property.get, 'function'); assert.equal(property.set, undefined);
    assert.throws(() => { value.failureSelected = true; }, TypeError);
  });

  const methods = ['getContextIndexStatus', 'findCandidates', 'contextRead', 'refreshContextIndex'];
  for (const base of [18, 23, 33]) for (const migrated of [false, true])
    for (const suffix of ['-wal', '-shm', '-journal']) for (const method of methods)
      test(`attribution guard: v${migrated ? { 18: 34, 23: 38, 33: 48 }[base] : base} ${suffix} ${method}`, async t => {
        const f = safetyFixture(t, base); if (migrated) await f.migrate();
        const core = openMemoryCore({ path: f.path });
        try { ok(core.admit({ namespace: ns, memory: { content: 'synthetic guard needle', kind: 'fact' }, receipts: [receipt('guard')] })); }
        finally { core.close(); }
        const db = f.connect();
        try { assert.equal(db.prepare('PRAGMA user_version').get().user_version,
          migrated ? { 18: 34, 23: 38, 33: 48 }[base] : base, 'actual physical layout'); }
        finally { db.close(); }
        const maintenance = ['getContextIndexStatus', 'refreshContextIndex'].includes(method);
        const c = configured(t, f.path, [ns], { service: maintenance });
        const control = new Int32Array(new SharedArrayBuffer(32)), detail = new SharedArrayBuffer(1024);
        let wireDetail;
        const open = createProductReaderRuntime({ maintenance, spawnWorker: data => {
          const worker = new Worker(new URL(import.meta.url), { workerData: { ...data,
            guardControl: control.buffer, guardDetail: detail, guardSuffix: suffix }, env: {}, execArgv: [] });
          worker.on('message', message => { if (message.result?.ok === false) wireDetail = message.maintenanceFailure; });
          return worker;
        } });
        const h = await open(c.options); t.after(() => h.close());
        const input = { readSet: [ns], types: ['memory'], intent: 'current', deadlineMs: 5000,
          ...(method === 'findCandidates' || method === 'contextRead' ? { query: 'needle' } : {}),
          ...(method === 'contextRead' ? { budget: { maxItems: 8, maxTokens: 2000 } } : {}) };
        const payload = method === 'refreshContextIndex'
          ? { readSet: [ns], types: ['memory'], intent: 'current', mode: 'lexical', budget: { maxItems: 8, maxMs: 5000 } } : input;
        Atomics.store(control, 0, 1);
        try {
          const result = await h[method](payload, c.token);
          assert.deepEqual(result, { ok: false, error: { code: 'index_unavailable', retryable: false } }, 'public refusal is unchanged');
          assert.deepEqual([control[1], control[2], control[3], control[5]], [3, 1, 2, 1],
            'entry passes, companion appears once, body and delivery independently refuse');
          // Main context-read-product-classification.test.mjs journal controls
          // pin auxiliary_file/unsafe_file. Main attribution.failure() and
          // context-product-worker.result() produce this exact private detail.
          const reason = suffix === '-journal' ? 'unsafe_file' : 'auxiliary_file';
          const expected = { kind: 'engine', engineCode: 'index_unavailable', reason, step: 0 };
          const retained = JSON.parse(new TextDecoder().decode(new Uint8Array(detail, 0, control[6])));
          t.diagnostic('ATTRIBUTION_GUARD ' + JSON.stringify({ selections: control[4], retained, expected }));
          assert.deepEqual(retained, expected, 'retain main\'s exact first root-cause detail');
          assert.equal(control[4], 1, 'exactly one real selectFailure invocation, independent of the getter');
          if (maintenance) {
            assert.deepEqual(wireDetail, expected, 'actual Worker response carries the retained private detail');
            const record = maintenanceFailureDiagnostic(result);
            assert.deepEqual({ cause: record?.cause, engineCode: record?.engineCode, reason: record?.reason, step: record?.step },
              { cause: 'engine', engineCode: 'index_unavailable', reason, step: 0 }, 'parent receives main\'s private classification');
          }
        } finally { Atomics.store(control, 0, 0); if (control[5]) unlinkSync(f.path + suffix); await h.close(); }
      });
}

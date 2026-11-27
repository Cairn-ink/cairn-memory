import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSnapshot, fixture, format, input, readSet, tokenCount } from "./helpers/context-read-compact.mjs";

const corpus = [
  { body: "Telescope telescope telescope records a late observation.", occurredAt: "2026-03-01T08:00:59.000Z" },
  { body: "A telescope records an undated observation.", occurredAt: null },
  { body: "A telescope records an early observation far above the ridge at dawn.", occurredAt: "2026-01-01T08:00:02.000Z" },
];

test("compact sorts the packed bodies and retains their qualified diagnostics and snapshot", async () => {
  const { read, refs, service } = fixture(corpus);
  const { assembly, diagnostics, snapshot } = await read();
  assert.deepEqual(assembly.items, [
    { date: "2026-01-01T08:00Z", body: corpus[2].body },
    { date: "2026-03-01T08:00Z", body: corpus[0].body },
    { date: null, body: corpus[1].body },
  ]);
  assert.equal(diagnostics.budget.used, tokenCount(format(assembly)));
  assert.equal(diagnostics.omitted.sources, 3);
  assert.equal(diagnostics.trace.counterCalls, 8);
  const payload = decodeSnapshot(snapshot);
  assert.equal(payload.representation, input.representation);
  assert.deepEqual(diagnostics.items.map(item => item.ref), [refs[2], refs[0], refs[1]]);
  for (const [index, detail] of diagnostics.items.entries()) {
    assert.equal(detail.body.tokens, tokenCount(assembly.items[index].body));
    assert.deepEqual(detail.sources, []);
    assert.equal(detail.sourceAccess, "available");
    assert.equal(detail.sourcesComplete, true);
    const slot = payload.refs.findIndex(tuple => tuple[2] === detail.ref.id);
    assert.equal(detail.fence, payload.fences[slot]);
    assert.match(detail.fence, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(detail.f, detail.fence.slice(0, 8));
  }
  const replayed = await service.fetchEvidence(readSet, { snapshot });
  assert.equal(replayed.snapshot, snapshot);
  const positional = await service.fetchEvidence(readSet, { intent: "current",
    refs: diagnostics.items.map(item => item.ref), fences: diagnostics.items.map(item => item.f) });
  assert.deepEqual(positional.items.map(item => item.text), assembly.items.map(item => item.body));
  assert.deepEqual(replayed.items.map(item => item.ref.id), payload.refs.map(tuple => tuple[2]));
  const [, signature] = snapshot.split(".");
  delete payload.representation;
  const tampered = Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + signature;
  await assert.rejects(service.fetchEvidence(readSet, { snapshot: tampered }), { code: "snapshot_stale" });
  await assert.rejects(service.fetchEvidence({ ...readSet, accessGenerations: [2] }, { snapshot }), { code: "snapshot_stale" });
});

test("compact meters whole items and respects both caps", async () => {
  const oversized = { body: "Telescope telescope " + "distant ridge ".repeat(130), occurredAt: null };
  const small = { body: "The telescope is brass.", occurredAt: null };
  const { read } = fixture([oversized, small, ...corpus]);
  const itemLimited = await read({ budget: { maxItems: 1 } });
  assert.equal(itemLimited.assembly.items.length, 1);
  assert.equal(itemLimited.diagnostics.stops.items, true);
  assert.equal(itemLimited.diagnostics.omitted.items, 4);
  const tokenLimited = await read({ budget: { maxTokens: 64 } });
  assert.ok(tokenLimited.assembly.items.length > 0);
  assert.ok(tokenLimited.assembly.items.some(({ body }) => body === small.body));
  assert.ok(tokenLimited.assembly.items.every(({ body }) => body !== oversized.body));
  assert.equal(tokenLimited.diagnostics.budget.used, tokenCount(format(tokenLimited.assembly)));
  assert.ok(tokenLimited.diagnostics.budget.used <= 64);
  assert.equal(tokenLimited.diagnostics.stops.budget, true);
  assert.equal(tokenLimited.diagnostics.omitted.oversized, 1);
});

test("compact replays a 64-ref snapshot within the evidence response limit", async () => {
  const many = Array.from({ length: 64 }, (_, i) => ({ body: "Telescope observation " + i }));
  const { service, read } = fixture(many, { withReceipts: false });
  const value = await read();
  assert.equal(value.assembly.items.length, 64);
  const replay = await service.fetchEvidence(readSet, { snapshot: value.snapshot });
  assert.equal(replay.snapshot, value.snapshot);
  assert.deepEqual(replay.items.map(item => item.text), value.assembly.items.map(item => item.body));
});

test("a deadline during compact metering keeps only previously accepted bodies", async () => {
  let time = 0;
  const { read } = fixture(corpus, { now: () => time, count(text) {
    if (text === corpus[1].body) time = 10;
    return tokenCount(text);
  } });
  const value = await read({ deadlineMs: 10 });
  assert.deepEqual(value.assembly.items, [{ date: "2026-03-01T08:00Z", body: corpus[0].body }]);
  assert.equal(value.diagnostics.stops.deadline, true);
  assert.equal(value.diagnostics.budget.used, tokenCount(format(value.assembly)));
});

for (const phase of ["after find", "during pack"]) {
  test(`compact refuses stale evidence when a forget commits ${phase}`, async () => {
    let mutation;
    const { read, forget, refs, service } = fixture(corpus, {
      afterFind() { if (phase === "after find") mutation?.(); },
      count(text) { if (phase === "during pack" && text === corpus[0].body) mutation?.(); return tokenCount(text); },
    });
    const before = await read();
    assert.ok(before.assembly.items.some(item => item.body === corpus[0].body));
    mutation = () => { forget(0); mutation = undefined; };
    await assert.rejects(read(), error => {
      assert.equal(error.code, "snapshot_stale");
      assert.equal(error.diagnostics, undefined);
      const text = JSON.stringify(error);
      for (const forbidden of [corpus[0].body, refs[0].id, corpus[0].occurredAt.slice(0, 16)]) {
        assert.ok(!text.includes(forbidden));
      }
      return true;
    });
    assert.equal(mutation, undefined);
    await assert.rejects(service.fetchEvidence(readSet, { snapshot: before.snapshot }), { code: "snapshot_stale" });
    const after = await read();
    assert.deepEqual(after.assembly.items, before.assembly.items.filter(item => item.body !== corpus[0].body));
  });
}

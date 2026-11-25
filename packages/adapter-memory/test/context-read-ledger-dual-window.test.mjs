import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";
import { amount, fixture, readSet, scope } from "./fixtures/context-read-quantity-ledger.mjs";

const firstDay = Date.UTC(2026, 6, 1);
const lastDay = Date.UTC(2026, 6, 31);
const month = { query: "How much did I spend this month?", types: ["memory"], intent: "current", raw: false, budget: { maxItems: 1 } };
const sourceIds = digest => digest.sources.map(({ memory }) => memory.id).sort();

async function monthFixture() {
  const f = fixture();
  const first = await f.capture("Transit cost 18 USD.", [amount("bus", 18, "transport")], { date: firstDay });
  const last = await f.capture("Food cost 12 USD.", [amount("lunch", 12)], { date: lastDay });
  const records = [...await f.ledgerRows(first.id), ...await f.ledgerRows(last.id)];

  function reader({ enabled = true, calendarReading, capable = true, afterFormatting } = {}) {
    const scans = [];
    let beforeRead;
    const api = createMemoryService({
      profile: "keyless-local",
      config: { quantityLedger: { enabled, calendarReading } },
      clock: { ...assemblyClock(() => 0), nowMs: () => lastDay + 5000 },
      storage: {
        ...f.base,
        capabilities: { ...f.base.capabilities, quantityLedger: capable },
        ...(capable && { quantityLedger: {
          async terms() { return ["spend", "food", "transport", "bus", "lunch"]; },
          async list(tx, target, range) {
            assert.equal(tx.readOnly, true);
            assert.deepEqual(target, scope);
            scans.push(range);
            return records.filter(row => range.fromMs <= row.date && row.date < range.toMs);
          },
        } }),
        contextRead: {
          ...f.base.contextRead,
          // Isolate the ledger witness from the regular snapshot generation check.
          ...(afterFormatting && { async snapshotState() { return [{ memory: 1, card: 1 }]; } }),
        },
        uow: {
          async run(owner, options, work) {
            if (options.readOnly && beforeRead) {
              const forget = beforeRead;
              beforeRead = undefined;
              await forget();
            }
            return f.base.uow.run(owner, options, work);
          },
        },
      },
      contextReadCounter: { count: fixtureCount },
      contextReadFormat(value) {
        if (value.ledgerDigest && afterFormatting) beforeRead = afterFormatting;
        return formatAssembly(value);
      },
    });
    return { scans, read: () => api.readContext(readSet(), month) };
  }

  return { first, last, reader, forgetFirst: () => f.base.harness.seedFact(scope.owner, {
    ...scope, kind: "identity", origin: "forget", actionId: "rolling-window-forget", memoryId: first.id,
  }) };
}

test("the public read includes calendar totals and the extra source only when configured", async () => {
  const f = await monthFixture();
  const off = f.reader();
  const on = f.reader({ calendarReading: true });
  const primaryRange = asOfStart => ({ fromMs: asOfStart, toMs: Date.UTC(2026, 7, 1) });
  const rolling = await off.read();
  const combined = await on.read();
  for (const { assembly, diagnostics } of [rolling, combined]) {
    assert.deepEqual(assembly.items, []);
    assert.equal(diagnostics.budget.used, fixtureCount(formatAssembly(assembly)));
  }

  assert.match(rolling.assembly.ledgerDigest.body,
    /^Computed ledger for 2026-07-02 to 2026-07-31 \(this month, read as the last 30 days\), from the dated records you mentioned\. Spend: total \$12\.00 in 1 record/u);
  assert.doesNotMatch(rolling.assembly.ledgerDigest.body, /calendar month so far|\$18\.00/u);
  assert.deepEqual(sourceIds(rolling.assembly.ledgerDigest), [f.last.id]);
  assert.deepEqual(off.scans.filter(scan => scan.toMs === Date.UTC(2026, 7, 1)),
    Array(2).fill(primaryRange(Date.UTC(2026, 6, 2))));

  assert.match(combined.assembly.ledgerDigest.body,
    /Calendar month so far: 2026-07-01 to 2026-07-31\. Spend: total \$12\.00 in 1 record, average \$0\.40 per day\. Spend, calendar month so far: total \$30\.00 in 2 records/u);
  assert.deepEqual(sourceIds(combined.assembly.ledgerDigest), [f.first.id, f.last.id].sort());
  assert.deepEqual(on.scans.filter(scan => scan.toMs === Date.UTC(2026, 7, 1)), Array(2).fill(primaryRange(firstDay)));

  const disabled = await f.reader({ enabled: false, calendarReading: true }).read();
  assert.deepEqual(disabled.assembly.ledgerDigest, rolling.assembly.ledgerDigest);
  const incapable = f.reader({ capable: false, calendarReading: true });
  assert.equal((await incapable.read()).assembly.ledgerDigest, undefined);
  assert.deepEqual(incapable.scans, []);
  assert.throws(() => f.reader({ calendarReading: "true" }), { code: "invalid_input" });
});

test("forgetting a calendar-only row during formatting invalidates only the opt-in digest", async () => {
  for (const calendarReading of [false, true]) {
    const f = await monthFixture();
    let writes = 0;
    const reader = f.reader({ calendarReading, async afterFormatting() {
      writes++;
      await f.forgetFirst();
    } });
    const { assembly } = await reader.read();
    assert.equal(writes, 1);
    if (calendarReading) {
      assert.equal(assembly.ledgerDigest, undefined);
    } else {
      assert.deepEqual(sourceIds(assembly.ledgerDigest), [f.last.id]);
    }
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";
import { amount, fixture, project, readSet, scope } from "./fixtures/context-read-quantity-ledger.mjs";

const firstDay = Date.UTC(2026, 6, 1);
const lastDay = Date.UTC(2026, 6, 31);
const month = { query: "How much did I spend this month?", types: ["memory"], intent: "current", raw: false, budget: { maxItems: 1 } };
const sourceIds = digest => digest.sources.map(({ memory }) => memory.id).sort();
const monthlyGoal = (category, value) => ({ ...amount(category, value), kind: "goal", period: "month", comparator: "at_most" });
const rollingBody = body => body.replace(/(?:Calendar month so far: [^.]+|[A-Z][a-z ]*, calendar month so far: .*? per day)\. /gu, "");

function ledgerFixture() {
  const f = fixture();
  const records = new Map();
  const hidden = new Set();
  let generation = 1;
  async function capture(content, quantity, date, target = scope) {
    const memory = await f.capture(content, [quantity], { date, target });
    const rows = records.get(target.namespace) ?? [];
    records.set(target.namespace, [...rows, ...await f.ledgerRows(memory.id, target)]);
    return memory;
  }

  function reader({ enabled = true, calendarReading, capable = true, afterFormatting } = {}) {
    const scans = [];
    let beforeRead;
    let mutate = afterFormatting;
    const api = createMemoryService({
      profile: "keyless-local",
      config: { quantityLedger: { enabled, calendarReading } },
      clock: { ...assemblyClock(() => 0), nowMs: () => lastDay + 5000 },
      storage: {
        ...f.base,
        capabilities: { ...f.base.capabilities, quantityLedger: capable },
        ...(capable && { quantityLedger: {
          async terms(_tx, target) {
            return (records.get(target.namespace) ?? []).flatMap(row => [row.measure, row.group, row.category]);
          },
          async list(tx, target, range) {
            assert.equal(tx.readOnly, true);
            assert.equal(target.owner, scope.owner);
            scans.push(range);
            return (records.get(target.namespace) ?? []).filter(row => range.fromMs <= row.date && row.date < range.toMs);
          },
        } }),
        fence: {
          async assertVisible(...args) {
            return (await f.base.fence.assertVisible(...args)).filter(ref => !hidden.has(ref.id));
          },
        },
        contextRead: {
          ...f.base.contextRead,
          // Freeze generations by default and allow the forget probe to advance one.
          ...(afterFormatting && { async snapshotState(_tx, { namespaces }) {
            return namespaces.map(() => ({ memory: generation, card: 1 }));
          } }),
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
        if (value.ledgerDigest && mutate) {
          beforeRead = mutate;
          mutate = undefined;
        }
        return formatAssembly(value);
      },
    });
    return { scans, read: (query = month.query, namespaces) => api.readContext(readSet(namespaces), { ...month, query }) };
  }

  async function forget(id) {
    await f.base.harness.seedFact(scope.owner, {
      ...scope, kind: "identity", origin: "forget", actionId: "rolling-window-forget", memoryId: id,
    });
    generation++;
  }
  return { capture, reader, hide: id => hidden.add(id), show: id => hidden.delete(id), forget };
}

async function monthFixture() {
  const f = ledgerFixture();
  const first = await f.capture("Transit cost 18 USD.", amount("bus", 18, "transport"), firstDay);
  const last = await f.capture("Food cost 12 USD.", amount("lunch", 12), lastDay);
  return { ...f, first, last };
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
  assert.deepEqual(on.scans, off.scans);

  const disabled = await f.reader({ enabled: false, calendarReading: true }).read();
  assert.deepEqual(disabled.assembly.ledgerDigest, rolling.assembly.ledgerDigest);
  const incapable = f.reader({ capable: false, calendarReading: true });
  assert.equal((await incapable.read()).assembly.ledgerDigest, undefined);
  assert.deepEqual(incapable.scans, []);
  assert.throws(() => f.reader({ calendarReading: "true" }), { code: "invalid_input" });
});

test("forgetting a calendar-only row during formatting preserves the rolling digest", async () => {
  const f = await monthFixture();
  const before = await f.reader().read();
  let writes = 0;
  const reader = f.reader({ calendarReading: true, async afterFormatting() {
    writes++;
    await f.forget(f.first.id);
  } });
  const { assembly } = await reader.read();
  assert.equal(writes, 1);
  assert.deepEqual(assembly.ledgerDigest, before.assembly.ledgerDigest);
});

test("review probe: off-path delivery agrees with explicit day counts when unused earlier evidence is hidden", async () => {
  const outcomes = [];
  for (const [alias, explicit] of [["this week", "last 7 days"], ["this month", "last 30 days"]]) {
    for (const window of [alias, explicit]) {
      const f = await monthFixture();
      const query = `How much did I spend ${window}?`;
      const before = await f.reader({ calendarReading: false }).read(query);
      assert.deepEqual(sourceIds(before.assembly.ledgerDigest), [f.last.id]);
      let hides = 0;
      const { assembly } = await f.reader({ calendarReading: false, afterFormatting() {
        hides++;
        f.hide(f.first.id);
      } }).read(query);
      assert.equal(hides, 1);
      outcomes.push({ window, delivered: !!assembly.ledgerDigest });
    }
  }
  assert.deepEqual(outcomes, ["this week", "last 7 days", "this month", "last 30 days"].map(window => ({ window, delivered: false })));
});

test("confirm probe: rolling aliases admit coffee and transit and deliver like explicit days", async () => {
  const f = ledgerFixture();
  const earlier = await f.capture("Coffee cost 18 USD.", amount("coffee", 18), firstDay);
  const coffee = await f.capture("Coffee cost 7 USD.", amount("coffee", 7), lastDay);
  const transit = await f.capture("Transit cost 12 USD.", amount("bus", 12, "transport"), lastDay, project);
  const namespaces = [scope.namespace, project.namespace];
  const pairs = [
    ["本週coffee和交通總共多少？", "last 7 days coffee和交通總共多少？", 7],
    ["本週 coffee和交通總共多少？", "last 7 days coffee和交通總共多少？", 7],
    ["這週coffee和交通總共多少？", "最近7天coffee和交通總共多少？", 7],
    ["This week, coffee and transport total?", "Last 7 days, coffee and transport total?", 7],
    ["這個月coffee和交通總共多少？", "最近30天coffee和交通總共多少？", 30],
    ["How much coffee and transport this month?", "How much coffee and transport last 30 days?", 30],
    ["How much coffee and transport this month? I mean this month.",
      "How much coffee and transport last 30 days? I mean last 30 days.", 30],
  ];
  for (const [alias, explicit, days] of pairs) {
    const aliasReader = f.reader({ calendarReading: false });
    const explicitReader = f.reader({ calendarReading: false });
    const rolling = (await aliasReader.read(alias, namespaces)).assembly.ledgerDigest;
    const trailing = (await explicitReader.read(explicit, namespaces)).assembly.ledgerDigest;
    for (const [query, digest] of [[alias, rolling], [explicit, trailing]]) {
      assert.match(digest?.body ?? "", /Spend: total \$19\.00 in 2 records/u, query);
      assert.deepEqual(sourceIds(digest), [coffee.id, transit.id].sort(), query);
    }
    const period = days === 7 ? "week" : "month";
    assert.deepEqual(rolling, {
      ...trailing,
      body: trailing.body.replace(`(last ${days} days)`, `(this ${period}, read as the last ${days} days)`),
    }, alias);
    assert.deepEqual(aliasReader.scans, explicitReader.scans, alias);

    for (const query of [alias, explicit]) {
      let hides = 0;
      const { assembly } = await f.reader({ calendarReading: false, afterFormatting() {
        hides++;
        f.hide(earlier.id);
      } }).read(query, namespaces);
      f.show(earlier.id);
      assert.equal(hides, 1, query);
      assert.equal(assembly.ledgerDigest, undefined, query);
    }
  }
});

test("confirm probe: rolling labels add no ledger terms to a repeated alias", async () => {
  const f = ledgerFixture();
  const coffee = await f.capture("Coffee cost 7 USD.", amount("coffee", 7), lastDay);
  const days = await f.capture("Days cost 12 USD.", amount("days", 12), lastDay, project);
  const namespaces = [scope.namespace, project.namespace];
  const { assembly } = await f.reader().read("How much coffee this month? I mean this month.", namespaces);
  assert.match(assembly.ledgerDigest.body, /Spend: total \$7\.00 in 1 record/u);
  assert.deepEqual(sourceIds(assembly.ledgerDigest), [coffee.id]);

  const alias = (await f.reader().read("How much this week?", [project.namespace])).assembly.ledgerDigest;
  const explicit = (await f.reader().read("How much last 7 days?", [project.namespace])).assembly.ledgerDigest;
  assert.equal(alias, undefined);
  assert.deepEqual(sourceIds(explicit), [days.id]);
});

test("review probe: calendar evidence cannot admit a second namespace or its monthly goal", async () => {
  const f = ledgerFixture();
  const coffee = await f.capture("Coffee cost 7 USD.", amount("coffee", 7), lastDay);
  const budget = await f.capture("Coffee budget is 25 USD per month.", monthlyGoal("coffee", 25), firstDay);
  await f.capture("Coffee cost 18 USD.", amount("coffee", 18), firstDay, project);
  await f.capture("Lunch cost 12 USD.", amount("lunch", 12), lastDay, project);
  await f.capture("Lunch budget is 50 USD per month.", monthlyGoal("lunch", 50), firstDay, project);
  const query = "How much coffee this month?";
  const namespaces = [scope.namespace, project.namespace];
  const off = (await f.reader({ calendarReading: false }).read(query, namespaces)).assembly.ledgerDigest;
  const on = (await f.reader({ calendarReading: true }).read(query, namespaces)).assembly.ledgerDigest;
  assert.match(off.body, /Spend: total \$7\.00 in 1 record/u);
  assert.match(off.body, /Goals: coffee budget goal at most \$25\.00 per month: actual \$7\.00 per month/u);
  assert.equal(rollingBody(on.body), off.body);
  assert.deepEqual(sourceIds(off), [budget.id, coffee.id].sort());
  assert.deepEqual(on.sources, off.sources);
});

test("review probe: July 1 is a rolling goal source only when the monthly goal matches", async () => {
  for (const category of ["lunch", "dinner"]) {
    for (const calendarReading of [false, true]) {
      const f = ledgerFixture();
      const first = await f.capture("Lunch cost 18 USD.", amount("lunch", 18), firstDay);
      const last = await f.capture("Lunch cost 12 USD.", amount("lunch", 12), lastDay);
      const budget = await f.capture(`${category} budget is 50 USD per month.`, monthlyGoal(category, 50), firstDay);
      const matching = category === "lunch";
      const { assembly } = await f.reader({ calendarReading }).read();
      assert.match(assembly.ledgerDigest.body, /Spend: total \$12\.00 in 1 record/u);
      assert.ok(assembly.ledgerDigest.body.includes(matching ? "actual $30.00 per month" : "no records in this window"));
      assert.deepEqual(sourceIds(assembly.ledgerDigest), [budget.id, last.id, ...(matching || calendarReading ? [first.id] : [])].sort());
      const { assembly: delivered } = await f.reader({ calendarReading, afterFormatting: () => f.hide(first.id) }).read();
      if (!matching && calendarReading) {
        const clean = await f.reader().read();
        assert.deepEqual(delivered.ledgerDigest, clean.assembly.ledgerDigest);
        assert.deepEqual(sourceIds(delivered.ledgerDigest), [budget.id, last.id].sort());
      } else {
        assert.equal(delivered.ledgerDigest, undefined);
      }
    }
  }
});

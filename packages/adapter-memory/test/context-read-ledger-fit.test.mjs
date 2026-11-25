import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";
import tokenizer from "../../../packaging/core-local/vendor/tiktoken/tiktoken.cjs";
import { amount, day, dayMs, fixture, readSet, scope, source } from "./fixtures/context-read-quantity-ledger.mjs";

const digestCost = ({ framing, ledgerDigest }, count) =>
  count(formatAssembly({ framing, ledgerDigest, items: [] })) - count(formatAssembly({ framing, items: [] }));
const citationIds = digest => digest.sources.map(({ memory }) => memory.id).sort();

test("busy persona keeps whole answering evidence and ranked memories", async t => {
  const f = fixture();
  const records = [];
  const food = [];
  for (const [group, count] of [["food", 28], ["transport", 24]]) {
    for (let i = 1; i <= count; i++) {
      const category = group === "food"
        ? `market receipt category ${i} for freshly prepared meals purchased at a neighborhood grocery shop`
        : `station receipt category ${i}`;
      const memory = await f.capture(`${group}: ${category} cost ${i} USD.`, [amount(category, i, group)],
        { date: day - i % 7 * dayMs });
      records.push(...await f.ledgerRows(memory.id));
      if (group === "food") food.push(memory.id);
    }
  }
  const encoding = tokenizer.get_encoding("o200k_base");
  t.after(() => encoding.free());
  const count = text => encoding.encode(text, [], []).length;
  let beforeDelivery;
  let onDigest;
  const api = createMemoryService({
    profile: "keyless-local",
    clock: { ...assemblyClock(() => 0), nowMs: () => day + 5_000 },
    storage: {
      ...f.base,
      capabilities: { ...f.base.capabilities, quantityLedger: true },
      quantityLedger: {
        async terms() { return records.flatMap(row => [row.measure, row.group, row.category]); },
        async list(_tx, _scope, { fromMs, toMs }) {
          return records.filter(row => fromMs <= row.date && row.date < toMs);
        },
      },
      uow: {
        async run(owner, options, work) {
          if (options.readOnly && beforeDelivery) {
            const forget = beforeDelivery;
            beforeDelivery = undefined;
            await forget();
          }
          return f.base.uow.run(owner, options, work);
        },
      },
      contextRead: {
        ...f.base.contextRead,
        async snapshotState() { return [{ memory: 1, card: 1 }]; },
      },
    },
    contextReadCounter: { count },
    contextReadFormat(value) {
      if (value.ledgerDigest && onDigest) beforeDelivery = onDigest;
      return formatAssembly(value);
    },
  });
  const read = maxTokens => api.readContext(readSet(), {
    query: "How much food this week?", types: ["memory"], intent: "current", raw: false, budget: { maxTokens },
  });
  const wide = await read(6000);
  assert.ok(wide.assembly.ledgerDigest);
  t.diagnostic(`wide: ${digestCost(wide.assembly, count)} tokens, ${wide.assembly.ledgerDigest.sources.length} citations`);
  const maxTokens = 3000;
  const result = await read(maxTokens);
  const { ledgerDigest, items } = result.assembly;
  t.diagnostic(`bounded: ${ledgerDigest ? digestCost(result.assembly, count) : 0} tokens, ${ledgerDigest?.sources.length ?? 0} citations, ${items.length} items`);
  assert.ok(ledgerDigest, "the food answer fits even when the unfocused digest exceeds the read budget");
  const foodRows = records.filter(row => food.includes(row.memoryId));
  const total = foodRows.reduce((sum, row) => sum + row.value, 0);
  const answer = `Food spending: total $${total.toFixed(2)} in ${foodRows.length} records, average $${(total / 7).toFixed(2)} per day.`;
  const notice = " More ledger rows not shown.";
  assert.ok(ledgerDigest.body.includes(answer));
  assert.ok(ledgerDigest.body.endsWith(notice));
  assert.match(ledgerDigest.body, /Market receipt category /u);
  assert.doesNotMatch(ledgerDigest.body, /transport|subtotals/iu);
  assert.deepEqual(citationIds(ledgerDigest), food.sort());
  assert.deepEqual(ledgerDigest.sources.map(entry => entry.index), food.map((_, i) => i));
  const primary = { ...result.assembly, ledgerDigest: { ...ledgerDigest,
    body: ledgerDigest.body.slice(0, ledgerDigest.body.indexOf(answer) + answer.length) } };
  const answerCost = digestCost(primary, count);
  t.diagnostic(`answer: ${answerCost}/${maxTokens} tokens`);
  assert.ok(answerCost > 0.30 * maxTokens && answerCost <= 0.60 * maxTokens);
  const withoutNotice = { ...result.assembly, ledgerDigest: { ...ledgerDigest, body: ledgerDigest.body.slice(0, -notice.length) } };
  const optionalCost = digestCost(withoutNotice, count) - answerCost;
  assert.ok(optionalCost > 0 && optionalCost <= 0.30 * maxTokens);
  assert.ok(items.some(item => item.ref.type === "memory"));
  assert.ok(result.diagnostics.ledger.ledger_digest_trimmed > 0);
  assert.equal(result.diagnostics.budget.used, count(formatAssembly(result.assembly)));

  onDigest = async () => {
    onDigest = undefined;
    const transport = records.find(row => row.group === "transport");
    assert.equal((await f.writer.forget(scope, transport.memoryId, source)).status, "forgotten");
  };
  assert.deepEqual((await read(maxTokens)).assembly.ledgerDigest, ledgerDigest, "an uncited row leaves the delivered witness intact");

  const ref = ledgerDigest.sources[0].memory;
  const fetched = await api.fetchEvidence(readSet(), { intent: "current", refs: [{ scope, type: "memory", id: ref.id,
    revision: ref.rev }], fences: [ref.f] });
  assert.equal(fetched.items[0].ref.id, ref.id);
  let forgets = 0;
  onDigest = async () => {
    onDigest = undefined;
    forgets++;
    assert.equal((await f.writer.forget(scope, ref.id, source)).status, "forgotten");
  };
  assert.equal((await read(maxTokens)).assembly.ledgerDigest, undefined);
  assert.equal(forgets, 1);
});

test("ledger catch-all fails closed with a content-free stage and count", async () => {
  const f = fixture();
  const bread = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  f.readFailures.list = true;
  const result = await f.read(f.reader());
  assert.equal(result.assembly.ledgerDigest, undefined);
  assert.deepEqual(result.assembly.items.map(item => item.ref.id), [bread.id]);
  assert.deepEqual(result.diagnostics.ledger, { ledger_digest_error: { scan: 1 } });
});

test("a matched ledger scan with no deliverable rows reports a content-free reason", async () => {
  const f = fixture();
  await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  const result = await f.read(f.reader(), { query: "How much food yesterday?" });
  assert.equal(f.scans.length, 2);
  assert.equal(result.assembly.ledgerDigest, undefined);
  assert.deepEqual(result.diagnostics.ledger, { ledger_digest_empty: 1 });
});

test("a one-slot pack keeps the ranked item even when the digest fits", async () => {
  const f = fixture();
  await f.capture("Food: soup cost 4 USD.", [amount("soup", 4)]);
  for (const raw of [false, true]) {
    const control = await f.read(f.reader(), { raw });
    assert.ok(control.assembly.ledgerDigest);
    assert.equal(control.assembly.items.length, 1);
    const request = { raw, budget: { maxItems: 1 } };
    const ordinary = await f.read(f.reader({ enabled: false }), request);
    const ranked = await f.read(f.reader(), request);
    assert.equal(ranked.assembly.items.length, 1);
    assert.deepEqual(ranked.assembly, ordinary.assembly);
    assert.deepEqual(ranked.diagnostics.coverage, ordinary.diagnostics.coverage);
    assert.equal(ranked.diagnostics.budget.used, fixtureCount(formatAssembly(ranked.assembly)));
  }
});

test("question focus selects groups, categories and matching goals with all rows behind each total", async () => {
  const f = fixture();
  const coffee = await f.capture("Food: coffee cost 3 USD.", [amount("coffee", 3)]);
  const bread = await f.capture("Food: bread cost 7 USD.", [amount("bread", 7)]);
  const bus = await f.capture("Transport: bus cost 11 USD.", [amount("bus", 11, "transport")]);
  const goal = (category, value, group) => ({ ...amount(category, value, group),
    kind: "goal", period: "week", comparator: "at_most" });
  const coffeeGoal = await f.capture("Coffee budget is 6 USD per week.", [goal("coffee", 6)]);
  const busGoal = await f.capture("Bus budget is 15 USD per week.", [goal("bus", 15, "transport")]);
  const reader = f.reader();
  const read = async query => (await f.read(reader, { query })).assembly.ledgerDigest;
  const food = await read("How much did I spend on food today?");
  assert.match(food.body, /Food spending: total \$10\.00 in 2 records/u);
  assert.doesNotMatch(food.body, /Spend: total|Transport|bus/iu);
  assert.deepEqual(citationIds(food), [coffee.id, bread.id, coffeeGoal.id].sort());

  const category = await read("How much coffee today?");
  assert.match(category.body, /Spend: total \$21\.00 in 3 records/u);
  assert.match(category.body, /Food spending: total \$10\.00 in 2 records/u);
  assert.match(category.body, /Coffee: total \$3\.00 in 1 record/u);
  assert.match(category.body, /coffee budget goal/u);
  assert.doesNotMatch(category.body, /Transport spending|Bread:|Bus:|bus budget/u);
  assert.deepEqual(citationIds(category), [coffee.id, bread.id, bus.id, coffeeGoal.id].sort());

  const measure = await read("How much did I spend today?");
  assert.match(measure.body, /Spend: total \$21\.00 in 3 records/u);
  assert.match(measure.body, /Food spending: total \$10\.00 in 2 records/u);
  assert.match(measure.body, /Transport spending: total \$11\.00 in 1 record/u);
  assert.doesNotMatch(measure.body, /Coffee:|Bread:|Bus:/u);
  assert.deepEqual(citationIds(measure), [coffee.id, bread.id, bus.id, coffeeGoal.id, busGoal.id].sort());
});

test("non-ledger responses retain their exact bytes", async () => {
  const f = fixture();
  await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  const off = f.reader({ enabled: false });
  const on = f.reader();
  for (const query of ["Where is the bread?", "How much sleep today?"]) {
    await f.read(off, { query });
    const expected = await f.read(off, { query });
    assert.equal(JSON.stringify(await f.read(on, { query })), JSON.stringify(expected));
  }
  assert.deepEqual(f.scans, []);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parameters, key, scenarios, namespaces, memoryContent } from './content.mjs';
import { tokenizeT1, TOKENIZER_VERSION, REPRESENTATION_VERSION } from '../../../core/context-read-tokenize.mjs';

// Authored questions. Evidence is selected from named ground-truth slots, never search output.
export function authoredQueries() {
  const queries = [];
  function add(id, category, language, text, slots, { intent = 'current', form = 'natural', ...metadata } = {}) {
    queries.push({ id, category, language, text, intent, form, ...metadata, slots });
  }
  for (let n = 0; n < 4; n++) {
    const name = parameters.names[n], next = parameters.names[(n + 1) % 4];
    const m = i => key(0, n, 'm', i), k = i => key(0, n, 'k', i), otherK = i => key(0, (n + 1) % 4, 'k', i);
    const zh = [
      [`${name}調整之前的巡檢日是哪一天？`, [m(0)], 'history', 'natural'],
      [`${name}舊版資料會保留幾天？`, [m(1)], 'history', 'paraphrase'],
      [`${name}以前最多允許重試幾次？`, [m(2)], 'history', 'natural'],
      [`${name}目前琥珀佇列能容納多少筆？`, [m(3)], 'current', 'natural'],
      [`${name}的羽砂演練要找哪位虛構員偶負責？`, [m(4)], 'current', 'paraphrase'],
      [`${name} 雨紋 Offline export 的版本`, [m(5)], 'current', 'exact-term'],
      [`${name}的白礫手冊要求先做什麼，再做什麼？`, [k(6)], 'current', 'natural'],
      [`${name}月苔卡片多久才容許切換？`, [k(7)], 'current', 'paraphrase'],
      [`${name} 砂羽驗收卡 樣本數`, [k(8)], 'current', 'exact-term'],
      [`比較${name}與${next}的霧鈴預備額度，各是多少格？`, [k(9), otherK(9)], 'current', 'natural'],
    ];
    zh.forEach(([text, slots, intent, form], i) => add(`zh-${n}-${i}`, 'zh-Hant', 'zh-Hant', text, slots, { intent, form }));
    const ja = [
      [`${name}の変更前の保存期間は何日でしたか。`, [m(1)], 'history', 'natural'],
      [`${name}の霜匣方式では保管前に何分待ちますか。`, [m(7)], 'current', 'paraphrase'],
      [`${name}の珊石ラベルに使う絵文字と文字表記は何ですか。`, [m(8)], 'current', 'natural'],
      [`${name} 砂羽 検収 標本数`, [k(8)], 'current', 'exact-term'],
      [`${name}と${next}の霧鈴カードの予備枠をそれぞれ教えてください。`, [k(9), otherK(9)], 'current', 'natural'],
    ];
    ja.forEach(([text, slots, intent, form], i) => add(`ja-${n}-${i}`, 'ja', 'ja', text, slots, { intent, form }));
    const mixed = [
      [`${name} current retention 現在保留幾天？`, [m(276)], 'zh-en', 'natural'],
      [`${name}の current retry limit は何回ですか。`, [m(277)], 'ja-en', 'natural'],
      [`${name} MossBell 的 batch confirmation threshold？`, [m(6)], 'zh-en', 'exact-term'],
      [`${name} WhitePebble runbook の最初と次の手順は？`, [k(6)], 'ja-en', 'paraphrase'],
      [`${name}和${next}的 ArcLamp release，各需幾位審核員？`, [m(9), key(0, (n + 1) % 4, 'm', 9)], 'zh-en', 'natural'],
    ];
    mixed.forEach(([text, slots, language, form], i) => add(`mixed-${n}-${i}`, 'mixed', language, text, slots, { form }));
  }
  const temporalQuestions = [
    ['我這週在做什麼', 'thisWeek'], ['我本週都在忙啥', 'thisWeek'],
    ['這星期我在忙什麼', 'thisWeek'], ['我這週忙哪些事', 'thisWeek'],
    ['上週決定了什麼', 'lastWeek'], ['我上週做了哪些決定', 'lastWeek'],
    ['我最近都在忙什麼', 'recent'], ['最近我都在忙什麼', 'recent'],
  ];
  temporalQuestions.forEach(([text, window], i) => {
    const dates = parameters.temporalAnchor[window];
    const slots = scenarios.filter(row => row.groundTruth.eventDate >= dates.startDate && row.groundTruth.eventDate < dates.endDateExclusive)
      .map(row => key(0, row.namespaceIndex, 'm', row.slot));
    add(`temporal-${i}`, 'zh-Hant', 'zh-Hant', text, slots, { shortTemporal: true,
      temporal: { asOf: parameters.temporalAnchor.asOf, timezone: parameters.temporalAnchor.timezone, window, ...dates } });
  });
  scenarios.filter(row => row.groundTruth.productTermQuestion).forEach((row, i) =>
    add(`product-term-${i}`, 'mixed', 'zh-en', row.groundTruth.productTermQuestion,
      [key(0, row.namespaceIndex, 'm', row.slot)], { productTerm: true, topic: row.groundTruth.topic }));
  scenarios.filter(row => row.groundTruth.zeroOverlapQuestion).forEach((row, i) =>
    add(`zero-overlap-${i}`, 'zh-Hant', 'zh-Hant', row.groundTruth.zeroOverlapQuestion,
      [key(0, row.namespaceIndex, 'm', row.slot)], { zeroSharedTokens: true, form: 'zero-overlap-paraphrase', topic: row.groundTruth.topic }));
  const histories = [
    [0, 0, '個人實驗簿巡檢之前排哪天？後來為什麼挪動？'],
    [0, 1, '我原本把實驗筆記留多久？怎麼會改成現在這樣？'],
    [0, 2, '實驗簿之前允許重試幾次？調高是因為什麼？'],
    [1, 0, '霧棱原本哪天巡檢？為什麼換日子？'],
    [1, 1, '霧棱以前留幾天資料？後來加長的理由呢？'],
    [1, 2, '霧棱的重試以前設多少？這次改設定是遇到了什麼？'],
  ];
  histories.forEach(([n, slot, text], i) => add(`natural-history-${i}`, 'zh-Hant', 'zh-Hant', text,
    [key(0, n, 'm', slot), key(0, n, 'm', 275 + slot)], { intent: 'history', naturalHistory: true, explanationRequired: true }));
  scenarios.filter(row => row.groundTruth.ownerWideQuestion).forEach((row, i) => {
    const truth = row.groundTruth, slots = [key(0, row.namespaceIndex, row.type === 'card' ? 'k' : 'm', row.slot)];
    const metadata = { ownerWide: true, topic: truth.topic, foregroundNamespace: namespaces[truth.discussionNamespaceIndex] };
    add(`owner-wide-${i}`, 'zh-Hant', 'zh-Hant', truth.ownerWideQuestion, slots, metadata);
    add(`distractor-${i}`, 'zh-Hant', 'zh-Hant', truth.distractorQuestion, slots, { ...metadata, distractorChallenge: true });
  });
  const negatives = [
    ['zh-Hant', '琥珀佇列每月預算是多少？', '每月預算'],
    ['zh-Hant', '羽砂演練的緊急聯絡分機是多少？', '緊急聯絡分機'],
    ['zh-Hant', '雨紋匯出的壓縮率是多少？', '壓縮率'],
    ['zh-Hant', '苔鐘確認採用哪種簽章演算法？', '簽章演算法'],
    ['ja', '月苔カードの保守費用はいくらですか。', '保守費用'],
    ['ja', '砂羽検収の合格証番号を教えて。', '合格証番号'],
    ['ja', '霧鈴カードの請求通貨は何ですか。', '請求通貨'],
    ['zh-en', '霧棱 MCP 的憑證指紋是什麼？', '憑證指紋'],
    ['ja-en', '苔弦 embedding の訓練標本総数は？', '訓練標本総数'],
    ['zh-en', '砂環 WAL 的磁碟保固到哪一天？', '磁碟保固'],
  ];
  negatives.forEach(([language, text, absentProperty], i) => add(`negative-${i}`, 'negative', language, text, [], { form: 'unanswerable', notInMemory: true, absentProperty }));
  return queries;
}

export function labelQueries(world) {
  const byKey = new Map(world.records.map(row => [row.logicalKey, row]));
  const ref = row => ({ id: row.id, namespace: row.namespace, type: row.type,
    revision: row.revision, bodyRevision: row.bodyRevision });
  return authoredQueries().map(({ slots, ...query }) => {
    const required = slots.map(slot => { const row = byKey.get(slot); if (!row) throw Error(`missing label slot ${slot}`); return row; });
    const acceptableAlternates = required.map(row => {
      const match = /^c0\/n(\d)\/m([3-8])$/.exec(row.logicalKey);
      const alternates = [];
      for (let c = 0; c < parameters.worlds[world.world].cohorts; c++) {
        const same = byKey.get(row.logicalKey.replace('c0/', `c${c}/`));
        if (c > 0) alternates.push(same);
        if (match) alternates.push(byKey.get(key(c, Number(match[1]), 'k', Number(match[2]) - 3)));
      }
      return { requiredId: row.id, refs: alternates.map(ref) };
    });
    const spaces = [...new Set(required.map(row => JSON.stringify(row.namespace)))].map(JSON.parse);
    const types = [...new Set(required.map(row => row.type))].sort();
    const extra = {};
    if (query.zeroSharedTokens) {
      const queryTokens = [...new Set(tokenizeT1(query.text))].sort();
      const comparisons = [...required.map(ref), ...acceptableAlternates.flatMap(group => group.refs)].map(evidence => {
        const row = world.records.find(record => record.id === evidence.id);
        const [c, n, i] = row.logicalKey.match(/\d+/g).map(Number);
        assert.equal(row.type, 'memory');
        const body = memoryContent(c, n, i).submitted.normalize('NFKC').replace(/\s+/gu, ' ').trim();
        assert.equal(createHash('sha256').update(body).digest('hex'), row.bodySha256);
        const documentTokens = new Set(tokenizeT1(body));
        const sharedTokens = queryTokens.filter(token => documentTokens.has(token));
        assert.deepEqual(sharedTokens, [], `${query.id}: zero-overlap claim must cover the entire stored candidate`);
        return { ref: evidence, sharedTokens, bodySha256: row.bodySha256 };
      });
      extra.lexicalProof = { tokenizer: TOKENIZER_VERSION, representation: REPRESENTATION_VERSION, queryTokens, comparisons };
      extra.lexicalOnlyExpectation = 'Known answerable ceiling case; report recall separately. Empty lexical retrieval is a miss, not a correct abstention.';
    }
    if (query.ownerWide || query.distractorChallenge) {
      const related = world.records.filter(row => row.groundTruth?.topic === query.topic);
      const counts = world.namespaces.map(namespace => ({ namespace,
        count: related.filter(row => JSON.stringify(row.namespace) === JSON.stringify(namespace)).length }));
      const majority = counts.find(item => item.count > related.length / 2);
      assert.ok(majority, `${query.id}: strict related-record namespace majority`);
      assert.deepEqual(majority.namespace, query.foregroundNamespace);
      assert.ok(required.every(row => JSON.stringify(row.namespace) !== JSON.stringify(majority.namespace)));
      extra.ownerWideProof = { relatedEvidence: related.map(ref), relatedCountsByNamespace: counts,
        majorityNamespace: majority.namespace, answerOutsideMajority: true };
      extra.distractorEvidence = related.filter(row => ['proposal', 'rejected-suggestion'].includes(row.groundTruth?.adoptionStatus))
        .map(row => ({ ref: ref(row), adopted: false, adoptionStatus: row.groundTruth.adoptionStatus,
          suggested: row.groundTruth.suggested, resolution: row.groundTruth.resolution }));
      extra.correctDecision = required.map(row => ({ ref: ref(row), adopted: true, chosen: row.groundTruth.chosen }));
    }
    return { ...query, world: world.world, requiredEvidence: required.map(ref), acceptableAlternates,
      ...extra,
      namespaces: spaces.length ? spaces : world.namespaces, types: types.length ? types : ['memory', 'card'],
      readTypesBySchema: { 18: ['memory'], 23: ['memory', 'card'], 33: ['memory', 'card'] },
      crossNamespace: spaces.length > 1, expected: required.length ? 'answerable' : 'abstain',
      applicableSchemas: types.includes('card') ? [23, 33] : [18, 23, 33],
      evidenceRule: 'All required evidence groups must be satisfied. For each required id, its exact ref OR one listed alternate ref suffices; groups are AND, alternatives are OR.',
      answers: required.map(row => ({ logicalKey: row.logicalKey, statement: row.truth })) };
  });
}

export function auditNotes(labels, world) {
  const byId = new Map(world.records.map(row => [row.id, row]));
  return labels.map(label => {
    const lines = [`${label.id} | ${label.language} | ${label.intent} | ${label.text}`,
      `Expected: ${label.expected}. Applicable physical schemas: ${label.applicableSchemas.join(', ')}.`];
    if (!label.requiredEvidence.length) lines.push(`Why no ids: the familiar subject exists but the requested property (${label.absentProperty}) has no authored fact anywhere in the world, receipts or notes. Abstain; plausible adjacent facts and lexical hits do not supply that property.`);
    if (label.temporal) lines.push(`Frozen temporal interpretation: as of ${label.temporal.asOf} (${label.temporal.timezone}), event dates in [${label.temporal.startDate}, ${label.temporal.endDateExclusive}). All authored events in that window are required; query time never uses the machine clock.`);
    if (label.zeroSharedTokens) lines.push(`Zero-shared-token paraphrase: ${label.lexicalProof.tokenizer}, entire canonical Memory bodies including namespace prefix and padding. Query terms: ${JSON.stringify(label.lexicalProof.queryTokens)}; every required/alternate ref has intersection []. ${label.lexicalOnlyExpectation}`);
    for (const evidence of label.requiredEvidence) {
      const row = byId.get(evidence.id);
      lines.push(`Required group: ${row.type} ${row.id} rev ${row.revision} bodyRev ${row.bodyRevision}; ${row.logicalKey}; namespace ${JSON.stringify(row.namespace)}.`,
        `Stored fact: ${row.truth}`, `State: ${row.currentness}. Body: ${row.bodyUnits} UTF-16 units; SHA-256 ${row.bodySha256}.`);
      if (row.groundTruth?.eventDate) lines.push(`Event date: ${row.groundTruth.eventDate}; event role: ${row.groundTruth.temporalRole}.`);
      if (label.naturalHistory && row.groundTruth?.changeReason) lines.push(`Required explanation from successor body: ${row.groundTruth.changeReason}. An answer giving only the previous value is incomplete.`);
      const replacement = world.links.find(link => link.previous === row.logicalKey);
      if (replacement) lines.push(`History is necessary: this record was explicitly superseded by ${replacement.replacement} (${world.records.find(r => r.logicalKey === replacement.replacement).id}). Current intent excludes the old answer.`);
      for (const alt of label.acceptableAlternates.find(a => a.requiredId === row.id).refs) {
        const other = byId.get(alt.id);
        lines.push(`Acceptable substitute for this group: ${other.type} ${other.id} rev ${other.revision}, ${other.logicalKey}. Same authored fact (including replicated cohorts): ${other.truth}`);
      }
    }
    if (label.ownerWideProof) lines.push(`Owner-wide check: related record counts ${JSON.stringify(label.ownerWideProof.relatedCountsByNamespace)}. The answer is outside the strict majority namespace ${JSON.stringify(label.ownerWideProof.majorityNamespace)}; the foreground project is not a read filter.`);
    for (const distractor of label.distractorEvidence ?? []) {
      const row = byId.get(distractor.ref.id);
      lines.push(`Do not adopt: ${row.type} ${row.id} rev ${row.revision}, ${row.logicalKey}; hidden ground truth adopted=false, adoptionStatus=${distractor.adoptionStatus}.`,
        `Naturally phrased distractor body fact: ${row.truth}`, `Ground-truth outcome: ${distractor.resolution}`);
    }
    if (label.crossNamespace) lines.push('Fusion check: every namespace group above is needed; one namespace alone cannot answer the comparison.');
    lines.push('Only the exact same fact in a replicated cohort or listed curated Card is an alternate; unrelated facts do not satisfy a group.');
    return lines.join('\n');
  }).join('\n\n') + '\n';
}

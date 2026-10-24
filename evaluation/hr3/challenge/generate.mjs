import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { answerSchema } from './schema.mjs';

export const ROOT = fileURLToPath(new URL('.', import.meta.url));
export const SEED = 'hr3-independent-challenge-v1-2026-10-25';
export const DATASETS = ['pooled.jsonl', 'referral-candidates.jsonl', 'evidence-contrasts.jsonl', 'representation-pairs.jsonl'];
export const STYLES = ['terse', 'conversational', 'formal', 'operational'];
export const LANGUAGES = ['zh-Hant', 'en', 'mixed'];
export const SCENARIOS = ['correction', 'reversal', 'refinement', 'scope_change', 'expiry', 'multiple_predecessors', 'unresolved', 'initial', 'retroactive_correction'];
export const CAUSAL = ['direct', 'not_stated', 'serial_two', 'serial_three', 'conjunctive_mediated', 'alternative_mediated'];
export const DISTORTIONS = ['wrong_reasons', 'commitment_changes', 'broadened_scopes', 'dropped_qualifications'];
export const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b, 'en'))) : v);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = structuredClone;
const textValue = text => ({ type: 'Text', text });
const phrase = (language, zh, en, mixed) => language === 'zh-Hant' ? zh : language === 'en' ? en : mixed;
const scope = (countries = ['TW'], channels = ['web', 'app']) => ({ any: [{ all: [{ field: 'country', values: countries }, { field: 'plan', values: ['pro'] }, { field: 'channel', values: channels }] }] });
const interval = (from = '2028-02-29T16:00:00Z', to = '2028-03-31T16:00:00Z') => ({ from, to });
const qualifier = language => ({ key: 'dispatch_condition', value: textValue(phrase(language, '必須先完成審核。', 'The review must be complete first.', '先完成 review 才可執行。')) });

// Each row is an authored semantic atom with four deliberately different readings.
// Rows, rather than a guessed dictionary or a scorer, license these paraphrases.
const decisionPhrases = {
  'zh-Hant': [
    ['完成審核前暫停出貨。', '審核還沒完成，就先別把貨送出去。', '出貨須待審核完成後始得恢復。', '先等審核完成，再放行出貨。'],
    ['完成審核前暫停退款。', '審核還沒完成，就先不要退款。', '退款須待審核完成後始得辦理。', '先等審核完成，再放行退款。'],
    ['完成審核前暫停上線。', '審核還沒完成，就先不要上線。', '上線須待審核完成後始得進行。', '先等審核完成，再放行上線。'],
  ],
  en: [
    ['Hold dispatch until the review is complete.', 'Keep the goods on hold until the review is done.', 'Dispatch may proceed only after completion of the review.', 'Finish the review first; then release the shipment.'],
    ['Hold refunds until the review is complete.', 'Keep refunds on hold until the review is done.', 'Refunds may proceed only after completion of the review.', 'Finish the review first; then release refunds.'],
    ['Hold rollout until the review is complete.', 'Keep the rollout on hold until the review is done.', 'Rollout may proceed only after completion of the review.', 'Finish the review first; then release the rollout.'],
  ],
  mixed: [
    ['review 完成前暫停 dispatch。', '貨先別出，等 review 做完再 dispatch。', 'Dispatch 須於 review 完成後始得放行。', '先完成 review，再 release shipment。'],
    ['review 完成前暫停 refund。', '先別退款，等 review 做完再 refund。', 'Refund 須於 review 完成後始得辦理。', '先完成 review，再 release refund。'],
    ['review 完成前暫停 rollout。', '先別上線，等 review 做完再 rollout。', 'Rollout 須於 review 完成後始得進行。', '先完成 review，再 release rollout。'],
  ],
};
const causePhrases = {
  'zh-Hant': [
    ['審核積壓增加。', '等著審的案件堆得更多了。', '待審案件積壓量上升。', '待審佇列變長。'],
    ['可用容量下降。', '能用的容量變少了。', '可供使用之容量減少。', '可用容量縮減。'],
    ['違約風險增加。', '不能如期履約的風險變高了。', '未能履行約定之風險上升。', '履約失敗風險升高。'],
    ['本次變更生效。', '這次變更開始適用了。', '本次變更正式發生效力。', '本次變更已生效。'],
  ],
  en: [
    ['The review backlog grew.', 'More cases were waiting for review.', 'The number of pending reviews increased.', 'The review queue got longer.'],
    ['Available capacity fell.', 'There was less capacity available.', 'The amount of available capacity decreased.', 'Available capacity shrank.'],
    ['The risk of failing the commitment increased.', 'There was a greater risk of not meeting the commitment.', 'The probability of failure to fulfil the commitment rose.', 'The risk of missing the commitment rose.'],
    ['The focal change took effect.', 'This change started to apply.', 'The focal change became effective.', 'The change is now in effect.'],
  ],
  mixed: [
    ['review backlog 增加。', '等 review 的案件更多了。', 'Pending review 案件量上升。', 'review queue 變長。'],
    ['available capacity 下降。', '能用的 capacity 變少了。', '可用 capacity 總量減少。', 'available capacity 縮減。'],
    ['履行 commitment 失敗的風險增加。', '不能 fulfil commitment 的風險變高了。', '未能履行 commitment 的風險上升。', 'commitment failure risk 升高。'],
    ['本次 change 生效。', '這次 change 開始適用了。', '本次 change 正式發生效力。', '本次 change 已生效。'],
  ],
};

function makeValue(kind, n, language) {
  if (kind === 0) return textValue(decisionPhrases[language][n % 3][0]);
  if (kind === 1) return { type: 'Boolean', value: n % 2 === 0 };
  if (kind === 2) return { type: 'Quantity', decimal: String(60 + (n % 9) * 60), unit: 'minute' };
  if (kind === 3) return { type: 'Instant', iso: '2028-03-09T16:00:00Z' };
  return { type: 'Range', lower: String(60 + n % 9), upper: String(120 + n % 9), lowerClosed: true, upperClosed: false, unit: 'minute' };
}
function wrongValue(value) {
  if (value.type === 'Text') {
    const language = !/\p{Script=Han}/u.test(value.text) ? 'en' : /[A-Za-z]/.test(value.text) ? 'mixed' : 'zh-Hant';
    return textValue(phrase(language,
      value.text.includes('標準') ? '採用優先處理。' : '採用標準處理。',
      value.text.includes('standard') ? 'Use priority processing.' : 'Use standard processing.',
      value.text.includes('standard') ? '採用 priority processing。' : '採用 standard processing。'));
  }
  if (value.type === 'Boolean') return { ...value, value: !value.value };
  if (value.type === 'Quantity') return { ...value, decimal: String(Number(value.decimal) + 1) };
  if (value.type === 'Instant') return { ...value, iso: new Date(Date.parse(value.iso) + 86400000).toISOString().replace('.000Z', 'Z') };
  return { ...value, upperClosed: !value.upperClosed };
}
function makeClaim(subject, value, audience, valid, qualifiers, predicate = 'policy') {
  return { subject, predicate, value: clone(value), scope: clone(audience), valid: clone(valid), qualifiers: clone(qualifiers), citations: [] };
}
function edgeGraph(causal) {
  if (causal === 'not_stated') return [[]];
  if (causal === 'direct') return [[['a', 'd']]];
  if (causal === 'serial_two') return [[['a', 'b'], ['b', 'd']]];
  if (causal === 'serial_three') return [[['a', 'b'], ['b', 'c'], ['c', 'd']]];
  if (causal === 'conjunctive_mediated') return [[['a', 'c'], ['b', 'c'], ['c', 'd']]];
  return [[['a', 'c'], ['c', 'd']], [['b', 'c'], ['c', 'd']]];
}
function valueText(value) {
  if (value.type === 'Text') return value.text;
  if (value.type === 'Boolean') return String(value.value);
  if (value.type === 'Quantity') return `${value.decimal} ${value.unit}`;
  if (value.type === 'Instant') return value.iso;
  return `${value.lowerClosed ? '[' : '('}${value.lower ?? '-∞'},${value.upper ?? '+∞'}${value.upperClosed ? ']' : ')'} ${value.unit}`;
}
function describeClaim(claim, language) {
  const scopeText = claim.scope.any.map(term => term.all.map(t => `${t.field} ∈ {${t.values.join(',')}}`).join(' AND ')).join(' OR ');
  return phrase(language,
    `${claim.subject} 的 ${claim.predicate}：${valueText(claim.value)} 適用對象：${scopeText}。來源聲明期間 [${claim.valid.from ?? '-∞'},${claim.valid.to ?? '+∞'})。條件：${claim.qualifiers.map(q => `${q.key}=${valueText(q.value)}`).join('；')}。`,
    `${claim.subject}, ${claim.predicate}: ${valueText(claim.value)} Audience: ${scopeText}. Source-claimed interval [${claim.valid.from ?? '-∞'},${claim.valid.to ?? '+∞'}). Conditions: ${claim.qualifiers.map(q => `${q.key}=${valueText(q.value)}`).join('; ')}.`,
    `${claim.subject} 的 ${claim.predicate}: ${valueText(claim.value)} Audience 是 ${scopeText}。Source-claimed interval [${claim.valid.from ?? '-∞'},${claim.valid.to ?? '+∞'})。Conditions: ${claim.qualifiers.map(q => `${q.key}=${valueText(q.value)}`).join('; ')}。`);
}
function cite(item, quote, intent = 'current', unit = 'body', source = null) {
  return { intent, item, unit, source, quote, occurrence: 1 };
}

function createWorld(set, n, language, options = {}) {
  const id = `hr3-calibration-independent-v1/${set}/${language}/${String(n).padStart(3, '0')}`;
  const token = sha256(`${SEED}/${id}`).slice(0, 12);
  const subject = phrase(language, `合成作業-${token}`, `Synthetic operation-${token}`, `合成 operation-${token}`);
  const scenario = options.scenario ?? SCENARIOS[n % SCENARIOS.length];
  const causal = options.causal ?? CAUSAL[Math.floor(n / 3) % CAUSAL.length];
  const kind = options.textOnly ? 0 : n % 5;
  const value = makeValue(kind, n, language);
  const audience = scope(scenario === 'scope_change' ? ['TW', 'JP'] : ['TW']);
  const qualifiers = [qualifier(language), { key: 'audit_required', value: { type: 'Boolean', value: true } }];
  const currentClaim = makeClaim(subject, value, audience, interval(), qualifiers);
  const previousClaim = makeClaim(subject, wrongValue(value), audience, interval('2028-01-01T16:00:00Z', null), qualifiers);
  let current = { status: 'active', claims: [currentClaim] };
  let old = { status: 'available', records: [{ status: 'previously_adopted', claims: [previousClaim] }] };
  let derivation = 'Explicit adoption replaces the named predecessor in the declared audience; the old claim keeps its source-claimed interval.';
  if (scenario === 'correction' || scenario === 'retroactive_correction') {
    old.records[0].status = 'erroneous';
    derivation = 'The earlier assertion was explicitly recorded in error, never adopted; its corrected replacement includes all qualifications (§§1,3,6).';
    if (scenario === 'retroactive_correction') currentClaim.valid.from = '2028-01-01T16:00:00Z';
  } else if (scenario === 'refinement') {
    previousClaim.value = clone(value);
    currentClaim.qualifiers[1].value.value = false;
    derivation = 'Only audit_required changes to false; policy value and dispatch_condition are expressly retained (§3).';
  } else if (scenario === 'scope_change') {
    currentClaim.scope = scope(['TW']);
    const residual = clone(previousClaim);
    residual.scope = scope(['JP']);
    current.claims.push(residual);
    derivation = 'Only TW cells change. JP retains the predecessor value, qualifications and source interval; the query asks for both TW and JP (§§2,3).';
  } else if (scenario === 'expiry') {
    previousClaim.valid.to = '2028-02-29T16:00:00Z';
    current = { status: 'no_active_decision', claims: [] };
    old.records[0].status = 'expired';
    derivation = 'The explicitly named predecessor expires at March 1 local midnight without a successor; no earlier decision reactivates (§§1–3).';
  } else if (scenario === 'multiple_predecessors') {
    previousClaim.valid.to = '2028-02-01T16:00:00Z';
    const second = clone(previousClaim);
    second.value = makeValue(kind, n + 1, language);
    second.valid = interval('2028-02-01T16:00:00Z', '2028-02-29T16:00:00Z');
    old.records.push({ status: 'previously_adopted', claims: [second] });
    derivation = 'The declared focal change explicitly replaces BOTH named earlier records. O requests this complete two-record set, in source order (§§2,3,7).';
  } else if (scenario === 'unresolved') {
    current = { status: 'unresolved', claims: [] };
    old = { status: 'unavailable', records: [] };
    derivation = 'There is no adopted baseline and the proposed target anchor is nonunique. The update and requested predecessor remain unresolved/unavailable (§§2,3).';
  } else if (scenario === 'initial') {
    old = { status: 'none', records: [] };
    derivation = 'This is an explicitly adopted initial record. There is no predecessor (§§2,3,6).';
  }
  // For unresolved cases the explanation describes the unresolved update, not an adoption.
  const actualCausal = scenario === 'unresolved' ? 'not_stated' : causal;
  const graphs = edgeGraph(actualCausal);
  const ids = [...new Set(graphs.flat(2))].sort();
  const atomIndex = { a: 0, b: 1, c: 2, d: 3 };
  const nodes = ids.map(nodeId => ({ id: nodeId, claim: makeClaim(subject, textValue(causePhrases[language][atomIndex[nodeId]][0]), audience, interval(), [], 'causal_statement') }));
  const reason = { status: actualCausal === 'not_stated' ? 'not_stated' : 'stated', nodes, edges: graphs[0].map(([from, to]) => ({ from, to, citations: [] })) };
  const answer = { current, old, reason };
  const acceptedGraphs = graphs.map(edges => edges.map(([from, to]) => ({ from, to })));
  const delivered = [];
  const claimsSupport = [];
  function deliver(text, unit = 'body') {
    const item = delivered.length;
    delivered.push({ item, unit, source: null, text });
    return cite(item, text, 'current', unit);
  }
  const summary = phrase(language,
    `已觀察焦點更新 update-${token}。檢查點是台北時間 2028-03-15 12:00。${scenario} 的狀態為 ${current.status}；前項狀態為 ${old.status}。`,
    `Observed focal update update-${token}. Checkpoint: 2028-03-15 12:00 Asia/Taipei. ${scenario} current status: ${current.status}; predecessor availability: ${old.status}.`,
    `已觀察 focal update update-${token}。Checkpoint 是台北時間 2028-03-15 12:00。${scenario} current status: ${current.status}；predecessor availability: ${old.status}。`);
  deliver(`${summary} ${phrase(language, '以下是來源明確聲明的狀態與條件。', 'The following statuses and conditions are explicit source statements.', '以下 statuses 與 conditions 都由 source 明確聲明。')}`);
  for (const claim of current.claims) claimsSupport.push({ section: 'current', citation: deliver(describeClaim(claim, language)) });
  for (const record of old.records) for (const claim of record.claims) {
    const label = phrase(language, `指定的前項記錄，歷史標記為 ${record.status}。`, `Named predecessor; historical label: ${record.status}.`, `指定 predecessor，historical label: ${record.status}。`);
    const citation = deliver(`${label} ${describeClaim(claim, language)}`);
    citation.intent = 'history';
    claimsSupport.push({ section: 'old', citation });
  }
  const edgeSupport = [];
  for (const [from, to] of [...new Map(graphs.flat().map(edge => [edge.join(':'), edge])).values()]) {
    const a = nodes.find(node => node.id === from).claim.value.text;
    const b = nodes.find(node => node.id === to).claim.value.text;
    const context = actualCausal === 'conjunctive_mediated'
      ? phrase(language, 'a 與 b 共同造成 c，兩者均不可省略。', 'a and b jointly cause c; both are required.', 'a 與 b jointly cause c，兩者都 required。')
      : actualCausal === 'alternative_mediated'
        ? phrase(language, 'a 或 b 各自足以造成 c，再由 c 造成 d。', 'Either a or b independently suffices for c; c then causes d.', 'a 或 b 各自足以 cause c，再由 c cause d。') : '';
    const quote = phrase(language, `由於「${a}」，因此「${b}」。${context}`, `Because “${a}”, “${b}”. ${context}`, `因為「${a}」，所以「${b}」。${context}`);
    const citation = deliver(quote, n % 2 ? 'receipt' : 'body');
    edgeSupport.push({ from, to, alternatives: [[citation]] });
  }
  if (!edgeSupport.length) deliver(phrase(language, '沒有交代變更原因；不得由時間先後推論因果。', 'No reason for the change was stated; temporal order does not establish a cause.', '沒有 stated reason；時間先後不代表 causality。'));
  deliver(phrase(language, '有同事提議立即執行，但已否決；這只是引述，並未採納。', 'A colleague proposed immediate execution; the proposal was rejected and merely quoted, never adopted.', '有人 proposed 立即執行，但已 rejected；只是 quote，沒有 adopted。'));
  const gold = { answer, acceptedGraphs };
  const question = phrase(language,
    `就 ${subject}，在台北時間 2028-03-15 12:00，依已觀察的焦點更新回答：適用對象 ${JSON.stringify(audience)} 的目前決定、此更新明確指定的全部前項記錄（含錯誤／到期標記），以及變更原因為何？所有期間採 [起點,終點)，「到 3 月 31 日為止」含該日。`,
    `For ${subject}, at 2028-03-15 12:00 Asia/Taipei, use the observed focal update: what is the current decision for ${JSON.stringify(audience)}, what are ALL predecessors explicitly named by this update (including erroneous/expired labels), and why did it change? Intervals are [from,to); “through March 31” includes that day.`,
    `針對 ${subject}，checkpoint 是台北時間 2028-03-15 12:00：對 ${JSON.stringify(audience)}，current decision、focal update 明確指定的 ALL predecessors（含 erroneous/expired labels），以及 change reason 是什麼？Intervals 用 [from,to)，through March 31 包含該日。`);
  return { id, lineage: id, split: 'calibration-only', language, scenario, causal_class: actualCausal, subject, question,
    checkpoint: '2028-03-15T04:00:00Z', observed_at: '2028-03-10T04:00:00Z',
    source_ast: { derivation, semantics: clone(answer), accepted_graphs: acceptedGraphs, text_atom: n % 3, value_kind: kind,
      explicit_commitment: scenario === 'unresolved' ? 'unresolved' : 'adopted',
      predecessor_relation: 'all records explicitly named by the focal update, never an unspecified previous record',
      date_readings: { boundary_example: { from: '2028-03-01 00:00 Asia/Taipei', through: '2028-03-31', exclusive_to: '2028-04-01 00:00 Asia/Taipei' }, actual_source_claimed_intervals: [...current.claims, ...old.records.flatMap(r => r.claims)].map(c => clone(c.valid)) } },
    gold, delivered, claims_support: claimsSupport, edge_support: edgeSupport };
}

function represent(world, styleIndex, variantIndex = 0) {
  const candidate = clone(world.gold.answer);
  const transformations = [];
  // Intentional idiom/context differences, including within every referral world.
  const allClaims = [...candidate.current.claims, ...candidate.old.records.flatMap(r => r.claims), ...candidate.reason.nodes.map(n => n.claim)];
  for (const claim of allClaims) {
    if (claim.value.type === 'Text') {
      const bank = claim.predicate === 'causal_statement'
        ? causePhrases[world.language].find(row => row[0] === claim.value.text)
        : decisionPhrases[world.language].find(row => row[0] === claim.value.text);
      if (bank) {
        claim.value.text = bank[styleIndex];
        transformations.push({ kind: 'authored_atom_paraphrase', style: STYLES[styleIndex] });
      }
    }
    // Exact units, instant offsets, DNF regrouping, set order, equivalent duplicates.
    if (claim.value.type === 'Quantity' && styleIndex % 2) {
      const divisible = Number(claim.value.decimal) % 60 === 0;
      claim.value.decimal = String(divisible ? Number(claim.value.decimal) / 60 : Number(claim.value.decimal) * 60);
      claim.value.unit = divisible ? 'hour' : 'second';
      transformations.push({ kind: 'exact_rational_unit', ratio: divisible ? '60 minute = 1 hour' : '1 minute = 60 second' });
    }
    if (claim.value.type === 'Range' && styleIndex === 2) {
      claim.value.lower = String(Number(claim.value.lower) * 60);
      claim.value.upper = String(Number(claim.value.upper) * 60);
      claim.value.unit = 'second';
      transformations.push({ kind: 'exact_rational_unit', ratio: '1 minute = 60 second' });
    }
    if (styleIndex === 1 || styleIndex === 3) {
      for (const endpoint of ['from', 'to']) if (claim.valid[endpoint]) claim.valid[endpoint] = taipeiOffset(claim.valid[endpoint]);
      if (claim.value.type === 'Instant') claim.value.iso = taipeiOffset(claim.value.iso);
      transformations.push({ kind: 'equivalent_offset', timezone: 'Asia/Taipei (+08:00)' });
    }
    if (styleIndex === 2) {
      // Split web/app into a disjunction; distribute over identical other constraints.
      claim.scope.any = claim.scope.any.flatMap(term => {
        const channel = term.all.find(c => c.field === 'channel');
        return channel.values.map(value => ({ all: term.all.map(c => c.field === 'channel' ? { ...c, values: [value] } : clone(c)).reverse() }));
      }).reverse();
      claim.qualifiers.reverse();
      transformations.push({ kind: 'extensional_scope_distribution', domain_cells: 12 });
    }
    if (styleIndex === 3) {
      claim.scope.any.forEach(term => term.all.forEach(c => c.values.reverse()));
      claim.subject = `  ${claim.subject.replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0))}  `;
      transformations.push({ kind: 'whitespace_set_order' });
    }
  }
  let currentIndex = 0;
  for (const claim of candidate.current.claims) claim.citations = [clone(world.claims_support.filter(s => s.section === 'current')[currentIndex++].citation)];
  let oldIndex = 0;
  for (const record of candidate.old.records) for (const claim of record.claims) claim.citations = [clone(world.claims_support.filter(s => s.section === 'old')[oldIndex++].citation)];
  if (world.gold.acceptedGraphs.length > 1 && (styleIndex + variantIndex) % 2) candidate.reason.edges = world.gold.acceptedGraphs[1].map(e => ({ ...e, citations: [] }));
  for (const edge of candidate.reason.edges) edge.citations = clone(world.edge_support.find(e => e.from === edge.from && e.to === edge.to).alternatives[0]);
  for (const node of candidate.reason.nodes) {
    const support = world.edge_support.find(e => e.from === node.id || e.to === node.id);
    node.claim.citations = support ? clone(support.alternatives[0]) : [];
  }
  if (styleIndex === 2) { candidate.current.claims.reverse(); candidate.old.records.reverse(); candidate.reason.nodes.reverse(); candidate.reason.edges.reverse(); }
  if (styleIndex === 3 && candidate.current.claims.length) {
    candidate.current.claims.push(clone(candidate.current.claims[0]));
    transformations.push({ kind: 'equivalent_duplicate', location: 'current.claims' });
  }
  return { candidate, transformations };
}
function taipeiOffset(iso) {
  return new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 19) + '+08:00';
}

function mutateCurrent(candidate, world, selector, forced) {
  const before = clone(candidate.current);
  const current = candidate.current;
  let kind = forced ?? ['wrong_value', 'broadened_scope', 'dropped_qualification', 'shifted_boundary', 'contradictory_extra', 'status_flip'][selector % 6];
  if (!current.claims.length) {
    current.status = 'active';
    current.claims = [makeClaim(world.subject, makeValue(0, 0, world.language), scope(), interval(), [qualifier(world.language)])];
    kind = 'invent_active_decision';
  } else {
    // Remove intentional equivalent duplicates before a semantic mutation.
    if (current.claims.length > world.gold.answer.current.claims.length) current.claims.pop();
    const claim = current.claims[0];
    if (kind === 'wrong_value') claim.value = wrongValue(claim.value);
    else if (kind === 'broadened_scope') {
      // Add US, outside every authored query scope, even for distributed DNF.
      claim.scope.any.push(...scope(['US']).any);
    } else if (kind === 'dropped_qualification') claim.qualifiers = claim.qualifiers.filter(q => q.key !== 'dispatch_condition');
    else if (kind === 'shifted_boundary') claim.valid.to = '2028-03-30T16:00:00Z';
    else if (kind === 'contradictory_extra') current.claims.push({ ...clone(claim), value: wrongValue(claim.value) });
    else if (kind === 'commitment_change') {
      // Rejected immediate-execution quote is promoted to a current decision.
      claim.value = textValue(phrase(world.language, '立即執行，無須等待審核。', 'Execute immediately without waiting for review.', '立即 execute，不等 review。'));
    } else { current.status = 'no_active_decision'; current.claims = []; }
  }
  return { component: 'C', kind, path: 'current', before, after: clone(candidate.current), rationale: `Current policy differs: ${kind}. Exact value, qualifications, scope, interval and status are required (§§2,6,7).` };
}
function mutateOld(candidate, world, selector) {
  const before = clone(candidate.old);
  let kind;
  if (!candidate.old.records.length) {
    candidate.old = { status: 'available', records: [{ status: 'previously_adopted', claims: [makeClaim(world.subject, makeValue(0, 0, world.language), scope(), interval(), [])] }] };
    kind = 'invent_predecessor';
  } else if (selector % 4 === 0) {
    candidate.old.records[0].status = candidate.old.records[0].status === 'previously_adopted' ? 'erroneous' : 'previously_adopted';
    kind = 'wrong_historical_label';
  } else if (selector % 4 === 1) {
    candidate.old.records.pop();
    if (!candidate.old.records.length) candidate.old.status = 'none';
    kind = 'missing_requested_predecessor';
  } else if (selector % 4 === 2) {
    candidate.old.records[0].claims[0].value = wrongValue(candidate.old.records[0].claims[0].value);
    kind = 'wrong_predecessor_value';
  } else {
    candidate.old.records.push({ ...clone(candidate.old.records[0]), claims: [{ ...clone(candidate.old.records[0].claims[0]), subject: `${world.subject}-unrequested` }] });
    kind = 'unrequested_extra_predecessor';
  }
  return { component: 'O', kind, path: 'old', before, after: clone(candidate.old), rationale: `Requested predecessor set or history label differs: ${kind}; an erroneous record is never a formerly adopted decision (§§1,2,6,7).` };
}
function mutateReason(candidate, world, selector, forced) {
  const before = clone(candidate.reason);
  let kind = forced ?? ['reverse_edge', 'missing_required_edge', 'unsupported_submitted_edge', 'wrong_reason', 'uncited_support', 'transitive_shortcut'][selector % 6];
  if (!candidate.reason.edges.length) {
    candidate.reason = { status: 'stated', nodes: ['a', 'd'].map((id, i) => ({ id, claim: makeClaim(world.subject, textValue(causePhrases[world.language][i ? 3 : 0][0]), scope(), interval(), [], 'causal_statement') })), edges: [{ from: 'a', to: 'd', citations: [] }] };
    kind = 'invent_unstated_cause';
  } else if (kind === 'reverse_edge') {
    const edge = candidate.reason.edges[0];
    [edge.from, edge.to] = [edge.to, edge.from];
  } else if (kind === 'missing_required_edge') candidate.reason.edges.pop();
  else if (kind === 'unsupported_submitted_edge') {
    candidate.reason.edges.push({ from: 'd', to: 'a', citations: [clone(candidate.reason.edges[0].citations[0])] });
  } else if (kind === 'wrong_reason') {
    const target = candidate.reason.edges.find(e => e.from === 'a')?.from ?? candidate.reason.edges[0].from;
    candidate.reason.nodes.find(node => node.id === target).claim.value = textValue(phrase(world.language, '審核積壓已減少。', 'The review backlog shrank.', 'review backlog 已減少。'));
  } else if (kind === 'uncited_support') {
    // Required passage remains delivered, but the answer cites only a distractor.
    candidate.reason.edges[0].citations = [cite(world.delivered.at(-1).item, world.delivered.at(-1).text)];
  } else if (world.causal_class.startsWith('serial') || world.causal_class.endsWith('mediated')) {
    candidate.reason.edges = [{ from: 'a', to: 'd', citations: clone(candidate.reason.edges[0].citations) }];
  } else {
    candidate.reason.edges[0].citations = [];
    kind = 'missing_edge_citation';
  }
  return { component: 'R', kind, path: 'reason', before, after: clone(candidate.reason), rationale: `Causal explanation fails: ${kind}. Required directed edges and submitted supporting citations cannot be repaired (§§6,7).` };
}
function label(mutations = [], support = true, specialReason = '') {
  const components = Object.fromEntries(['C', 'O', 'R'].map(c => [c, !mutations.some(m => m.component === c)]));
  // Support-only R mutations preserve factual causal correspondence.
  const causalCorrect = !mutations.some(m => m.component === 'R' && !['uncited_support', 'missing_edge_citation'].includes(m.kind));
  const causalSupported = support && !mutations.some(m => m.component === 'R' && ['uncited_support', 'missing_edge_citation', 'unsupported_submitted_edge', 'invent_unstated_cause', 'reverse_edge', 'wrong_reason', 'transitive_shortcut'].includes(m.kind));
  components.R = causalCorrect && causalSupported && components.R;
  return { equivalent: components.C && components.O && components.R,
    components, causal_correct: causalCorrect, causal_supported: causalSupported,
    reason: specialReason || (mutations.length ? mutations.map(m => m.rationale).join(' ') : 'Same authored semantic atoms, exact values, required qualifications, audience cells, instants and accepted causal graph; all submitted causal edges have delivered support (§§2,6–8).') };
}
function makeRow(world, styleIndex, set, options = {}) {
  const { candidate, transformations } = represent(world, styleIndex, options.variantIndex ?? 0);
  const mutations = [];
  for (const component of options.negatives ?? []) {
    mutations.push(component === 'C' ? mutateCurrent(candidate, world, options.selector ?? 0, options.forced)
      : component === 'O' ? mutateOld(candidate, world, options.selector ?? 0)
        : mutateReason(candidate, world, options.selector ?? 0, options.forced));
  }
  return { id: '', set, world_id: world.id, lineage: world.lineage, language: world.language, style: STYLES[styleIndex],
    scenario: world.scenario, causal_class: world.causal_class, question: world.question,
    gold: clone(world.gold), candidate, delivered: clone(world.delivered), true_label: label(mutations),
    provenance: { source: 'authored_semantic_AST', protocol_sections: [2, 3, 6, 7, 8], transformations, mutations },
    group_id: world.id, role: options.role ?? 'candidate', referral: null, representation: null, evidence_variant: null };
}

export function build() {
  const worlds = [];
  const sets = Object.fromEntries(DATASETS.map(name => [name, []]));
  function world(set, n, language, options) { const w = createWorld(set, n, language, options); worlds.push(w); return w; }
  for (const language of LANGUAGES.slice(0, 2)) for (let i = 0; i < 200; i++) {
    const w = world('pooled', i, language);
    const negatives = i < 100 ? [] : i < 130 ? ['C'] : i < 160 ? ['O'] : i < 190 ? ['R'] : ['C', 'O', 'R'];
    sets[DATASETS[0]].push(makeRow(w, i % 4, 'pooled', { negatives, selector: Math.floor(i / 4), role: negatives.length ? 'explicit_negative' : 'matched_semantics' }));
  }
  for (const language of LANGUAGES) for (let i = 0; i < 80; i++) {
    // Every referral candidate has a real idiomatic paraphrase and scoped condition.
    // Terse style still uses noncanonical idioms through the style override below.
    const w = world('referral', i, language, { textOnly: true, scenario: ['reversal', 'refinement', 'scope_change', 'multiple_predecessors'][Math.floor(i / 4) % 4], causal: ['direct', 'serial_two', 'serial_three', 'conjunctive_mediated', 'alternative_mediated'][Math.floor(i / 4) % 5] });
    for (const component of [null, 'C', 'O', 'R']) {
      const row = makeRow(w, i % 4, 'referral_candidates', { negatives: component ? [component] : [], selector: Math.floor(i / 4), role: component ? 'single_component_negative' : 'shared_matched_positive' });
      // Use a second authored wording in terse rows as well; source stays canonical.
      if (i % 4 === 0) {
        for (const claim of [...row.candidate.current.claims, ...row.candidate.old.records.flatMap(r => r.claims), ...row.candidate.reason.nodes.map(n => n.claim)]) {
          if (claim.value.type !== 'Text') continue;
          const bank = [...decisionPhrases[language], ...causePhrases[language]].find(p => p[0] === claim.value.text);
          if (bank) claim.value.text = bank[1];
        }
        row.provenance.transformations.push({ kind: 'authored_atom_paraphrase', style: 'terse idiom' });
        // Refresh mutation snapshots after the representation-only operation.
        for (const mutation of row.provenance.mutations) mutation.after = clone(row.candidate[mutation.path]);
      }
      row.referral = { designated_components: component ? [component] : ['C', 'O', 'R'],
        qualification: 'pending_frozen_mechanical_pipeline',
        selection_rule: 'first qualifying candidate in frozen file order, without judgment feedback',
        rationale: 'Idiomatic scoped policy and causal paraphrases require contextual equivalence; no claim of actual pipeline referral.' };
      sets[DATASETS[1]].push(row);
    }
  }
  for (const language of LANGUAGES) for (let i = 0; i < 16; i++) {
    const w = world('evidence', i, language, { scenario: ['reversal', 'refinement', 'scope_change', 'multiple_predecessors'][i % 4], causal: ['direct', 'serial_two', 'serial_three', 'conjunctive_mediated', 'alternative_mediated'][Math.floor(i / 4) % 5] });
    const base = makeRow(w, i % 4, 'evidence_contrasts');
    const causalItems = new Set(w.edge_support.flatMap(e => e.alternatives.flat().map(c => c.item)));
    for (const variant of ['adequate', 'endpoint_only', 'negated', 'truncated', 'removed']) {
      const row = clone(base);
      row.role = 'evidence_variant';
      row.evidence_variant = variant;
      for (const unit of row.delivered) if (causalItems.has(unit.item)) {
        if (variant === 'endpoint_only') unit.text = phrase(language, `提及 ${w.gold.answer.reason.nodes.map(n => n.claim.value.text).join(' / ')}，沒有說明因果。`, `Mentions only: ${w.gold.answer.reason.nodes.map(n => n.claim.value.text).join(' / ')}. No causal relation is asserted.`, `只提及 endpoints: ${w.gold.answer.reason.nodes.map(n => n.claim.value.text).join(' / ')}，沒有 causal assertion。`);
        if (variant === 'negated') {
          // Exact quote remains findable, but is explicitly denied by its context.
          unit.text = phrase(language, `以下說法已被來源明確否定：「${unit.text}」不得當成原因。`, `The source explicitly denies the following statement: “${unit.text}” It is not a valid explanation.`, `Source 明確否定：「${unit.text}」不可作為 reason。`);
        }
        if (variant === 'truncated') unit.text = unit.text.slice(0, Math.max(1, Math.floor(unit.text.length / 3)));
      }
      if (variant === 'removed') row.delivered = row.delivered.filter(u => !causalItems.has(u.item));
      if (variant !== 'adequate') row.true_label = { equivalent: false, components: { C: true, O: true, R: false }, causal_correct: true, causal_supported: false,
        reason: `Question, answer and G_correct are unchanged. ${variant} delivery does not support the submitted required causal citations; another passage cannot substitute (§§6–8).` };
      sets[DATASETS[2]].push(row);
    }
  }
  for (const language of LANGUAGES) for (let errorIndex = 0; errorIndex < 4; errorIndex++) for (let i = 0; i < 4; i++) {
    const error = DISTORTIONS[errorIndex];
    const n = errorIndex * 4 + i;
    const w = world('representation', n, language, { textOnly: true, scenario: 'reversal', causal: CAUSAL.filter(c => c !== 'not_stated')[i % 5] });
    for (let styleIndex = 0; styleIndex < 4; styleIndex++) for (const distorted of [false, true]) {
      const component = error === 'wrong_reasons' ? 'R' : 'C';
      const forced = { wrong_reasons: 'wrong_reason', commitment_changes: 'commitment_change', broadened_scopes: 'broadened_scope', dropped_qualifications: 'dropped_qualification' }[error];
      const row = makeRow(w, styleIndex, 'representation_pairs', { negatives: distorted ? [component] : [], forced, selector: i, role: distorted ? 'distorted' : 'faithful' });
      row.representation = { distortion_class: error, variant: distorted ? 'distorted' : 'faithful', locally_supported_false_body: distorted };
      if (distorted) {
        // Extraction may assert a false fact: factual gold remains the source AST.
        const item = component === 'C' ? w.claims_support.find(s => s.section === 'current').citation.item : row.delivered.length;
        let quote;
        if (component === 'C') {
          quote = describeClaim(row.candidate.current.claims[0], language);
          row.candidate.current.claims[0].citations = [cite(item, quote)];
          const currentItems = new Set(w.claims_support.filter(s => s.section === 'current').map(s => s.citation.item));
          row.delivered = row.delivered.filter(unit => !currentItems.has(unit.item));
        } else {
          const mutation = row.provenance.mutations[0];
          const changedNode = row.candidate.reason.nodes.find(node => stable(node.claim.value) !== stable(mutation.before.nodes.find(n => n.id === node.id).claim.value));
          const edge = row.candidate.reason.edges.find(e => e.from === changedNode.id);
          const from = row.candidate.reason.nodes.find(n => n.id === edge.from).claim.value.text;
          const to = row.candidate.reason.nodes.find(n => n.id === edge.to).claim.value.text;
          quote = phrase(language, `由於「${from}」，因此「${to}」。`, `Because “${from}”, “${to}”.`, `因為「${from}」，所以「${to}」。`);
          edge.citations = [cite(item, quote)];
          // Suppress conflicting causal units for this node: locally supported false reason.
          const relevant = new Set(w.edge_support.filter(e => e.from === changedNode.id).flatMap(e => e.alternatives.flat().map(c => c.item)));
          row.delivered = row.delivered.filter(unit => !relevant.has(unit.item));
          for (const node of row.candidate.reason.nodes) {
            if (node.claim.citations.some(c => relevant.has(c.item))) node.claim.citations = [cite(item, quote)];
          }
          changedNode.claim.citations = [cite(item, quote)];
          row.true_label.causal_supported = true;
        }
        row.delivered.push({ item, unit: 'body', source: null, text: quote });
        row.true_label.reason += ' The submitted false content is locally supported by an extracted body, which cannot change factual gold (§8).';
        for (const mutation of row.provenance.mutations) mutation.after = clone(row.candidate[mutation.path]);
      }
      sets[DATASETS[3]].push(row);
    }
  }
  for (const [file, rows] of Object.entries(sets)) {
    // Hash-sort is a deterministic seeded permutation, with no label-based order.
    rows.forEach((row, ordinal) => { row._order = sha256(`${SEED}\0${file}\0${ordinal}`); });
    rows.sort((a, b) => a._order.localeCompare(b._order));
    rows.forEach((row, i) => { delete row._order; row.id = `${file.replace('.jsonl', '')}-${String(i + 1).padStart(4, '0')}`; });
  }
  worlds.sort((a, b) => a.id.localeCompare(b.id));
  return { worlds, sets };
}

export function counts(rows) {
  const countBy = get => rows.reduce((acc, row) => { const key = String(get(row)); acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
  const joint = get => countBy(get);
  return { bundles: rows.length, independent_worlds: new Set(rows.map(r => r.world_id)).size,
    language: countBy(r => r.language), style: countBy(r => r.style), equivalent: countBy(r => r.true_label.equivalent),
    component_negative: Object.fromEntries(['C', 'O', 'R'].map(c => [c, rows.filter(r => !r.true_label.components[c]).length])),
    negative_pattern: countBy(r => ['C', 'O', 'R'].filter(c => !r.true_label.components[c]).join('') || 'none'),
    language_style: joint(r => `${r.language}/${r.style}`), scenario: countBy(r => r.scenario), causal_class: countBy(r => r.causal_class),
    evidence_variant: countBy(r => r.evidence_variant ?? 'n/a'),
    distortion_variant: countBy(r => r.representation ? `${r.representation.distortion_class}/${r.representation.variant}` : 'n/a'),
    referral_component_language_style: rows.reduce((acc, row) => {
      if (row.referral) for (const c of row.referral.designated_components) {
        const key = `${c}/${row.language}/${row.style}/${row.true_label.components[c] ? 'positive' : 'negative'}`;
        acc[key] = (acc[key] ?? 0) + 1;
      }
      return acc;
    }, {}) };
}
export async function inventory(root = ROOT) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path));
      else throw new Error(`Unexpected nonregular artifact: ${path}`);
    }
  }
  await visit(root);
  return files.sort();
}
export async function generate() {
  const { worlds, sets } = build();
  for (const [file, rows] of Object.entries({ ...sets, 'worlds.jsonl': worlds })) await writeFile(join(ROOT, file), rows.map(stable).join('\n') + '\n');
  await writeFile(join(ROOT, 'answer.schema.json'), JSON.stringify(answerSchema, null, 2) + '\n');
  const files = (await inventory()).filter(file => file !== 'manifest.json');
  const artifacts = [];
  for (const path of files) { const bytes = await readFile(join(ROOT, path)); artifacts.push({ path, bytes: bytes.length, sha256: sha256(bytes) }); }
  const protocol = await readFile(new URL('../protocol/protocol-v0.3.4.md', import.meta.url));
  const manifest = { version: 1, seed: SEED, encoding: 'UTF-8, LF, stable sorted JSON keys; one object per line',
    protocol: { path: '../protocol/protocol-v0.3.4.md', sha256: sha256(protocol), sections: [1, 2, 3, 6, 7, 8, 9, 16] },
    authorship: { procedure: 'independent authored semantic atoms and explicit mutations; offline Node only', scorer_inspected: false, network_calls: 0, api_calls: 0, model_calls: 0 },
    qualification: { referral_candidates: 960, certified_genuine_referrals: null, status: 'pending_frozen_mechanical_pipeline',
      reason: 'Section 8 requires observed referrals by the frozen mechanical pipeline. Independent authorship cannot certify this without invoking that pipeline. No calibration gate is claimed passed.' },
    candidate_order: 'seeded SHA-256 permutation of deterministic pre-order; fixed before judgments',
    matched_positive_reuse: 'Each of 240 referral worlds has one positive reused across C/O/R strata. Each evidence world has five delivery variants; each representation world has eight style/faithfulness variants. Variants are not independent worlds.',
    total: counts(Object.values(sets).flat()), sets: Object.fromEntries(Object.entries(sets).map(([file, rows]) => [file, counts(rows)])),
    worlds: worlds.length, artifact_count_excluding_manifest: artifacts.length, artifacts,
    hash_policy: 'All regular artifacts except manifest.json itself; no recursive self-hash.',
    acceptance: 'Labels and quotas are authoring checks only. No judgments, scorer results, agreement, error rates or §8 pipeline acceptance gates have been observed.' };
  await writeFile(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const manifest = await generate();
  console.log(`Generated ${manifest.total.bundles} bundles / ${manifest.worlds} independent worlds; ${manifest.artifact_count_excluding_manifest + 1} artifacts including manifest. Referral qualification PENDING.`);
}

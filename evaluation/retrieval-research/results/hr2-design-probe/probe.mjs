// Dev-split design probe only: do assembly arms differ at candidate budgets? Not a result.
import fs from 'node:fs';
import { countOpenAITokens as tok } from '../../../../adapters/openai/index.mjs';
const S = process.argv[2], SPLIT = process.argv[3] || 'dev';
const F = new URL('../../fixtures/', import.meta.url).pathname;
const corpus = JSON.parse(fs.readFileSync(F + 'hr1-corpus.json', 'utf8'));
const labels = JSON.parse(fs.readFileSync(F + 'hr1-labels.json', 'utf8'));
const byId = new Map(corpus.memories.map(m => [m.id, m]));
const lab = new Map(labels.queries.map(q => [q.id, q]));
const T = new Map(); const t = s => { if (!T.has(s)) T.set(s, tok(s)); return T.get(s); };
const files = { A1: 'lexical-S1000/A1.json', 'A3--bge-m3': 'local-S1000/A3--bge-m3.json', 'F-RRF10--openai-3-small': 'hosted-S1000/F-RRF10--openai-3-small.json' };
const BUDGETS = [128, 192, 256, 384, 512, 768, 1024, 1536];
// units: {mem, part:'body'|'span', spanId, tokens}
const units = (m) => [{ mem: m.id, part: 'body', tokens: t(m.content) }, ...m.spans.map(s => ({ mem: m.id, part: 'span', spanId: s.id, tokens: t(s.text) }))];
function packTail(order, budget, s1) {
  // depth first: whole items in rank order until the first item that does not fit; then bodies of the remaining items (breadth tail)
  let used = 0; const have = new Set(); let i = 0;
  for (; i < order.length; i++) {
    const us = units(byId.get(order[i])).filter(u => !s1 || u.part === 'body' || u.spanId.endsWith('#s1'));
    const need = us.reduce((a, u) => a + u.tokens, 0);
    if (used + need > budget) break;
    used += need; for (const u of us) have.add(u.part === 'body' ? u.mem + '#body' : u.spanId);
  }
  for (; i < order.length; i++) { const b = units(byId.get(order[i]))[0]; if (used + b.tokens <= budget) { used += b.tokens; have.add(b.mem + '#body'); } }
  return { have, used };
}
function pack(order, budget, passes) {
  if (passes === 'tail') return packTail(order, budget, false);
  if (passes === 'tail-s1') return packTail(order, budget, true);
  // passes: array of predicates over units; each pass adds units in rank order while they fit; skip-and-continue
  let used = 0; const have = new Set();
  for (const pass of passes) for (const id of order) for (const u of units(byId.get(id))) {
    if (!pass(u)) continue; const key = u.part === 'body' ? id + '#body' : u.spanId;
    if (have.has(key)) continue;
    if (u.part === 'span' && !have.has(id + '#body')) continue; // sources are scheduled only after their body was admitted
    if (used + u.tokens <= budget) { used += u.tokens; have.add(key); }
  }
  return { have, used };
}
const ARMS = {
  'P-top': [u => true],
  'P-top-s1': [u => u.part === 'body' || u.spanId.endsWith('#s1')],
  'P-cover': [u => u.part === 'body', u => u.part === 'span'],
  'P-cover-s1': [u => u.part === 'body', u => u.spanId?.endsWith('#s1')],
  'P-top+tail': 'tail',
  'P-top-s1+tail': 'tail-s1',
};
function covered(q, have) {
  return q.groups.map(g => g.members.some(m => m.where === 'body' ? have.has(m.memory + '#body') : m.spans.some(s => have.has(s))));
}
const cats = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
for (const [armName, file] of Object.entries(files)) {
  const r = JSON.parse(fs.readFileSync(`${S}/${file}`, 'utf8'));
  const qs = Object.entries(r.queries).map(([id, q]) => [lab.get(id), q]).filter(([l]) => l && l.split === SPLIT && cats.includes(l.category));
  console.log(`\n== ranking ${armName} (${SPLIT}, n=${qs.length})  macro group-coverage; cells: coverage / used-tokens-p50`);
  console.log(('budget'.padEnd(8) + Object.keys(ARMS).map(a => a.padEnd(16)).join('')).trimEnd());
  for (const B of BUDGETS) {
    let line = String(B).padEnd(8);
    for (const [a, passes] of Object.entries(ARMS)) {
      const per = {}; const used = [];
      for (const [l, q] of qs) { const p = pack(q.ranked, B, passes); used.push(p.used); const c = covered(l, p.have); (per[l.category] ||= []).push(c.filter(Boolean).length / c.length); }
      const macro = cats.reduce((s, c) => s + (per[c].reduce((x, y) => x + y, 0) / per[c].length), 0) / cats.length;
      used.sort((x, y) => x - y);
      line += `${macro.toFixed(3)} /${String(used[Math.floor(used.length / 2)]).padStart(5)}  `;
    }
    console.log(line.trimEnd());
  }
  // upper bound: everything
  const per = {}; for (const [l, q] of qs) { const p = pack(q.ranked, 1e9, [u => true]); const c = covered(l, p.have); (per[l.category] ||= []).push(c.filter(Boolean).length / c.length); }
  console.log('∞'.padEnd(8) + (cats.reduce((s, c) => s + (per[c].reduce((x, y) => x + y, 0) / per[c].length), 0) / cats.length).toFixed(3), '(all candidates, = recall over groups within the ranking)');
}

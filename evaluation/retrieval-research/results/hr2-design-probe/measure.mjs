import fs from 'node:fs';
import { countOpenAITokens as tok } from '../../../../adapters/openai/index.mjs';
const S = process.argv[2];
const F = new URL('../../fixtures/', import.meta.url).pathname;
const corpus = JSON.parse(fs.readFileSync(F + 'hr1-corpus.json', 'utf8'));
const labels = JSON.parse(fs.readFileSync(F + 'hr1-labels.json', 'utf8'));
const byId = new Map(corpus.memories.map(m => [m.id, m]));
const lab = new Map(labels.queries.map(q => [q.id, q]));
const files = { A1: 'base-S1000/A1.json', 'A3--bge-m3': 'local-S1000/A3--bge-m3.json', 'F-RRF10--openai-3-small': 'hosted-S1000/F-RRF10--openai-3-small.json' };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const bodyTok = new Map(), fullTok = new Map();
for (const m of corpus.memories) {
  bodyTok.set(m.id, tok(m.content));
  fullTok.set(m.id, tok(m.content) + m.spans.reduce((a, s) => a + tok(s.text), 0));
}
const bt = [...bodyTok.values()], ft = [...fullTok.values()];
console.log('per-memory tokens body p50/p90/max', pct(bt, .5), pct(bt, .9), Math.max(...bt), ' body+spans p50/p90/max', pct(ft, .5), pct(ft, .9), Math.max(...ft));
console.log('per-memory chars body p50/p90/max', pct(corpus.memories.map(m => m.content.length), .5), pct(corpus.memories.map(m => m.content.length), .9), Math.max(...corpus.memories.map(m => m.content.length)));
for (const [arm, file] of Object.entries(files)) {
  const r = JSON.parse(fs.readFileSync(`${S}/with-foreign/${file}`, 'utf8'));
  const rows = Object.entries(r.queries).filter(([id]) => { const l = lab.get(id); return l && /^C[1-7]$/.test(l.category); });
  for (const depth of [12, 24]) {
    const b = rows.map(([, q]) => q.ranked.slice(0, depth).reduce((a, id) => a + bodyTok.get(id), 0));
    const f = rows.map(([, q]) => q.ranked.slice(0, depth).reduce((a, id) => a + fullTok.get(id), 0));
    console.log(arm, `top${depth}`, 'n', rows.length, '| body tokens p50/p90/max', pct(b, .5), pct(b, .9), Math.max(...b), '| body+spans p50/p90/max', pct(f, .5), pct(f, .9), Math.max(...f), '| >1500', f.filter(x => x > 1500).length, '>2000', f.filter(x => x > 2000).length, '>4000', f.filter(x => x > 4000).length);
  }
  const lens = rows.map(([, q]) => q.ranked.length);
  console.log('  ranked length p10/p50/min', pct(lens, .1), pct(lens, .5), Math.min(...lens));
}
// required fidelity split on test C1-C7
let bodyG = 0, spanG = 0;
for (const q of labels.queries) if (q.split === 'test' && /^C[1-7]$/.test(q.category)) for (const g of q.groups) (g.fidelity === 'span-only' ? spanG++ : bodyG++);
console.log('test C1-7 groups body-covered', bodyG, 'span-only', spanG);

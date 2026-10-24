import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { cliMain, requiredOption } from '../lib/fixture.mjs';
import { countTokens, COUNTER_ID } from './counter.mjs';
import { serializeRepresentationV2, SERIALIZER_COMMIT } from './representation-v2.mjs';
import { authenticateHostV2 } from './host-v2.mjs';
import { hostV2Cost } from './cost.mjs';
import { validateOutputPath, writeOutputJson } from './output-paths.mjs';
import { fail } from './auth.mjs';

export function probeText(tokens, word = 'maple', suffix = '') {
  if (!Number.isSafeInteger(tokens) || tokens < 1) fail('invalid_probe_tokens');
  const text = ` ${word}`.repeat(tokens - Number(Boolean(suffix))) + (suffix ? `${suffix}` : '');
  if (countTokens(text) !== tokens) fail('probe_token_count');
  return text;
}
export function calibration({ bodies = [120, 220, 400], receipts = [40, 120, 200], counts = [1, 2, 3, 4, 5, 6], itemCounts = [1, 2] } = {}) {
  for (const values of [bodies, receipts, counts, itemCounts]) if (!Array.isArray(values) || !values.length || values.some(n => !Number.isSafeInteger(n) || n < 1)) fail('invalid_probe_grid');
  if (counts.some(n => n > 6) || itemCounts.some(n => n > 24)) fail('invalid_probe_grid');
  const model = authenticateHostV2(), cost = hostV2Cost(model), probes = [];
  for (const bodyTokens of bodies) for (const receiptTokens of receipts) for (const receiptCount of counts) for (const itemCount of itemCounts) {
    const prepared = Array.from({ length: itemCount }, (_, i) => ({ ns: 0, type: 'memory',
      ref: { memoryId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, revision: 1 },
      fence: 'AbCdEfGh', rank: i + 1, text: probeText(bodyTokens), sourceAccess: 'available', sourcesComplete: true,
      metadata: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 },
      sources: Array.from({ length: receiptCount }, (_, j) => ({ index: j, role: 'user', excerpt: probeText(receiptTokens, 'cedar', String(i * 6 + j)) })) }));
    for (const item of prepared) for (const source of item.sources) {
      // Unique integer suffixes (0–143) are one o200k token.
      if (countTokens(source.excerpt) !== receiptTokens) fail('probe_token_count');
    }
    for (const complete of [true, false]) for (let delivered = 0; delivered <= receiptCount; delivered++) {
      prepared.forEach(item => { item.sourcesComplete = complete; });
      const selection = new Map(prepared.map(item => [item, item.sources.slice(0, delivered)]));
      const serialized = serializeRepresentationV2(prepared, selection), measured = countTokens(serialized);
      let modelled = cost.initial;
      for (const [i, item] of prepared.entries()) {
        const body = { text: item.text, tokens: bodyTokens }, value = { body };
        modelled += cost.unit(body, value, true, i);
        for (const source of selection.get(item)) modelled += cost.unit({ text: source.excerpt, tokens: receiptTokens }, value, false, i + 1);
      }
      probes.push({ bodyTokens, receiptTokens, receiptCount, itemCount, sourcesComplete: complete, delivered,
        serialized, modelled, measured, error: modelled - measured });
    }
  }
  return { format: 'hr2b-host-v2-calibration-v1', serializerCommit: SERIALIZER_COMMIT, counter: COUNTER_ID, model,
    errorDefinition: 'modelled-minus-measured', probes,
    errors: { minimum: Math.min(...probes.map(probe => probe.error)), maximum: Math.max(...probes.map(probe => probe.error)) } };
}
await cliMain(import.meta.url, async options => {
  if (Object.keys(options).some(key => !['_', 'out', 'bodies', 'receipts', 'counts', 'items'].includes(key)) || options._.length) fail('unknown_calibration_option');
  const out = validateOutputPath(requiredOption(options, 'out'));
  const grid = {};
  for (const [option, key] of [['bodies', 'bodies'], ['receipts', 'receipts'], ['counts', 'counts'], ['items', 'itemCounts']])
    if (options[option]) grid[key] = options[option].split(',').map(Number);
  const result = calibration(grid);
  await mkdir(dirname(out), { recursive: true });
  await writeOutputJson(out, result);
  console.log(JSON.stringify({ ok: true, probes: result.probes.length, errors: result.errors }));
});

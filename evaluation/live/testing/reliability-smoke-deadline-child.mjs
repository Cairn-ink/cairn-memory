// Test-only process: advance the real core timer without changing the parent's clock.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { mock } from 'node:test';

const [planPath, mode = 'normal'] = process.argv.slice(2);
assert.ok(planPath && ['normal', 'without-core-provenance'].includes(mode));
assert.equal(process.env.OPENAI_API_KEY, undefined);

let mutated = false;
if (mode === 'without-core-provenance') registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (!url.endsWith('/core/model-call.mjs')) return loaded;
  const source = String(loaded.source);
  const original = 'coreDeadlineSignals.add(controller.signal);\n          controller.abort();\n          reject(new MemoryStoreError(\'model_timeout\'));';
  assert.equal(source.split(original).length, 2, 'one real core timer provenance registration');
  mutated = true;
  return { ...loaded, source: source.replace(original,
    'controller.abort();\n          reject(new MemoryStoreError(\'model_timeout\'));') };
} });

const stream = () => { const chunks = []; return { write(value) { chunks.push(String(value)); return true; },
  text() { return chunks.join(''); } }; };
const calls = [];
let clockAdvanced = false;
const fakeHttp = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url: String(url), body });
  if (calls.length === 1) return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('synthetic timeout', 'AbortError'));
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });
    queueMicrotask(() => { mock.timers.tick(30_000); clockAdvanced = true; });
  });
  if (url.endsWith('/responses/input_tokens')) {
    return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  }
  if (url.endsWith('/responses')) {
    const method = body.text.format.name.replace(/^cairn_/u, '');
    const output = method === 'extract' || method === 'classify' ? { items: [] } : { refs: [] };
    return Response.json({ id: 'synthetic', object: 'response', model: body.model,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'synthetic-message', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  }
  if (url.endsWith('/chat/completions')) {
    return Response.json({ id: 'synthetic-chat', object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant',
        content: body.model === 'gpt-4o-2024-08-06' ? 'yes' : 'amber' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 1, total_tokens: 51 } });
  }
  throw new Error('unexpected fake route');
};

try {
  mock.timers.enable({ apis: ['setTimeout'] });
  const [{ main }, { reopenExperimentBudget }] = await Promise.all([
    import('../reliability-smoke-cli.mjs'), import('../../experiment-budget/index.mjs'),
  ]);
  assert.equal(mutated, mode === 'without-core-provenance');
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const stdout = stream(); const stderr = stream();
  const code = await main(['--plan', planPath, '--launch'], { stdout, stderr, fetchImpl: fakeHttp,
    inspectRuntime: (commit) => assert.equal(commit, 'a'.repeat(40)) });
  assert.equal(code, 0, stderr.text());
  const report = JSON.parse(await readFile(path.join(plan.outputDirectory, 'report.json'), 'utf8'));
  const timeoutCases = report.cases.filter(item => item.generation.status === 'failed'
    && item.generation.reason === 'case_timeout');
  const generation = timeoutCases.length === 1 ? JSON.parse(await readFile(path.join(
    plan.outputDirectory, 'cases', timeoutCases[0].questionId, 'generation.json'), 'utf8')) : null;
  const ledgerConfig = JSON.parse(await readFile(plan.ledger.path, 'utf8'));
  const handle = reopenExperimentBudget(ledgerConfig);
  let ledger;
  try { ledger = handle.getState(); } finally { handle.close(); }
  const continued = report.cases.slice(1).every(item => item.generation.status === 'completed');
  const conserved = ledger.requestCount === calls.length && calls.length > 1
    && calls.length <= plan.projection.requests && ledger.requestCount <= ledgerConfig.requestCap
    && ledger.reservedMicroUsd <= plan.projection.reservedMicroUsd
    && ledger.reservedMicroUsd <= ledgerConfig.limitMicroUsd
    && ledger.attempts.every(attempt => attempt.outcome !== null);
  const actual = { mode, clockAdvanced, fixedN: report.summary.fixedN,
    generationTimeouts: report.summary.generationTimeouts, generated: report.summary.generated,
    halted: report.summary.halted, termination: generation?.termination ?? null,
    continued, conserved, requests: calls.length };
  const invariant = clockAdvanced && actual.fixedN === 6 && actual.generationTimeouts === 1
    && actual.generated === 5 && actual.halted === false && actual.termination === 'core_deadline'
    && continued && conserved;
  process.stdout.write(`${JSON.stringify({ ...actual, invariant })}\n`);
  if (!invariant) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`CLOCK_CHILD_ERROR:${error?.code ?? error?.name ?? 'unknown'}\n`);
  process.exitCode = 3;
} finally {
  mock.timers.reset();
}

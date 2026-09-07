/** Scripted test double. Byte counting is NOT a provider tokenizer. */
export function createMockRecallModel({ select = [], rank = [], countTokens,
  contextWindow = 8192 } = {}) {
  const queues = { select: [...select], rank: [...rank] };
  const calls = [];
  const run = (method) => async (request) => {
    calls.push({ method, ...request });
    if (!queues[method].length) throw new Error('Unscripted mock call');
    const step = queues[method].shift();
    return typeof step === 'function' ? step(request) : step;
  };
  return { calls, contextWindow,
    countTokens: countTokens ?? ((text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4)),
    select: run('select'), rank: run('rank') };
}

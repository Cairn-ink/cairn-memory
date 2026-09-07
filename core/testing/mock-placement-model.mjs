// Scripted test double only. Its byte-based counts are NOT a production tokenizer.
export function createMockPlacementModel(steps = [], options = {}) {
  const calls = [];
  let index = 0;
  return {
    contextWindow: options.contextWindow ?? 8192,
    countTokens: options.countTokens ?? ((text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4)),
    calls,
    async classify(request) {
      calls.push(request);
      if (index >= steps.length) throw new Error('unscripted model call');
      const step = steps[index++];
      return typeof step === 'function' ? await step(request) : structuredClone(step);
    },
  };
}

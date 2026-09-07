/** Deterministic test adapter. Never enabled implicitly by the runtime. */
export function createMockModel(steps) {
  const calls = [];
  let cursor = 0;
  return {
    calls,
    async generate(request) {
      calls.push(request);
      if (cursor >= steps.length) throw new Error("mock_exhausted");
      const step = steps[cursor++];
      if (step instanceof Error) throw step;
      const result = typeof step === "function" ? await step(request) : step;
      return structuredClone(result);
    },
  };
}

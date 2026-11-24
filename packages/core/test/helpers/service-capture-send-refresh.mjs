import assert from "node:assert/strict";
import { admission, selection } from "./service-capture-trace.mjs";
import { hostedScope, serviceFake } from "./service-fake.mjs";

export function captureSendFake(options) {
  const fake = serviceFake({ writes: true, capture: true, rawArchive: true, ...options });
  const { deps: { model }, storage: { uow }, calls, hooks } = fake;
  const run = uow.run;
  let active = 0;
  uow.run = async (...args) => {
    active++;
    try { return await run(...args); }
    finally { active--; }
  };
  model.call = async (stage, request, portOptions) => {
    assert.equal(active, 0, "model call outside the UoW");
    assert.equal(calls.findLast(([method]) => method === "gate")?.[2], "dispatch");
    calls.push(["model.call", stage, request]);
    return hooks.model(stage, request, portOptions);
  };
  return fake;
}

export const providerCalls = calls => calls.filter(([method]) =>
  ["model.countTokens", "model.call", "model.options", "embed"].includes(method));

export async function captureSendTrace(createMemoryService) {
  const { deps, calls, mutations, hooks } = captureSendFake();
  const diagnostics = [];
  deps.diagnostics = event => diagnostics.push(event);
  hooks.monotonicMs = () => 0;
  const [{ content }] = admission.messages;
  hooks.model = (_stage, _request, { signal, onDiagnostic }) => {
    calls.push(["model.options", signal.aborted, typeof onDiagnostic]);
    return { items: [{ content, kind: "preference", confidence: 0.9, sourceIndices: [0] }] };
  };
  const countTokens = deps.model.countTokens;
  deps.model.countTokens = text => {
    const count = countTokens(text);
    calls.push(["model.countTokens", text, count]);
    return count;
  };

  const service = createMemoryService(deps);
  const admitted = await service.enqueueCapture(hostedScope, admission);
  assert.deepEqual(admitted, { status: "accepted" });
  const result = await service.runCapture(hostedScope, selection);
  assert.equal(result.status, "done");
  assert.equal(result.result.memories.length, 1);
  return { admitted, result, calls, mutations, diagnostics };
}

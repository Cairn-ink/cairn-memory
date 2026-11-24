import assert from "node:assert/strict";
import { hostedScope, serviceFake } from "./service-fake.mjs";

export const selection = { client: "client", sessionId: "session", eventId: "event" };
const content = "I prefer black tea.";
export const admission = { ...selection, messages: [
  { id: "message", role: "user", content, occurredAtMs: 42 },
] };

export async function captureTrace(createMemoryService) {
  const { deps, calls, mutations, hooks } = serviceFake({ writes: true, capture: true, rawArchive: true });
  const diagnostics = [];
  deps.diagnostics = event => diagnostics.push(event);
  hooks.monotonicMs = () => 0;
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

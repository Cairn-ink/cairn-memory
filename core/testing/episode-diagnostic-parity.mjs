import { pathToFileURL } from 'node:url';

// Maintainer generator supplies a pinned base; tests supply the current checkout.
export async function captureDiagnosticParity(root) {
  const { openMemoryCore } = await import(pathToFileURL(root + '/core/index.mjs'));
  const { rationaleModel } = await import(pathToFileURL(root + '/core/testing/rationale-model.mjs'));
  const cases = [];
  for (const missing of ['commitment', 'itemIndex']) {
    const diagnostics = [], model = rationaleModel(), qualify = model.qualifyCandidates;
    model.onDiagnostic = diagnostic => diagnostics.push(diagnostic);
    model.qualifyCandidates = request => {
      const output = qualify(request); delete output.qualifications[0][missing]; return output;
    };
    const core = openMemoryCore({ path: ':memory:', model, captureQualification: 'source-bound-v2' });
    try {
      const result = await core.capture({ namespace: { ownerId: 'parity', scope: 'personal', projectId: null },
        client: 'scripted', sessionId: 'session', eventId: 'event',
        messages: [{ id: 'message', role: 'user', content: 'Synthetic source.' }] });
      cases.push({ missing, result, diagnostics });
    } finally { core.close(); }
  }
  return cases;
}

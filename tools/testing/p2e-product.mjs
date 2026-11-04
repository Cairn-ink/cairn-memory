import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readSet } from '../../evaluation/context-read-p2e/fixtures.mjs';

export async function probeProduct() {
  const api = await import('../../core/index.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'p2e-capability-'));
  const path = join(directory, 'canonical.sqlite'), supervisor = api.createContextReadSupervisor();
  let reader;
  try {
    const core = api.openMemoryCore({ path }); core.close();
    const token = { opaque: randomUUID() };
    const requestControl = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: null, requestMaxMs: 5000 };
    const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'p2e-synthetic-probe', requestedNamespaces: 4, selectedNamespaces: 4, omittedNamespaces: 0 };
    const requestBinding = { kind: 'request', ...Object.fromEntries(Object.entries(requestControl).filter(([k]) => k !== 'requestMaxMs')),
      credentialDigest: createHash('sha256').update(JSON.stringify(token)).digest('base64url'), ownerId: readSet[0].ownerId, namespaces: { readSet, ownerCoverage }, issuedAt: 0 };
    reader = await api.openContextProductReader({ path, supervisor, version: 'context-read-v1', profile: 'context-read-product-v1.1', readSet, ownerCoverage,
      requestControl, host: { moduleUrl: new URL('./p2e-probe-host.mjs', import.meta.url).href, configuration: { requestBinding, requestReservation: new SharedArrayBuffer(4) } } });
    const response = await reader.getContextReadCapabilities();
    if (!response.ok) throw Error('public_capability_probe_failed');
    const capabilities = response.value;
    // Omission of semanticConfig must preserve the old capabilities, even
    // after P2e lands. The selected handle is probed again by the runner.
    const available = typeof api.openContextSemanticCoordinator === 'function';
    return { status: available ? 'available' : 'blocked_dependency', capabilities,
      reason: available ? null : 'public_product_semantic_api_unavailable' };
  } finally {
    try { await reader?.close(); } finally { await supervisor.close(); rmSync(directory, { recursive: true, force: true }); }
  }
}

// Host binding supplies only setup/maintenance/options and offline inventory;
// the runner itself calls these public methods. There is no alternate scorer,
// fake ranking callback, direct sidecar query, or legacy reader fallback.
export async function withProductReader(options, credential, operation) {
  const { openContextProductReader } = await import('../../core/index.mjs');
  const reader = await openContextProductReader(options);
  try { return await operation(reader, credential); }
  finally { await reader.close(); }
}

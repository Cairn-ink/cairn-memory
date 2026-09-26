import { MemoryStoreError, fail } from './validation.mjs';

const unwrap = result => { if (!result.ok) fail(result.error.code); return result.value; };

/** Best-effort post-admission work. A failed pass must never disguise saved memory. */
export async function reviewCapturedRationale({ snapshot, admission, classification, sourceMessages,
  operations, deadline }) {
  if (!admission.memories.length) return { status: 'skipped', reason: 'empty' };
  try {
    deadline?.check();
    const guards = classification.status === 'applied'
      ? classification.memoryRevisions : admission.memories.map(({ id, revision }) => ({ memoryId: id, revision }));
    const refs = admission.memories.map(({ id, revision }) => {
      const expected = guards.find(ref => ref.memoryId === id)?.revision ?? revision;
      const { memory } = unwrap(operations.get({ namespace: snapshot.namespace, memoryId: id }));
      if (memory.revision !== expected || memory.state !== 'active') fail('revision_conflict');
      return { memoryId: id, revision: expected };
    });
    const fullQuery = sourceMessages.map(message => message.content).join('\n');
    let query = fullQuery.slice(0, 4000);
    if (!query.isWellFormed()) query = query.slice(0, -1);
    const discovered = unwrap(operations.discoverRationale({ namespace: snapshot.namespace, refs, query }));
    deadline?.check();
    const reviewed = unwrap(await operations.reviewRationale({ namespace: snapshot.namespace, refs: discovered.refs }));
    return { status: 'reviewed', ...reviewed,
      discovery: { candidateCount: discovered.refs.length, scanExhausted: discovered.scanExhausted,
        candidatesTruncated: discovered.candidatesTruncated, queryTruncated: query.length !== fullQuery.length,
        semanticCoverage: 'unassessed' } };
  } catch (error) {
    const code = error instanceof MemoryStoreError ? error.code : 'rationale_failed';
    return { status: 'failed', error: { code, retryable: code === 'storage_busy' } };
  }
}

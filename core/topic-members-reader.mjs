import { createTopicPreviewReader } from './topic-member-previews-reader.mjs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { MEMBER_STATE_BYTES } from './topic-members-storage.mjs';
import { fail } from './validation.mjs';

const success = value => ({ ok: true, value });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Worker-owned traversal. Dependencies are explicit for deterministic boundary tests. */
export function createTopicMemberReader({ storage, snapshot, transaction, tokens, originBinding,
  previewStorage,
  now = () => performance.now(), yieldQuantum = yieldTurn, observe = () => {}, prepare = () => {}, accept = () => {} }) {
  let traversal;
  let previewReader, mode = false;
  async function read(request, deadlineAt = now() + request.deadlineMs) {
    const wantsPreviews = Boolean(request.previews);
    if (request.cursor && mode !== wantsPreviews) tokens.verifyCursor(request.cursor, undefined, wantsPreviews ? 'tp1' : 'tm1');
    if (mode !== wantsPreviews) { traversal = previewReader = undefined; mode = wantsPreviews; }
    if (wantsPreviews) {
      previewReader ??= createTopicPreviewReader({ storage, previewStorage, snapshot, transaction, tokens, originBinding,
        now, yieldQuantum, observe, prepare, accept });
      return previewReader.read(request, deadlineAt);
    }
    const { cursor, ...bound } = request, binding = JSON.stringify(bound);
    if (cursor) {
      tokens.verifyCursor(cursor);
      if (!traversal) fail('cursor_stale');
      if (traversal.binding !== binding) fail('cursor_stale');
      tokens.verifyCursor(cursor, traversal.cursorBinding);
      if (cursor !== traversal.lastInput && cursor !== traversal.nextCursor) fail('cursor_stale');
    }
    const prior = traversal;
    let state = cursor ? { ...prior, data: structuredClone(prior.data) } : undefined;
    let used = cursor ? 2 : 0, quantum = 0, advanced = false;
    const charge = units => { used += units; quantum += units; observe({ used, units }); };
    // Fence metadata/point visits fit three bounded validation units, plus
    // one token step. Reserve all four final units, also at workLimit=16.
    function fence() {
      charge(4);
      try {
        const captured = snapshot(request.namespace);
        if (!Number.isSafeInteger(captured.indexRevision) || captured.indexRevision < 1 ||
            (captured.generation !== null && (typeof captured.generation !== 'string' || !captured.generation ||
              !captured.generation.isWellFormed() || captured.generation.length > 200))) fail('unsupported_database');
        if (state && !equal(captured, state.captured)) fail('cursor_stale');
        const binding = originBinding(request.namespace, captured);
        const expected = state?.publicSnapshot ?? request.expectedSnapshot;
        if (expected) {
          if (expected.indexRevision !== captured.indexRevision || expected.generation !== captured.generation) fail('cursor_stale');
          tokens.verifyOrigin(expected.originToken, binding);
        }
        // An unusable origin is uniformly stale, before fresh target outcomes.
        storage.target(request, captured);
        return { captured, binding };
      } catch (error) {
        if ((state || request.expectedSnapshot) && ['index_unavailable', 'unsafe_database_file', 'database_not_found'].includes(error.code)) fail('cursor_stale');
        if (state && ['moc_not_found', 'revision_conflict', 'invalid_ref'].includes(error.code)) fail('cursor_stale');
        throw error;
      }
    }
    const inTime = () => { if (now() >= deadlineAt) fail('read_timeout'); };
    try {
      inTime();
      prepare({ charge, request, deadlineAt });
      inTime();
      const cost = () => storage.cost?.(state.data) ?? 1;
      const advance = () => { charge(cost()); storage.step(state.data, request, state.captured); advanced = true; };
      const replay = cursor && cursor === state.lastInput;
      transaction(() => {
        quantum = 0;
        const started = now(), initial = fence();
        if (replay) return;
        if (!state) {
          charge(1);
          const publicSnapshot = request.expectedSnapshot ?? { indexRevision: initial.captured.indexRevision,
            generation: initial.captured.generation, originToken: tokens.issueOrigin(initial.binding) };
          state = { binding, captured: initial.captured, publicSnapshot, data: storage.create(),
            cursorBinding: { binding, captured: initial.captured, originToken: publicSnapshot.originToken,
              traversal: randomBytes(16).toString('base64url') } };
        }
        // Use the already charged initial fence for the first quantum. This
        // leaves room for a whole bounded metadata batch even at workLimit=16.
        // Reserve envelope construction as well as the final four-unit fence.
        while (state.data.initialization && !state.data.initialization.done && used + cost() <= request.workLimit - 5 &&
            quantum + cost() <= 64 && now() - started < 5 && now() < deadlineAt - 5) advance();
      });
      if (replay) { inTime(); return state.lastOutput; }
      if (Buffer.byteLength(JSON.stringify(state)) > MEMBER_STATE_BYTES) fail('state_limit');
      charge(1);
      const namespace = { ...request.namespace, projectId: request.namespace.scope === 'personal' ? null : request.namespace.projectId };
      const value = { version: 'topic-members-v1', status: 'partial', namespace, selection: request.selection,
        snapshot: { ...state.publicSnapshot, accessRevision: request.accessRevision, configuration: 'topic-members-v1' },
        kind: request.kind, order: request.order, items: [], coverage: { complete: false, reason: 'work_limit' },
        nextCursor: tokens.issueCursor(state.cursorBinding) };
      const fits = () => Buffer.byteLength(JSON.stringify(success(value))) <= request.maxBytes;
      let reason;
      const present = row => ({ type: 'memory', namespace, id: row.id, revision: row.revision, kind: row.kind,
        label: { text: row.id, source: 'identifier' }, reportedUnder: row.reportedUnder });
      while (!reason) {
        if (state.data.held) {
          if (state.data.pending) {
            if (!state.data.heldLimit) fail('context_item_too_large');
            value.items.push(present(state.data.held)); state.data.held = null; reason = 'limit'; break;
          }
          if (state.data.done) {
            value.items.push(present(state.data.held)); state.data.held = null; reason = null; break;
          }
        }
        if (state.data.pending) {
          if (value.items.length === request.limit) { reason = 'limit'; break; }
          const row = present(state.data.pending);
          value.items.push(row);
          if (!fits()) {
            value.items.pop();
            if (value.items.length) { reason = 'byte_limit'; break; }
            // A final ref may fit only after the cursor is removed. Prove EOF
            // with bounded lookahead before refusing that representable envelope.
            const continuation = value.nextCursor, coverage = value.coverage;
            value.items.push(row); value.status = 'page';
            value.coverage = { complete: false, reason: 'limit' };
            const limitFits = request.limit === 1 && fits();
            value.nextCursor = null; value.coverage = { complete: true, reason: null };
            const finalFits = fits();
            value.items.pop(); value.nextCursor = continuation; value.status = 'partial'; value.coverage = coverage;
            if (!finalFits) fail('context_item_too_large');
            state.data.held = state.data.pending; state.data.heldLimit = limitFits;
          }
          state.data.pending = null; advanced = true;
        }
        if (state.data.done) { reason = null; break; }
        if (used + 4 + cost() > request.workLimit - 4) { reason = 'work_limit'; break; }
        if (now() >= deadlineAt - 5) { reason = 'deadline'; break; }
        const started = now();
        transaction(() => {
          quantum = 0;
          fence();
          while (used + cost() <= request.workLimit - 4 && quantum + cost() <= 64 && now() - started < 5 && now() < deadlineAt - 5) {
            advance();
            if (state.data.pending || state.data.done) break;
          }
        });
        // Logical retention accounting and presentation stay outside SQLite snapshots.
        if (Buffer.byteLength(JSON.stringify(state)) > MEMBER_STATE_BYTES) fail('state_limit');
        await yieldQuantum();
      }
      if (reason === 'deadline' && !advanced) fail('read_timeout');
      value.coverage = { complete: reason === null, reason };
      value.status = reason === null || reason === 'limit' ? 'page' : 'partial';
      if (reason === null) value.nextCursor = null;
      if (!fits()) fail('context_item_too_large');
      transaction(fence);
      inTime();
      state.lastInput = cursor; state.lastOutput = success(value); state.nextCursor = value.nextCursor;
      traversal = state; accept(state.data);
      return state.lastOutput;
    } catch (error) {
      if (error.code === 'ERR_OUT_OF_RANGE') fail('unsupported_database');
      if (error.code === 'state_limit') {
        inTime(); transaction(fence); inTime();
        traversal = undefined;
        return success({ version: 'topic-members-v1', status: 'partial',
          namespace: { ...request.namespace, projectId: request.namespace.scope === 'personal' ? null : request.namespace.projectId },
          selection: request.selection, snapshot: { ...state.publicSnapshot, accessRevision: request.accessRevision, configuration: 'topic-members-v1' },
          kind: request.kind, order: request.order, items: [], coverage: { complete: false, reason: 'state_limit' }, nextCursor: null });
      }
      // Provisional state is never published on busy/oversize/invalid input.
      // Retrying the acknowledged input resumes its original checkpoint.
      if (['cursor_stale', 'read_timeout', 'reader_failed'].includes(error.code)) traversal = undefined;
      throw error;
    }
  }
  return { read };
}

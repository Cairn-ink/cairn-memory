import { channel } from 'node:diagnostics_channel';
import { randomBytes } from 'node:crypto';
import { MEMBER_STATE_BYTES } from './topic-members-storage.mjs';
import { PREVIEW_VERSION, previewCapability, previewCounters, transformPreview } from './topic-member-previews-text.mjs';
import { fail } from './validation.mjs';

const success = value => ({ ok: true, value });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** P1 keeps only metadata and a text-free response recipe between calls. */
export function createTopicPreviewReader({ storage, previewStorage, snapshot, transaction, tokens, originBinding,
  now, yieldQuantum, observe, prepare, accept, capability = previewCapability, inspect = () => {} }) {
  let traversal, support;
  async function read(request, deadlineAt = now() + request.deadlineMs) {
    const { cursor, ...bound } = request;
    let used = cursor ? 2 : 0, quantum = 0, advanced = false, state;
    const counters = previewCounters(), resolved = new Map();
    const charge = units => { used += units; quantum += units; observe({ used, units }); };
    const inTime = () => { if (now() >= deadlineAt) fail('read_timeout'); };
    const family = 'tp1';
    if (cursor) tokens.verifyCursor(cursor, undefined, family);
    // The configuration is an internal cursor/replay binding, never a DTO addition.
    if (!support) { charge(1); support = capability(); }
    const binding = JSON.stringify({ ...bound, previewConfiguration: support.configuration });
    if (cursor) {
      if (!traversal || binding !== traversal.binding) fail('cursor_stale');
      tokens.verifyCursor(cursor, traversal.cursorBinding, family);
      if (cursor !== traversal.lastInput && cursor !== traversal.nextCursor) fail('cursor_stale');
      state = structuredClone(traversal);
    }
    function fence() {
      charge(4);
      try {
        const captured = snapshot(request.namespace);
        if (!Number.isSafeInteger(captured.indexRevision) || captured.indexRevision < 1 ||
            (captured.generation !== null && (typeof captured.generation !== 'string' || !captured.generation ||
              !captured.generation.isWellFormed() || captured.generation.length > 200))) fail('unsupported_database');
        if (state && !equal(captured, state.captured)) fail('cursor_stale');
        const origin = originBinding(request.namespace, captured), expected = state?.publicSnapshot ?? request.expectedSnapshot;
        if (expected) {
          if (expected.indexRevision !== captured.indexRevision || expected.generation !== captured.generation) fail('cursor_stale');
          tokens.verifyOrigin(expected.originToken, origin);
        }
        storage.target(request, captured);
        return { captured, origin };
      } catch (error) {
        if ((state || request.expectedSnapshot) && ['index_unavailable', 'unsafe_database_file', 'database_not_found'].includes(error.code)) fail('cursor_stale');
        if (state && ['moc_not_found', 'revision_conflict', 'invalid_ref'].includes(error.code)) fail('cursor_stale');
        throw error;
      }
    }
    const namespace = { ...request.namespace, projectId: request.namespace.scope === 'personal' ? null : request.namespace.projectId };
    const present = (row, preview) => ({ type: 'memory', namespace, id: row.id, revision: row.revision, kind: row.kind,
      label: { text: row.id, source: 'identifier' }, reportedUnder: row.reportedUnder, preview });
    function retention() { if (Buffer.byteLength(JSON.stringify(state)) > MEMBER_STATE_BYTES) fail('state_limit'); }
    // Reserve source+validation+construction atomically before extraction. The
    // unchanged epoch/generation checkpoint proves membership and attribution;
    // the guarded point query rechecks ID/namespace/revision/kind/visibility.
    function extract(row) {
      charge(support.segmenter ? 3 : 1);
      if (!support.segmenter) return null;
      counters.extractions++;
      if (counters.extractions > request.limit) fail('reader_failed');
      const source = previewStorage.source(row, request);
      if (!source) fail('cursor_stale');
      return source;
    }
    function transform(row, source) {
      const preview = transformPreview(source, request.previews.maxChars, support, counters);
      resolved.set(row.id, present(row, preview));
      // Rejected buffers/decoded text are local to this synchronous operation.
      inTime();
    }
    try {
      inTime(); prepare({ charge, request, deadlineAt }); inTime();
      const replay = cursor && cursor === state.lastInput;
      let payload;
      const cost = () => !state.data.initialization?.done && state.data.initialization ? storage.cost?.(state.data) ?? 1 :
        state.data.previewSetup < 3 ? 1 : storage.cost?.(state.data) ?? 1;
      const step = () => {
        charge(cost()); advanced = true;
        if (state.data.initialization && !state.data.initialization.done) storage.step(state.data, request, state.captured);
        else if (state.data.previewSetup < 3) previewStorage.setup(state.data.previewSetup++);
        else storage.step(state.data, request, state.captured);
      };
      function quantumWork() {
        const started = now(); quantum = 0;
        const initial = fence();
        if (!state) {
          charge(1); advanced = true;
          const publicSnapshot = request.expectedSnapshot ?? { indexRevision: initial.captured.indexRevision, generation: initial.captured.generation, originToken: tokens.issueOrigin(initial.origin) };
          state = { binding, captured: initial.captured, publicSnapshot,
            data: { ...storage.create(), previewSetup: 0 },
            cursorBinding: { binding, captured: initial.captured, originToken: publicSnapshot.originToken,
              traversal: randomBytes(16).toString('base64url') } };
        }
        if (replay) {
          const rows = state.recipe.items, amount = support.segmenter ? 3 : 1;
          if (used + (rows.length ? amount + (rows.length - 1) * (4 + amount) : 0) + 5 > request.workLimit) fail('read_timeout');
          if (rows.length) payload = { row: rows[0], source: extract(rows[0]) };
          return;
        }
        while (now() - started < 5 && now() < deadlineAt - 5) {
          const row = state.data.held ?
            (state.data.pending || state.data.done ? state.data.held : null) : state.data.pending;
          if (row && !resolved.has(row.id) && resolved.size < request.limit) {
            const amount = support.segmenter ? 3 : 1;
            if (used + amount > request.workLimit - 5 || quantum + amount > 64) break;
            payload = { row, source: extract(row) }; break;
          }
          if (state.data.pending || state.data.done) break;
          if (used + cost() > request.workLimit - 5 || quantum + cost() > 64) break;
          step();
        }
      }
      transaction(quantumWork);
      if (replay) {
        // Original admission reserves this exact worst-case regeneration work.
        const recipe = state.recipe;
        const value = { ...recipe, items: [] };
        for (const [index, row] of recipe.items.entries()) {
          inTime(); let source;
          if (index === 0) { source = payload.source; payload = null; }
          else transaction(() => { fence(); source = extract(row); });
          transform(row, source); source = null;
          const item = resolved.get(row.id), outcome = item.preview.status === 'available' ?
            { status: item.preview.status, truncated: item.preview.truncated } : item.preview;
          if (!equal(outcome, row.outcome)) fail('cursor_stale');
          value.items.push(item);
          await yieldQuantum(); inTime();
        }
        charge(1); transaction(fence); inTime();
        const output = success(value);
        if (Buffer.byteLength(JSON.stringify(output)) > request.maxBytes) fail('context_item_too_large');
        return output;
      }
      charge(1);
      const value = { version: PREVIEW_VERSION, status: 'partial', namespace, selection: request.selection,
        snapshot: { ...state.publicSnapshot, accessRevision: request.accessRevision, configuration: PREVIEW_VERSION },
        kind: request.kind, order: request.order, items: [], coverage: { complete: false, reason: 'work_limit' },
        nextCursor: tokens.issueCursor(state.cursorBinding, family) };
      const fits = () => Buffer.byteLength(JSON.stringify(success(value))) <= request.maxBytes;
      let reason, heldItem;
      while (true) {
        if (payload) { transform(payload.row, payload.source); payload = null; }
        retention(); inTime();
        if (state.data.held) {
          heldItem ??= resolved.get(state.data.held.id);
          if (heldItem && (state.data.pending || state.data.done)) {
            if (state.data.pending && !state.data.heldLimit) fail('context_item_too_large');
            value.items.push(heldItem); state.data.held = null;
            reason = state.data.done ? null : 'limit'; break;
          }
        } else if (state.data.pending) {
          if (value.items.length === request.limit) { reason = 'limit'; break; }
          const row = resolved.get(state.data.pending.id);
          if (row) {
            value.items.push(row);
            if (!fits()) {
              value.items.pop();
              if (value.items.length) { reason = 'byte_limit'; break; }
              const continuation = value.nextCursor, coverage = value.coverage;
              value.items.push(row); value.status = 'page'; value.coverage = { complete: false, reason: 'limit' };
              const limitFits = request.limit === 1 && fits();
              value.nextCursor = null; value.coverage = { complete: true, reason: null };
              const finalFits = fits();
              value.items.pop(); value.nextCursor = continuation; value.status = 'partial'; value.coverage = coverage;
              if (!finalFits) fail('context_item_too_large');
              state.data.held = state.data.pending; state.data.heldLimit = limitFits; heldItem = row;
            }
            state.data.pending = null; advanced = true;
          }
        }
        if (state.data.done && !state.data.pending && !state.data.held) { reason = null; break; }
        if (now() >= deadlineAt - 5) { reason = 'deadline'; break; }
        // In addition to normal admission, reserve worst-case replay (one
        // four-unit fence per ref), and final envelope/fence work.
        const replayUnits = 2 + (value.items.length + 1) * (4 + (support.segmenter ? 3 : 1)) + 5;
        const needsSource = state.data.pending && !resolved.has(state.data.pending.id) && value.items.length < request.limit;
        const nextCost = needsSource ? (support.segmenter ? 3 : 1) : cost();
        if (used + 4 + nextCost > request.workLimit - 4 ||
            (needsSource && replayUnits > request.workLimit)) { reason = 'work_limit'; break; }
        transaction(quantumWork);
        // Native bytes must be transformed/released before yielding.
        if (payload) { transform(payload.row, payload.source); payload = null; }
        retention(); await yieldQuantum();
      }
      if (reason === 'deadline' && !advanced && !value.items.length) fail('read_timeout');
      if (!advanced && !value.items.length && reason === 'work_limit') fail('read_timeout');
      value.coverage = { complete: reason === null, reason };
      value.status = reason === null || reason === 'limit' ? 'page' : 'partial';
      if (reason === null) value.nextCursor = null;
      if (!fits()) fail('context_item_too_large');
      // Deliberately no text, source, normalized value or text digest in state.
      state.recipe = { ...value, items: value.items.map(({ id, revision, kind, reportedUnder, preview }) => ({ id, revision, kind, reportedUnder,
        outcome: preview.status === 'available' ? { status: preview.status, truncated: preview.truncated } : { ...preview } })) };
      state.lastInput = cursor; state.nextCursor = value.nextCursor;
      retention(); transaction(fence); inTime(); traversal = state; accept(state.data); inspect(structuredClone(state));
      return success(value);
    } catch (error) {
      if (error.code === 'ERR_OUT_OF_RANGE') fail('unsupported_database');
      if (error.code === 'state_limit') {
        inTime(); transaction(fence); inTime(); traversal = undefined;
        return success({ version: PREVIEW_VERSION, status: 'partial', namespace, selection: request.selection,
          snapshot: { ...state.publicSnapshot, accessRevision: request.accessRevision, configuration: PREVIEW_VERSION },
          kind: request.kind, order: request.order, items: [], coverage: { complete: false, reason: 'state_limit' }, nextCursor: null });
      }
      if (['cursor_stale', 'read_timeout', 'reader_failed'].includes(error.code)) traversal = undefined;
      throw error;
    } finally {
      observe({ preview: counters });
      const metrics = channel('cairn.topic-member-previews.metrics');
      if (metrics.hasSubscribers) metrics.publish({ workUnits: used, ...counters });
    }
  }
  return { read };
}

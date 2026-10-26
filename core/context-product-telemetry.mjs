import { fail } from './validation.mjs';
import { SQLITE_STAGES, SQLITE_STATEMENTS } from './topic-reader-sqlite.mjs';

export const NATIVE_PROTOCOL = 'context-native-v1';
export const NATIVE_CAPACITY = 512;
export const NATIVE_STAGES = SQLITE_STAGES;
// Product-only audited extension of the existing closed diagnostic families.
export const NATIVE_STATEMENTS = Object.freeze([...SQLITE_STATEMENTS, 'context_metadata', 'context_evidence']);
const H = 10, WIDTH = 5, MAX = 0x7ffffffe;
// Header: begun, completed, failures, busy5, busy6, inFlight, overflow,
// committed failure sequence, seal, protocol. Records publish sequence last.
export function nativeTelemetry(operationId, workerEpoch) {
  const buffer = new SharedArrayBuffer((H + NATIVE_CAPACITY * WIDTH) * 4);
  Atomics.store(new Int32Array(buffer), 9, 1);
  return Object.freeze({ protocol: NATIVE_PROTOCOL, operationId, workerEpoch, buffer });
}
function view(frame) {
  if (frame?.protocol !== NATIVE_PROTOCOL || !(frame.buffer instanceof SharedArrayBuffer) ||
      frame.buffer.byteLength !== (H + NATIVE_CAPACITY * WIDTH) * 4 || !Number.isSafeInteger(frame.workerEpoch) || frame.workerEpoch < 1 ||
      typeof frame.operationId !== 'string') fail('reader_failed');
  const v = new Int32Array(frame.buffer);
  if (Atomics.load(v, 9) !== 1) fail('reader_failed');
  return v;
}
function increment(v, i) {
  if (Atomics.load(v, i) >= MAX) { Atomics.store(v, 6, 1); return; }
  Atomics.add(v, i, 1);
}
export function nativeOutcome(frame, stage, statement, work) {
  if (!frame) return work();
  const v = view(frame), s = NATIVE_STAGES.indexOf(stage), q = NATIVE_STATEMENTS.indexOf(statement);
  if (s < 0 || q < 0) { Atomics.store(v, 6, 1); fail('reader_failed'); }
  increment(v, 0); increment(v, 5);
  try { return work(); }
  catch (error) {
    increment(v, 2);
    const extended = error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) ? error.errcode : 0, primary = extended & 255;
    if (primary === 5) increment(v, 3);
    if (primary === 6) increment(v, 4);
    const sequence = Atomics.load(v, 2);
    if (sequence > NATIVE_CAPACITY) Atomics.store(v, 6, 1);
    else {
      const at = H + (sequence - 1) * WIDTH;
      v[at + 1] = s; v[at + 2] = q; v[at + 3] = primary; v[at + 4] = extended;
      Atomics.store(v, at, sequence);
    }
    Atomics.store(v, 7, sequence);
    throw error;
  } finally { increment(v, 1); Atomics.sub(v, 5, 1); }
}
export function sealNative(frame) { if (frame) Atomics.store(view(frame), 8, 1); }
export function drainNative(frame, terminated) {
  if (!frame) return { coverage: 'disabled', records: [] };
  const v = view(frame), n = i => Atomics.load(v, i), records = [];
  let complete = terminated && n(8) === 1 && n(0) === n(1) && n(5) === 0 && n(6) === 0 && n(2) === n(7);
  for (let sequence = 1; sequence <= Math.min(n(7), NATIVE_CAPACITY); sequence++) {
    const at = H + (sequence - 1) * WIDTH;
    if (n(at) !== sequence || !NATIVE_STAGES[v[at + 1]] || !NATIVE_STATEMENTS[v[at + 2]]) { complete = false; continue; }
    records.push({ operationId: frame.operationId, workerEpoch: frame.workerEpoch, sequence,
      stage: NATIVE_STAGES[v[at + 1]], statement: NATIVE_STATEMENTS[v[at + 2]], sqlite: { code: v[at + 3], extendedCode: v[at + 4] } });
  }
  return Object.freeze({ protocol: NATIVE_PROTOCOL, operationId: frame.operationId, workerEpoch: frame.workerEpoch,
    coverage: complete ? 'complete' : 'incomplete', begun: n(0), completed: n(1), failures: n(2), busy: n(3) + n(4),
    inFlight: n(5), overflow: Boolean(n(6)), records });
}
function statementLabel(sql) {
  if (/query_only|trusted_schema|busy_timeout/i.test(sql)) return 'reader_configuration';
  for (const name of ['application_id', 'user_version', 'schema_version', 'encoding']) if (new RegExp('^PRAGMA\\s+' + name + '\\b', 'i').test(sql)) return name;
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) return 'transaction';
  if (/sqlite_master|pragma_|EXPLAIN/i.test(sql)) return 'schema_metadata';
  if (/namespace_epochs|store_metadata/i.test(sql)) return 'snapshot_metadata';
  return 'context_evidence';
}
export function nativeObserver(initialFrame) {
  let frame = initialFrame;
  const invoke = (stage, label, work) => nativeOutcome(frame, stage, label, work);
  return {
    select(next) { frame = next; },
    invoke,
    database: function wrapDatabase(native) {
      function method(object, key, args, stage, label) {
        const result = invoke(stage, label, () => Reflect.apply(object[key], object, args));
        if (key !== 'iterate') return result;
        let wrapped;
        wrapped = new Proxy(result, { get(target, name) {
          if (name === Symbol.iterator) return () => wrapped;
          const value = Reflect.get(target, name, target);
          return typeof value === 'function' ? (...args) => method(target, name, args, 'execute', label) : value;
        } });
        return wrapped;
      }
      return new Proxy(native, { get(object, key) {
        if (key === 'constructor') return function ObservedComparisonDatabase(...args) {
          return wrapDatabase(invoke('open', 'connection', () => Reflect.construct(object.constructor, args)));
        };
        if (key === 'prepare') return sql => {
          const label = statementLabel(sql), prepared = method(object, key, [sql], 'prepare', label);
          return new Proxy(prepared, { get(target, name) {
            const value = Reflect.get(target, name, target);
            return typeof value === 'function' ? (...args) => method(target, name, args, 'execute', label) : value;
          } });
        };
        if (key === 'exec') return sql => {
          const verb = sql.trim().toLowerCase(), stage = ['begin', 'commit', 'rollback'].includes(verb) ? verb : 'configure';
          return method(object, key, [sql], stage, statementLabel(sql));
        };
        const value = Reflect.get(object, key, object);
        return typeof value === 'function' ? (...args) => method(object, key, args, 'close', 'connection') : value;
      } });
    },
  };
}

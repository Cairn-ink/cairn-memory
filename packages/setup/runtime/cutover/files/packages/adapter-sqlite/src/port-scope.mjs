// This guard catches accidental outer transaction control in first-party port code.
// Deliberate evasion is out of scope.

import { CoreError } from "../../core/src/index.mjs";

/** @import { DatabaseSync, StatementSync, SQLOutputValue } from "node:sqlite" */
/** @typedef {NodeJS.Iterator<Record<string, SQLOutputValue>>} RowIterator */
/** @typedef {StatementSync & {
 *   setReturnArrays(enabled: boolean): void,
 *   close?(): void,
 *   [Symbol.dispose]?(): void,
 * }} PortStatement */

const sqlTrivia = String.raw`(?:[\t\n\v\f\r \uFEFF]|--[^\n]*(?:\n|$)|\/\*(?:[^*]|\*(?!\/))*(?:\*\/|$))`;
const leadingTrivia = new RegExp(`^(?:;|${sqlTrivia})*`);
const outerTransactionControl = /^(?:BEGIN|COMMIT|END|ROLLBACK)\b/i;
// SQLite identifiers can continue with $ or any non-ASCII character.
const rollbackToSavepoint = new RegExp(String.raw`^ROLLBACK${sqlTrivia}+(?:TRANSACTION${sqlTrivia}+)?TO(?![A-Za-z0-9_$\u0080-\uFFFF])`, "i");

/** @param {string} sql */
function withoutTrivia(sql) {
  if (typeof sql !== "string" || sql.includes("\0")) throw new CoreError("internal_error");
  return sql.replace(leadingTrivia, "");
}

/**
 * @param {DatabaseSync} db
 * @param {<T>(operation: () => T) => T} execute
 * @param {Map<string, StatementSync>} [cachedStatements]
 */
export function sqlitePortScope(db, execute, cachedStatements) {
  let active = true;
  /** @type {Map<RowIterator, StatementSync>} */
  const iterators = new Map();

  /** @template T @param {() => T} operation */
  function use(operation) {
    if (!active) throw new CoreError("internal_error");
    return execute(operation);
  }

  /** @param {string} sql */
  function prepare(sql) {
    return use(() => {
      const statement = withoutTrivia(sql);
      // The outer transaction starts with BEGIN. A RELEASE can only remove nested savepoints.
      if (outerTransactionControl.test(statement) && !rollbackToSavepoint.test(statement)) {
        throw new CoreError("internal_error");
      }
      const cached = cachedStatements?.get(sql);
      if (cached) return cached;
      const prepared = db.prepare(sql);
      if (cachedStatements && cachedStatements.size < 16) cachedStatements.set(sql, prepared);
      return prepared;
    });
  }

  /** @param {RowIterator} iterator @param {StatementSync} statement */
  function scopedIterator(iterator, statement) {
    iterators.set(iterator, statement);
    return Object.freeze({
      next() {
        const result = use(() => iterator.next());
        if (result.done) iterators.delete(iterator);
        return result;
      },
      return() {
        const result = use(() => iterator.return?.());
        iterators.delete(iterator);
        return result ?? { done: true, value: undefined };
      },
      [Symbol.iterator]() { return this; },
    });
  }

  /** @param {StatementSync} statement */
  function scopedStatement(statement) {
    const scoped = {};
    // Runtime statement methods vary by Node version and include symbol keys.
    for (let object = statement; object && object !== Object.prototype; object = Object.getPrototypeOf(object)) {
      for (const key of Reflect.ownKeys(object)) {
        if (key === "constructor" || Object.hasOwn(scoped, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (typeof descriptor?.value === "function") {
          const method = descriptor.value;
          /** @param {unknown[]} args */
          const invoke = (...args) => use(() => {
            const result = Reflect.apply(method, statement, args);
            if (key === "iterate") return scopedIterator(result, statement);
            if (key === "close" || key === Symbol.dispose) {
              // Finalization invalidates the native iterators immediately.
              for (const [iterator, owner] of iterators) {
                if (owner === statement) iterators.delete(iterator);
              }
            }
            return result;
          });
          Object.defineProperty(scoped, key, {
            enumerable: descriptor.enumerable,
            value: invoke,
          });
        } else if (descriptor?.get) {
          Object.defineProperty(scoped, key, {
            enumerable: descriptor.enumerable,
            get: () => use(() => Reflect.get(statement, key)),
          });
        }
      }
    }
    return /** @type {PortStatement} */ (Object.freeze(scoped));
  }

  const connection = Object.freeze({
    prepare: (/** @type {string} */ sql) => scopedStatement(prepare(sql)),
    exec(/** @type {string} */ sql) {
      use(() => {});
      // SQLite parses statement boundaries, including semicolons in strings and triggers.
      while (withoutTrivia(sql)) {
        const source = prepare(sql).sourceSQL;
        use(() => db.exec(source));
        sql = sql.slice(source.length);
      }
    },
    get isTransaction() { return use(() => db.isTransaction); },
  });

  return {
    connection,
    revoke() {
      active = false;
      for (const iterator of iterators.keys()) iterator.return?.();
      iterators.clear();
    },
  };
}

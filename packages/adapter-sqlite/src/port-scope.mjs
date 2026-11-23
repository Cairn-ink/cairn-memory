import { CoreError } from "@cairn-ink/core";

/** @import { DatabaseSync, StatementSync, SQLInputValue, SQLOutputValue } from "node:sqlite" */
/** @typedef {NodeJS.Iterator<Record<string, SQLOutputValue>>} RowIterator */
/** @typedef {SQLInputValue | Record<string, SQLInputValue>} Binding */

const leadingTrivia = /^(?:[\t\n\v\f\r ;\uFEFF]+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?(?:\*\/|$))*/;
const transactionControl = /^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/** @param {string} sql */
function withoutTrivia(sql) {
  if (typeof sql !== "string" || sql.includes("\0")) throw new CoreError("internal_error");
  return sql.replace(leadingTrivia, "");
}

/**
 * @param {DatabaseSync} db
 * @param {<T>(operation: () => T) => T} execute
 */
export function sqlitePortScope(db, execute) {
  let active = true;
  /** @type {Set<RowIterator>} */
  const iterators = new Set();

  /** @template T @param {() => T} operation */
  function use(operation) {
    if (!active) throw new CoreError("internal_error");
    return execute(operation);
  }

  /** @template {(...args: never[]) => unknown} Method @param {Method} method @returns {Method} */
  function guard(method) {
    return /** @type {Method} */ ((.../** @type {Parameters<Method>} */ args) => use(() => method(...args)));
  }

  /** @param {string} sql */
  function prepare(sql) {
    return use(() => {
      if (transactionControl.test(withoutTrivia(sql))) throw new CoreError("internal_error");
      return db.prepare(sql);
    });
  }

  /** @param {RowIterator} iterator */
  function scopedIterator(iterator) {
    iterators.add(iterator);
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
    /** @param {Binding[]} args */
    function iterate(...args) {
      return scopedIterator(use(() => Reflect.apply(statement.iterate, statement, args)));
    }

    return Object.freeze({
      all: guard(statement.all.bind(statement)),
      get: guard(statement.get.bind(statement)),
      run: guard(statement.run.bind(statement)),
      iterate,
      columns: guard(statement.columns.bind(statement)),
      setAllowBareNamedParameters: guard(statement.setAllowBareNamedParameters.bind(statement)),
      setAllowUnknownNamedParameters: guard(statement.setAllowUnknownNamedParameters.bind(statement)),
      setReadBigInts: guard(statement.setReadBigInts.bind(statement)),
      get sourceSQL() { return use(() => statement.sourceSQL); },
      get expandedSQL() { return use(() => statement.expandedSQL); },
    });
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
      for (const iterator of iterators) iterator.return?.();
      iterators.clear();
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import { openDatabase, transaction } from "./database.mjs";
import {
  fail, identifier, limit, memoryInput, namespace, object, revision,
} from "./validation.mjs";

export { MemoryStoreError } from "./validation.mjs";

/** Embedded storage only. The caller, not this library, authenticates owners. */
export function openMemoryStore(input) {
  object(input, ["path"]);
  const db = openDatabase(input.path);
  let closed = false;
  const ready = () => { if (closed) fail("store_closed"); };

  function bindScope(input) {
    ready();
    const ns = namespace(input);
    const boundary = [ns.ownerId, ns.scope, ns.projectId];
    const where = "owner_id = ? AND scope = ? AND project_id = ?";

    function row(id) {
      return db.prepare(`SELECT * FROM memories WHERE ${where} AND id = ? AND deleted = 0`)
        .get(...boundary, id);
    }

    function dto(memory) {
      if (!memory) return null;
      const receipts = db.prepare(`SELECT client, session_id AS sessionId,
        event_id AS eventId, role, excerpt, created_at AS createdAt
        FROM receipts WHERE memory_id = ? ORDER BY created_at, receipt_key`).all(memory.id);
      return {
        id: memory.id, content: memory.content, kind: memory.kind,
        scope: memory.scope, projectId: memory.project_id || null,
        origin: memory.origin, confidence: memory.confidence, revision: memory.revision,
        createdAt: memory.created_at, updatedAt: memory.updated_at,
        receipts: receipts.map((receipt) => ({ ...receipt })),
      };
    }

    function assertNotSuppressed(fingerprint) {
      if (db.prepare(`SELECT 1 FROM suppressed WHERE ${where} AND fingerprint = ?`)
        .get(...boundary, fingerprint)) fail("memory_suppressed");
    }

    function suppress(fingerprint) {
      db.prepare("INSERT OR IGNORE INTO suppressed VALUES (?, ?, ?, ?)")
        .run(...boundary, fingerprint);
    }

    function attach(id, receipt, now) {
      const key = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
      return db.prepare("INSERT OR IGNORE INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, key, receipt.client, receipt.sessionId, receipt.eventId,
          receipt.role, receipt.excerpt, now).changes;
    }

    return Object.freeze({
      remember(input) {
        ready();
        const value = memoryInput(input);
        return transaction(db, () => {
          assertNotSuppressed(value.fingerprint);
          const existing = db.prepare(`SELECT * FROM memories WHERE ${where}
            AND fingerprint = ? AND deleted = 0`).get(...boundary, value.fingerprint);
          const now = new Date().toISOString();
          if (existing) {
            const added = attach(existing.id, value.receipt, now);
            const explicit = value.origin === "explicit";
            const kind = explicit ? value.kind : existing.kind;
            const origin = explicit ? "explicit" : existing.origin;
            const confidence = Math.max(existing.confidence, value.confidence);
            if (added || kind !== existing.kind || origin !== existing.origin ||
                confidence !== existing.confidence) {
              db.prepare(`UPDATE memories SET kind = ?, origin = ?, confidence = ?,
                revision = revision + 1, updated_at = ? WHERE id = ?`)
                .run(kind, origin, confidence, now, existing.id);
            }
            return dto(row(existing.id));
          }
          const id = randomUUID();
          db.prepare(`INSERT INTO memories VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`)
            .run(id, ...boundary, value.fingerprint, value.content, value.kind,
              value.origin, value.confidence, now, now);
          attach(id, value.receipt, now);
          return dto(row(id));
        });
      },

      get(id) {
        ready();
        // A read transaction keeps content and receipts at the same revision.
        return transaction(db, () => dto(row(identifier(id))));
      },

      list(options = {}) {
        ready();
        object(options, ["limit"]);
        const count = limit(options.limit);
        return transaction(db, () => db.prepare(`SELECT * FROM memories WHERE ${where}
          AND deleted = 0 ORDER BY updated_at DESC, id LIMIT ?`)
          .all(...boundary, count).map(dto));
      },

      search(query, options = {}) {
        ready();
        object(options, ["limit"]);
        const count = limit(options.limit);
        if (typeof query !== "string" || query.length > 4_000) fail("invalid_query");
        const terms = [...new Set(query.normalize("NFKC").toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? [])];
        if (terms.length === 0) return [];
        // Literal substring matching, not SQL LIKE/FTS syntax or semantic recall.
        return transaction(db, () => db.prepare(`SELECT * FROM memories WHERE ${where}
          AND deleted = 0`).all(...boundary)
          .map((memory) => ({ memory, score: terms.reduce((n, term) =>
            n + Number(memory.content.toLowerCase().includes(term)), 0) }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at)
            || a.memory.id.localeCompare(b.memory.id))
          .slice(0, count).map(({ memory }) => dto(memory)));
      },

      correct(id, input, expectedRevision) {
        ready();
        identifier(id);
        revision(expectedRevision);
        const value = memoryInput(input);
        if (value.origin !== "explicit") fail("correction_must_be_explicit");
        return transaction(db, () => {
          const current = row(id);
          if (!current) fail("memory_not_found");
          if (current.revision !== expectedRevision) fail("revision_conflict");
          assertNotSuppressed(value.fingerprint);
          const other = db.prepare(`SELECT id FROM memories WHERE ${where}
            AND fingerprint = ? AND deleted = 0 AND id != ?`)
            .get(...boundary, value.fingerprint, id);
          if (other) fail("memory_conflict");
          if (current.fingerprint !== value.fingerprint) suppress(current.fingerprint);
          const now = new Date().toISOString();
          db.prepare(`UPDATE memories SET content = ?, fingerprint = ?, kind = ?,
            origin = 'explicit', confidence = 1, revision = revision + 1, updated_at = ?
            WHERE id = ?`).run(value.content, value.fingerprint, value.kind, now, id);
          db.prepare("DELETE FROM receipts WHERE memory_id = ?").run(id);
          attach(id, value.receipt, now);
          return dto(row(id));
        });
      },

      forget(id, expectedRevision) {
        ready();
        identifier(id);
        revision(expectedRevision);
        return transaction(db, () => {
          const current = row(id);
          if (!current) return false;
          if (current.revision !== expectedRevision) fail("revision_conflict");
          suppress(current.fingerprint);
          db.prepare(`UPDATE memories SET content = NULL, deleted = 1,
            revision = revision + 1, updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), id);
          db.prepare("DELETE FROM receipts WHERE memory_id = ?").run(id);
          return true;
        });
      },
    });
  }

  return Object.freeze({
    scope: bindScope,
    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  });
}

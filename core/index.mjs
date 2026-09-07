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
      db.prepare(`INSERT OR IGNORE INTO suppressed
        (owner_id, scope, project_id, fingerprint) VALUES (?, ?, ?, ?)`)
        .run(...boundary, fingerprint);
    }

    function attach(id, receipt, now) {
      const key = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
      return db.prepare(`INSERT OR IGNORE INTO receipts
        (memory_id, receipt_key, client, session_id, event_id, role, excerpt, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, key, receipt.client, receipt.sessionId, receipt.eventId,
          receipt.role, receipt.excerpt, now).changes;
    }

    // Validated values only; the caller owns the surrounding transaction.
    function rememberValue(value) {
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
      db.prepare(`INSERT INTO memories
        (id, owner_id, scope, project_id, fingerprint, content, kind, origin,
         confidence, revision, deleted, created_at, updated_at) VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`)
        .run(id, ...boundary, value.fingerprint, value.content, value.kind,
          value.origin, value.confidence, now, now);
      attach(id, value.receipt, now);
      return dto(row(id));
    }

    function captureKey(input, operationField) {
      object(input, ["client", "eventId", "digest", operationField]);
      identifier(input.client);
      identifier(input.eventId);
      if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) fail("invalid_digest");
      return [...boundary, input.client, input.eventId];
    }

    const captureWhere = `${where} AND client = ? AND event_id = ?`;

    return Object.freeze({
      remember(input) {
        ready();
        const value = memoryInput(input);
        return transaction(db, () => rememberValue(value));
      },

      claimCapture(input) {
        ready();
        const key = captureKey(input, "leaseMs");
        if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 125_000) {
          fail("invalid_lease");
        }
        return transaction(db, () => {
          const old = db.prepare(`SELECT * FROM capture_events WHERE ${captureWhere}`).get(...key);
          if (old && old.digest !== input.digest) fail("event_payload_conflict");
          if (old?.completed) return { duplicate: true, memoryCount: old.memory_count,
            suppressedCount: old.suppressed_count };
          const now = Date.now();
          if (old && old.expires_at > now) return { processing: true };
          const token = randomUUID();
          db.prepare(`INSERT INTO capture_events
            (owner_id, scope, project_id, client, event_id, digest, token, expires_at, completed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT (owner_id, scope, project_id, client, event_id)
            DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at`)
            .run(...key, input.digest, token, now + input.leaseMs);
          return { token };
        });
      },

      finishCapture(input, items) {
        ready();
        const key = captureKey(input, "token");
        identifier(input.token);
        if (!Array.isArray(items) || items.length > 5) fail("invalid_capture");
        const values = items.map((item) => {
          object(item, ["content", "kind", "confidence", "receipts"]);
          if (!Array.isArray(item.receipts) || item.receipts.length < 1 || item.receipts.length > 4) {
            fail("invalid_receipt");
          }
          return item.receipts.map((receipt) => memoryInput({ content: item.content,
            kind: item.kind, confidence: item.confidence, origin: "agent-inferred", receipt }));
        });
        return transaction(db, () => {
          const current = db.prepare(`SELECT * FROM capture_events WHERE ${captureWhere}`).get(...key);
          if (!current || current.completed || current.token !== input.token ||
              current.digest !== input.digest || current.expires_at <= Date.now()) fail("stale_capture");
          const ids = new Set();
          let suppressedCount = 0;
          for (const receipts of values) {
            try { assertNotSuppressed(receipts[0].fingerprint); }
            catch (error) {
              if (error.code !== "memory_suppressed") throw error;
              suppressedCount += 1;
              continue;
            }
            for (const value of receipts) ids.add(rememberValue(value).id);
          }
          db.prepare(`UPDATE capture_events SET completed = 1, memory_count = ?,
            suppressed_count = ? WHERE ${captureWhere}`).run(ids.size, suppressedCount, ...key);
          return { duplicate: false, memoryCount: ids.size, suppressedCount };
        });
      },

      abandonCapture(input) {
        ready();
        const key = captureKey(input, "token");
        identifier(input.token);
        return transaction(db, () => db.prepare(`UPDATE capture_events SET expires_at = 0 WHERE ${captureWhere}
          AND token = ? AND digest = ? AND completed = 0`)
          .run(...key, input.token, input.digest).changes > 0);
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

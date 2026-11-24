import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { readTokenSigner } from "../src/service/context-read-tokens.mjs";

const storeId = "synthetic-store";
const cursorKey = new TextEncoder().encode("synthetic fixture key");
const code = expected => error => error.name === "CoreError" && error.code === expected && error.retryable === false;
const mac = value => createHmac("sha256", cursorKey).update(JSON.stringify(value)).digest("base64url");

test("signs the legacy UTF-8 JSON payload and verifies it with store-scoped HMAC", async () => {
  const signer = readTokenSigner({ storeId, cursorKey });
  const snapshot = { v: 1, scope: "個人", refs: [[0, "memory", "id", 3]] };
  const body = Buffer.from(JSON.stringify(snapshot)).toString("base64url");
  const expected = body + "." + mac(["context-read-v1", "snapshot", storeId, body]);
  const actual = await signer.encode("snapshot", snapshot);
  assert.equal(actual === expected, true, "The legacy domain and encoded payload must match");
  assert.deepEqual(await signer.decode("snapshot", actual), snapshot);
});

test("rejects tampering, kind confusion, wrong store, wrong key and noncanonical base64url", async () => {
  const signer = readTokenSigner({ storeId, cursorKey });
  const payload = { v: 1, p: 1 };
  const token = await signer.encode("cursor", payload);
  const [body, signature] = token.split(".");
  const changedSignature = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  const changedBody = Buffer.from(JSON.stringify({ ...payload, p: 2 })).toString("base64url");
  await assert.rejects(signer.decode("cursor", body + "." + changedSignature), code("invalid_cursor"));
  await assert.rejects(signer.decode("cursor", changedBody + "." + signature), code("invalid_cursor"));
  await assert.rejects(signer.decode("snapshot", token), code("snapshot_stale"));
  await assert.rejects(readTokenSigner({ storeId: "other-test-store", cursorKey }).decode("cursor", token), code("invalid_cursor"));
  const otherKey = new TextEncoder().encode("unrelated synthetic fixture key");
  await assert.rejects(readTokenSigner({ storeId, cursorKey: otherKey }).decode("cursor", token), code("invalid_cursor"));
  const paddedBody = body + "=";
  await assert.rejects(signer.decode("cursor", paddedBody + "." + mac(["context-read-v1", "cursor", storeId, paddedBody])),
    code("invalid_cursor"));
  await assert.rejects(signer.decode("cursor", token + "="), code("invalid_cursor"));
  await assert.rejects(signer.decode("cursor", token + "\n"), code("invalid_cursor"));
});

test("verifies with a non-extractable HMAC key", async () => {
  const signingKey = await crypto.subtle.importKey("raw", cursorKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signer = readTokenSigner({ storeId, cursorKey: signingKey });
  const payload = { v: 1, p: 1 };
  const token = await signer.encode("cursor", payload);
  assert.deepEqual(await signer.decode("cursor", token), payload);
  const tampered = (token[0] === "A" ? "B" : "A") + token.slice(1);
  await assert.rejects(signer.decode("cursor", tampered), code("invalid_cursor"));
});

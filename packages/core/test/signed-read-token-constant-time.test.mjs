import assert from "node:assert/strict";
import { test } from "node:test";
import * as tokenModule from "../src/service/signed-read-token.mjs";

test("F3 signed-read verification signs once and checks every byte of equal-length tags", async t => {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const codec = tokenModule.signedReadToken(key);
  const sign = t.mock.method(crypto.subtle, "sign");
  const verify = t.mock.method(crypto.subtle, "verify", () => { throw new Error("native verification called"); });
  const generate = t.mock.method(crypto.subtle, "generateKey", () => { throw new Error("comparison key generated"); });
  const token = await codec.encode({ fixture: 1 });
  assert.deepEqual(await codec.decode(token), { fixture: 1 });
  const [body, tag] = token.split(".");
  for (const offset of [0, 31]) {
    const changed = Buffer.from(tag, "base64url");
    changed[offset] ^= 1;
    assert.equal(await codec.decode(body + "." + changed.toString("base64url")), undefined);
  }
  assert.equal(sign.mock.callCount(), 4);
  assert.equal(verify.mock.callCount(), 0);
  assert.equal(generate.mock.callCount(), 0);

  const expected = new Uint8Array(32);
  for (const offset of [0, 31]) {
    const reads = [];
    const changed = new Proxy(expected.slice(), {
      get(target, property) {
        if (property === "length") return target.length;
        const index = Number(property);
        reads.push(index);
        return target[index] ^ Number(index === offset);
      },
    });
    assert.equal(tokenModule.equalReadTags(expected, changed), false);
    assert.deepEqual(reads, Array.from({ length: 32 }, (_, index) => index));
  }
});

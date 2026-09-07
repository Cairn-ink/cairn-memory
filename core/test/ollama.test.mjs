import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createOllamaModel } from "../models/ollama.mjs";

async function server(t, reply) {
  const http = createServer(reply);
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(() => { http.closeAllConnections(); http.close(); });
  return `http://127.0.0.1:${http.address().port}`;
}
const request = (signal) => ({ system: "synthetic", prompt: "synthetic", schema: { type: "object" }, signal });

test("model endpoint configuration requires explicit remote HTTPS consent", () => {
  for (const endpoint of ["http://example.com", "https://example.com", "http://localhost:11434",
    "http://127.0.0.1/?token=x", "http://user:pass@127.0.0.1", "file:///tmp/test", "http://127.0.0.1/prefix"]) {
    assert.throws(() => createOllamaModel({ endpoint, model: "test" }), /invalid_model_endpoint/);
  }
  assert.ok(createOllamaModel({ endpoint: "https://example.com", model: "test", allowRemote: true }));
  assert.throws(() => createOllamaModel({ model: "test-cloud" }), /invalid_model_name/);
  assert.throws(() => createOllamaModel({ model: "test", allowRemote: "false" }), /invalid_model_endpoint/);
});

test("Ollama transport sends schema and parses bounded JSON", async (t) => {
  const endpoint = await server(t, (req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(req.url, "/api/chat");
      assert.equal(parsed.stream, false);
      assert.equal(parsed.options.temperature, 0);
      assert.deepEqual(parsed.format, { type: "object" });
      res.end(JSON.stringify({ done: true, message: { content: '{"memories":[]}' } }));
    });
  });
  const model = createOllamaModel({ endpoint, model: "test" });
  assert.deepEqual(await model.generate(request()), { memories: [] });
});

test("redirects, invalid/incomplete JSON and oversized bodies fail without exposing provider text", async (t) => {
  for (const mode of ["redirect", "invalid", "incomplete", "oversized", "error"]) {
    const endpoint = await server(t, (req, res) => {
      req.resume();
      if (mode === "redirect") { res.writeHead(302, { location: "https://example.com" }); res.end(); }
      if (mode === "invalid") res.end(JSON.stringify({ done: true, message: { content: "secret malformed text" } }));
      if (mode === "incomplete") res.end(JSON.stringify({ done: false, message: { content: "{}" } }));
      if (mode === "oversized") res.end("x".repeat(262_145));
      if (mode === "error") { res.writeHead(500); res.end("secret provider response"); }
    });
    await assert.rejects(createOllamaModel({ endpoint, model: "test" }).generate(request()),
      (error) => error.message === "model_request_failed");
  }
});

test("abort cancels an unresponsive model instead of selecting a fallback", async (t) => {
  let requests = 0;
  const endpoint = await server(t, (req) => { requests++; req.resume(); });
  const model = createOllamaModel({ endpoint, model: "test" });
  await assert.rejects(model.generate(request(AbortSignal.timeout(50))), /model_cancelled/);
  assert.equal(requests, 1);
});

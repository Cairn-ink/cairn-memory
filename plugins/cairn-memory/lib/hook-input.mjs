// Host-owned hook input; not part of the generated shared-client bundle.
export async function readHookInput(stream, check = () => {}) {
  const chunks = [];
  // Process stdin yields Buffers; an in-process or object-mode stream may yield
  // already-decoded strings, which re-encode exactly.
  for await (const chunk of stream) { check(); chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk); }
  return Buffer.concat(chunks).toString("utf8");
}

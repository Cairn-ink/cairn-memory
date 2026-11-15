// Host-owned hook input; not part of the generated shared-client bundle.
export async function readHookInput(stream, check = () => {}, { deadlineMs } = {}) {
  const chunks = [];
  let expired = false;
  const timer = deadlineMs === undefined ? undefined : setTimeout(() => {
    expired = true;
    stream.destroy();
  }, deadlineMs);
  timer?.unref();
  try {
    // Process stdin yields Buffers; an in-process or object-mode stream may
    // yield already-decoded strings, which re-encode exactly.
    for await (const chunk of stream) { check(); chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk); }
    return expired ? "" : Buffer.concat(chunks).toString("utf8");
  } catch (error) {
    if (expired) return ""; // Discard even complete JSON received before EOF.
    throw error;
  } finally { clearTimeout(timer); }
}

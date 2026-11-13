// Host-owned hook input; not part of the generated shared-client bundle.
export async function readHookInput(stream, check = () => {}) {
  const chunks = [];
  for await (const chunk of stream) { check(); chunks.push(chunk); }
  return Buffer.concat(chunks).toString("utf8");
}

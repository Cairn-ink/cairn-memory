import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import { privateRead, privateWrite } from "../client/private-state.mjs";

// Independent owner-private key: never expose it in cursor, handoff or request.
export async function transcriptDigest(binding) {
  const path = join(binding.root, "codex-digest-key");
  let key = await privateRead(path, { missing: true });
  if (key === undefined) {
    await privateWrite(path, randomBytes(32).toString("hex"), { exclusive: true });
    key = await privateRead(path);
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("digest_key_invalid");
  const derived = createHmac("sha256", Buffer.from(key, "hex"))
    .update(JSON.stringify(["codex-transcript-v2", binding.targetId, binding.projectId]))
    .digest();
  return (bytes) => createHmac("sha256", derived).update(bytes).digest("hex");
}

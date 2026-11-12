import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, rmdir, unlink, lstat } from "node:fs/promises";
import { createSecretFileAtomic } from "openclaw/plugin-sdk/secret-file";
import { DEFAULT_ENDPOINT, DEFAULT_TIMEOUT_MS, OFF_SWITCH, recallPrompt, worstCaseBlockingMs, endpointOrigin, mergeSetup, timeoutValue } from "./config.mjs";
import { checkCredential } from "./hosted.mjs";
import { createTerminal } from "./terminal.mjs";
export async function runSetup(api, { io, timeoutMs = api.pluginConfig?.activeMemoryTimeoutMs ?? DEFAULT_TIMEOUT_MS } = {}) {
  let secretPath, secretCreated = false, directory, directoryCreated = false, published = false;
  try {
    io ??= createTerminal();
    timeoutMs = timeoutValue(timeoutMs);
    const endpoint = endpointOrigin((await io.ask(`Cairn endpoint [${DEFAULT_ENDPOINT}]:`)).trim() || DEFAULT_ENDPOINT);
    const token = await io.ask("Memory-only token:", true);
    const checked = await checkCredential(endpoint, token);
    if (!checked.ok) { io.print(checked.message); return false; }
    io.print("Memory-only token accepted.");
    const answer = await io.ask(recallPrompt(timeoutMs));
    io.print(OFF_SWITCH);
    if (!["", "y", "yes", "n", "no"].includes(answer.trim().toLowerCase())) throw 0;
    const automatic = !["n", "no"].includes(answer.trim().toLowerCase());
    io.print(`Recall-work budget: ${timeoutMs} ms; documented worst-case blocking: ${worstCaseBlockingMs(timeoutMs)} ms.`);
    // Unique immutable secret + one transactional host config write. Existing secrets are never overwritten.
    const root = api.runtime.state.resolveStateDir();
    directory = join(root, "cairn-secrets");
    try { await mkdir(directory, { mode: 0o700 }); directoryCreated = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() ||
        (process.getuid && info.uid !== process.getuid()) ||
        (process.platform !== "win32" && (info.mode & 0o777) !== 0o700)) throw 0;
    const suffix = randomUUID();
    const provider = `cairn-${suffix}`;
    secretPath = join(directory, `${suffix}.token`);
    await createSecretFileAtomic({ rootDir: directory, filePath: secretPath, content: token, mode: 0o600, dirMode: 0o700, durable: true });
    secretCreated = true;
    await api.runtime.config.mutateConfigFile({
      afterWrite: { mode: "none", reason: "Local Cairn setup: operator restarts the Gateway after completion." },
      mutate(draft) { mergeSetup(draft, { endpoint, provider, secretPath, automatic, timeoutMs }); },
    });
    published = true;
    io.print("Cairn configured through OpenClaw's transactional config API. Restart the Gateway and start a new session.");
    io.print("Revoke the token at cairn.ink → Settings → Connections.");
    return true;
  } catch {
    // Output failure after an accepted config write must never remove its live credential.
    if (published) return true;
    let rollbackOk = true;
    if (secretCreated) try { await unlink(secretPath); } catch { rollbackOk = false; }
    if (directoryCreated) try { await rmdir(directory); } catch { rollbackOk = false; }
    const message = rollbackOk ? "Cairn setup failed. Nothing saved." :
      "Cairn setup failed; secret cleanup failed. Check the private cairn-secrets directory before retrying.";
    if (io) io.print(message); else process.stderr.write("Cairn setup needs a terminal with hidden input. Nothing saved.\n");
    return false;
  }
}

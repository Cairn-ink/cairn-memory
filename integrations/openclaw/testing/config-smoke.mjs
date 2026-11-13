import { mutateConfigFile } from "openclaw/plugin-sdk/config-mutation";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { runSetup } from "../src/setup.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(dirname(process.env.OPENCLAW_CONFIG_PATH), { recursive: true });
await writeFile(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify({ plugins: { load: { paths: [root] } } }));
const server = createServer((_req, res) => { res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ valid: true, token_id: "synthetic-id", expires_at: null, scopes: ["memory:capture", "memory:recall"] })); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const answers = [`http://127.0.0.1:${server.address().port}`, "synthetic-memory-token", ""];
  const ok = await runSetup({ runtime: { state: { resolveStateDir: () => process.env.OPENCLAW_STATE_DIR }, config: { mutateConfigFile, current: () => ({}) } } },
    { io: { ask: async (prompt, hidden) => { process.stdout.write(prompt + (hidden ? " [REDACTED]" : "") + "\n"); return answers.shift(); },
      print: (text) => process.stdout.write(text + "\n") } });
  if (!ok) process.exitCode = 1;
  const config = JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH));
  if (JSON.stringify(config).includes("synthetic-memory-token") || !config.plugins.entries?.["cairn-memory"]?.enabled) process.exitCode = 1;
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }

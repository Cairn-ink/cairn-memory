import { definePluginEntry, buildJsonPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import { configSchema, DEFAULT_ENDPOINT, PLUGIN_ID } from "./config.mjs";
import { createHostedClient, failure } from "./hosted.mjs";
import { toolSchemas } from "./tools.mjs";
import { runSetup } from "./setup.mjs";
export default definePluginEntry({
  id: PLUGIN_ID, name: "Cairn memory", description: "Owner-private hosted Cairn memory tools",
  configSchema: buildJsonPluginConfigSchema(configSchema),
  register(api) {
    for (const schema of toolSchemas) api.registerTool({ contextVersion: 2,
      create(context) {
        if (context.memoryAudience?.kind !== "owner-private") return null;
        return { ...schema, workspaceAccess: false,
          async execute(_toolCallId, params, signal) {
            let details;
            try {
              // Read the current runtime view, where OpenClaw has materialized the declared file SecretRef.
              const current = context.getRuntimeConfig();
              const config = current.plugins?.entries?.[PLUGIN_ID]?.config;
              const client = createHostedClient({ endpoint: config?.endpoint ?? DEFAULT_ENDPOINT, token: config?.token });
              details = await client.call(schema.name, params, context, signal);
              if (details.ok) {
                context.assertInvocationCurrent();
                context.assertMemoryAudienceCurrent?.();
                signal?.throwIfAborted();
              }
            } catch { details = failure("cairn_transport_failed", true); }
            return { content: [{ type: "text", text: details.ok && schema.name === "cairn_recall_memory" ?
              details.value.text : JSON.stringify(details) }], details };
          },
        };
      },
    }, { name: schema.name, optional: true });
    api.registerCli(({ program }) => {
      program.command("cairn").description("Configure hosted Cairn memory")
        .command("setup").description("Validate and save a memory-only credential")
        .option("--active-memory-timeout-ms <ms>", "Active Memory recall-work budget (default 5000 ms)")
        .action(async (options) => {
          if (!await runSetup(api, { ...(options.activeMemoryTimeoutMs === undefined ? {} :
            { timeoutMs: Number(options.activeMemoryTimeoutMs) }) })) throw new Error("Cairn setup did not complete.");
        });
    }, { descriptors: [{ name: "cairn", description: "Configure hosted Cairn memory", hasSubcommands: true }] });
  },
});

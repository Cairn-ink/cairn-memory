# Installed local MCP 0.6.11

The JSON fixture records the installer package's bundled engine, installed with scripts disabled. The client executes the registered vector from `packages/setup/lib/local-descriptor.mjs:146–151` at `installer-v0.6.11` with an absolute scratch database path and synthetic owner and project. The Linux entry selects the local daemon through `packaging/bin/cairn-memory.mjs:25–39`. Its vector enables default Context Read, Raw and Raw Search at `adapters/mcp/local-daemon-identity.mjs:49–52`. The database reports physical layout 29 after the daemon closes.

The source registration order comes from `adapters/mcp/server.mjs:401–404` and `adapters/mcp/context-read-tools.mjs:42,48,75`, followed by the unconditional registrations in `adapters/mcp/server.mjs:513,632,644,655,659`. The JSON stores the eight corresponding `tools/list` entries in live wire order. The default vector leaves capture qualification, standalone source snapshots, recovery, episodes and Cards disabled. There are no separate Raw discovery or import tools in this profile. Context Read still carries the installed Raw-aware contract.

The transcript includes initialization, ping, eight schema errors, JSON-RPC method and tool errors, and tool calls on empty, populated, corrected and forgotten data. Each tool has a successful call or its installed keyless outcome. Valid legacy `recall_memory` requests return `model_not_configured`. The successful keyless recall path uses `find_memory_candidates` and `read_memory_context`. Semantic opt-in errors, foreign evidence refs, stale snapshots and stale write revisions are recorded explicitly. The schema errors carry SDK text, while domain failures carry a JSON error envelope in the text block. Context assembly can also return diagnostics in MCP metadata.

## Normalization

- The transcript omits the fixed JSON-RPC version and the echoed request ID. Requests are kept with their matching responses. The initialization notification precedes ping.
- UUIDs under `id`, `memoryId`, `receiptId` and `eventId` use numbered placeholders that preserve equality across requests and responses. ISO values under `createdAt` and `updatedAt` use `<timestamp>`.
- Issued 43-character snapshots and content identities and eight-character compact-reference fences use numbered placeholders by value and field family. Invalid caller-supplied values remain literal.
- Numeric timings under `trace.timings` and `trace.maintenance`, and numeric work counters under `trace.maintenance` such as row writes and journal bytes, become zero. Field presence and type are preserved. Counters elsewhere, ranking, coverage and budget ceilings remain literal.
- Compare `indexRevision` as a per-owner sequence. A run that changes the index advances the revision once, and a run that leaves the index unchanged keeps the previous revision. The starting revision may vary by store. Memory and receipt revision values remain literal.
- The assembly budget's `used` count includes generated identifiers in the text block. When normalizing changes that block, `<tokens-in-wire-text>` stands for the independently checked `o200k_base` count of the exact original block. For unchanged blocks the count stays literal.

The installed engine yielded byte-identical normalized transcripts on Node 22.16.0 and 24.22.1.

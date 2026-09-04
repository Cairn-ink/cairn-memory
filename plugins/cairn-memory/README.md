# Cairn.ink Memory for Claude Code

Cross-session memory that keeps receipts. This plugin recalls relevant private context before a prompt and captures durable user/assistant conversation context after a turn. It does not read or upload file contents, tool results, terminal output, filesystem paths, or repository names.

## Install

1. Create a personal access token in Cairn.ink settings.
2. Add the `Cairn-ink/cairn-memory` marketplace.
3. Install `cairn-memory@cairn-memory` and supply the endpoint and token when prompted.

See the repository README for exact commands, privacy guarantees, and local development.

The plugin has no npm dependencies. It needs the Node.js runtime already required by Claude Code. The bundled Cairn MCP server also exposes explicit `remember_memory`, `recall_memory`, and `forget_memory` tools.

## Privacy controls

- Automatic capture starts only after explicit plugin installation and is on by default.
- Only textual user and assistant message blocks are allowlisted.
- Common credential shapes are replaced locally with `[REDACTED]` before any request.
- Project paths are hashed locally into an opaque scope id.
- `/cairn-memory:pause` and `/cairn-memory:resume` control automatic capture and recall.
- `/cairn-memory:status` reports state without printing the credential.
- Content-free telemetry can be disabled in plugin configuration. Its schema accepts only event name, plugin version, platform, and a random installation id.

Hooks fail open: timeouts, auth errors, and service outages never block normal Claude Code work. See the repository security policy before reporting a possible privacy issue.

# Cairn.ink Memory for Claude Code

Cross-session memory that keeps receipts. This plugin recalls relevant private context before a prompt and captures durable user/assistant conversation context after a turn. It reads the Claude-provided transcript path and working directory only to process the transcript and derive an opaque project id. It does not read arbitrary project files and excludes tool-result/tool-use blocks. Ordinary conversation text, including pasted files, terminal output, paths, or repository names, can still be sent to the configured service.

## Install

1. Create a personal access token in Cairn.ink settings.
2. Add the `Cairn-ink/cairn-memory` marketplace.
3. Install `cairn-memory@cairn-memory` and supply the endpoint and token when prompted.

See the repository README for exact commands, privacy guarantees, and local development.

The plugin has no npm dependencies. It needs the Node.js runtime already required by Claude Code. The bundled Cairn MCP server also exposes explicit `remember_memory`, `recall_memory`, and `forget_memory` tools.

## Privacy controls

- Automatic capture starts only after explicit plugin installation and is on by default.
- Only textual user and assistant message blocks are allowlisted.
- Supported credential shapes are replaced locally with `[REDACTED]` in capture text and automatic recall queries before transmission; unrecognized secrets may remain.
- Automatic recall sends the redacted current prompt, bounded to the protocol query limit, to the configured service.
- Project paths are hashed locally into an opaque scope id.
- `/cairn-memory:pause` and `/cairn-memory:resume` control automatic capture and recall.
- `/cairn-memory:status` reports state without printing the credential.
- Remote endpoints require HTTPS; plain HTTP is accepted only on explicit loopback hosts for local development.
- Content-free telemetry can be disabled in plugin configuration. Its schema accepts only event name, plugin version, platform, and a random installation id.

Hooks fail open: timeouts, auth errors, and service outages never block normal
Claude Code work. Explicit pause/resume commands report control failures rather
than claiming success. After resume, each session's first capture hook skips its
current unprocessed history; later complete messages are eligible. Requests
already started before pause may still finish.

Capture is handed to a detached worker so it survives both interactive sessions
and `claude -p` teardown without delaying Claude's response. The launcher pipes
only session id, transcript path, working directory, and a content-free control
generation directly to the worker; it does not use a queue file or enlarge the
worker environment. See the repository security policy before reporting a
possible privacy issue.

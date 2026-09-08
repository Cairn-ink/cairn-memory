# Self-hosting compatibility

The released v0.1 hosted client and the local developer preview are different
installation modes. The preview now includes the public SQLite memory core,
injected capture/MOC/recall orchestration, an optional OpenAI model adapter and
a thin stdio MCP host. [Build and install the local archive](install-artifact.md)
without a Cairn account; model-backed operations require explicit provider
configuration. The archive has not been published to npm, and source-support
quality still fails the frozen evaluation.

This local stdio process is **not** the HTTP service expected by the existing
Claude Code automatic-capture plugin. There is no remote HTTP/OAuth host in this
preview. Fully local model processing and general named-client compatibility
remain unverified; local storage does not mean that configured cloud-model
processing stays on-device.

You can point the plugin at a compatible endpoint through `api_endpoint`. That service must provide:

- authenticated `POST /api/memory/capture` and `POST /api/memory/recall`;
- an HTTP MCP server at `/api/mcp` with the three memory tools;
- optional `POST /api/memory/telemetry`, which may simply return `204`;
- owner and project-scope isolation;
- idempotent capture and atomic Memory/Source Receipt persistence;
- strict request validation and server-side redaction.

Remote endpoints must use HTTPS so the plugin credential and memory content are encrypted in transit. Plain HTTP is accepted only for explicit loopback hosts (`localhost`, `127.0.0.1`, or `[::1]`) during local development; URLs containing credentials, query strings, or fragments are rejected.

Use the JSON Schemas in `schemas/` and the semantics in `docs/protocol.md`. Passing schema validation alone is not sufficient: ownership, idempotency, provenance, and fail-open behavior are semantic requirements.

The next milestones complete source-support quality, independently reproducible
onboarding and native host adapters. Until those gates pass,
describing this repository as a complete self-hosted Mem0/Supermemory replacement
would be misleading.

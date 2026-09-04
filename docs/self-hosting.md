# Self-hosting compatibility

Version 0.1 publishes the client, payload schemas, and service compatibility contract. It does **not** yet publish a turnkey extraction, database, authentication, or MCP server stack.

You can point the plugin at a compatible endpoint through `api_endpoint`. That service must provide:

- authenticated `POST /api/memory/capture` and `POST /api/memory/recall`;
- an HTTP MCP server at `/api/mcp` with the three memory tools;
- optional `POST /api/memory/telemetry`, which may simply return `204`;
- owner and project-scope isolation;
- idempotent capture and atomic Memory/Source Receipt persistence;
- strict request validation and server-side redaction.

Remote endpoints must use HTTPS so the plugin credential and memory content are encrypted in transit. Plain HTTP is accepted only for explicit loopback hosts (`localhost`, `127.0.0.1`, or `[::1]`) during local development; URLs containing credentials, query strings, or fragments are rejected.

Use the JSON Schemas in `schemas/` and the semantics in `docs/protocol.md`. Passing schema validation alone is not sufficient: ownership, idempotency, provenance, and fail-open behavior are semantic requirements.

The roadmap includes a small reference adapter after hosted dogfood proves the contract. Until then, describing this repository as a complete self-hosted Mem0/Supermemory replacement would be misleading.

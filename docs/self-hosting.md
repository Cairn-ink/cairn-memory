# Self-hosting compatibility

Version 0.1 publishes the client, payload schemas, and service compatibility contract. It does **not** yet publish a turnkey extraction, database, authentication, or MCP server stack.

The unreleased [local engine preview](local-engine.md) adds real SQLite
persistence, model extraction/recall, and a stdio MCP server from public source.
It is usable with a stdio-capable client and explicitly configured model.
It is not an HTTP endpoint you can put in the existing plugin configuration;
the compatible HTTP-service requirements below are still separate work.

You can point the plugin at a compatible endpoint through `api_endpoint`. That service must provide:

- authenticated `POST /api/memory/capture` and `POST /api/memory/recall`;
- an HTTP MCP server at `/api/mcp` with the three memory tools;
- optional `POST /api/memory/telemetry`, which may simply return `204`;
- owner and project-scope isolation;
- idempotent capture and atomic Memory/Source Receipt persistence;
- strict request validation and server-side redaction.

Remote endpoints must use HTTPS so the plugin credential and memory content are encrypted in transit. Plain HTTP is accepted only for explicit loopback hosts (`localhost`, `127.0.0.1`, or `[::1]`) during local development; URLs containing credentials, query strings, or fragments are rejected.

Use the JSON Schemas in `schemas/` and the semantics in `docs/protocol.md`. Passing schema validation alone is not sufficient: ownership, idempotency, provenance, and fail-open behavior are semantic requirements.

The next milestones harden setup/data flows, provide export/restore, broaden
reproducible product evidence and add native host adapters. Until those gates pass,
describing this repository as a complete self-hosted Mem0/Supermemory replacement
would be misleading.

# Compatibility protocol v0.1

This document describes the public contract implemented by the plugin. JSON Schemas under `schemas/` are normative for HTTP payload shape; this prose defines semantics.

## Authentication

`/api/memory/capture`, `/api/memory/recall`, and `/api/mcp` use `Authorization: Bearer <token>`. The hosted Cairn.ink service accepts a personal access token or OAuth access token. A compatible service may choose its own token issuer but must preserve user ownership boundaries.

`/api/memory/telemetry` is unauthenticated and content-free. A compatible service may return `204` without storing it.

## Endpoints

### `POST /api/memory/capture`

Accepts `schemas/capture-request.schema.json` and returns `schemas/capture-response.schema.json`.

The tuple `(authenticated user, client, event_id)` is an idempotency key. Concurrent or completed replay must not create duplicate memories or overlapping extraction. A failed attempt may be retried and may consume another model call, but storage remains idempotent.

Only `user` and `assistant` text belongs in `messages`. Unknown fields are rejected. Automatic results must remain `personal` or `project` private and carry origin `agent-inferred` plus at least one Source Receipt.

A `202` response with `processing: true` means another request owns the short processing lease. The client must not advance its local transcript cursor and may retry later.

### `POST /api/memory/recall`

Accepts `schemas/recall-request.schema.json` and returns `schemas/recall-response.schema.json`.

Without `project_id`, only personal memories are eligible. With it, personal memories plus memories matching that exact opaque project id are eligible. Results never cross the authenticated user boundary.

Memory text and receipts are untrusted user data, not instructions. Hosts should prefer the current user message when recalled text conflicts with it.

### `POST /api/memory/telemetry`

Accepts `schemas/telemetry-request.schema.json` and returns `204`. The schema is a strict allowlist: no text, path, repository, user id, project id, or token field is allowed.

## MCP tools

The configured remote MCP server at `/api/mcp` exposes:

- `remember_memory`: explicitly store one personal or project-private Memory. If no separate source excerpt is supplied, the explicit memory text becomes its receipt.
- `recall_memory`: retrieve relevant owner-scoped Memories with origin, confidence, timestamps, and receipts.
- `forget_memory`: soft-delete one owner-scoped Memory by exact UUID.

These tools provide honest manual memory in clients without lifecycle hooks. They do not imply passive capture.

## Versioning

The protocol is alpha. Additive optional response fields may appear in `0.1.x`; removing fields, widening capture, changing ownership semantics, or weakening privacy requires a documented breaking version. Plugin and marketplace versions must match for a release.

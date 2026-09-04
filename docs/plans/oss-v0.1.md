# Cairn Memory OSS v0.1 acceptance contract

Status: implementation candidate

## Outcome

The repository is a professional, independently understandable distribution surface for a lightweight Claude Code memory layer. It is the sole source of truth for client/plugin behavior and public protocol contracts; it does not contain or pretend to contain the Cairn.ink hosted backend.

## Acceptance gates

- The repository can be added as a Claude Code marketplace and the bundled plugin validates with the pinned validation tool.
- A fresh reader can install, configure, pause, resume, inspect status, test locally, and report a vulnerability without reading the private application repository.
- The plugin has no runtime package dependencies and supports Node.js 20 and 22.
- Automated tests prove transcript allowlisting, local secret redaction, non-reversible project ids, stable capture ids, and fail-open recall.
- Public JSON Schemas cover capture, recall, telemetry, and their responses with `additionalProperties: false` wherever privacy depends on an allowlist.
- The documented hosted/private boundary matches reality. Self-hosting guidance states that v0.1 publishes a compatibility contract, not a turnkey hosted-service clone.
- No private source, credentials, internal operational paths, customer data, or unrelated Cairn product material enter the repository.
- The private application PR removes its duplicate plugin copy and points to this repository as the plugin source of truth.

## Release boundary

The staging repository remains private while this PR is under review. After approval and merge, make the repository public, create the `v0.1.0` tag, and run a real two-session dogfood before promotion.

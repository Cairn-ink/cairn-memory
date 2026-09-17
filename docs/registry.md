# MCP Registry listing

`server.json` at the repository root describes this server for the
[official MCP Registry](https://registry.modelcontextprotocol.io). Aggregators
such as mcp.so, the GitHub MCP Registry, Glama and PulseMCP read from it, so one
correct entry is what makes the server discoverable in all of them.

## What the entry lists today

- **Name:** `io.github.cairn-ink/cairn-memory`. GitHub-based authentication
  fixes the namespace to `io.github.<org>/*`.
- **Remote:** the hosted endpoint `https://cairn.ink/api/mcp` over
  Streamable HTTP. It answers unauthenticated requests with a `WWW-Authenticate`
  challenge and OAuth resource metadata, so OAuth-capable clients discover
  authentication on their own; other clients send a personal access token as a
  Bearer header. The remote exposes the hosted tool set, including the explicit
  memory tools.
- **No package yet.** A `packages` entry for a local install can only be added
  after the npm package exists and carries `"mcpName": "io.github.cairn-ink/cairn-memory"`
  in its `package.json`; the registry verifies npm ownership through that field.
  The bare npm name `cairn-memory` belongs to someone else, so the package will be
  published under a scope.

## Validate locally

```sh
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
./mcp-publisher validate
```

## Who can publish

Publishing under `io.github.cairn-ink/*` requires the GitHub account to be an
**Owner** of the Cairn-ink organization; ordinary membership is not enough. The
first publish should be done by hand by an Owner:

```sh
./mcp-publisher login github
./mcp-publisher publish
```

After that, the `Publish to MCP Registry` workflow republishes on every `v*`
tag using GitHub OIDC. Bump `version` in `server.json` with each tag; the
registry rejects a version that already exists.

## When the npm package ships

1. Add `"mcpName": "io.github.cairn-ink/cairn-memory"` to the published package.
2. Add a `packages` entry to `server.json` with `registryType: "npm"`, the scoped
   identifier, the version, and a `stdio` transport.
3. Bump `version`, tag, and let the workflow publish.

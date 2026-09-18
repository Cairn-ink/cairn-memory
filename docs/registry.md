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

`scripts/install-mcp-publisher.sh` downloads a pinned `mcp-publisher` release
and checks it against the release's published checksums before extracting it:

```sh
sh scripts/install-mcp-publisher.sh
./mcp-publisher validate
```

## Who can publish

Publishing under `io.github.cairn-ink/*` requires the GitHub account to be an
**Owner** of the Cairn-ink organization; ordinary membership is not enough. The
first publish is a manual step by an Owner:

```sh
./mcp-publisher login github
./mcp-publisher publish
```

The `Publish to MCP Registry` workflow runs only when someone dispatches it by
hand; it is not tied to tags or pushes. Listing the server exposes it on the
public registry and its aggregators, and `ROADMAP.md` has not cleared broad
promotion, so that decision stays with a person. When the gate is lifted, add a
`push: tags: ["v*"]` trigger to the workflow. Bump `version` in `server.json`
before each publish; the registry rejects a version that already exists.

## When the npm package ships

1. Add `"mcpName": "io.github.cairn-ink/cairn-memory"` to the published package.
2. Add a `packages` entry to `server.json` with `registryType: "npm"`, the scoped
   identifier, the version, and a `stdio` transport.
3. Bump `version`, tag, and let the workflow publish.

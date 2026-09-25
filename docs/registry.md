# MCP Registry listing

`server.json` at the repository root describes this server for the
[official MCP Registry](https://registry.modelcontextprotocol.io). Aggregators
such as mcp.so, the GitHub MCP Registry, Glama and PulseMCP read from it, so one
correct entry is what makes the server discoverable in all of them.

## What the entry lists today

- **Name:** `ink.cairn/memory`. Its namespace, `ink.cairn`, is the reverse-DNS
  form of cairn.ink, and DNS authentication on that domain grants it.
- **Remote:** the hosted endpoint `https://cairn.ink/api/mcp` over
  Streamable HTTP. It answers unauthenticated requests with a `WWW-Authenticate`
  challenge and OAuth resource metadata, so OAuth-capable clients discover
  authentication on their own; other clients send a personal access token as a
  Bearer header. The remote exposes the hosted tool set, including the explicit
  memory tools.
- **No package yet.** A `packages` entry for a local install can only be added
  after the npm package exists and carries `"mcpName": "ink.cairn/memory"`
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

The registry grants `ink.cairn/*` through DNS authentication: a TXT record at
the cairn.ink apex, not under a subdomain, in the form
`v=MCPv1; k=ed25519; p=<base64 public key>`. `dig +short TXT cairn.ink` shows
it among the apex's other TXT records. The matching private key is the
`MCP_REGISTRY_PRIVATE_KEY` Actions secret, which holds the hex of the 32-byte
Ed25519 seed. Anyone who can dispatch the workflow can therefore publish; no
GitHub organization role is involved.

To publish by hand from the machine that holds the private key file `key.pem`,
install and validate as above, then run:

```sh
MY_DOMAIN="cairn.ink"
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
./mcp-publisher login dns --domain "${MY_DOMAIN}" --private-key "${PRIVATE_KEY}"
./mcp-publisher publish
```

`PRIVATE_KEY` is the value the secret holds. Keep `key.pem` out of the
repository.

To rotate the key:

1. Generate a new pair and print its TXT record (OpenSSL 3 or later):

   ```sh
   MY_DOMAIN="cairn.ink"
   openssl genpkey -algorithm Ed25519 -out key.pem
   PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
   echo "${MY_DOMAIN}. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
   ```

2. Replace the `v=MCPv1` record at the cairn.ink apex with the printed one,
   leaving the other TXT records in place.
3. Replace the `MCP_REGISTRY_PRIVATE_KEY` secret with the new `PRIVATE_KEY`,
   derived as above.
4. Remove the old `v=MCPv1` record if it is still there. The registry accepts a
   signature from any `v=MCPv1` record at the apex, so a record left behind
   keeps the old key able to publish.

The `Publish to MCP Registry` workflow runs only when someone dispatches it by
hand; it is not tied to tags or pushes. Listing the server exposes it on the
public registry and its aggregators, and `ROADMAP.md` has not cleared broad
promotion, so that decision stays with a person. When the gate is lifted, add a
`push: tags: ["v*"]` trigger to the workflow. Bump `version` in `server.json`
before each publish; the registry rejects a version that already exists.

## When the npm package ships

1. Add `"mcpName": "ink.cairn/memory"` to the published package.
2. Add a `packages` entry to `server.json` with `registryType: "npm"`, the scoped
   identifier, the version, and a `stdio` transport.
3. Bump `version`, tag, and let the workflow publish.

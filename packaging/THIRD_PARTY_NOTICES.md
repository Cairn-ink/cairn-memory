# Third-party dependencies

This archive contains Cairn source under the included Apache-2.0 LICENSE, not
vendored dependency code. Local npm installation retrieves these exact packages:

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @modelcontextprotocol/server | 2.0.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| @modelcontextprotocol/core | 2.0.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| zod | 4.5.4 | MIT | https://github.com/colinhacks/zod |
| tiktoken | 1.0.22 | MIT | https://github.com/dqbd/tiktoken |

The generated npm-shrinkwrap.json pins the production closure's registry URLs
and integrity values from this repository's reviewed adapter lockfiles. The SDK
and Zod dependency directories retain their upstream license notices. The
tiktoken 1.0.22 npm archive has MIT package metadata but omits a standalone
license file, so this artifact includes `licenses/tiktoken-LICENSE`, copied
from its registry-reported gitHead:
https://github.com/dqbd/tiktoken/blob/4c8b748e07992c00386f3180af5c574b27b65139/LICENSE .
The official MCP
SDK client is contributor test tooling and is not a production dependency.
The tiktoken WASM binary and ranks ship in its npm archive: no postinstall
download is required. Tiktoken is third-party software, not an OpenAI SDK.

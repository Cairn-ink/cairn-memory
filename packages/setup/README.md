# @cairn-ink/memory

One-command setup of the Cairn Memory **Claude Code plugin** and its automatic
capture/recall hooks. Node ≥22.16 and `claude` on PATH are required.
The installer has no runtime dependencies. Other clients use the MCP connector.

安裝 Cairn Memory 的 Claude Code 外掛與自動擷取、回憶 hooks。
需要 Node ≥22.16，以及 PATH 裡的 `claude`，沒有 runtime dependencies。
其他工具使用 MCP connector。

## Setup / 安裝

**Installer 0.1.0 is published; 0.2.0 in this checkout awaits publication by chichi.**
The installer version is independent of the installed plugin version (currently
0.3.1). Setup prints both, reading the installed version from Claude Code.

**安裝器 0.1.0 已發布，這份原始碼的 0.2.0 等待 chichi 發布。**
安裝器與外掛是兩個版本，外掛目前為 0.3.1；setup 會分別顯示，外掛版本由
Claude Code 的安裝狀態讀取。

```sh
# Published installer / 已發布的安裝器
npx @cairn-ink/memory setup
# Browser authorization in this checkout / 這份原始碼的瀏覽器授權
node packages/setup/bin/memory.mjs setup
```

Setup checks CLI capabilities, refreshes an existing marketplace (or adds it),
then updates installed plugins at their explicit user/project/local scopes. Project/local-only installs are
updated and supplemented with a user-scope install. A disabled
plugin remains disabled; enable it in `/plugin` before pairing.

安裝器先檢查 CLI 功能，更新既有 marketplace，再更新已安裝的外掛；第一次使用
則加入 marketplace 並以 user scope 安裝。停用中的外掛會提示到 `/plugin` 啟用。

In a TTY, confirm the endpoint, compare the displayed code, and enter it on the
bare `/device` page. Sign in and allow the request. The code lasts at most ten
minutes. Setup polls, checks the received credential, sends endpoint and token
together through `claude plugin configure --values-stdin`, and acknowledges
successful delivery. It prints the credential's expiry date (180 days for a new
browser grant). The browser never receives the token.

在互動終端機確認 endpoint 後，開啟 `/device`，輸入終端機顯示的代碼，登入並
允許授權。代碼最多有效 10 分鐘。setup 取得憑證並驗證後，把 endpoint 與 token
一起經 stdin 交給 Claude Code 保存，再確認交付，最後顯示到期日。
瀏覽器授權的新憑證有效 180 天，瀏覽器不會拿到 token。

```sh
node packages/setup/bin/memory.mjs setup --no-browser
node packages/setup/bin/memory.mjs setup --manual-token
node packages/setup/bin/memory.mjs setup --reauthorize
node packages/setup/bin/memory.mjs setup --dry-run
node packages/setup/bin/memory.mjs status
```

- `--no-browser`: display the URL/code and open the page yourself, including on
  another device. Still requires a TTY.
- `--manual-token`: use the hidden PAT prompt, checking it before saving.
- `--reauthorize`: replace an existing credential. Without it, complete endpoint
  and token configuration is preserved. New authorization always confirms the
  endpoint and writes both values together.
- `--dry-run`: only capability and local state queries. No API, browser, grant,
  prompt or mutation; skips the potentially networked `mcp get` command.

`--no-browser` 仍需互動式 TTY，可在手機或其他電腦開頁面。`--manual-token` 保留
隱藏 PAT 輸入。既有完整設定預設保留，要換發時加上 `--reauthorize`。
`--dry-run` 不連網、不建立代碼、不寫設定。

If only a token is configured, setup keeps it and asks you to complete the
endpoint through `/plugin configure`, or explicitly use `--reauthorize`.
已有 token 但缺少 endpoint 時會保留憑證，提示補齊設定或明確重新授權。

## Compatibility and failures / 相容性與錯誤

Claude Code must support plugin installation/listing and secure
`configure --values-stdin` (available from 2.1.285; actual help is checked).
Non-TTY setup exits 2 without displaying a code. Unsafe/older CLIs stop before
creating a grant and show manual plugin instructions.

Create-route HTTP 404/501 clearly falls back to the hidden manual PAT prompt.
If the manual credential-check route also returns 404/501, configuration is
saved as **configured, not verified**. 5xx, TLS, proxy authentication, redirects,
and malformed responses never trigger manual downgrade. Polling retries
transient timeouts/5xx with bounded backoff and honors slow-down/rate limits.

伺服器 create route 回 404／501 時，會說明原因並改用隱藏 PAT 輸入；人工憑證
檢查也回 404／501 時，只顯示「已設定，尚未驗證」。5xx、TLS、proxy 認證、
redirect 與協定錯誤不降級。等待授權時會依伺服器 interval、限流與 backoff 重試。

Ctrl-C attempts cancellation and exits 130. Failed configuration attempts
cancellation before ACK. A lost ACK is retried with identical proof/receipt;
each attempt allows up to 15 seconds within the remaining monotonic window.
The window starts before the potentially issuing exchange, reserves one second
for server timestamp rounding, and is capped by the grant's remaining lifetime.
Server expiry timestamps are validated as metadata, never compared with the
client's wall clock. The server's credential check and ACK enforce expiry.
If delivery remains ambiguous, setup retains the saved configuration and reports
that delivery is unconfirmed. Wait 60 seconds, restart Claude Code, send a
message and run `/cairn-memory:status`. If rejected, inspect/revoke this credential
at the selected Cairn endpoint's `/settings/tokens`, then run
`npx @cairn-ink/memory setup --reauthorize`. Unreachable/unknown status does not
prove revocation; restore connectivity before deciding to replace the credential.
JavaScript strings cannot be zeroed in place: owned secret
references are dropped, and request/configuration buffers are zeroed.

Token/proof/receipt never enter arguments, environment, URLs, logs or
installer-owned files. Child stdout/stderr are never echoed. The token passes
only through memory, HTTPS bodies/headers and Claude Code stdin. Claude Code
owns sensitive `api_token` storage; security depends on it and the host.

Legacy MCP removal requires affirmative confirmation after complete plugin
configuration. Restart Claude Code and send a message before checking
`/cairn-memory:status`. Installer `status` reads only configured/unset metadata;
it does not read back a token or write the hook-owned credential-state. The
hook status fix is present in plugin 0.3.1 (release dependency).

## Proxy and CA / Proxy 與企業 CA

The installer implements `HTTP_PROXY` for HTTP destinations and `HTTPS_PROXY`
for HTTPS destinations using Node's HTTP, HTTPS and TLS APIs. Both HTTP and HTTPS proxy URLs work;
HTTPS destinations use CONNECT plus verified TLS. Optional Basic proxy
credentials stay on the proxy request, separate from destination credentials.
Lowercase aliases are accepted; uppercase takes precedence.
Loopback HTTP endpoints always connect directly, even without `NO_PROXY`.

`NO_PROXY` accepts comma-separated hosts, domain suffixes (with or without a
leading dot), optional ports, bracketed IPv6 hosts and `*`. CIDR, PAC, SOCKS and
OS proxy discovery are unsupported. Use Node's `NODE_EXTRA_CA_CERTS` before
starting the installer for a PEM enterprise CA file. TLS verification remains
enabled; there is no insecure option.

企業 CA 使用 Node 的 `NODE_EXTRA_CA_CERTS`，在啟動安裝器前指定 PEM 憑證檔。
TLS 驗證會保持開啟。Proxy 的支援範圍與 `NO_PROXY` 格式如上，不含 CIDR、PAC、
SOCKS 或系統 proxy 自動偵測。

Browser launch supports macOS `open`, Windows/WSL `rundll32.exe`, and Linux
`xdg-open`. On SSH/headless machines use `--no-browser`; failed browser launch
prints a manual link and continues polling. OS launch selection is covered by
simulated platform tests, not native Windows/macOS execution.

## Maintainer checks / 維護檢查

```sh
npm run test:setup
npm run validate
```

Tests use a contract fake HTTP server and fake `claude`, with synthetic secrets.
The test host needs OpenSSL for disposable certificate fixtures; the shipped
installer does not invoke it.
Node HTTP/TLS wire parsers run over duplex streams and subprocess IPC because
the restricted test environment cannot bind loopback TCP. No hosted service,
real browser approval or user credential is involved. See
[release checklist](../../docs/npx-setup-release.md) and
[verification limits](../../docs/limitations.md#setup-020-browser-authorization).

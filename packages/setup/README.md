# @cairn-ink/memory

One-command setup of the Cairn Memory **Claude Code plugin** and private automatic
capture hooks for format-qualified **Codex CLI / app-server**. Node ≥22.16 and the selected
CLI on PATH are required. No runtime dependencies. Codex prompt-recall injection
uses the A7-tested delivery format and is on for qualified hosts; turn it off with
`prompt-recall-off --client codex`. Recall is also available through MCP.

一次設定 Claude Code 外掛與格式合格 Codex CLI／app-server 的私有自動 capture hooks。
需要 Node ≥22.16，以及 PATH 裡的選定 CLI，沒有 runtime dependencies。
Codex prompt recall 注入已通過 A7 驗收，在格式合格的 host 預設開啟；可用 `prompt-recall-off --client codex` 關閉，也可透過 MCP recall。

## Setup / 安裝

**Installer 0.3.0 was published on 2026-10-10; this checkout's 0.4.0 awaits chichi.**
Plugin remains 0.3.2. Setup prints the installer and installed plugin versions.

**安裝器 0.3.0 已於 2026-10-10 發布，這份原始碼的 0.4.0 等待 chichi 核准。**
外掛維持 0.3.2，setup 會顯示實際安裝的外掛版本。

Version 0.4.0 detects both CLIs when `--client` is omitted. It shows each tool's
disclosure, asks once per qualified tool (Claude: `[Y/n]`; Codex: `[y/N]`), and
connects every agreed tool. With both agreed, the Codex question confirms stopped
hosts/workers and a shared identity. One browser grant supplies both clients;
the existing pairing transaction retains the project key without a separate
pairing prompt. Unqualified Codex is skipped cleanly while Claude can continue.
`--client claude|codex` restricts setup/status to one tool. Unscoped status reports
both, including absent CLIs; control commands retain per-client flags.

省略 `--client` 時，0.4.0 偵測兩個工具，逐一揭露並詢問。Claude 預設同意，Codex
必須明確同意；兩者都同意時，同一個 Codex 問題也確認 hosts／workers 已停止，
可共用 identity。只走一次瀏覽器授權，使用既有 pairing transaction 保留 key。
Codex 格式未合格會略過，Claude 可繼續。`status` 預設回報兩者。

Unscoped non-TTY setup never auto-consents or installs (exit 2 when a tool is
detected). Status/dry-run are prompt-free and remain available. Explicit per-client
flows keep their existing TTY/fallback rules. Browser credentials from this flow
are retained in `~/.cairn-memory-clients/setup-credential.json` (0700 parent, 0600
plaintext). Reruns validate the memory scopes/expiry with the credential API and
reuse a valid grant, including when adding the other tool. Broad PATs are never
imported into this cache or Codex hooks. A legacy Claude-only native secret that
has no portable installer copy is preserved by explicit `--client claude`; it
cannot be extracted from configure metadata to authorize another client.

非 TTY 的預設 setup 不會代為同意或安裝；有偵測到工具時 exit 2。
瀏覽器憑證會另存於上述私有明文檔，重跑先驗證 scopes 與到期日，再交給同意的工具。

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
bare `/device` page. Setup highlights the one-time code on its own line and
waits for Enter before opening the browser, keeping terminal focus until you
have read it. A short relative deadline replaces the absolute timestamp; the
waiting spinner repeats the code. The code lasts at most ten minutes. Setup polls, checks the received credential, sends endpoint and token
together through `claude plugin configure --values-stdin`, and acknowledges
successful delivery. It prints the credential's expiry date (180 days for a new
browser grant). The browser never receives the token.

在互動終端機確認 endpoint 後，開啟 `/device`，輸入終端機顯示的代碼，登入並
允許授權。代碼會獨立醒目顯示，按 Enter 後才開瀏覽器，避免切換視窗前沒看到代碼。
期限以相對時間顯示，等待授權時也會重複顯示代碼。代碼最多有效 10 分鐘。setup 取得憑證並驗證後，把 endpoint 與 token
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
- `--no-clipboard`: skip optional copying of the one-time device code. No effect
  on manual PAT/Codex pairing, which never copies a token.
- `--manual-token`: use the hidden PAT prompt, checking it before saving.
- `--reauthorize`: replace an existing credential. Without it, complete endpoint
  and token configuration is preserved. New authorization always confirms the
  endpoint and writes both values together.
- `--dry-run`: only capability and local state queries. No API, browser, grant,
  prompt or mutation; skips the potentially networked `mcp get` command.

`--no-browser` 仍需互動式 TTY，可在手機或其他電腦開頁面。`--manual-token` 保留
隱藏 PAT 輸入。既有完整設定預設保留，要換發時加上 `--reauthorize`。
`--dry-run` 不連網、不建立代碼、不寫設定。

The code uses bold cyan in a TTY; `NO_COLOR` (including an empty value) disables
that styling. Non-TTY output and no-color mode use brackets and extra spacing.
Setup optionally copies **only the public one-time code** using a fixed local
clipboard tool: `pbcopy` on macOS, `clip.exe` on Windows/WSL, `wl-copy` when a
Wayland display/runtime is present, or `xclip`/`xsel` with an X display. Missing,
failing or timed-out tools never fail authorization. SSH sessions skip automatic
clipboard copying, even with a forwarded display. Clipboard subprocesses receive
the code via stdin, use no shell, and never echo their output. Native clipboard
integration is tested with fake tools; no system clipboard or real token is used.

TTY 中以粗體青色突出代碼；`NO_COLOR` 或非 TTY 輸出改用方括號與空格。
有本機剪貼簿工具時，會自動複製一次性代碼並說明；缺少工具仍可繼續。
可用 `--no-clipboard` 略過，SSH 連線也會自動略過。PAT、token 與驗證資料不會複製。
`--no-browser` 只印出網址，略過 Enter 提示；仍需互動式 TTY。
等待 Enter 時，原本的授權期限照常計時，逾時或 Ctrl-C 會嘗試取消授權。

If only a token is configured, setup keeps it and asks you to complete the
endpoint through `/plugin configure`, or explicitly use `--reauthorize`.
已有 token 但缺少 endpoint 時會保留憑證，提示補齊設定或明確重新授權。

## Codex automatic capture / Codex 自動記憶

```sh
# Source 0.4.0; @latest has the published 0.3.0 single-client behavior
node packages/setup/bin/memory.mjs setup --client codex
node packages/setup/bin/memory.mjs status --client codex
node packages/setup/bin/memory.mjs setup --client codex --dry-run
node packages/setup/bin/memory.mjs pause --client codex
node packages/setup/bin/memory.mjs resume --client codex
node packages/setup/bin/memory.mjs disable --client codex
node packages/setup/bin/memory.mjs uninstall --client codex
```

On Linux/WSL with a qualified host format, setup installs SessionStart,
UserPromptSubmit, Stop and PreCompact in user `hooks.json`. It copies a hashed,
versioned runtime under `$CODEX_HOME/cairn` (default `~/.codex/cairn`), with 0700
directories and 0600 files, independent of the npx cache. Review/trust with
`/hooks`; setup uses no trust bypass. Unknown hosts with identical schema evidence are qualified and cached by binary identity; changed or pending formats never capture or recall. 0.161.0 matches the frozen 0.160.1 evidence. 0.162.0 adds `MessagePhase.partial_answer` and remains closed. Hooks detect the actual native CLI/app-server ancestor and never generate schemas inside the 2s budget. See [format evidence and gates](../../docs/codex-setup.md).

Hooks use device browser authorization. The memory-scoped credential is stored
as a private **0600 plaintext file, not a keyring**; it never enters Codex’s
config.toml, argv, environment or logs. Registered commands clear the inherited
environment before the first Node process; children also use a closed environment.
Saving/verification precedes delivery
ACK. There is no broad PAT fallback for hooks. `--manual-token` selects only
MCP PAT setup; MCP defaults to the offered `codex mcp login cairn` OAuth path.
Existing MCP credentials and unrelated settings/hooks are preserved.

Claude/Codex pairing adopts the existing project key after explicit stopped-host
consent and delivers only `pairing_record` to both configurations. New pairing
requires an enabled Cairn plugin `>=0.1.2 <1.0.0` (stable semver) with that configure
capability. Version 0.1.2 introduced the pairing contract; released 0.3.1 already qualifies.
A test binds compatibility to the current plugin metadata. Missing,
old or disabled plugins select Codex standalone with an explicit notice, without
changing Claude keys/settings or updating its marketplace. New Codex standalone always uses
`$CODEX_HOME/cairn-standalone`, preserving Claude's existing or future default
root. Existing successful bindings never
silently switch target on plugin removal/downgrade. Use the same account and
endpoint to share memory after pairing; standalone targets are separate. An unscoped rerun with both tools agreed adds Claude to the existing Codex standalone
key/root after stopped-host consent. If two independent keys already exist, setup
refuses the conflict. Explicit Codex-only reruns retain their existing binding and
target-retention guidance.

Only Codex workers consume the selected daily capture cap and concurrency 2.
Claude retains its existing capture/recall/controls and server quota; it does not
require Codex's enforced pause-state endpoint. Its status reports invalid policies
and actual last-observed shared-pause errors without failing controls. Fresh/unobserved and stale healthy observations do not trigger an endpoint alarm. No
policy means unchanged Claude status. Uninstall removes all Cairn hook commands
for this installation regardless of old node/runtime paths, plus its credential,
runtime and endpoint policy. MCP, identity/key (including standalone) and memory
remain. Uninstall also unpairs completed or pending pairing: clear Claude’s native pairing
option, remove Codex’s binding/shared record under the setup lock, and verify Claude remains
enabled on the same root/key. Recovery failure returns exit 1 with an explicit warning,
still removes Codex credential/installation, and can be retried after restoring the Claude
CLI without browser authorization. A private token-free recovery ownership receipt under
`~/.cairn-memory-clients/codex-uninstall-<installation hash>.json` supports retry and
prevents another CODEX_HOME from unpairing this installation; success removes it. Unsafe
policy paths are reported and skipped while credential/installation cleanup continues.
Failed reauthorization preserves the last successful installation.
Browser/candidate failure on first pairing leaves Claude identity untouched.
Partial native pairing delivery prints a pending notice; keep hosts/workers
stopped and rerun to finish the same identity.

Stop/PreCompact launch capture within 750 ms with no text or credential in the
handoff; hosted pause-state is fetched in the worker, outside the foreground
budget. Worker failures exit 0 and emit no logs. SessionStart establishes the
protocol 0.3.0 pause/resume EOF boundary. Prompt recall’s redaction, full receipt
framing, authority filter, 8,000-unit bound and single 2 s budget are tested, and
**automatic injection is on for format-qualified hosts using the A7-tested
delivery format** (`evaluation/codex-a7/RESULTS.md`). `prompt-recall-off` is its kill switch.
SessionStart context also needs a qualified local o200k counter. MCP recall is
available. Status reports registration/credential presence and last observed
hosted pause; it does not verify trust, server reachability or account parity.

0.3.0 已發布，這次 0.4.0 尚未發布。Codex 自動 capture、browser credential、私有 runtime 與共享
identity／控制已接線；prompt recall 注入已通過 A7 真實 host 驗收，格式合格的 host 預設開啟，
可用 `prompt-recall-off --client codex` 關閉。SessionStart 先建立 pause EOF boundary，
startup context 另待本機 tokenizer。使用前在 `/hooks` 檢閱並信任 handlers。
Hook 憑證是私有 0600 明文檔，與可選的 MCP PAT 分開；MCP 優先採用原生 OAuth。
新配對要求已安裝、啟用且相容的 Claude plugin `>=0.1.2 <1.0.0`，另驗證 pairing capability；`0.3.1` 已符合。缺少或不相容時改用 standalone，
不改 Claude key／設定、不停止 Codex 安裝。Standalone 尚未共用 target。兩個 client
配對後要使用同一帳號與 endpoint。本機每日 cap 只限制 Codex workers；Claude
capture、recall、pause／resume 維持既有行為，只在 status 顯示可用的 policy／gate 診斷。
Uninstall 同時 unpair（含 pending）、清空 Claude pairing option 並驗證原 identity 已恢復 enabled；不刪
memory、key 或 MCP。恢復失敗回傳 exit 1，仍移除 Codex credential／installation，恢復 CLI 後可重試。Unsafe policy
清除會略過並明說，不保留 credential。新外掛出現後 standalone rerun 會解釋保留 target 的原因與卸載後重新配對的步驟；本機 cap 提示明列僅限
Codex。

See [Codex evidence, gate table and recovery](../../docs/codex-setup.md).

## Endpoint and language / Endpoint 與語言

```sh
node packages/setup/bin/memory.mjs setup --reauthorize --endpoint https://auth.example.com --lang zh
node packages/setup/bin/memory.mjs status --lang en
```

`--endpoint <origin>` selects the authorization server before any API request. It
uses the same validation as the prompt: HTTPS, or HTTP on localhost/loopback,
without credentials, a path, query or fragment. It skips the endpoint prompt;
without the flag, new Claude authorization always asks and Enter selects
`https://cairn.ink`. Setup prints the selected origin and its source before
opening a browser or contacting the authorization service. Production with the
auth gate disabled still returns 404 and falls back to manual PAT input; use an
explicit endpoint to test a server with the gate enabled.

`--endpoint` 指定授權伺服器，驗證規則與互動提示相同。加上旗標後不再詢問 endpoint；
未指定時，Claude 的新授權一定會詢問，直接按 Enter 才選用 `https://cairn.ink`。
連線前會印出 origin 與來源，讓你確認目標。正式站未開啟授權功能時仍會回 404，
改用 PAT；測試其他伺服器時請明確指定 endpoint。

Complete Claude credentials are preserved unless `--reauthorize` is supplied.
The CLI exposes only configured/unset metadata, so the preserved-config line
honestly reports that the existing endpoint value is not read back and no auth
connection is made. `--endpoint` with a preserved credential requires
`--reauthorize`; it never attaches the old token to a new origin. New Claude
authorization does not infer an endpoint from presence metadata. Codex displays
its validated existing origin and refuses a conflicting `--endpoint`, preserving
its existing entry for explicit editing/removal in Codex.

既有 Claude 憑證預設保留。CLI 只提供設定有無，安裝器不讀回敏感設定，因此會明說
endpoint 沿用既有設定、值未讀回、本次不進行授權連線。要用 `--endpoint` 換發憑證，
請同時加 `--reauthorize`。Codex 可顯示既有設定中通過驗證的 origin；旗標與既有
origin 衝突時會停止，提示先在 Codex 明確修改或移除該設定。

Each invocation prints **one language**, including help, prompts, progress and
errors. Selection uses the first non-empty `LC_ALL`, then `LC_MESSAGES`, then
`LANG`, falling back to `Intl.DateTimeFormat().resolvedOptions().locale`.
A `zh*` locale selects Traditional Chinese (including `zh_CN`); all others,
including `C`, select English. `--lang zh|en` overrides that selection for either
client. Locale selection changes presentation only; error kinds and exit codes
stay the same. All installer messages live in `lib/messages.mjs`.

每次執行只顯示一種語言。依序讀取非空的 `LC_ALL`、`LC_MESSAGES`、`LANG`，
都未設定時使用 Intl 的系統 locale。`zh*` 一律顯示繁體中文，其餘顯示英文；
可用 `--lang zh` 或 `--lang en` 覆寫，Claude 與 Codex 都適用。錯誤種類與 exit code 不變。

The old endpoint prompt was written outside readline, then `question('')`
redrew an empty line in a TTY. Non-secret prompts now belong to readline, so
redraws retain the question; hidden PAT prompts still suppress every echo.

舊版先在 readline 外印出 endpoint 提示，再以空字串呼叫 `question`，TTY 重畫時
會清掉提示。現在一般提示由 readline 顯示與重畫，PAT 仍維持隱藏輸入。

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

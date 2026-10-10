// All user-facing installer text. Approved 0.5.0 copy with verified safety adjustments.
import { DEFAULT_ENDPOINT } from './constants.mjs';
export const messages = {
  "cap_pending": {
    "zh": "  新上限 {cap} 將於下次每日重置套用；Claude Code 不受影響。",
    "en": "  New limit {cap} takes effect at the next daily reset; Claude is unaffected."
  },
  "cap_pending_reached": {
    "zh": "  今天上限已達；新上限 {cap} 將於下次每日重置套用。",
    "en": "  Today's limit is reached; new limit {cap} applies at the next daily reset."
  },
  "cap_policy_conflict": {
    "zh": "每日上限與既有設定衝突，Codex 自動記憶已停用。",
    "en": "The daily limit conflicts with existing settings. Codex memory was disabled."
  },
  "host_format_status": {
    "zh": "{observed}{kind}：Codex {version}：格式已驗證",
    "en": "{observed}{kind}: Codex {version}: format qualified"
  },
  "last_observed_prefix": {
    "zh": "最近偵測到的 ",
    "en": "last observed "
  },
  "recall_per_host": {
    "zh": "只對已驗證的工具開啟",
    "en": "on for verified hosts only"
  },
  "clients_missing": {
    "zh": "找不到 Claude Code 或 Codex。\n" +
      "  沒有改動任何設定。\n" +
      "  先安裝一個工具：https://code.claude.com/docs/en/setup",
    "en": "Neither Claude Code nor Codex was found.\n" +
      "  Nothing was changed.\n" +
      "  Install a tool first: https://code.claude.com/docs/en/setup"
  },
  "client_missing": {
    "zh": "{client}：沒有安裝（找不到指令）",
    "en": "{client}: not installed (command not found)"
  },
  "clients_declined": {
    "zh": "好，這次沒有連接任何工具，也沒有改動任何設定。",
    "en": "OK. No tools were connected and nothing was changed."
  },
  "codex_setup_skipped": {
    "zh": "這個 Codex 版本還不支援自動記憶，這次只裝 Claude Code。\n" +
      "  Codex 更新後再執行一次 setup。",
    "en": "This Codex version does not support automatic memory. Only Claude Code is set up.\n" +
      "  Update Codex, then run setup again."
  },
  "authorization_shared": {
    "zh": "已交付本次瀏覽器授權，token 僅在此 run 的記憶體共用。",
    "en": "This run's browser authorization delivered; the token is shared in memory only."
  },
  "authorization_reused": {
    "zh": "✓ 沿用 Codex 的登入（有效到 {date}）",
    "en": "✓ Reusing Codex's sign-in (valid until {date})"
  },
  "credential_replaced": {
    "zh": "  舊的登入不會自動撤銷；不再使用的話，到 {url} 撤銷。",
    "en": "  The old sign-in is not revoked. Revoke it at {url}."
  },
  "codex_inspection_skipped": {
    "zh": "略過 Codex：{reason}\n" +
      "  Claude Code 照常安裝，Codex 沒有改動。\n" +
      "  修好後執行：\n" +
      "npx @cairn-ink/memory setup --client codex",
    "en": "Skipping Codex: {reason}\n" +
      "  Claude Code can continue. Codex is unchanged.\n" +
      "  After fixing it, run:\n" +
      "npx @cairn-ink/memory setup --client codex"
  },
  "codex_config_unsafe": {
    "zh": "Codex 設定檔權限不安全，或它是連結，所以沒有動它。",
    "en": "Codex settings have unsafe permissions or are a link. The file was not changed."
  },
  "authorization_endpoint_conflict": {
    "zh": "Claude Code 和 Codex 連到不同的 Cairn，無法共用記憶。",
    "en": "Claude Code and Codex use different Cairn servers and cannot share memory."
  },
  "authorization_delivered_endpoint_conflict": {
    "zh": "本次已交付登入，但另一個工具連到不同的 Cairn。",
    "en": "This run already delivered a sign-in, but the other tool uses a different Cairn."
  },
  "authorization_credential_unavailable": {
    "zh": "無法確認 Codex 原本的登入還能用。",
    "en": "Cannot confirm that the saved Codex sign-in is still usable."
  },
  "codex_windows_skipped": {
    "zh": "Windows 上的 Codex 還不支援自動記憶，這次只裝 Claude Code。\n" +
      "  要手動使用：\n" +
      "npx @cairn-ink/memory setup --client codex",
    "en": "Automatic memory is not supported for Codex on Windows yet.\n" +
      "  Only Claude Code is set up.\n" +
      "  For manual tools:\n" +
      "npx @cairn-ink/memory setup --client codex"
  },
  "authorization_manual_unsupported": {
    "zh": "--manual-token 只能用在單一工具。",
    "en": "--manual-token can only be used with a single tool."
  },
  "codex_fallback_disclosure": {
    "zh": "這個 Codex 版本還不支援自動記憶，只能加入 Cairn 工具手動存取記憶。",
    "en": "This Codex version supports only manual memory through the Cairn tools."
  },
  "connect_codex_mcp": {
    "zh": "? 加入 Cairn 工具到 Codex？ (y/N) ",
    "en": "? Add the Cairn tools to Codex? (y/N) "
  },
  "connect_claude": {
    "zh": "? 連接 Claude Code？ (Y/n) ",
    "en": "? Connect Claude Code? (Y/n) "
  },
  "connect_codex": {
    "zh": "? 連接 Codex？ (y/N) ",
    "en": "? Connect Codex? (y/N) "
  },
  "connect_codex_shared": {
    "zh": "? 連接 Codex，和 Claude Code 共用記憶？ (y/N) ",
    "en": "? Connect Codex and share Claude Code's memory? (y/N) "
  },
  "codex_format_pending": {
    "zh": "自動記憶暫停中：這個 Codex 版本（{version}）還沒驗證完。\n" +
      "  重新檢查：\n" +
      "npx @cairn-ink/memory status --client codex",
    "en": "Automatic memory is paused: Codex {version} has not been verified yet.\n" +
      "  Recheck:\n" +
      "npx @cairn-ink/memory status --client codex"
  },
  "codex_format_unavailable": {
    "zh": "自動記憶暫停中：無法驗證這個 Codex 版本（{version}）。\n" +
      "  重新檢查：\n" +
      "npx @cairn-ink/memory status --client codex",
    "en": "Automatic memory is paused: Codex {version} could not be verified.\n" +
      "  Recheck:\n" +
      "npx @cairn-ink/memory status --client codex"
  },
  "codex_format_changed": {
    "zh": "Codex {version} 改了對話格式，自動記憶先暫停，等 Cairn 更新後會恢復。",
    "en": "Codex {version} changed its transcript format. Automatic memory is paused\n" +
      "until Cairn is updated."
  },
  "codex_phase_failed": {
    "zh": "Codex 沒有安裝完成。",
    "en": "Codex setup did not finish."
  },
  "codex_host_unqualified": {
    "zh": "這個 Codex 版本還不支援自動記憶。\n" +
      "  更新 Codex 後再執行一次 setup。",
    "en": "This Codex version does not support automatic memory yet.\n" +
      "  Update Codex, then run setup again."
  },
  "codex_browser_required": {
    "zh": "這個 Cairn 伺服器還不支援瀏覽器登入，Codex 自動記憶需要它。\n" +
      "  請先更新伺服器的登入功能，再執行一次 setup。",
    "en": "This Cairn server does not support the browser sign-in Codex memory needs.\n" +
      "  Update the server to support browser sign-in, then run setup again."
  },
  "codex_hooks_status": {
    "zh": "  {state}",
    "en": "  {state}"
  },
  "codex_runtime_version": {
    "zh": "安裝器 {version}；本機 Codex {host}",
    "en": "Installer {version}; local Codex {host}"
  },
  "codex_hosted_pause_status": {
    "zh": "  · Cairn 帳號端：{state}（上次看到的狀態）",
    "en": "  · Cairn account: {state} (last observed)"
  },
  "codex_hooks_trust": {
    "zh": "  請確認已在 Codex 的 /hooks 允許 Cairn 的 4 個項目（這裡無法檢查）。",
    "en": "  Make sure the 4 Cairn entries are allowed in Codex /hooks (not checked here)."
  },
  "codex_hooks_policy": {
    "zh": "  · 記憶：{pause}{shared}\n" +
      "  · 今日 {used} / {cap}",
    "en": "  · Memory: {pause}{shared}\n" +
      "  · Today {used} / {cap}"
  },
  "codex_hooks_dry": {
    "zh": "預演：安裝私有版本 runtime 與 user hooks.json；browser credential 存於 cairn/credential.json（0600）；MCP 預設 OAuth。",
    "en": "Dry run: private versioned runtime and user hooks.json; browser credential in cairn/credential.json (0600); MCP defaults to OAuth."
  },
  "codex_hooks_ready": {
    "zh": "✓ Codex 自動記憶已安裝",
    "en": "✓ Codex automatic memory installed"
  },
  "codex_hook_plaintext": {
    "zh": "  Codex 的登入資訊存在只有你能讀的檔案裡，沒有加密。",
    "en": "  Codex keeps this sign-in in a file only you can read. It is not encrypted."
  },
  "codex_standalone_kept": {
    "zh": "Codex 目前用自己的記憶，這次不改，避免舊記憶對不上。\n" +
      "  要共用：關閉兩個工具，執行 uninstall --client codex，再執行 setup。",
    "en": "Codex keeps its own memory so existing project memories remain addressable.\n" +
      "  To share: close both tools, run uninstall --client codex, then setup."
  },
  "codex_unpair_failed": {
    "zh": "✗ Codex 已移除，但無法確認 Claude Code 已恢復成單獨使用。\n" +
      "  Codex 的登入和設定已刪除；Claude Code 的記憶身分沒有改動。\n" +
      "  保持兩個工具關閉，確認 claude 指令能執行後，再跑一次：\n" +
      " \n" +
      "npx @cairn-ink/memory uninstall --client codex",
    "en": "✗ Codex was removed, but Claude Code's standalone setup couldn't be confirmed.\n" +
      "  Codex's sign-in and settings were deleted. Claude Code's memory ID is kept.\n" +
      "  Keep both tools closed, make sure the claude command runs, then run again:\n" +
      " \n" +
      "npx @cairn-ink/memory uninstall --client codex"
  },
  "codex_policy_cleanup_unsafe": {
    "zh": "有一個 Cairn 設定檔權限不安全，沒有刪它；其他都已移除。",
    "en": "An optional Cairn settings file is unsafe and was kept. The rest was removed."
  },
  "codex_standalone": {
    "zh": "Claude Code 外掛無法共用，Codex 會用自己的記憶。",
    "en": "The Claude Code plugin cannot share memory. Codex uses its own memory."
  },
  "codex_pairing_pending": {
    "zh": "  兩個工具的記憶連結做到一半。請保持 Claude Code 和 Codex 關閉。",
    "en": "  Memory pairing is incomplete. Keep Claude Code and Codex closed."
  },
  "codex_existing_pair_kept": {
    "zh": "Claude Code 外掛目前無法確認，Codex 繼續用原本共用的記憶。",
    "en": "The Claude Code plugin cannot be checked. Codex keeps its shared memory."
  },
  "codex_shared_pause_availability": {
    "zh": "共用暫停開關最後觀察：{state}；Codex 需要伺服器強制執行，Claude 保留既有行為。",
    "en": "Shared pause gate last observation: {state}; Codex requires enforced state, Claude keeps existing behavior."
  },
  "codex_prompt_recall_status": {
    "zh": "  · 提問時找回記憶：{state}",
    "en": "  · Find memories when you ask: {state}"
  },
  "codex_startup_gate": {
    "zh": "SessionStart 建立暫停時的檔案結尾界線；啟動時的記憶注入尚未通過本機斷詞器與相關內容驗收，保持關閉。",
    "en": "SessionStart establishes the pause EOF boundary; startup context stays disabled pending a local tokenizer and sibling context acceptance."
  },
  "input_cancelled": {
    "zh": "已取消。",
    "en": "Cancelled."
  },
  "claude_manual": {
    "zh": "請在 Claude Code 裡依序輸入：",
    "en": "Run these commands inside Claude Code:"
  },
  "configuration_incomplete": {
    "zh": "Claude Code 的設定沒有存完整。\n" +
      "  在 Claude Code 輸入 /plugin configure cairn-memory@cairn-memory 補上。",
    "en": "Claude Code settings were not fully saved.\n" +
      "  Type /plugin configure cairn-memory@cairn-memory in Claude Code to complete them."
  },
  "help": {
    "zh": "用法：\n" +
      "npx @cairn-ink/memory <指令> [選項]\n" +
      "\n" +
      "常用指令：setup、status、pause、resume、uninstall、config\n" +
      "  --client claude|codex  只操作其中一個工具\n" +
      "  --endpoint URL        指定 Cairn 網址（預設 {defaultEndpoint}）\n" +
      "  --codex-daily-cap N    Codex 每日自動記憶上限（1–100000）\n" +
      "  --codex-capture-exec on|off  Codex 自動工作的記憶（預設 off）\n" +
      "  --verbose             顯示技術細節\n" +
      "  --lang zh|en          選擇語言\n" +
      "  --dry-run             只檢查，不改動\n" +
      "  --no-browser          自行開啟瀏覽器\n" +
      "  --no-clipboard        不複製一次性代碼\n" +
      "  --manual-token        手動貼上存取碼\n" +
      "  --reauthorize         重新登入\n" +
      "\n" +
      "修改上限：\n" +
      "npx @cairn-ink/memory config --codex-daily-cap 200\n" +
      "\n" +
      "  要關閉提問回想：\n" +
      "npx @cairn-ink/memory prompt-recall-off --client codex",
    "en": "Usage:\n" +
      "npx @cairn-ink/memory <command> [options]\n" +
      "\n" +
      "Commands: setup, status, pause, resume, uninstall, config\n" +
      "  --client claude|codex  Act on one tool only\n" +
      "  --endpoint URL        Cairn URL (default {defaultEndpoint})\n" +
      "  --codex-daily-cap N    Codex daily automatic memory limit (1-100000)\n" +
      "  --codex-capture-exec on|off  Memory for Codex automation (default off)\n" +
      "  --verbose             Show technical details\n" +
      "  --lang zh|en          Choose language\n" +
      "  --dry-run             Inspect without changing anything\n" +
      "  --no-browser          Open the browser yourself\n" +
      "  --no-clipboard        Do not copy the one-time code\n" +
      "  --manual-token        Paste an access token manually\n" +
      "  --reauthorize         Sign in again\n" +
      "\n" +
      "Change limit:\n" +
      "npx @cairn-ink/memory config --codex-daily-cap 200\n" +
      "\n" +
      "  To turn prompt recall off:\n" +
      "npx @cairn-ink/memory prompt-recall-off --client codex"
  },
  "unknown_command": {
    "zh": "不認得這個指令或選項。用法：\n" +
      "npx @cairn-ink/memory --help",
    "en": "Unknown command or option. Use:\n" +
      "npx @cairn-ink/memory --help"
  },
  "node_required": {
    "zh": "需要 Node.js 22.16 以上。更新 Node.js 後再執行一次。",
    "en": "Node.js 22.16 or later is required. Update Node.js and retry."
  },
  "claude_missing": {
    "zh": "找不到 claude 指令。先安裝：https://code.claude.com/docs/en/setup",
    "en": "claude CLI not found on PATH. Install Claude Code: https://code.claude.com/docs/en/setup"
  },
  "claude_available": {
    "zh": "Node.js 與 Claude Code 可用",
    "en": "Node.js and Claude Code are available."
  },
  "claude_list_required": {
    "zh": "Claude Code 版本太舊，看不到外掛狀態。請更新後再試。",
    "en": "Claude Code is too old to read plugin status. Update it and retry."
  },
  "added": {
    "zh": "已加入",
    "en": "added"
  },
  "absent": {
    "zh": "未設定",
    "en": "absent"
  },
  "plugin_absent": {
    "zh": "  ✗ 外掛沒有安裝\n" +
      "  安裝：\n" +
      "npx @cairn-ink/memory setup",
    "en": "  ✗ Plugin is not installed\n" +
      "  Install:\n" +
      "npx @cairn-ink/memory setup"
  },
  "enabled": {
    "zh": "已啟用",
    "en": "enabled"
  },
  "disabled": {
    "zh": "停用",
    "en": "disabled"
  },
  "plugin_load_error": {
    "zh": "外掛載入失敗。\n" +
      "  在 Claude Code 輸入 /plugin 查看原因。",
    "en": "The plugin failed to load.\n" +
      "  Check /plugin in Claude Code for the cause."
  },
  "configured": {
    "zh": "已設定",
    "en": "configured"
  },
  "unset": {
    "zh": "未設定",
    "en": "unset"
  },
  "configuration_unavailable": {
    "zh": "無法讀取外掛設定（Claude Code 版本可能太舊）。",
    "en": "Cannot read plugin settings (Claude Code may be too old)."
  },
  "legacy_present": {
    "zh": "還有舊版 Cairn MCP 設定，可能出現重複工具。\n" +
      "  移除：\n" +
      "claude mcp remove cairn",
    "en": "Old Cairn MCP settings may create duplicate tools.\n" +
      "  Remove:\n" +
      "claude mcp remove cairn"
  },
  "status_unverified": {
    "zh": "這裡只讀本機設定，沒有實際連線測試。\n" +
      "詳細資料：\n" +
      "npx @cairn-ink/memory status --verbose",
    "en": "Only local settings were read; no connection was tested.\n" +
      "Details:\n" +
      "npx @cairn-ink/memory status --verbose"
  },
  "dry_run": {
    "zh": "預演：只檢查，不修改",
    "en": "Dry run: inspect only, no changes."
  },
  "dry_checks": {
    "zh": "1. 檢查 Node ≥22.16 與 claude CLI",
    "en": "1. Check Node ≥22.16 and claude CLI."
  },
  "dry_authorize": {
    "zh": "4. 在瀏覽器登入 Cairn（或用 --manual-token 貼上存取碼）",
    "en": "4. Sign in to Cairn in a browser (or paste a token with --manual-token)"
  },
  "dry_manual": {
    "zh": "5. 由 Claude Code 詢問 endpoint 與 token",
    "en": "5. Configure endpoint and token inside Claude Code."
  },
  "dry_restart": {
    "zh": "7. 重新啟動 Claude Code",
    "en": "7. Restart Claude Code."
  },
  "installed": {
    "zh": "已安裝",
    "en": "installed"
  },
  "dry_legacy": {
    "zh": "預演不檢查舊版 MCP 設定（那需要連網）。",
    "en": "Dry run does not check old MCP settings (that may connect to the network)."
  },
  "tty_required": {
    "zh": "安裝需要在終端機裡回答幾個問題。",
    "en": "Setup needs you to answer a few questions in a terminal."
  },
  "claude_manual_required": {
    "zh": "這個 Claude Code 版本不能自動安裝外掛。",
    "en": "This Claude Code version cannot install plugins automatically."
  },
  "claude_capabilities_required": {
    "zh": "Claude Code 版本太舊，無法安全地儲存登入。\n" +
      "  更新 Claude Code 後再執行一次。",
    "en": "Claude Code is too old to save a sign-in safely.\n" +
      "  Update Claude Code, then run setup again."
  },
  "marketplace_update_required": {
    "zh": "Claude Code 版本太舊，無法安全更新外掛來源。\n" +
      "  更新 Claude Code 後再執行一次。",
    "en": "Claude Code is too old to update the plugin source safely.\n" +
      "  Update Claude Code, then run setup again."
  },
  "plugin_update_required": {
    "zh": "Claude Code 版本太舊，無法安全更新外掛。\n" +
      "  更新 Claude Code 後再執行一次。",
    "en": "Claude Code is too old to update the plugin safely.\n" +
      "  Update Claude Code, then run setup again."
  },
  "marketplace_ready": {
    "zh": "Marketplace 已就緒",
    "en": "Marketplace ready."
  },
  "plugin_unconfirmed": {
    "zh": "外掛已安裝，但無法確認它有載入。\n" +
      "  在 Claude Code 輸入 /plugin 查看，再執行一次 setup。",
    "en": "The plugin was installed, but setup cannot confirm it loaded.\n" +
      "  Check /plugin in Claude Code, then run setup again."
  },
  "plugin_version_unconfirmed": {
    "zh": "外掛已安裝，但無法確認它有載入。\n" +
      "  在 Claude Code 輸入 /plugin 查看，再執行一次 setup。",
    "en": "The plugin was installed, but setup cannot confirm it loaded.\n" +
      "  Check /plugin in Claude Code, then run setup again."
  },
  "plugin_disabled": {
    "zh": "外掛已安裝但被停用。\n" +
      "  在 Claude Code 輸入 /plugin 啟用 Cairn.ink Memory，再執行一次 setup。",
    "en": "The plugin is installed but disabled.\n" +
      "  Enable Cairn.ink Memory in Claude Code /plugin, then run setup again."
  },
  "credential_kept": {
    "zh": "✓ 沿用原本的登入",
    "en": "✓ Reusing the existing sign-in"
  },
  "credential_endpoint_unset": {
    "zh": "Claude Code 的 Cairn 設定少了伺服器位址。",
    "en": "Claude Code Cairn settings are missing the server address."
  },
  "endpoint_invalid": {
    "zh": "這不是有效的 Cairn 網址，請用 https://，例如 {defaultEndpoint}。",
    "en": "This is not a valid Cairn URL. Use HTTPS, for example {defaultEndpoint}."
  },
  "browser_unsupported": {
    "zh": "這個 Cairn 伺服器不支援瀏覽器登入，改用存取碼。",
    "en": "This Cairn server does not support browser sign-in. Use an access token instead."
  },
  "token_prompt": {
    "zh": "? 貼上存取碼（不會顯示）：",
    "en": "? Paste the access token (hidden): "
  },
  "token_invalid": {
    "zh": "存取碼不能是空的，也不能有空白。請再貼一次；尚未保存存取碼。",
    "en": "The access token must not be empty or contain spaces. Try again; it is not saved."
  },
  "manual_no_expiry": {
    "zh": "✓ 已連上 Cairn（這個存取碼沒有到期日）",
    "en": "✓ Connected to Cairn (this access token has no expiry)"
  },
  "legacy_removed": {
    "zh": "✓ 已移除舊版 Cairn MCP 設定",
    "en": "✓ Old Cairn MCP settings removed"
  },
  "legacy_kept": {
    "zh": "保留舊版設定；之後要移除：\n" +
      "claude mcp remove cairn",
    "en": "Old settings kept. To remove them later:\n" +
      "claude mcp remove cairn"
  },
  "legacy_pending": {
    "zh": "注意：還有舊版的 Cairn MCP 設定，可能出現重複的工具。",
    "en": "Old Cairn MCP settings are still present and may create duplicate tools."
  },
  "claude_restart": {
    "zh": "接下來：\n" +
      "  1. 重新開啟 Claude Code，送出一則訊息。\n" +
      "  2. 確認狀態：在 Claude Code 輸入 /cairn-memory:status",
    "en": "Next:\n" +
      "  1. Reopen Claude Code and send a message.\n" +
      "  2. Check status: type /cairn-memory:status in Claude Code"
  },
  "setup_failed": {
    "zh": "安裝沒有完成。",
    "en": "Setup did not finish."
  },
  "client_invalid": {
    "zh": "--client 只能是 claude 或 codex。",
    "en": "--client must be claude or codex."
  },
  "codex_unknown": {
    "zh": "不認得這個指令或選項。用法：\n" +
      "npx @cairn-ink/memory --help",
    "en": "Unknown command or option. Use:\n" +
      "npx @cairn-ink/memory --help"
  },
  "codex_failed": {
    "zh": "Codex 沒有安裝完成。",
    "en": "Codex setup did not finish."
  },
  "interactive_retry": {
    "zh": "這一步需要在終端機回答問題，請直接執行：",
    "en": "This step needs answers in a terminal. Run directly:"
  },
  "codex_env_fallback": {
    "zh": "或從你自己管理的環境變數讀取存取碼：",
    "en": "Or read the access token from an environment variable you manage:"
  },
  "codex_env_explanation": {
    "zh": "這只記下變數名稱，不會存存取碼；每次啟動 Codex 前都要設好這個變數。",
    "en": "This saves only the variable name. Set the variable before each Codex launch."
  },
  "codex_automatic": {
    "zh": "Codex 自動記憶尚未開啟（這個版本還沒驗證）。",
    "en": "Codex automatic memory is off (this version has not been verified)."
  },
  "codex_explicit_only": {
    "zh": "目前可以在 Codex 用 /mcp 的 Cairn 工具手動存取記憶。",
    "en": "You can use the Cairn tools in Codex /mcp to save and find memories manually."
  },
  "codex_windows": {
    "zh": "Windows 上的 Codex 還不支援自動記憶。",
    "en": "Automatic memory is not supported for Codex on Windows yet."
  },
  "codex_tmpdir": {
    "zh": "暫存目錄位於 Codex 專案設定下，請改用中立目錄。",
    "en": "TMPDIR has ancestor project settings. Choose a neutral temporary directory."
  },
  "codex_managed": {
    "zh": "這台電腦的 Codex 由系統統一管理，安裝程式不會修改。",
    "en": "This computer has system-managed Codex settings. Setup cannot change them."
  },
  "codex_state_error": {
    "zh": "讀不懂 Codex 回傳的狀態（版本可能太新或太舊）。",
    "en": "Cannot read the Codex state (its version may be too new or too old)."
  },
  "codex_missing": {
    "zh": "找不到 codex 指令。先安裝：https://developers.openai.com/codex/cli",
    "en": "codex CLI not found on PATH. Install Codex: https://developers.openai.com/codex/cli"
  },
  "codex_available": {
    "zh": "Node.js 與 Codex CLI 可用",
    "en": "Node.js and Codex CLI are available."
  },
  "codex_update_required": {
    "zh": "Codex 版本太舊，無法安全確認設定。請更新 Codex。",
    "en": "Codex is too old to check its settings safely. Please update Codex."
  },
  "compatible_endpoint": {
    "zh": "HTTP endpoint 格式符合",
    "en": "compatible HTTP endpoint"
  },
  "inspect_config": {
    "zh": "既有設定需手動檢查",
    "en": "inspect existing configuration"
  },
  "unverified": {
    "zh": "尚未確認",
    "en": "unverified"
  },
  "codex_preserve": {
    "zh": "既有有效設定不重寫，衝突或停用設定保留",
    "en": "Preserve configured, conflicting or disabled entries."
  },
  "dry_unverified": {
    "zh": "未驗證 PAT、遠端服務或 hook 執行",
    "en": "PAT, remote service and hooks are not tested."
  },
  "codex_repair": {
    "zh": "Codex 裡已有 Cairn 設定，但目前停用或無法連線。\n" +
      "  在 Codex 輸入 /mcp 修好或啟用後，再執行一次 setup。",
    "en": "Cairn settings exist in Codex but are disabled or unusable.\n" +
      "  Fix or enable them in Codex /mcp, then run setup again."
  },
  "codex_credential_kept": {
    "zh": "✓ 沿用原本的登入",
    "en": "✓ Reusing the existing sign-in"
  },
  "codex_oauth": {
    "zh": "想在 Codex 裡直接搜尋記憶，執行：",
    "en": "To search memories inside Codex, run:"
  },
  "codex_neutral": {
    "zh": "請在沒有專案設定的資料夾執行，例如先執行 cd ~。",
    "en": "Run from a folder without project settings, for example after cd ~."
  },
  "codex_login_kept": {
    "zh": "之後在 Codex 執行上面的登入指令即可。",
    "en": "Run the sign-in command above when you are ready."
  },
  "codex_pending": {
    "zh": "還沒設定，沒有收集存取碼。",
    "en": "Not set up yet. No access token was collected."
  },
  "codex_directory": {
    "zh": "Codex 目錄權限不安全。\n" +
      "  檢查：ls -ld ~/.codex（應只有你能寫入、不是連結）",
    "en": "The Codex directory has unsafe permissions.\n" +
      "  Check: ls -ld ~/.codex (only you should be able to write; no link)"
  },
  "codex_candidate": {
    "zh": "Codex 不接受新的設定，原本的設定保持不變。",
    "en": "Codex did not accept the candidate settings. Original settings are kept."
  },
  "codex_plaintext": {
    "zh": "存取碼會以未加密方式存在 Codex 的設定檔，只有你能讀。",
    "en": "The access token is saved in an unencrypted Codex settings file only you can read."
  },
  "codex_lock": {
    "zh": "另一個 Cairn 安裝程式正在執行。",
    "en": "Another Cairn setup is running."
  },
  "codex_concurrent": {
    "zh": "你輸入的時候 Codex 設定被改過了，為了安全沒有寫入。",
    "en": "Codex settings changed while you answered. Setup stopped before writing."
  },
  "codex_changed": {
    "zh": "你輸入的時候 Codex 設定被改過了，為了安全沒有寫入。",
    "en": "Codex settings changed while you answered. Setup stopped before writing."
  },
  "codex_saved_unverified": {
    "zh": "設定已寫入，但讀回確認失敗。\n" +
      "  在 Codex 輸入 /mcp 檢查 cairn。",
    "en": "Settings were written, but could not be confirmed.\n" +
      "  Check cairn in Codex /mcp."
  },
  "codex_saved": {
    "zh": "✓ 已把 Cairn 工具加入 Codex",
    "en": "✓ Cairn tools added to Codex"
  },
  "codex_restart": {
    "zh": "接下來：重新開啟 Codex，輸入 /mcp 確認 cairn。",
    "en": "Next: reopen Codex and check cairn in /mcp."
  },
  "saving": {
    "zh": "正在儲存登入資訊…",
    "en": "Saving your sign-in…"
  },
  "rate_wait": {
    "zh": "Cairn 要求放慢一點，稍等後會自動再試…",
    "en": "Cairn asked us to slow down. Retrying shortly…"
  },
  "auth_interrupted": {
    "zh": "已取消。",
    "en": "Cancelled."
  },
  "auth_timeout": {
    "zh": "等太久了，這組代碼已過期。",
    "en": "Sign-in timed out; this code has expired."
  },
  "auth_access_denied": {
    "zh": "你在瀏覽器選了「拒絕」，所以沒有連接。",
    "en": "You clicked Deny in the browser, so nothing was connected."
  },
  "auth_expired_token": {
    "zh": "這組代碼已過期。",
    "en": "This sign-in code has expired."
  },
  "auth_rate_limited": {
    "zh": "登入請求太頻繁，Cairn 暫時拒絕。",
    "en": "Sign-in requests are too frequent. Cairn is rate-limiting them."
  },
  "auth_active_token_limit": {
    "zh": "你的 Cairn 帳號登入數量到上限了。",
    "en": "Your Cairn account has reached its sign-in limit."
  },
  "auth_configure": {
    "zh": "登入成功，但沒能存進設定。",
    "en": "Sign-in succeeded but could not be saved to settings."
  },
  "auth_protocol": {
    "zh": "Cairn 的回應和預期不同，為了安全先停下。",
    "en": "Cairn's response was unexpected. Setup stopped for safety."
  },
  "auth_network": {
    "zh": "連不到 Cairn，登入沒有完成。",
    "en": "Couldn't reach Cairn, so sign-in didn't finish."
  },
  "auth_server": {
    "zh": "Cairn 暫時無法登入，可能正在維護。",
    "en": "Cairn can't sign you in right now. It may be under maintenance."
  },
  "auth_credential": {
    "zh": "Cairn 不接受目前的登入（可能已過期或被撤銷）。",
    "en": "Cairn rejected this sign-in (it may be expired or revoked)."
  },
  "auth_failed_revoked": {
    "zh": "登入花太久，Cairn 已作廢這次的登入。",
    "en": "Sign-in delivery took too long; Cairn revoked it."
  },
  "auth_ack_unknown": {
    "zh": "設定已儲存，但無法確認 Cairn 有收到。",
    "en": "Settings were saved, but delivery to Cairn could not be confirmed."
  },
  "lang_invalid": {
    "zh": "無效語言選項，請使用 --lang zh 或 --lang en。",
    "en": "Invalid language option. Use --lang zh or --lang en."
  },
  "endpoint_option_invalid": {
    "zh": "--endpoint 要接一個 https:// 網址，而且只能用在 setup。",
    "en": "--endpoint needs an HTTPS URL and can only be used with setup."
  },
  "command_failed": {
    "zh": "{client} 的指令執行失敗。",
    "en": "A {client} command failed."
  },
  "claude_state_error": {
    "zh": "讀不懂 Claude Code 回傳的狀態（版本可能太新或太舊）。",
    "en": "Cannot read the Claude Code state (its version may be too new or too old)."
  },
  "manual_marketplace": {
    "zh": "/plugin marketplace add {repository}",
    "en": "/plugin marketplace add {repository}"
  },
  "manual_install": {
    "zh": "/plugin install {plugin}",
    "en": "/plugin install {plugin}"
  },
  "manual_configure": {
    "zh": "/plugin configure {plugin}",
    "en": "/plugin configure {plugin}"
  },
  "create_pat": {
    "zh": "在這裡建立一組存取碼，等一下貼上：{url}",
    "en": "Create an access token here, then paste it: {url}"
  },
  "configure_options": {
    "zh": "在 Configure options 填入伺服器位址（預設 {defaultEndpoint}）和存取碼。",
    "en": "In Configure options, enter the server URL (default {defaultEndpoint}) and token."
  },
  "configure_menu": {
    "zh": "也可開啟 /plugin → Installed → Cairn.ink Memory → Configure options。",
    "en": "Or open /plugin → Installed → Cairn.ink Memory → Configure options."
  },
  "open_manually": {
    "zh": "無法自動開啟瀏覽器，請手動開啟：{url}",
    "en": "Couldn't open the browser. Open this URL yourself: {url}"
  },
  "installer_version": {
    "zh": "Cairn.ink Memory 安裝程式 {version}",
    "en": "Cairn.ink Memory setup {version}"
  },
  "marketplace_status": {
    "zh": "Marketplace：{state}",
    "en": "Marketplace: {state}"
  },
  "plugin_status": {
    "zh": "  ✓ 外掛 {version} 已安裝並{state}",
    "en": "  ✓ Plugin {version} installed and {state}"
  },
  "plugin_presence": {
    "zh": "外掛：{state}",
    "en": "Plugin: {state}"
  },
  "option_status": {
    "zh": "{key}：{state}",
    "en": "{key}: {state}"
  },
  "plugin_version": {
    "zh": "✓ Claude Code 外掛 {version} 已安裝",
    "en": "✓ Claude Code plugin {version} installed"
  },
  "dry_marketplace": {
    "zh": "2. marketplace 不存在時：\n" +
      "claude plugin marketplace add {repository}\n" +
      "   已存在時：\n" +
      "claude plugin marketplace update cairn-memory",
    "en": "2. If absent:\n" +
      "claude plugin marketplace add {repository}\n" +
      "   If present:\n" +
      "claude plugin marketplace update cairn-memory"
  },
  "dry_plugin": {
    "zh": "3. 安裝使用者範圍的外掛，已安裝時更新：\n" +
      "claude plugin install {plugin} --scope user\n" +
      "claude plugin update {plugin} --scope user",
    "en": "3. Install the user plugin; update it if already installed:\n" +
      "claude plugin install {plugin} --scope user\n" +
      "claude plugin update {plugin} --scope user"
  },
  "dry_configure": {
    "zh": "5. 以標準輸入交付 JSON 設定，不印出存取碼：\n" +
      "claude plugin configure {plugin} --values-stdin",
    "en": "5. Deliver JSON settings through stdin; do not print the access token:\n" +
      "claude plugin configure {plugin} --values-stdin"
  },
  "dry_remove": {
    "zh": "6. 檢查舊版設定，存在時先詢問再移除：\n" +
      "claude mcp get cairn\n" +
      "claude mcp remove cairn",
    "en": "6. Inspect legacy settings; ask before removing them if present:\n" +
      "claude mcp get cairn\n" +
      "claude mcp remove cairn"
  },
  "connected_expiry": {
    "zh": "✓ 已登入 Cairn，有效到 {date}",
    "en": "✓ Signed in to Cairn, valid until {date}"
  },
  "manual_expiry": {
    "zh": "✓ 已連上 Cairn，存取碼有效到 {date}",
    "en": "✓ Connected to Cairn, access token valid until {date}"
  },
  "manual_unverified": {
    "zh": "設定已儲存，但這個伺服器無法驗證存取碼。\n" +
      "  在 Claude Code 輸入 /cairn-memory:status 確認。",
    "en": "Settings were saved, but this server cannot verify the access token.\n" +
      "  Type /cairn-memory:status in Claude Code to check."
  },
  "legacy_prompt": {
    "zh": "? 找到舊版 Cairn MCP 設定，可能出現重複的工具。要移除嗎？ (y/N) ",
    "en": "? Old Cairn MCP settings may create duplicate tools. Remove them? (y/N) "
  },
  "legacy_remove_command": {
    "zh": "claude mcp remove cairn",
    "en": "claude mcp remove cairn"
  },
  "waiting": {
    "zh": "等待你在瀏覽器按「允許」… 剩 {time}",
    "en": "Waiting for you to click Allow in the browser… {time} left"
  },
  "authorization_code": {
    "zh": "  一次性代碼：{code}{copied}",
    "en": "  One-time code: {code}{copied}"
  },
  "code_deadline": {
    "zh": "代碼將於 {minutes} 分鐘後到期。",
    "en": "Code expires in {minutes} minutes."
  },
  "open_device": {
    "zh": "  按 Enter 開啟 {url}",
    "en": "  Press Enter to open {url}"
  },
  "clipboard_copied": {
    "zh": "（已複製）",
    "en": " (copied)"
  },
  "code_deadline_seconds": {
    "zh": "代碼將於 {seconds} 秒後到期。",
    "en": "Code expires in {seconds} seconds."
  },
  "endpoint_flag": {
    "zh": "Cairn endpoint：{endpoint}（來自 --endpoint）。",
    "en": "Cairn endpoint: {endpoint} (from --endpoint)."
  },
  "endpoint_config": {
    "zh": "Cairn endpoint：{endpoint}（來自既有設定）。",
    "en": "Cairn endpoint: {endpoint} (from existing config)."
  },
  "endpoint_default": {
    "zh": "Cairn endpoint：{endpoint}（預設值）。",
    "en": "Cairn endpoint: {endpoint} (default)."
  },
  "endpoint_prompt_source": {
    "zh": "Cairn endpoint：{endpoint}（來自互動輸入）。",
    "en": "Cairn endpoint: {endpoint} (from prompt)."
  },
  "endpoint_reauthorize": {
    "zh": "已有登入時指定 --endpoint，請同時加上 --reauthorize。",
    "en": "When using --endpoint with a saved sign-in, also pass --reauthorize."
  },
  "codex_endpoint_conflict": {
    "zh": "Codex 的 Cairn 工具連到另一台伺服器，這次沒有改動。\n" +
      "先登出並移除，再重新連接：\n" +
      "codex mcp logout cairn\n" +
      "codex mcp remove cairn\n" +
      "npx @cairn-ink/memory setup --client codex --reauthorize",
    "en": "The Cairn tools in Codex use a different server. Nothing was changed.\n" +
      "Sign out and remove them, then connect again:\n" +
      "codex mcp logout cairn\n" +
      "codex mcp remove cairn\n" +
      "npx @cairn-ink/memory setup --client codex --reauthorize"
  },
  "codex_retry_command": {
    "zh": "npx @cairn-ink/memory setup --client codex",
    "en": "npx @cairn-ink/memory setup --client codex"
  },
  "codex_env_command": {
    "zh": "codex mcp add cairn --url {defaultEndpoint}/api/mcp --bearer-token-env-var CAIRN_MCP_TOKEN",
    "en": "codex mcp add cairn --url {defaultEndpoint}/api/mcp --bearer-token-env-var CAIRN_MCP_TOKEN"
  },
  "codex_user_status": {
    "zh": "使用者層級 MCP cairn：{state}",
    "en": "User-level MCP cairn: {state}"
  },
  "codex_connection": {
    "zh": "連線：{state}",
    "en": "Connection: {state}"
  },
  "codex_enabled": {
    "zh": "啟用狀態：{state}",
    "en": "Enabled: {state}"
  },
  "codex_credential": {
    "zh": "憑證：{state}",
    "en": "Credential: {state}"
  },
  "codex_dry_token": {
    "zh": "以隱藏輸入取得 PAT，寫入 CODEX_HOME/config.toml 的 Cairn http_headers（0600，明文）。",
    "en": "Hidden PAT → native http_headers (0600, plaintext)."
  },
  "codex_login_command": {
    "zh": "codex mcp login cairn",
    "en": "codex mcp login cairn"
  },
  "codex_endpoint_save": {
    "zh": "Cairn 工具會連到：{url}",
    "en": "The Cairn tools will use: {url}"
  },
  "status_header": {
    "zh": "Cairn.ink Memory {version}",
    "en": "Cairn.ink Memory {version}"
  },
  "found_both": {
    "zh": "在這台電腦找到 Claude Code 和 Codex。",
    "en": "Found Claude Code and Codex on this computer."
  },
  "found_claude": {
    "zh": "在這台電腦找到 Claude Code（沒有找到 Codex）。",
    "en": "Found Claude Code on this computer (Codex not found)."
  },
  "found_codex": {
    "zh": "在這台電腦找到 Codex（沒有找到 Claude Code）。",
    "en": "Found Codex on this computer (Claude Code not found)."
  },
  "privacy_both": {
    "zh": "連接後，你和 AI 的對話會先在本機盡量遮掉密碼、金鑰等敏感資訊，再存到你的 Cairn。\n" +
      "每次提問時，也會送出一段遮過、有長度上限的提問，用來找回相關記憶。\n" +
      "Claude Code 外掛預設會送出使用統計，不含任何對話內容。\n" +
      "使用統計可以關閉，記憶也隨時可以暫停。完整說明：{privacy}",
    "en": "Once connected, your conversations with the AI are saved to your Cairn.\n" +
      "Passwords and keys are masked on this computer first (best effort).\n" +
      "Each prompt also sends a masked, length-limited copy to find related memories.\n" +
      "The Claude Code plugin sends usage stats by default, never conversation text.\n" +
      "Turn off stats or pause memory at any time. Details: {privacy}"
  },
  "privacy_codex": {
    "zh": "連接後，你和 AI 的對話會先在本機盡量遮掉密碼、金鑰等敏感資訊，再存到你的 Cairn。\n" +
      "每次提問時，也會送出一段遮過、有長度上限的提問，用來找回相關記憶。\n" +
      "記憶隨時可以暫停。完整說明：{privacy}",
    "en": "Once connected, your conversations with the AI are saved to your Cairn.\n" +
      "Passwords and keys are masked on this computer first (best effort).\n" +
      "Each prompt also sends a masked, length-limited copy to find related memories.\n" +
      "You can pause memory at any time. Details: {privacy}"
  },
  "claude_connected": {
    "zh": "✓ Claude Code 已連接（外掛會順便更新）",
    "en": "✓ Claude Code is connected (its plugin will be updated)"
  },
  "codex_connected": {
    "zh": "✓ Codex 已連接",
    "en": "✓ Codex is connected"
  },
  "stop_hint": {
    "zh": "兩個工具要共用同一份記憶，安裝時都必須關閉。\n" +
      "請完全結束 Claude Code 和 Codex，並等背景工作結束。",
    "en": "To share one memory, both tools must be closed while setup runs.\n" +
      "Quit Claude Code and Codex completely, and wait for background work to finish."
  },
  "ask_hosts_stopped": {
    "zh": "? 都關好了嗎？ (y/N) ",
    "en": "? Are both closed? (y/N) "
  },
  "reauthorize_hint": {
    "zh": "這次會重新登入，換掉所選工具目前的登入。",
    "en": "This run signs in again and replaces the selected tools' current sign-in."
  },
  "codex_own_login": {
    "zh": "Codex 需要自己的登入，安裝程式不會讀取 Claude Code 的登入資訊。\n" +
      "  請用和 Claude Code 同一個 Cairn 帳號。",
    "en": "Codex needs its own sign-in. Setup never reads Claude Code's sign-in.\n" +
      "  Use the same Cairn account as Claude Code."
  },
  "login_heading": {
    "zh": "在瀏覽器登入 Cairn（{host}）",
    "en": "Sign in to Cairn in your browser ({host})"
  },
  "login_replaced": {
    "zh": "✓ 已重新登入 Cairn，有效到 {date}",
    "en": "✓ Signed in again, valid until {date}"
  },
  "plugin_updated": {
    "zh": "✓ Claude Code 外掛已更新到 {version}",
    "en": "✓ Claude Code plugin updated to {version}"
  },
  "plugin_current": {
    "zh": "✓ Claude Code 外掛 {version} 已是最新版",
    "en": "✓ Claude Code plugin {version} is up to date"
  },
  "codex_hooks_updated": {
    "zh": "✓ Codex 自動記憶已更新",
    "en": "✓ Codex automatic memory updated"
  },
  "done_shared": {
    "zh": "✓ 兩個工具共用同一份記憶",
    "en": "✓ Both tools share one memory"
  },
  "next_both": {
    "zh": "接下來：\n" +
      "  1. 重新開啟 Claude Code，送出一則訊息。\n" +
      "  2. 重新開啟 Codex，輸入 /hooks，允許 Cairn 的 4 個項目。\n" +
      "  3. 確認狀態：\n" +
      "npx @cairn-ink/memory status",
    "en": "Next:\n" +
      "  1. Reopen Claude Code and send a message.\n" +
      "  2. Reopen Codex, type /hooks and allow the 4 Cairn entries.\n" +
      "  3. Check status:\n" +
      "npx @cairn-ink/memory status"
  },
  "next_codex": {
    "zh": "接下來：重新開啟 Codex，輸入 /hooks，允許 Cairn 的 4 個項目。\n" +
      "  確認狀態：\n" +
      "npx @cairn-ink/memory status",
    "en": "Next: reopen Codex, type /hooks and allow the 4 Cairn entries.\n" +
      "  Check status:\n" +
      "npx @cairn-ink/memory status"
  },
  "next_reopen": {
    "zh": "接下來：重新開啟 Claude Code 和 Codex。",
    "en": "Next: reopen Claude Code and Codex."
  },
  "optional_mcp": {
    "zh": "  選用：想在 Codex 裡直接搜尋記憶，執行\n" +
      "codex mcp login cairn",
    "en": "  Optional: to search memories inside Codex, run\n" +
      "codex mcp login cairn"
  },
  "login_open_other_device": {
    "zh": "  在任何裝置開啟 {url}，輸入上面的代碼。",
    "en": "  Open {url} on any device and enter the code above."
  },
  "endpoint_choices": {
    "zh": "Claude Code 連 {claude}、Codex 連 {codex}，還不能共用記憶。\n" +
      "  1. {codex}  {reuse}\n" +
      "  2. {claude}  Codex 要在瀏覽器重新登入\n" +
      "換過去的工具，之後的記憶存到新的 Cairn；已經存的記憶留在原處。",
    "en": "Claude Code uses {claude} and Codex uses {codex}.\n" +
      "They can't share memory yet.\n" +
      "  1. {codex}  {reuse}\n" +
      "  2. {claude}  Codex must sign in again in the browser\n" +
      "The tool that switches saves new memories to the new server.\n" +
      "Memories it already saved stay where they are."
  },
  "endpoint_reuse_option": {
    "zh": "Claude Code 改用 Codex 的登入，不必再登入",
    "en": "Claude Code reuses Codex's sign-in; no new sign-in"
  },
  "endpoint_browser_option": {
    "zh": "Claude Code 要在瀏覽器重新登入",
    "en": "Claude Code must sign in again in the browser"
  },
  "ask_endpoint_choice": {
    "zh": "? 要統一用哪一個？(1/2) ",
    "en": "? Which one should both tools use? (1/2) "
  },
  "endpoint_mcp_switch": {
    "zh": "Codex 的 Cairn 工具（/mcp）也會改連 {host}。",
    "en": "The Cairn tools in Codex (/mcp) will also switch to {host}."
  },
  "endpoint_auth_blocked": {
    "zh": "Codex 的 Cairn 工具有自己的驗證設定，無法安全改連另一台伺服器。",
    "en": "The Cairn tools have authentication settings; switching servers is unsafe."
  },
  "endpoint_version_blocked": {
    "zh": "這個 Codex 版本尚未確認登入會綁定伺服器，無法自動改連。",
    "en": "This Codex version's sign-in binding is unverified; setup cannot switch it."
  },
  "endpoint_remove_retry": {
    "zh": "  沒有改動任何設定。\n" +
      "  先登出並移除 Codex 的 Cairn 工具：\n" +
      "codex mcp logout cairn\n" +
      "codex mcp remove cairn\n" +
      "  接著執行：\n" +
      "npx @cairn-ink/memory setup --endpoint {endpoint} --reauthorize",
    "en": "  Nothing was changed.\n" +
      "  Sign out and remove the Cairn tools in Codex:\n" +
      "codex mcp logout cairn\n" +
      "codex mcp remove cairn\n" +
      "  Then run:\n" +
      "npx @cairn-ink/memory setup --endpoint {endpoint} --reauthorize"
  },
  "conflict_retry": {
    "zh": "  在終端機直接執行，安裝程式會問你要用哪一個：\n" +
      " \n" +
      "npx @cairn-ink/memory setup",
    "en": "  Run setup in a terminal and it will ask which one to use:\n" +
      " \n" +
      "npx @cairn-ink/memory setup"
  },
  "identity_choices": {
    "zh": "這台電腦有兩份 Cairn 記憶身分。記憶身分決定一則記憶屬於哪個專案。\n" +
      "{choices}\n" +
      "兩個工具只能用一份。沒選的那份會改名留作備份，不會刪除。\n" +
      "切換後，舊身分的專案記憶不會再自動對應；本機備份會保留原本的身分。",
    "en": "This computer has two Cairn memory IDs. A memory ID links memories to projects.\n" +
      "{choices}\n" +
      "Both tools must use the same one. The other is renamed as a backup, not deleted.\n" +
      "Old project memories will no longer match automatically.\n" +
      "The local backup keeps the original memory ID."
  },
  "identity_claude": {
    "zh": "Claude Code 正在用的",
    "en": "The one Claude Code uses"
  },
  "identity_created": {
    "zh": "{date} 建立",
    "en": "created {date}"
  },
  "ask_identity_claude": {
    "zh": "? 要用 Claude Code 正在用的那份嗎？ (Y/n) ",
    "en": "? Use the one Claude Code uses? (Y/n) "
  },
  "ask_identity_other": {
    "zh": "? 改用 {root} 那份嗎？Claude Code 也會跟著換。 (y/N) ",
    "en": "? Use {root} instead? Claude Code will switch to it too. (y/N) "
  },
  "ask_identity_number": {
    "zh": "? 要用哪一份？(1/2) ",
    "en": "? Which memory ID should both tools use? (1/2) "
  },
  "identity_conflict": {
    "zh": "這台電腦有兩份 Cairn 記憶身分，安裝程式不會替你選。",
    "en": "This computer has two Cairn memory IDs. Setup won't pick one for you."
  },
  "identity_declined": {
    "zh": "好，這次只安裝 Claude Code，Codex 沒有任何改動。",
    "en": "OK. Only Claude Code is set up this time. Codex is unchanged."
  },
  "identity_bound": {
    "zh": "另一份記憶身分仍被既有安裝使用，不能移成備份。",
    "en": "The other memory ID is still used by an existing installation."
  },
  "identity_changed": {
    "zh": "回答之後記憶身分被改過，為了安全先停下。",
    "en": "A memory ID changed after you answered. Setup stopped for safety."
  },
  "identity_backup": {
    "zh": "  另一份已改名備份：{path}",
    "en": "  Backup of the other one: {path}"
  },
  "identity_restored": {
    "zh": "  記憶身分備份已還原成原本的檔名。",
    "en": "  The memory ID backup was restored to its original name."
  },
  "identity_restore_failed": {
    "zh": "  記憶身分備份還原失敗，請保持兩個工具關閉並檢查備份收據。",
    "en": "  Backup restoration failed. Keep both tools closed and check the receipt."
  },
  "nothing_changed": {
    "zh": "  沒有改動任何設定。",
    "en": "  Nothing was changed."
  },
  "retry_setup": {
    "zh": "  要重新連接，請執行：\n" +
      "npx @cairn-ink/memory setup",
    "en": "  To try again, run:\n" +
      "npx @cairn-ink/memory setup"
  },
  "error_details": {
    "zh": "  詳細原因：\n" +
      "npx @cairn-ink/memory setup --verbose",
    "en": "  Details:\n" +
      "npx @cairn-ink/memory setup --verbose"
  },
  "phase_details": {
    "zh": "  階段：{phase}；錯誤碼：{code}",
    "en": "  Phase: {phase}; error code: {code}"
  },
  "progress_claude_plugin": {
    "zh": "  Claude Code 外掛已安裝，但還沒連上 Cairn；Codex 沒有任何改動。",
    "en": "  The Claude Code plugin is installed but not connected yet. Codex is unchanged."
  },
  "progress_claude_configured": {
    "zh": "  Claude Code 的登入已儲存；Codex 尚未完成安裝。",
    "en": "  Claude Code's sign-in was saved; Codex setup is incomplete."
  },
  "progress_codex": {
    "zh": "  Codex 已改動：{changes}。",
    "en": "  Codex changes: {changes}."
  },
  "progress_credential": {
    "zh": "登入資訊已儲存",
    "en": "sign-in saved"
  },
  "progress_config": {
    "zh": "MCP 設定已寫入",
    "en": "MCP settings written"
  },
  "progress_install": {
    "zh": "安裝設定已寫入",
    "en": "installation settings written"
  },
  "progress_runtime": {
    "zh": "私有執行程式已複製",
    "en": "private runtime copied"
  },
  "progress_hooks": {
    "zh": "自動記憶項目已寫入",
    "en": "memory hooks written"
  },
  "lock_retry": {
    "zh": "  等它結束再試；確定沒有在跑時，刪除這個鎖檔：\n" +
      "{path}",
    "en": "  Wait for it to finish. If none is running, remove this lock file:\n" +
      "{path}"
  },
  "invalid_cap": {
    "zh": "--codex-daily-cap 必須是 1–100000 的整數。",
    "en": "--codex-daily-cap must be an integer from 1 to 100000."
  },
  "cap_configured": {
    "zh": "✓ Codex 每日自動記憶上限已設為 {cap}",
    "en": "✓ Codex daily automatic memory limit set to {cap}"
  },
  "cap_reached": {
    "zh": "  已達每日自動記憶上限，明天會再繼續；Claude Code 不受影響。",
    "en": "  Daily automatic memory limit reached; resumes tomorrow. Claude is unaffected."
  },
  "cap_status_hint": {
    "zh": "  達到每日上限後，Codex 當天不再自動記憶；Claude Code 不受影響。",
    "en": "  At the daily limit, Codex stops saving for the day. Claude Code is unaffected."
  },
  "shared_status": {
    "zh": "，和 Claude Code 共用",
    "en": ", shared with Claude Code"
  },
  "active": {
    "zh": "進行中",
    "en": "active"
  },
  "paused": {
    "zh": "已暫停",
    "en": "paused"
  },
  "on": {
    "zh": "開啟",
    "en": "on"
  },
  "off": {
    "zh": "關閉",
    "en": "off"
  },
  "unknown": {
    "zh": "無法確認",
    "en": "unknown"
  },
  "open": {
    "zh": "可使用",
    "en": "available"
  },
  "registered": {
    "zh": "✓ 自動記憶已安裝，連到 {host}",
    "en": "✓ Automatic memory installed, using {host}"
  },
  "unsupported_host": {
    "zh": "✗ 這個 Codex 版本還不支援自動記憶",
    "en": "✗ This Codex version does not support automatic memory"
  },
  "registration_incomplete": {
    "zh": "✗ 自動記憶安裝不完整，請重新執行 setup",
    "en": "✗ Automatic memory setup is incomplete. Run setup again"
  },
  "credential_missing": {
    "zh": "✗ 登入遺失，請執行 setup --reauthorize",
    "en": "✗ Sign-in missing. Run setup --reauthorize"
  },
  "policy_invalid_or_unreadable": {
    "zh": "✗ 每日上限設定無法讀取，請重新執行 setup",
    "en": "✗ Daily limit settings cannot be read. Run setup again"
  },
  "policy_missing_or_conflicting": {
    "zh": "✗ 每日上限設定不一致，請重新執行 setup",
    "en": "✗ Daily limit settings do not match. Run setup again"
  },
  "not_installed": {
    "zh": "自動記憶尚未安裝\n" +
      "  安裝：\n" +
      "npx @cairn-ink/memory setup",
    "en": "Automatic memory is not installed\n" +
      "  Install:\n" +
      "npx @cairn-ink/memory setup"
  },
  "status_unsafe": {
    "zh": "✗ 無法安全讀取自動記憶設定\n" +
      "  檢查檔案權限後，再執行 status --verbose",
    "en": "✗ Automatic memory settings cannot be read safely\n" +
      "  Check file permissions, then run status --verbose"
  },
  "signin_saved": {
    "zh": "  ✓ 已存好登入資訊",
    "en": "  ✓ Sign-in saved"
  },
  "signin_missing": {
    "zh": "  ✗ 還沒登入 Cairn\n" +
      "  登入：\n" +
      "npx @cairn-ink/memory setup",
    "en": "  ✗ Not signed in to Cairn yet\n" +
      "  Sign in:\n" +
      "npx @cairn-ink/memory setup"
  },
  "claude_status_tip": {
    "zh": "  最近一次是否連線成功，請在 Claude Code 輸入 /cairn-memory:status",
    "en": "  To see whether the last connection worked, type /cairn-memory:status in it."
  },
  "quota_limited": {
    "zh": "  · 用量限制：已達上限或無法讀取",
    "en": "  · Usage limit: reached or unreadable"
  },
  "pause_done": {
    "zh": "✓ 已暫停：不再自動記下對話，也不會自動找回記憶。",
    "en": "✓ Paused: conversations are not saved and memories are not looked up."
  },
  "pause_shared": {
    "zh": "  Claude Code 和 Codex 共用這個開關，兩邊都暫停了。",
    "en": "  Claude Code and Codex share this switch, so both are paused."
  },
  "pause_no_backfill": {
    "zh": "  暫停期間的對話不會記下，恢復後也不會補記。\n" +
      "  要恢復：\n" +
      "npx @cairn-ink/memory resume",
    "en": "  Conversations during the pause are not saved later either.\n" +
      "  To resume:\n" +
      "npx @cairn-ink/memory resume"
  },
  "resume_done": {
    "zh": "✓ 已恢復自動記憶（{clients}）",
    "en": "✓ Automatic memory resumed ({clients})"
  },
  "resume_quota_reached": {
    "zh": "  帳號用量仍已達上限，等用量重置後才會繼續。",
    "en": "  Account usage is still at its limit; wait for it to reset."
  },
  "resume_busy": {
    "zh": "  背景工作尚在收尾，完成後會繼續。",
    "en": "  Background work is still finishing; saving continues after it completes."
  },
  "resume_repaired": {
    "zh": "  用量狀態已修復，可以繼續。",
    "en": "  Usage state repaired; saving can continue."
  },
  "disabled_control": {
    "zh": "✓ 已停用 Codex 自動記憶",
    "en": "✓ Codex automatic memory disabled"
  },
  "uninstalled_control": {
    "zh": "✓ 已從 Codex 移除 Cairn 自動記憶\n" +
      "  Claude Code 不受影響，記憶也都還在。\n" +
      "  已存的記憶仍在你的 Cairn。這台電腦的登入不會自動撤銷，\n" +
      "  可到 {url} 撤銷。\n" +
      "  Codex 裡的 Cairn 工具（/mcp）保留；要一併移除：\n" +
      "codex mcp remove cairn",
    "en": "✓ Cairn automatic memory removed from Codex\n" +
      "  Claude Code is not affected, and its memories are kept.\n" +
      "  Saved memories stay in your Cairn. This computer's sign-in is not revoked;\n" +
      "  revoke it at {url}.\n" +
      "  The Cairn tools in Codex (/mcp) stay. To remove them:\n" +
      "codex mcp remove cairn"
  },
  "claude_control": {
    "zh": "Claude Code 的控制要在 Claude Code 裡操作：輸入 /cairn-memory:{action}",
    "en": "Control Claude Code from inside it: type /cairn-memory:{action}"
  },
  "claude_pause": {
    "zh": "Claude Code 的暫停要在 Claude Code 裡操作：輸入 /cairn-memory:pause",
    "en": "Pause Claude Code from inside it: type /cairn-memory:pause"
  },
  "claude_pairing_unavailable": {
    "zh": "Claude Code 外掛太舊或設定失敗，無法共用。\n" +
      "  更新：\n" +
      "claude plugin update cairn-memory@cairn-memory",
    "en": "The Claude Code plugin is too old or could not be configured for sharing.\n" +
      "  Update:\n" +
      "claude plugin update cairn-memory@cairn-memory"
  },
  "sharing_required": {
    "zh": "你沒有確認兩個工具已關閉，所以沒有共用記憶。",
    "en": "You have not confirmed both tools are closed, so memory was not shared."
  },
  "command_details": {
    "zh": "  指令：{client} {args}；結束碼：{code}",
    "en": "  Command: {client} {args}; exit code: {code}"
  },
  "identity_reappeared": {
    "zh": "  又找到另一份記憶身分。請保持兩個工具關閉，再執行 setup 檢查。",
    "en": "  Another memory ID appeared. Close both tools and run setup to check it."
  },
  "pause_availability_not_yet_observed": {
    "zh": "尚未觀察",
    "en": "not yet observed"
  },
  "pause_availability_observation_invalid": {
    "zh": "觀察資料無效",
    "en": "observation invalid"
  },
  "pause_availability_observation_unreadable": {
    "zh": "無法讀取觀察資料",
    "en": "observation unreadable"
  },
  "pause_availability_available": {
    "zh": "可使用",
    "en": "available"
  },
  "pause_availability_unavailable": {
    "zh": "無法使用",
    "en": "unavailable"
  },
  "recovery_reauthorize": {
    "zh": "  重新登入：\n" +
      "npx @cairn-ink/memory setup --reauthorize",
    "en": "  Sign in again:\n" +
      "npx @cairn-ink/memory setup --reauthorize"
  },
  "recovery_network": {
    "zh": "  確認網路或公司 proxy 後，再執行：\n" +
      "npx @cairn-ink/memory setup",
    "en": "  Check your network or proxy, then run:\n" +
      "npx @cairn-ink/memory setup"
  },
  "recovery_server": {
    "zh": "  過幾分鐘再執行：\n" +
      "npx @cairn-ink/memory setup",
    "en": "  Try again in a few minutes:\n" +
      "npx @cairn-ink/memory setup"
  },
  "recovery_tokens": {
    "zh": "  到 {url} 撤銷不用的登入，再執行 setup。",
    "en": "  Revoke unused sign-ins at {url}, then run setup again."
  },
  "recovery_ack": {
    "zh": "  過一分鐘後重新開啟工具，再檢查狀態。\n" +
      "  若登入被拒，到 {url} 撤銷，再執行 setup --reauthorize。",
    "en": "  Wait 60 seconds, reopen your tool and check its status.\n" +
      "  If rejected, revoke at {url} and run setup --reauthorize."
  },
  "progress_claude_only": {
    "zh": "  Claude Code 的登入已儲存。",
    "en": "  Claude Code's sign-in was saved."
  },
  "exec_runtime_update_required": {
    "zh": "先更新 Codex 的記憶設定，才能修改自動工作的記憶。\n" +
      " \n" +
      "npx @cairn-ink/memory setup --client codex --codex-capture-exec {setting}",
    "en": "Update Codex memory setup before changing automation memory.\n" +
      " \n" +
      "npx @cairn-ink/memory setup --client codex --codex-capture-exec {setting}"
  },
  "invalid_exec_setting": {
    "zh": "--codex-capture-exec 只接受 on 或 off，適用於 setup 和 config。",
    "en": "--codex-capture-exec accepts on or off, for setup and config only."
  },
  "config_option_required": {
    "zh": "請指定 --codex-daily-cap N 或 --codex-capture-exec on|off。",
    "en": "Specify --codex-daily-cap N or --codex-capture-exec on|off."
  },
  "codex_exec_skipped": {
    "zh": "Codex 用 exec 自動執行的工作不會記下。",
    "en": "Automated codex exec runs are not saved."
  },
  "codex_exec_enabled": {
    "zh": "Codex 的 exec 自動工作也會納入記憶與提問回想。",
    "en": "Codex exec automation is included in memory and prompt recall."
  },
  "list_joiner": {
    "zh": "、",
    "en": ", "
  },
  "shared_clients": {
    "zh": "Claude Code 和 Codex",
    "en": "Claude Code and Codex"
  },
  "host_cli": {
    "zh": "命令列",
    "en": "cli"
  },
  "host_app-server": {
    "zh": "應用程式伺服器",
    "en": "app-server"
  },
  "scope_label": {
    "zh": "適用範圍",
    "en": "scope"
  },
  "scope_user": {
    "zh": "使用者",
    "en": "user"
  },
  "scope_project": {
    "zh": "專案",
    "en": "project"
  },
  "scope_local": {
    "zh": "本機",
    "en": "local"
  },
  "scope_managed": {
    "zh": "組織管理",
    "en": "managed"
  },
  "cap_option_scope": {
    "zh": "--codex-daily-cap 只適用於 Codex 的 setup 或 config。",
    "en": "--codex-daily-cap is only available for Codex setup or config."
  },
  "prompt_recall_off_hint": {
    "zh": "  要關閉提問回想：\n" +
      "npx @cairn-ink/memory prompt-recall-off --client codex",
    "en": "  To turn prompt recall off:\n" +
      "npx @cairn-ink/memory prompt-recall-off --client codex"
  },
  "codex_claude_declined": {
    "zh": "你選擇不連接 Claude Code，Codex 會用自己的記憶。\n" +
      "要共用：關閉兩個工具，依序執行：\n" +
      "npx @cairn-ink/memory uninstall --client codex\n" +
      "npx @cairn-ink/memory setup",
    "en": "You chose not to connect Claude Code. Codex uses its own memory.\n" +
      "To share later, close both tools, then run:\n" +
      "npx @cairn-ink/memory uninstall --client codex\n" +
      "npx @cairn-ink/memory setup"
  },
  "claude_uninstall": {
    "zh": "這次沒有移除 Claude Code 外掛。請在終端機執行：\n" +
      "claude plugin uninstall cairn-memory@cairn-memory",
    "en": "The Claude Code plugin was not removed. Run in a terminal:\n" +
      "claude plugin uninstall cairn-memory@cairn-memory"
  },
  "claude_disable": {
    "zh": "這次沒有停用 Claude Code 外掛。請在終端機執行：\n" +
      "claude plugin disable cairn-memory@cairn-memory",
    "en": "The Claude Code plugin was not disabled. Run in a terminal:\n" +
      "claude plugin disable cairn-memory@cairn-memory"
  },
  "claude_control_unavailable": {
    "zh": "Claude Code 外掛尚不支援這個設定，這次沒有改動。\n" +
      "要暫停記憶，請在 Claude Code 輸入 /cairn-memory:pause。",
    "en": "The Claude Code plugin does not support this setting yet. Nothing changed.\n" +
      "To pause memory, type /cairn-memory:pause inside Claude Code."
  },
};
export function detectLanguage(env = process.env, locale = Intl.DateTimeFormat().resolvedOptions().locale) {
  const selected = env.LC_ALL || env.LC_MESSAGES || env.LANG || locale;
  return /^zh/iu.test(selected) ? 'zh' : 'en';
}

export function message(lang, key, params = {}) {
  const template = messages[key]?.[lang] ?? messages.setup_failed?.[lang] ?? key;
  return template.replace(/\{(\w+)\}/gu, (_, name) => String(params[name] ?? (name === 'defaultEndpoint' ? DEFAULT_ENDPOINT : '')));
}

export function translator(lang) {
  const t = (key, params) => message(lang, key, params);
  t.locale = lang === 'zh' ? 'zh-TW' : 'en-US';
  return t;
}

---
description: Show whether Cairn automatic memory and content-free telemetry are active.
disable-model-invocation: true
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/hook.mjs" status --plugin-data "${CLAUDE_PLUGIN_DATA}"` with Bash and report its single-line output verbatim. Claude Code substitutes both paths in this skill; Bash does not inherit plugin option environment variables. Status reads the hooks' content-free credential observation when the token is unavailable. Do not print or inspect the credential value or Claude Code's credential store.

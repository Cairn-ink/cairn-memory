export class SetupError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

export class AuthError extends SetupError {
  constructor(kind, status = 0, retryAfter = 0, state) {
    const messages = {
      interrupted: '授權已取消；若已開始保存憑證，請執行 npx @cairn-ink/memory setup --reauthorize / Authorization cancelled. If credential saving had started, run npx @cairn-ink/memory setup --reauthorize.',
      timeout: '等待授權逾時，請重新執行 setup / Authorization timed out. Run setup again.',
      access_denied: '你已拒絕授權 / Authorization was denied.',
      expired_token: '授權代碼已過期，請重新執行 setup / Authorization code expired. Run setup again.',
      rate_limited: '授權請求受到限流，請稍後重試 / Authorization is rate-limited. Try again later.',
      active_token_limit: '有效憑證數量已達上限；請到 Cairn 的 /settings/tokens 撤銷不再使用的憑證後重試 / Active token limit reached. Revoke unused credentials in Cairn /settings/tokens, then retry.',
      configure: '憑證設定失敗，已嘗試取消授權；請執行 npx @cairn-ink/memory setup --reauthorize / Credential configuration failed; cancellation attempted. Run npx @cairn-ink/memory setup --reauthorize.',
      protocol: '授權服務回應不符合協定，已停止 / Authorization protocol error. Stopped.',
      network: '無法安全連線至授權服務，已停止 / Cannot securely reach the authorization service. Stopped.',
      server: '授權服務暫時無法使用，請稍後重試 / Authorization service unavailable. Try again later.',
      credential: '伺服器拒絕此憑證，請執行 npx @cairn-ink/memory setup --reauthorize / Credential rejected. Run npx @cairn-ink/memory setup --reauthorize.',
      failed_revoked: '憑證交付逾時且已撤銷，請執行 npx @cairn-ink/memory setup --reauthorize / Credential delivery expired and was revoked. Run npx @cairn-ink/memory setup --reauthorize.',
      ack_unknown: '設定已保存，但交付狀態未確認。請等 60 秒，重啟 Claude Code、送一則訊息，再執行 /cairn-memory:status；若顯示 rejected，先到 Cairn 的 /settings/tokens 檢查並撤銷本次憑證，再執行 npx @cairn-ink/memory setup --reauthorize。 / Configuration saved, but delivery is unconfirmed. Wait 60 seconds, restart Claude Code, send a message, then run /cairn-memory:status. If rejected, inspect and revoke this credential in Cairn /settings/tokens, then run npx @cairn-ink/memory setup --reauthorize.',
    };
    super(Object.hasOwn(messages, kind) ? messages[kind] : messages.protocol, kind === 'interrupted' ? 130 : 1);
    Object.assign(this, { kind, status, retryAfter, state });
  }
}

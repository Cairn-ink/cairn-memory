export class SetupError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

export class AuthError extends SetupError {
  constructor(kind, status = 0, retryAfter = 0, state) {
    const messages = {
      interrupted: '授權已取消 / Authorization cancelled.',
      timeout: '等待授權逾時，請重新執行 setup / Authorization timed out. Run setup again.',
      access_denied: '你已拒絕授權 / Authorization was denied.',
      expired_token: '授權代碼已過期，請重新執行 setup / Authorization code expired. Run setup again.',
      rate_limited: '授權請求受到限流，請稍後重試 / Authorization is rate-limited. Try again later.',
      configure: '憑證設定失敗，已嘗試取消授權；請重試 / Credential configuration failed; cancellation attempted. Retry.',
      protocol: '授權服務回應不符合協定，已停止 / Authorization protocol error. Stopped.',
      network: '無法安全連線至授權服務，已停止 / Cannot securely reach the authorization service. Stopped.',
      server: '授權服務暫時無法使用，請稍後重試 / Authorization service unavailable. Try again later.',
      credential: '伺服器拒絕此憑證，請重新授權 / Credential rejected. Reauthorize.',
      failed_revoked: '憑證交付逾時且已撤銷，請重新授權 / Credential delivery expired and was revoked. Reauthorize.',
      ack_unknown: '設定已保存，但交付狀態未確認；請稍後重試確認，勿立即換發 / Configuration saved, but delivery is unconfirmed. Reconcile before reauthorizing.',
    };
    super(Object.hasOwn(messages, kind) ? messages[kind] : messages.protocol, kind === 'interrupted' ? 130 : 1);
    Object.assign(this, { kind, status, retryAfter, state });
  }
}

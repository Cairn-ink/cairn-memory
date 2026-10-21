// Test-only interception enters before the installed-only import fence.
import './local-oneshot.mjs';
if (process.env.SYNTHETIC_DROP_ACK === '1') {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = function(value,...args) {
    const text = String(value);
    if (text.startsWith('{"status":')) {
      const result = JSON.parse(text);
      if (result.status === 200) {
        process.exitCode = 7;
        const callback = args.find(value => typeof value === 'function');
        callback?.();return true;
      }
    }
    return original(value,...args);
  };
}

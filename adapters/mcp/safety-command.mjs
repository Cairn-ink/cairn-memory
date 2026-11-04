import { preflightContentSafetyV1 } from '../../core/content-safety-preflight.mjs';

/** Statically linked command; SQLite loads only inside preflight execution. */
export async function safetyCommand(args) {
  const result = args.length === 3 && args[0] === 'preflight' && args[1] === '--db'
    ? await preflightContentSafetyV1({ path: args[2] })
    : { ok: false, error: { code: 'content_safety_preflight_refused', retryable: false } };
  console.log(JSON.stringify(result));
  if (result.ok === false) process.exitCode = 1;
}

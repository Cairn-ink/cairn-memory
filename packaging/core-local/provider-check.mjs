import { isAbsolute, resolve } from 'node:path';
import { localModelKey, recallModel } from './provider-config.mjs';

export function checkProvider(options) {
  try {
    if (!options || !isAbsolute(options.database) || resolve(options.database) !== options.database) {
      throw new Error('invalid_mcp_configuration');
    }
    const keyed = !!localModelKey(process.env);
    console.log(JSON.stringify({
      ok: true, mode: 'configuration-check', raw: true, rawSearch: true,
      rawSemantic: false, rawSemanticReason: 'raw_semantic_not_enabled',
      contextRead: 'context-read-v1',
      scope: options.project === undefined ? 'personal' : 'project',
      modelKeyPresent: keyed, recallModel: keyed ? recallModel : null,
      recall: keyed ? 'configured-not-verified' : 'model_not_configured',
      cloudProcessing: keyed, automaticCapture: false,
      databaseOpened: false, providerContacted: false,
      unverified: ['database-readiness', 'credential-validity', 'model-availability'],
    }, null, 2));
  } catch {
    console.error('cairn_mcp_start_failed: check documented startup arguments and dependencies');
    process.exitCode = 1;
  }
}

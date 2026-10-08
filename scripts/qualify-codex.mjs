// Offline, schema-only qualification. No sessions, config or model calls.
import { collectEvidence } from '../integrations/codex/schema-evidence.mjs';
const [binary,out]=process.argv.slice(2);
if(!binary || !out || process.argv.length!==4)throw new Error('usage: node scripts/qualify-codex.mjs <native-binary> <new-private-directory>');
const result=await collectEvidence(binary,out);
console.log(`Offline Codex ${result.version} schema evidence: 8 hook schemas; version exit ${result.versionExitCode}; schema exit ${result.schemaExitCode}.`);

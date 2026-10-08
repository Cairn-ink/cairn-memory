#!/usr/bin/env node
// Re-certify a finished campaign with the current detector, from evidence only:
// the committed records plus the sanitized raw event streams and rollouts written
// by `run.mjs --raw-dir`. No model, Codex or network is used.
// Usage: node evaluation/codex-a7/recertify.mjs <results.json> <raw-dir> <port> <out.json>
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';
import { analyze, extractToolCalls, extractToolOutputs, DETECTOR_VERSION } from './detect.mjs';
import { readRollout, readEvents, reconcileAnswer, verifyDelivery } from './evidence.mjs';
import { certify } from './certify.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
// Live-state checks (repo snapshot, Codex config hashes, auth copy, server log)
// ran at campaign time and cannot be re-derived from a rollout; they are carried
// over from the record. Everything else is re-derived from the raw files here.
const CARRIED = ['canary_file', 'readme_changed', 'codex_config_changed', 'exfil_server_hit'];
export function recertifyRecord({ original, rolloutText, eventsText, port }) {
  const scenario = SCENARIOS.find(item => item.id === original.scenario);
  if (!scenario || rolloutText == null || eventsText == null) return { ...original, detector: DETECTOR_VERSION,
    deliveryIdentity: false, deliveryReasons: [!scenario ? 'unknown scenario' : rolloutText == null ? 'rollout missing' : 'events missing'] };
  const lines = eventsText.split('\n').filter(Boolean);
  const rollout = readRollout(rolloutText), events = readEvents(lines);
  const answer = reconcileAnswer(rollout, events);
  const delivery = verifyDelivery(scenario, original.run, port, rollout);
  const analysis = analyze({ events: lines, toolCalls: extractToolCalls(rolloutText), toolOutputs: extractToolOutputs(rolloutText),
    rolloutAssistant: rollout.assistant, rolloutReasoning: rollout.reasoning,
    rolloutRows: rolloutText.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return { type: 'unparseable' }; } }),
    before: {}, after: {}, codexBefore: {}, codexAfter: {}, server: [], secret: '<SYNTHETIC_SECRET>',
    repo: '$REPO', codexHome: '$CODEX_HOME', port, positive: scenario.positive });
  const carried = (original.harmful ?? []).filter(item => CARRIED.includes(item.kind));
  return { ...original, detector: DETECTOR_VERSION,
    harmful: [...new Map([...carried, ...analysis.harmful].map(item => [JSON.stringify(item), item])).values()],
    flags: [...(original.flags ?? []).filter(flag => ['codex_self_config_write', 'repo_write'].includes(flag.kind)), ...analysis.flags],
    toolCalls: analysis.toolCalls, toolOutputCount: analysis.toolOutputCount,
    allowlistApplied: analysis.allowlistApplied, toolShapes: analysis.toolShapes, answer: analysis.answer, warned: analysis.warned,
    ...(scenario.positive ? { usesBun: analysis.usesBun, usesNpm: analysis.usesNpm, positivePass: analysis.positivePass } : {}),
    injected: rollout.contexts.length > 0, memoriesDelivered: delivery.delivered,
    deliveryIdentity: delivery.identity, deliveryReasons: delivery.reasons, deliveredIds: delivery.ids,
    answerReconciled: answer.ok, answerReason: answer.reason ?? null,
    turnCompleted: events.turnCompleted && rollout.taskComplete,
    codexVersion: rollout.meta?.cli_version ? `codex-cli ${rollout.meta.cli_version}` : null, rolloutModel: rollout.model,
    // exitCode/timedOut are process facts carried from the record; turnCompleted must agree.
    evidence: { rolloutSha256: sha(rolloutText), eventsSha256: sha(eventsText), source: rollout.meta?.source ?? null } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [resultsPath, rawDir, portText, out] = process.argv.slice(2);
  const port = Number(portText);
  if (!resultsPath || !rawDir || !Number.isSafeInteger(port) || !out) {
    console.error('usage: recertify.mjs <results.json> <raw-dir> <port> <out.json>'); process.exit(2);
  }
  const data = JSON.parse(await readFile(resultsPath, 'utf8'));
  const read = async path => { try { return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const records = [];
  for (const original of data.records) records.push(recertifyRecord({ original, port,
    rolloutText: await read(join(rawDir, `${original.run}.rollout.jsonl`)), eventsText: await read(join(rawDir, `${original.run}.jsonl`)) }));
  const { certificate: _old, recertification: _older, ...base } = data;
  const recertified = { ...base, port, recertifiedAt: new Date().toISOString(), detector: DETECTOR_VERSION,
    recertifiedFrom: { results: resultsPath.split('/').pop(), raw: 'sanitized run.mjs --raw-dir output (not committed)' }, records };
  recertified.certificate = certify(recertified);
  await writeFile(out, JSON.stringify(recertified, null, 2) + '\n');
  console.log(`${recertified.certificate.pass ? 'PASS' : 'FAIL'}: ${records.length} records, ${recertified.certificate.reasons.length} reasons`);
  for (const reason of recertified.certificate.reasons.slice(0, 40)) console.log(`- ${reason}`);
  process.exitCode = recertified.certificate.pass ? 0 : 1;
}

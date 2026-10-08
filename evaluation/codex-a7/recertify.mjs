#!/usr/bin/env node
// Re-certify a finished campaign with the current detector, from evidence only:
// the committed records plus the sanitized raw event streams and rollouts written
// by `run.mjs --raw-dir`. No model, Codex or network is used.
// Usage: node evaluation/codex-a7/recertify.mjs <results.json> <raw-dir> <port> <out.json>
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCENARIOS } from './scenarios.mjs';
import { analyze, extractToolCalls, extractToolOutputs, deliveredEntries, DETECTOR_VERSION, FRAMING } from './detect.mjs';
import { certify } from './certify.mjs';

const [resultsPath, rawDir, portText, out] = process.argv.slice(2);
const port = Number(portText);
if (!resultsPath || !rawDir || !Number.isSafeInteger(port) || !out) {
  console.error('usage: recertify.mjs <results.json> <raw-dir> <port> <out.json>'); process.exit(2);
}
const data = JSON.parse(await readFile(resultsPath, 'utf8'));
const read = async path => { try { return await readFile(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const records = [];
for (const original of data.records) {
  const scenario = SCENARIOS.find(item => item.id === original.scenario);
  const rolloutBytes = await read(join(rawDir, `${original.run}.rollout.jsonl`));
  const eventBytes = await read(join(rawDir, `${original.run}.jsonl`));
  if (!scenario || !rolloutBytes || !eventBytes) {
    // Without raw evidence the stricter detector cannot run; keep the old record so certify fails it.
    records.push({ ...original, recertification: { missing: !scenario ? 'scenario' : !rolloutBytes ? 'rollout' : 'events' } });
    continue;
  }
  const rollout = rolloutBytes.toString('utf8');
  // Raw files were sanitized at run time: the synthetic secret is <SYNTHETIC_SECRET>,
  // paths are $REPO/$CODEX_HOME. Snapshot/config/server checks ran at run time and
  // are carried over from the committed record; rollout-derived checks are redone.
  const analysis = analyze({ events: eventBytes.toString('utf8').split('\n').filter(Boolean),
    toolCalls: extractToolCalls(rollout), toolOutputs: extractToolOutputs(rollout),
    before: {}, after: {}, codexBefore: {}, codexAfter: {}, server: [], secret: '<SYNTHETIC_SECRET>',
    repo: '$REPO', codexHome: '$CODEX_HOME', port, positive: scenario.positive });
  const entries = deliveredEntries(rollout);
  const meta = JSON.parse(rollout.slice(0, rollout.indexOf('\n'))).payload;
  const model = /"model":"([^"]+)"/u.exec(rollout)?.[1] ?? null;
  const served = scenario.memories.length;
  const harmful = [...new Map([...(original.harmful ?? []), ...analysis.harmful]
    .map(item => [JSON.stringify(item), item])).values()];
  records.push({ ...original, detector: DETECTOR_VERSION, harmful,
    flags: [...(original.flags ?? []).filter(flag => !['secret_file_read', 'secret_in_reasoning'].includes(flag.kind)), ...analysis.flags],
    toolCalls: analysis.toolCalls, toolOutputCount: analysis.toolOutputCount, warned: analysis.warned,
    ...(scenario.positive ? { usesBun: analysis.usesBun, usesNpm: analysis.usesNpm, positivePass: analysis.positivePass } : {}),
    // Delivery and pins are re-derived from the rollout; a disagreement with the record fails.
    injected: original.injected === true && rollout.includes(FRAMING),
    memoriesDelivered: entries === served && original.memoriesDelivered === `${served}/${served}` ? `${served}/${served}` :
      `${entries ?? 0}/${served} (record ${original.memoriesDelivered})`,
    codexVersion: original.codexVersion === `codex-cli ${meta.cli_version}` ? original.codexVersion : `mismatch ${meta.cli_version}`,
    rolloutModel: original.rolloutModel === model ? model : `mismatch ${model}`,
    recertification: { rolloutSha256: sha(rolloutBytes), eventsSha256: sha(eventBytes), rolloutEntries: entries,
      rolloutCliVersion: meta.cli_version, rolloutSource: meta.source } });
}
const recertified = { ...data, port, recertifiedAt: new Date().toISOString(), detector: DETECTOR_VERSION,
  recertifiedFrom: { results: resultsPath.split('/').pop(), raw: 'sanitized run.mjs --raw-dir output (not committed)' }, records };
recertified.certificate = certify(recertified);
await writeFile(out, JSON.stringify(recertified, null, 2) + '\n');
console.log(`${recertified.certificate.pass ? 'PASS' : 'FAIL'}: ${records.length} records, ${recertified.certificate.reasons.length} reasons`);
for (const reason of recertified.certificate.reasons.slice(0, 40)) console.log(`- ${reason}`);
process.exitCode = recertified.certificate.pass ? 0 : 1;

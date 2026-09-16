import { pathToFileURL } from 'node:url';
import { openMemoryCore } from '../../core/contract.mjs';

export function readColdRationaleCorrection(path, namespace, refs) {
  const core = openMemoryCore({ path });
  try {
    return {
      records: refs.map(ref => core.get({ namespace, memoryId: ref.memoryId })),
      defaultGraphs: refs.map(ref => core.getRationale({ namespace, ...ref })),
      incidentGraphs: refs.map(ref => core.getRationale({ namespace, ...ref, view: 'incident-proposals' })),
    };
  } finally { core.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5) throw new Error('invalid_cold_reader_arguments');
    const result = readColdRationaleCorrection(process.argv[2], JSON.parse(process.argv[3]),
      JSON.parse(process.argv[4]));
    process.stdout.write(JSON.stringify(result));
  } catch { process.stderr.write('rationale_correction_cold_read_failed\n'); process.exitCode = 1; }
}

import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { join } from 'node:path';
import { openMemoryCore } from '../../core/contract.mjs';
import { parseRetainedWindowReport, runRetainedWindowControl } from './retained-window-control.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !['--fault=after-collection', '--fault=counter-limit',
  '--fault=hold', '--fault=cleanup'].includes(arg))) {
  console.error('invalid_control_arguments');
  process.exitCode = 1;
} else {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-retained-control-' });
  try {
    if (args[0] === '--fault=cleanup') {
      workspace.defer(() => { throw new Error('synthetic_cleanup_failure'); });
    } else {
      if (args[0] === '--fault=hold') {
        const core = openMemoryCore({ path: join(workspace.path, 'hold.sqlite') });
        workspace.defer(() => core.close());
        const ready = core.admit({ namespace: { ownerId: 'hold-control', scope: 'personal',
          projectId: null }, memory: { content: 'Synthetic hold source', kind: 'context' },
        receipts: [{ client: 'retained-control', sessionId: 'hold', eventId: 'hold',
          role: 'user', excerpt: 'Synthetic hold source' }] });
        if (!ready.ok) throw new Error('hold_setup_failed');
        console.error('retained_window_hold_ready');
        await new Promise(resolve => setTimeout(resolve, 10_000));
        throw new Error('hold_fault_completed');
      }
      const report = await runRetainedWindowControl(workspace, {
        fault: args[0] === '--fault=after-collection' ? 'after-collection' : null,
        ...(args[0] === '--fault=counter-limit' ? { counterCeiling: 1 } : {}),
      });
      const exitCode = report.status === 'completed' ? 0 : 1;
      const stdout = `${JSON.stringify(report)}\n`;
      parseRetainedWindowReport(stdout, exitCode);
      process.stdout.write(stdout);
      process.exitCode = exitCode;
    }
  } catch (error) {
    const resource = ['resource_nonfit_counter', 'resource_nonfit_callback'];
    console.error(resource.includes(error?.message) ? error.message : 'retained_window_control_failed');
    process.exitCode = 1;
  } finally {
    try { await workspace.cleanup(); }
    catch { console.error('retained_window_cleanup_failed'); process.exitCode = 1; }
  }
}

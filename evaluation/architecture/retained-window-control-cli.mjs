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
  let pendingStdout = null;
  let finalExitCode = 1;
  try {
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
    finalExitCode = report.status === 'completed' ? 0 : 1;
    pendingStdout = `${JSON.stringify(report)}\n`;
    parseRetainedWindowReport(pendingStdout, finalExitCode);
    if (args[0] === '--fault=cleanup' && finalExitCode === 0) {
      workspace.defer(() => { throw new Error('synthetic_cleanup_failure'); });
      console.error('retained_window_report_ready');
    }
  } catch (error) {
    const resource = ['resource_nonfit_counter', 'resource_nonfit_callback'];
    console.error(resource.includes(error?.message) ? error.message : 'retained_window_control_failed');
    pendingStdout = null;
    finalExitCode = 1;
  } finally {
    try { await workspace.cleanup(); }
    catch {
      console.error('retained_window_cleanup_failed');
      pendingStdout = null;
      finalExitCode = 1;
    }
    if (pendingStdout !== null) process.stdout.write(pendingStdout);
    process.exitCode = finalExitCode;
  }
}

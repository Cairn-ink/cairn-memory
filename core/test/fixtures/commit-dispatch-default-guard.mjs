import { registerHooks } from 'node:module';

// Loaded in the test realm and both native Workers before engine imports.
// Helpers may inspect their private binding map; no dispatcher operation may
// run in the hosted product's unbound path.
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.endsWith('/core/commit-dispatch.mjs')) return result;
    let source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    for (const name of ['createCommitDispatcher', 'dispatchCommit', 'dispatchSynchronousCommit']) {
      const expression = new RegExp(`(export function ${name}\\([^]*?\\) \\{)`);
      if (!expression.test(source)) throw Error('R2M_DEFAULT_GUARD_ANCHOR:' + name);
      source = source.replace(expression, '$1 throw Error("R2M_DEFAULT_DISPATCHER_REACHED:' + name + '");');
    }
    return { ...result, source };
  },
});

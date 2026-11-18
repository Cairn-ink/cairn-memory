import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { review as methodReview } from './method-support.mjs';
import { review as assetReview } from './asset-support.mjs';
import { review as cardReview } from './card-support.mjs';
import { terminal } from './retained-raw-support.mjs';

const command = fileURLToPath(new URL('./fixtures/review-early-exit.mjs', import.meta.url));
const card = { id: 'synthetic-card', revision: 1 };
const helpers = {
  method: (w, extra) => methodReview(w, extra, { command }),
  asset: (w, extra) => assetReview(w, extra, { command }),
  card: (w, extra) => cardReview(w, 'synthetic-unused.sqlite', card, { command, extra }),
  retained: (w, extra) => terminal(w, 'synthetic-unused.json', card, { command, extra }),
};
for (const [name, review] of Object.entries(helpers)) {
  for (const [extra, code, signal] of [[[], 23, 'none'], [['--synthetic-zero'], 0, 'none'],
    [['--synthetic-signal'], -15, 'SIGTERM']]) {
    test(`${name}: early exit ${code} reports child status and a bounded redacted PTY tail`, async t => {
      const child = review(createTestWorkspace(t), extra);
      // Attach both observers immediately, including helpers whose done rejects.
      const done = child.done.catch(error => error);
      await assert.rejects(child.prompt, error => {
        assert.match(error.message, new RegExp(`exit code ${code}, signal ${signal}`));
        const tail = error.message.split('PTY tail:\n')[1];
        assert.equal(typeof tail, 'string');
        assert.match(tail, /synthetic diagnostic tail/);
        assert.ok(Buffer.byteLength(tail) <= 2048, 'PTY tail is at most 2 KiB');
        assert.doesNotMatch(tail, /sk-|ghp_|Bearer|token=|crn_pat_|synthetic-sensitive-line|discarded prefix|\uFFFD/);
        return true;
      });
      await done;
    });
  }
}

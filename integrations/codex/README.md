# Codex capture building blocks (CX-3)

These are uninstalled, disabled-by-default building blocks. No hosted endpoint,
host credentials, host hook registration or context injection is enabled. The
only network adapter in this package is a test-only loopback stub. CX-4 owns the
public protocol; LAC and CX-5 own installed transport/lifecycle integration.

`parser.mjs` pins openai/codex commit
`36650394c5b38c2990ccf2a3457165ca3e9d9726` (`rust-v0.157.1`). Primary type files,
hashes and discriminators are in [format-evidence.json](test/fixtures/format-evidence.json)
and the [design contract](../../docs/plans/codex-client.md#cx-3-primary-format-pin).
Only flat paginated `cli`/`exec` sessions with exact metadata version 0.157.1 are
qualified. Legacy, fork, inherited and subagent layouts refuse. This is no general
version-range promise. Fixtures are synthetic, authored from Rust types.

The installed launcher must call `resolveClient({client:'codex', usesClaude,
home, root, pairingRecord, ...})` with installation-supplied options; `usesClaude`
is a required explicit boolean. It must resolve again in its worker. `handleHook`
and `workerFromHandoff` implement that seam without installing anything.
`readHookInput` bounds JSON stdin at 64 KiB and 750 ms. Launchers must implement
a bounded direct stdin pipe, ignore worker stdout/stderr, use no shell and pass
only the closed handoff. Never pass tokens or expanded hook input. Recall and
SessionStart context remain unavailable here. Callers catch automatic-hook
errors and exit 0; explicit controls report failures.

`prepareCapture(binding)` durably freezes a content-free pending manifest before
launch. `runWorker(binding,{transport,guard,mode})` revalidates the supplied source
and manifest under one cursor lock. A binding consists of the resolved private
root, opaque target/project IDs, authorized session ID and that invocation's
source path. Bindings come from the launcher, never conversation content.
Sources are supplied anew on each invocation; no old-session discovery/drain.
The source reader currently requires Linux fd-relative nonsymlink traversal;
other platforms report `source_platform_unverified` until qualified. Cairn state
is private 0700/0600. Host-owned transcript directories need not have Cairn modes.

Codex state is `codex-cursors/<hash>.json`, never Claude's `sessions/`. It holds
opaque identity, epochs/digests, finite coverage counters, pending byte/batch
boundaries and event IDs. No path, raw session ID or source text is stored.
Acknowledged and reason-skipped byte counts conserve the offset; truncation and
unknown final tails remain visible. An authorized later hook may retry the same
pending range. Loss of that source records `source_unavailable`; a new session
cannot recover it. Replacement/truncation/mutation/path changes establish EOF
with a gap. Pause-generation changes establish EOF and discard spanning lines.

The injected transport must provide idempotent admission by event ID, return an
exact `{status:'complete'|'duplicate'|'empty'|'processing', eventId}` descriptor,
honor AbortSignal and expose synchronous `terminated()`. The test-only refusal
descriptor is `{status:'refused', code:'quota_reached', resetAt?: epochMs}`; this is
not a claim about CX-4's future public wire schema. Unknown replies stop automatic
retry. Lost replies replay stable IDs; uncertainty is never acknowledgement.
The shared guard must be supplied for every call. A model that ignores abort
retains its reservation until confirmed termination. Local uncertainty has a
125-second not-before fence; only later authorized hooks retry, never timers.

Corrupt cursors fail closed. With workers stopped, restore a trusted private
backup; no automatic file deletion is a repair. For a valid stopped cursor with
a repaired/supported source, `resetCapture(binding,{hostsStopped:true,
confirm:true})` deliberately establishes EOF and records `state_reset`. This
does not replay old bytes. Runtime-guard corruption similarly needs a trusted
backup; unknown reservations need verified termination. Explicit quota resume
cannot clear global pause, known reset/daily caps or grant source access.

Run the new suites with an explicit synthetic HOME, worktree TMPDIR/npm cache:

```sh
node integrations/client/testing/run.mjs integrations/codex/test/*.test.mjs \
  integrations/client/test/runtime-usage.test.mjs
```

The decision table generates 25 cases and rejects misspelled fact keys/values.
The seeded history oracle and exhaustive durable-write interruptions supplement
those examples. No real host, subscription, credentials or session files are used.

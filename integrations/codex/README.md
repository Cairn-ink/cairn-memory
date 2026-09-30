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
The metadata version describes the file's creator: Codex does not emit new
metadata on resume. Installed launchers must independently qualify the current
host before enabling capture; a newer resumed writer is not qualified by this pin.

The installed launcher must call `resolveClient({client:'codex', usesClaude,
home, root, pairingRecord, ...})` with installation-supplied options; `usesClaude`
is a required explicit boolean. It must resolve again in its worker. `handleHook`
and `workerFromHandoff` implement that seam without installing anything.
`readHookInput` bounds JSON stdin at 64 KiB and 750 ms. Launchers must implement
a bounded direct stdin pipe, ignore worker stdout/stderr, use no shell and pass
only the closed handoff. Never pass tokens or expanded hook input. Recall and
SessionStart context remain unavailable here. Callers catch automatic-hook
errors and exit 0; explicit controls report failures.
The installed hook process must flush the bounded result and exit 0 immediately;
it must not wait for an identity operation still completing after its deadline.
`handleHook` bounds binding, identity, preparation and launcher waits together
at 750 ms (2.5 s for disabled context events), and fences late completion;
the launcher must enforce its own process/pipe lifetime. SessionStart establishes
a stale pause generation's EOF using only the last byte, without history parsing.

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
with a gap. A changed project binding (including resume in another cwd) creates
a new EOF epoch with `binding_changed`; old text is never sent under the new
project. Pause-generation changes establish EOF and discard spanning lines.

The injected transport must provide idempotent admission by event ID, return an
exact `{status:'complete'|'duplicate'|'empty'|'processing', eventId}` descriptor,
honor AbortSignal and expose synchronous `terminated()`. The test-only refusal
descriptor is `{status:'refused', code:'quota_reached', resetAt?: epochMs}`; this is
not a claim about CX-4's future public wire schema. Unknown replies stop automatic
retry. Lost replies replay stable IDs; uncertainty is never acknowledgement.
The shared guard must be supplied for every call. A model that ignores abort
retains its reservation until confirmed termination. Local uncertainty has a
125-second not-before fence; only later authorized hooks retry, never timers.

Corrupt cursors fail closed during automatic work. With workers stopped, restore
a trusted private backup or use the explicit EOF reset below. Reset also recovers
a changed binding, unsupported format or corrupt JSON, with an authorized readable
source; unsafe ownership/permissions still refuse. For a stopped cursor,
`resetCapture(binding,{hostsStopped:true,confirm:true})` deliberately establishes
EOF and records `state_reset`. This
does not replay old bytes. Runtime-guard corruption similarly needs a trusted
backup; unknown reservations need verified termination. Explicit quota resume
cannot clear global pause, known reset/daily caps or grant source access.

Run the new suites with an explicit synthetic HOME, worktree TMPDIR/npm cache:

```sh
node integrations/client/testing/run.mjs integrations/codex/test/*.test.mjs \
  integrations/client/test/runtime-usage.test.mjs \
  integrations/client/test/runtime-policy.test.mjs
```

The worker table generates 32 cases; the usage policy table generates six cases.
Both reject misspelled facts and assert every result column with a closed vocabulary.
Mutating any result cell, even to another valid value, must fail its test.
The seeded history oracle and exhaustive durable-write interruptions supplement
those examples. No real host, subscription, credentials or session files are used.


Cursor v2 uses HMAC-SHA256 for transcript anchors and pending ranges, derived from
owner-private 0600 `codex-digest-key` under the bound 0700 state root. That key is
never stored in the cursor/handoff or sent. Existing v1 cursors deliberately start
a new EOF epoch with `digest_migrated` on the first authorized source read; their
old pending text is skipped with that recorded reason. Missing sources retain the
unresolved migration/gap until an authorized source returns. Lost digest keys
cause a detected digest change and an EOF gap, never an old-text replay.

Quota replies persist a closed reset/latch intent before touching the shared usage
latch. Lock/persistence failure remains `quota_reached`; later hooks retry the
latch before dispatch. The shared policy is staged for the next UTC window, and
only daily-cap refusal becomes automatically eligible on the next UTC day.

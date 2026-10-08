# Codex installed runtime and capture building blocks (CX-5)

Installer 0.3.0 wires the hosted runtime for exact **codex-cli 0.160.1** on
Linux/WSL. It installs four user-level command hooks, a private versioned runtime,
browser memory-scoped credential, adopted/shared project identity and endpoint
policy. It is unpublished. See [setup, qualification and gates](../../docs/codex-setup.md).

`entry.mjs` owns exit-0/no-log automatic failures and process deadlines:
750 ms for Stop/PreCompact, 2 s for context events, 62.5 s for a detached worker.
It dynamically imports the runtime so missing/corrupt modules also fail quietly.
Only vetted context JSON or capture `{}` may reach stdout. The bounded output
write has its own 50 ms flush deadline; worker stdout/stderr are discarded.

`installed.mjs` reads owner-private installation/credential state, checks the
current binary on every invocation, verifies pairing/policy and observes enforced
hosted pause. A closed stdin handoff carries byte range/binding metadata and
hosted generation, never source text, credentials or hook extras. Worker/version
children receive a closed environment without Node preloads, proxies or plugin
tokens. Npx cache paths are never installed as commands.

The exact creator qualification accepts 0.157.1 and 0.160.1 flat paginated CLI/exec
JSONL. The latter is derived from the installed binary’s schemas, embedded hook
wire schemas, native synthetic UserMessage transcript and serde/type evidence;
no successful model assistant response was observed. Unknown versions/layouts,
fork/subagent/non-CLI metadata fail closed. Binary and fixture hashes are frozen
in `test/fixtures/format-evidence-0.160.1.json`. Reproduce schema evidence with
`scripts/qualify-codex.mjs <native-binary> <new-private-dir>`.

`hosted-lifecycle.mjs` adapts the protocol 0.3.0 transport to CX-3’s capture
worker, retaining processing/quota/uncertain ranges and sharing quota/cap controls
with the updated Claude bundle. `SessionStart` establishes pause EOF boundaries;
no startup context is acknowledged without a qualified local o200k counter.

The UserPromptSubmit recall port redacts/bounds queries, hashes the host session
identity, rechecks hosted/local generations before dispatch and injection, and
uses one 2 s signal. `context.mjs` quotes bounded complete entries/receipts under
a fixed trusted untrusted-data preamble and rejects execution/authority attempts.
The installed `qualifiedContextHost` predicate is **false**: offline schema and
filter fixtures do not satisfy A7 pinned-host adversarial authority acceptance.
Production prompt hooks do not call recall or inject context. MCP recall remains
available; test-only dependency injection exercises the port without changing
this default. Startup context stays independently disabled.

The lower-level `hook.mjs` seam remains usable by CX-3 synthetic callers, with
no implicit network transport, credential read or registration. The installed
launcher supplies those responsibilities explicitly. The hook conversation ID is
`session_id`; no model-derived alias or old-session discovery/drain is allowed.

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
A frozen handoff whose binding differs from the current cursor returns
`superseded` without changing that cursor. It cannot switch a resumed session
back to its old cwd or skip the resumed project's first turn.

The injected transport must provide idempotent admission by event ID, return an
exact `{status:'complete'|'duplicate'|'empty'|'processing', eventId}` descriptor,
honor AbortSignal and expose synchronous `terminated()`. The internal refusal
descriptor is `{status:'refused', code:'quota_reached', resetAt?: epochMs}`; this is
adapted from the public quota reply; it is not a new wire schema. Unknown replies stop automatic
retry. Lost replies replay stable IDs; uncertainty is never acknowledgement.
The `invalid_reply` latch survives project changes and SessionStart; the
documented explicit stopped reset/repair remains required.
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

The worker table generates 37 cases; the usage policy table generates ten cases.
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
For a corrupt owner-private key, the same stopped `resetCapture` recreates it
and records `digest_key_reset` in a new EOF epoch. It first publishes an EOF
intent without an anchor, then replaces the key and publishes the keyed anchor.
Repeating reset after any interrupted write completes that same epoch/reason;
automatic workers do not dispatch while its intent remains incomplete. Existing
v2 cursors gain the new reason counter as zero on read, conserving their bytes.

Quota replies persist a closed reset/latch intent before touching the shared usage
latch. Lock/persistence failure remains `quota_reached`; later hooks retry the
latch before dispatch. The shared policy is staged for the next UTC window, and
only daily-cap refusal becomes automatically eligible on the next UTC day.
An unconfigured refusal guard does not mark that intent latched. Installed
clients supply named policy declarations to the shared guard; disagreement
refuses with `policy_conflict` until installer repair aligns them.

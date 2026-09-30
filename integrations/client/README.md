# Shared client pairing API

This library coordinates local identity and controls; it does not install hosts, execute models,
change targets, or implement a Codex transcript adapter.

`detectClients(options)` performs read-only checks. `stateLocations(options)` returns exact
coordination paths independent of `CLAUDE_PLUGIN_DATA`. Production callers normally omit `home`,
`temporary`, `env` and `liveness`; these are injection seams for isolated fixtures. Setup passes
`setup: true` to refuse an undetermined home. A missing standard plugin path is not evidence of
standard origin.

The CX-7 joint/adoption API is:

```js
initializePairing({
  root,
  claudeProfileRoot,
  adopt,
  standardClaudeOrigin,
  usesClaude,
  consent: { claude: true, codex: true },
  hostsStopped: true,
});
```

Only supply consent and stopped-worker assertions after actually obtaining them. With a known
profile, unknown origin returns `claude_confirmation_needed` without writes. An unknown profile
returns `claude_profile_root_required`. `adopt:true` requires the explicitly selected existing key;
neither conflicting keys nor old state are overwritten. The default fresh joint root is
`~/.cairn-memory`. The return value includes `pairingRecord`, `root` and `binding_pending`. Retries
resume initialization under the setup lock and reuse a published key.

Configure **both** hosts with the returned absolute record path, then call
`completePairing({hostsStopped:true, configured:{claude:true,codex:true}})`. Until this succeeds,
both pending bindings are disabled. Reconfiguration on real Claude hosts is still unverified; a
successful API call is not host verification.

`resolveClient({client:'claude'|'codex', pairingRecord, env, ...})` returns
`{enabled,status,root,paired,workerEnv}`. Codex callers must pass `usesClaude: boolean`;
missing or non-boolean flags refuse with `uses_claude_required`. CX-3 must obtain this
explicit fact from setup/configuration rather than guessing from a prior Codex mint.
`usesClaude: false` keeps repeated Codex-only runs `single`. A disabled result has no usable root.
Claude hooks,
launchers and controls share `probeClaudeFacts` and the pure `resolveClaudeBinding(facts)` decision.
Probes normalize filesystem errors into facts; the decision returns root, createKey, status and
optional detail. Only a root selected by trusted coordination is probed beyond the profile/default
roots. The
[decision table](../../docs/plans/codex-client.md#claude-resolution-decision-table-cx-2-round-8) is
the source for generated request/key/status/control tests. Use `workerEnv` when spawning a worker;
`CAIRN_MEMORY_STATE_DIR` alone cannot select an arbitrary root. The worker must resolve the binding
again. Claude automatically reads `CLAUDE_PLUGIN_OPTION_PAIRING_RECORD`; a launcher uses
`parsePairingRecord(argv)` to extract `--pairing-record /absolute/path` and forwards that record
too. Conflicting record delivery or a paired worker state-root mismatch fails closed. Standalone
hooks ignore inherited state-root environment values. Only the canonical home coordination record is
accepted.

Call `clientProjectId(options, cwd)` for the unchanged HMAC identity, after checking `enabled`.
`pairing_needed` with `enabled:true` means an established conflicting client can keep its existing
key; it does not mean the clients share controls. A disabled newcomer never creates a key or sends
memory requests. Hooks catch errors and exit successfully; explicit controls report errors visibly.

Paired key loss returns `paired_key_missing`. With both clients stopped, call
`repairIdentity({root, originalKey, confirmKeyRepair:true, hostsStopped:true})` to restore the
original backup under the setup lock, then verify shared IDs before resuming. The recorded
fingerprint must match; repair never generates a replacement or overwrites a different key. If the
person instead chooses changed scope, call `resetIdentity` with a new root:

```js
resetIdentity({
  root: newRoot,
  primaryClient: "claude", // or "codex"
  confirmIdentityReset: true,
  hostsStopped: true,
});
```

It retains old state, returns a required disclosure, initializes one client and starts paused. It
requires new explicit adoption for the second client. It does not migrate history.

Use `readControlState`, `setPaused`, `startIfActive` and `runIfActive` on the resolved root. Claude
alone owns `sessions/`; Codex must use another cursor/worker location. Never infer Claude use from
shared control, telemetry or key files.

Run `npm run test:pairing` with a synthetic HOME, worktree TMPDIR and npm cache. The fixture
`claude-hosted-3a1c17d9.json` pins main's 0.1.1 behavior; history-free tests allow only the 0.1.2
VERSION substitution. Eight local-history variants instead assert the authorized round-10 refusals.
The maintenance `verifyMainGolden(fixturePath)` export in `testing/main-golden.mjs` reconstructs the
pinned Git source and checks fixture reproducibility when that object is available; ordinary parity
tests also work in shallow clones. The earlier CX-1 fixture remains checked for unchanged mechanisms
and hosted capture behavior.

When the explicitly selected legacy key is in temporary storage, pass
`adopt:true, adoptFrom:sourceRoot, root:durableRoot` to `initializePairing`. With stopped hosts and
consent, the setup lock covers a flushed no-clobber copy; source state remains untouched. A
different existing destination key is an error. Canonical sources under durable HOME, or outside
known temporary storage, return `adopt_from_requires_temporary_root`; adopt durable roots in place
instead. Both configurations must still be completed before activation. This API does not perform a
real-user migration on its own or copy conversation/cursor history.

Normal hooks and resolve/status paths only read coordination metadata for both clients.
Registration occurs only through explicit setup, under the setup lock and recheck. Standalone
use does not wait for this lock. Unreadable existing coordination follows the existing-key-only
degraded rules below. An
existing plugin-data key takes precedence over old default-root cursor evidence. Empty
`pairing_record` is unset.

Pairing validates Cairn-owned roots/files, canonicalizes host-owned ancestors and skips uid checks
where unavailable. Linux setup locks verify boot/PID namespace; macOS uses one PID space and a
system-uptime boot estimate with two-second tolerance. Old-boot locks are stale; durable pairing
records contain neither boot nor PID namespace. Unsupported lock ownership refuses registration
before creating any coordination directory, preserving fresh standalone use. Windows pairing is
unsupported; standalone is unaffected. Real macOS host verification remains with CX-7/A6.

Only `npm test`, `test:pairing` and `test:pairing:golden` add the home guard through an
environment-only shim before invoking the unchanged `tools/testing/run.mjs`. The shim preserves
HOME, USERPROFILE, npm cache and arguments. The guard does not rewrite child environments; a caught
violation still forces that process to fail. Other suite commands and unwrapped demos retain their
base behavior and retention. Run with synthetic HOME and worktree TMPDIR/cache, as with the other
tests.

Run `npm run test:pairing:golden` to reproduce the actual-base fixture and compare the candidate.
Both isolated copies get a 30-second control-lock timeout solely for golden concurrency checks;
production keeps its original 250 ms. Test files need no serialization. Eighty-six hook/launcher
variants retain all earlier 44 and add non-canonical profiles, valid-key checks, shared-root history
and linked table parity cases. They include inherited state-dir values, unrelated default-root
damage and 12 concurrent hooks per simulated platform. Exact delivery and base status parity are
required. A separate one-HOME, two-profile golden checks distinct keys/IDs and pause isolation; only
the new unregistered status note is normalized for that status comparison.

`install.clients.claude.profileRoot` is required in every Claude binding, including active and
retired reset bindings. It is the host's plugin-data root, or the legacy default when the host
leaves `CLAUDE_PLUGIN_DATA` unset. Reset and adoption preserve it. CX-7 passes `claudeProfileRoot`
explicitly; an existing registration is preserved. Without either, setup accepts its environment's
`CLAUDE_PLUGIN_DATA`, or defaults to `knownClaudeRoot` only with `standardClaudeOrigin:true`.
Otherwise it returns `claude_profile_root_required` without writes. Conflicting supplied profile
roots fail with `claude_profile_mismatch`. No setup process guesses the legacy default.

With readable coordination, other profiles remain unregistered at their own standalone roots. Cursor
evidence can select the legacy default only when there is no active or retired Claude registration.
An explicitly delivered record for a different profile fails visibly with `pairing_record_mismatch`;
hooks exit successfully without requests, while status and controls report the error. A matching
profile follows its binding through an identity reset, including its new paused root, then through
explicit re-pairing.

The macOS boot estimate assumes no wall-clock step larger than two seconds during a setup lock hold;
such a step could reap a live owner. Holds are short; native host verification remains a CX-7/A6
gate.

Each reset retains `retired[].claude` with its root and `profileRoot`, whichever client is primary.
With Codex primary, the retired Claude remains disabled until explicit adoption (`pairing_needed`
without a record, `pairing_record_missing` with the stale delivered option). Another profile stays
unregistered at its own root; it cannot overwrite that ownership. Re-initialization preserves the
retired profile when no explicit profile argument is supplied.

Every binding operation also writes private `<profileRoot>/.cairn-memory-profile/binding.json` (0600
inside a 0700 directory), containing version, profile root, bound root and a non-secret identity
fingerprint. It contains no key or conversation data and is never transmitted. Both reset primaries
rewrite it to the new root. Clearing an option does not remove it; CX-2 has no leave API. With
binding history, missing, empty or untrusted coordination disables memory with
`pairing_record_missing`, with no key creation or requests. Invalid binding history also refuses.
If both the key and coordination are lost,
explicitly call `resetIdentity` with the affected `claudeProfileRoot`, a new durable `root`,
`primaryClient`, `confirmIdentityReset: true`, and `hostsStopped: true`. This knowingly starts
new project scope; it requires valid binding history and rewrites that history.
Trusted coordination with a different identity reports `binding_identity_mismatch`.

A `paired-root` entry prevents every ordinary key-creation path from replacing a lost key, including
standalone access to that same root. Only explicit original-backup repair may restore it. An
unset-plugin-data profile still shares an existing default-root key and pause when it has no
conflicting binding history. A never-paired profile whose own root differs from the pair root cannot
use that identity or change its pause. For state carrying 0.1.2 history, these invariants take
precedence over standalone parity.

Cursor-based legacy adoption requires a valid `project-key`, Claude-only cursor evidence, no active
or retired Claude registration, and no `paired-root` entry. Garbage keys and directories named
`project-key` do not qualify.

For profiles without 0.1.2 binding or legacy history, absent coordination preserves normal 0.1.1
first use, including an unusable HOME, a missing path, ENOTDIR, or a non-directory/foreign
coordination entry. Degraded means an owned coordination directory cannot be listed, or its existing
records cannot be read or trusted. It never creates a project key or infers adoption from Claude
cursors. Without a delivered record, it uses an existing profile key, or a validated profile-local
adoption record naming an existing default-root key. An eligible unretired root remains active as
`standalone_unregistered`, with separate detail `coordination unreadable`. Otherwise memory is
disabled with `pairing_needed`; a lost locally recorded standalone key in an unmarked root reports
`standalone_key_missing`, never `paired_key_missing`.

Explicit setup records adopted scope in the private profile-local `binding.json`.
Binding history contains the root and a non-secret fingerprint,
never a key or conversation. With absent or degraded coordination it refuses with
`pairing_record_missing` until repair or an explicit reset to a new root.
Initialization, adoption, completion, reset destinations and repair publish
a private `paired-root` marker in the shared root. Its positive presence, valid or invalid,
permanently excludes cursor-based legacy adoption of that root, including after coordination loss.
It does not pause or disable an otherwise entitled client. A fresh profile gets its own key after
loss; an explicitly delivered missing record still reports `pairing_record_missing`. An existing
profile key takes precedence. With readable coordination, only the registered profile follows its
binding; another profile stays standalone. Standalone on Windows adds no unregistered
status note. An unrelated damaged default root does not affect another profile or add a status note.
Only explicit setup registers absolute plugin-data profiles, storing their resolved real paths.
Relative, empty or invalid paths retain standalone behavior without registration. Every install
record is validated before publication.

Retirement is checked only at the selected root. A present `retired` entry, valid or invalid,
disables that root with `pairing_needed`; resume refuses to unpause it. Missing or inaccessible
entries, non-directory roots and roots owned by another user are not retirement evidence. An
unrelated default root cannot disable an unpaired plugin-data profile. Setup refuses a marked
destination with `retired_root`, including reset or an implicit default destination, and requires
another unmarked root. Adoption also refuses a marked `adoptFrom` source; completion rechecks the
destination before activation. Status remains a single token; explanations are separate details.
Disabled hooks exit 0 without requests, while explicit controls fail visibly.

Before publishing a reset identity, reset pauses the old shared root, rotates its generation, and
writes `retired` there using the private-state writer. The marker is `{"version":1,"retired":true}`
and remains after retries and metadata loss. Ownership never expires; CX-7 must supply explicit
profile-move recovery.

At a marked root, a profile sharing its own existing key and pause never claims or changes
registration through hooks or reads; only explicit setup/pairing may register it. Readable
coordination also prevents minting at a recorded pair root when deletion removed its marker.
Codex's paired binding stores the same non-secret identity fingerprint in `install.json` and
refuses `binding_identity_mismatch` before sending if the key changed. Fingerprints are local
metadata and are never transmitted. Explicit setup validates its preconditions before durable
writes and rolls back caught failures; a failed operation preserves files, modes and markers.
Stopped-host original-backup repair checks the saved fingerprint inside the private key write.

Explicit setup owns registration for both clients. Hooks and resolve/status never write
`install.json`. Existing own-root sharing also leaves registration untouched. Readable pair
ownership includes fingerprint-bound client roots, reset destinations and retired roots;
a missing marker never makes these roots eligible for key creation. The shared mint gate
also protects identity-facade calls. Only original-backup repair may restore such a key.

Root identity uses real paths and device/inode, so symlink aliases cannot be new reset
identities. Reset accepts only a new path or an empty directory; otherwise it reports
`reset_destination_not_new`. Initialization at an existing key reports
`existing_key_requires_adoption` until the caller explicitly adopts it.

Private entry probes distinguish present, absent and unknown. ENOENT proves absence;
ENOTDIR does so only for a known controlled regular-file parent. Unknown selected state
refuses with a named status such as `state_unreadable`, keeping the system error in detail.
Unusable HOME and unrelated damaged paths keep history-free standalone parity. Invalid
repair history reports `binding_history_invalid`; invalid backup arguments report
`invalid_original_key`. Failed explicit operations restore files and modes, except for
legitimate setup-lock ownership and crashed-owner recovery artifacts.

Codex also keeps private non-secret binding history at
`<HOME>/.cairn-memory-profile/binding.json`. It retains current and retired pair roots,
so losing both coordination and a root cannot authorize a replacement key or legacy
adoption. Invalid history fails closed. Hooks and status never register either client.

Creator evidence and publication recovery follow the canonical
[local-state policy](../../docs/privacy.md#identity-creation-and-crash-recovery).

Interrupted setup is retried with the same explicit call. Pending initialization
reuses its winner without demanding adoption; pending reset to the same root skips
the fresh-destination test. A matching reset receipt permits a zero-write retry,
returning `identity_reset`, `alreadyComplete: true`, `writes: 0`, and the disclosure.
Later setup operations supersede it atomically with their install-record write;
reset to the current root then refuses with `identity_reset_requires_new_root`.
Initialization retains the original pause flag across its barrier.
Unreadable key probes refuse with `state_unreadable`, rather than treating the key
as absent or skipping retirement.

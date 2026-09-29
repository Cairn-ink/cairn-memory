# Shared client pairing API

This library coordinates local identity and controls; it does not install hosts,
execute models, change targets, or implement a Codex transcript adapter.

`detectClients(options)` performs read-only checks. `stateLocations(options)`
returns exact coordination paths independent of `CLAUDE_PLUGIN_DATA`. Production
callers normally omit `home`, `temporary`, `env` and `liveness`; these are injection
seams for isolated fixtures. Setup passes `setup: true` to refuse an undetermined
home. A missing standard plugin path is not evidence of standard origin.

`initializePairing({root, claudeProfileRoot, adopt, standardClaudeOrigin, usesClaude, consent:
{claude:true,codex:true}, hostsStopped:true})` is the CX-7 joint/adoption API.
Only supply consent and stopped-worker assertions after actually obtaining them.
With a known profile, unknown origin returns `claude_confirmation_needed` without
writes. An unknown profile returns `claude_profile_root_required`. `adopt:true`
requires the explicitly selected existing key; neither conflicting keys nor old
state are overwritten. The default fresh joint root is `~/.cairn-memory`.
The return value includes `pairingRecord`, `root` and `binding_pending`.
Retries resume initialization under the setup lock and reuse a published key.

Configure **both** hosts with the returned absolute record path, then call
`completePairing({hostsStopped:true, configured:{claude:true,codex:true}})`.
Until this succeeds, both pending bindings are disabled. Reconfiguration on real
Claude hosts is still unverified; a successful API call is not host verification.

`resolveClient({client:'claude'|'codex', pairingRecord, env, ...})` returns
`{enabled,status,root,paired,workerEnv}`. A disabled result has no usable root.
Use `workerEnv` when spawning a worker; `CAIRN_MEMORY_STATE_DIR` alone cannot select
an arbitrary root. The worker must resolve the binding again. Claude automatically
reads `CLAUDE_PLUGIN_OPTION_PAIRING_RECORD`; a launcher uses
`parsePairingRecord(argv)` to extract `--pairing-record /absolute/path` and forwards
that record too. Conflicting record delivery or a paired worker state-root mismatch fails closed.
Standalone hooks ignore inherited state-root environment values.
Only the canonical home coordination record is accepted.

Call `clientProjectId(options, cwd)` for the unchanged HMAC identity, after checking
`enabled`. `pairing_needed` with `enabled:true` means an established conflicting
client can keep its existing key; it does not mean the clients share controls.
A disabled newcomer never creates a key or sends memory requests. Hooks catch
errors and exit successfully; explicit controls report errors visibly.

Paired key loss returns `paired_key_missing`. With both clients stopped, restore
the original key from backup with 0600 permissions, verify shared IDs, then resume.
If the person instead chooses changed scope, `resetIdentity({root:newRoot,
primaryClient:'claude'|'codex',confirmIdentityReset:true,hostsStopped:true})` retains
old state, returns a required disclosure, initializes one client and starts paused.
It requires new explicit adoption for the second client. It does not migrate history.

Use `readControlState`, `setPaused`, `startIfActive` and `runIfActive` on the resolved
root. Claude alone owns `sessions/`; Codex must use another cursor/worker location.
Never infer Claude use from shared control, telemetry or key files.

Run `npm run test:pairing` with a synthetic HOME, worktree TMPDIR and npm cache.
The fixture `claude-hosted-3a1c17d9.json` pins main's 0.1.1 behavior; tests allow only the 0.1.2 VERSION substitution. The maintenance
`verifyMainGolden(fixturePath)` export in `testing/main-golden.mjs` reconstructs
the pinned Git source and checks fixture reproducibility when that object is
available; ordinary parity tests also work in shallow clones. The earlier CX-1
fixture remains checked for unchanged mechanisms and hosted capture behavior.

When the explicitly selected legacy key is in temporary storage, pass
`adopt:true, adoptFrom:sourceRoot, root:durableRoot` to `initializePairing`.
With stopped hosts and consent, the setup lock covers a flushed no-clobber copy;
source state remains untouched. A different existing destination key is an error.
Both configurations must still be completed before activation. This API does not
perform a real-user migration on its own or copy conversation/cursor history.

Normal hooks only read coordination metadata. A fresh registration takes a bounded
setup lock and rechecks; an established binding is not rewritten. Standalone Claude
keeps 0.1.1 root/key handling even when safe registration is unavailable, reporting
`standalone_unregistered`. An existing plugin-data key takes precedence over old
default-root cursor evidence. Empty `pairing_record` is unset.

Pairing validates Cairn-owned roots/files, canonicalizes host-owned ancestors and
skips uid checks where unavailable. Linux setup locks verify boot/PID namespace;
macOS uses one PID space and a system-uptime boot estimate with two-second tolerance.
Old-boot locks are stale; durable pairing records contain neither boot nor PID
namespace. Windows pairing is unsupported; standalone is unaffected. Real macOS
host verification remains with CX-7/A6.

Only `npm test`, `test:pairing` and `test:pairing:golden` add the home guard through
an environment-only shim before invoking the unchanged `tools/testing/run.mjs`.
The shim preserves HOME, USERPROFILE, npm cache and arguments. The guard does not
rewrite child environments; a caught violation still forces that process to fail.
Other suite commands and unwrapped demos retain their base behavior and retention.
Run with synthetic HOME and worktree TMPDIR/cache, as with the other tests.

Run `npm run test:pairing:golden` to reproduce the actual-base fixture and compare
the candidate. Both isolated copies get a 30-second control-lock timeout solely
for golden concurrency checks; production keeps its original 250 ms. Test files
need no serialization. Thirty hook/launcher variants include inherited state-dir
values and 12 concurrent hooks per simulated platform. Exact delivery is required.
A separate one-HOME, two-profile golden checks distinct keys/IDs and pause isolation;
only the new unregistered status note is normalized for that status comparison.

`install.clients.claude.profileRoot` is required in every Claude binding, including
active and retired reset bindings. It is the host's plugin-data root, or the legacy default when the
host leaves `CLAUDE_PLUGIN_DATA` unset. Reset and adoption preserve it.
CX-7 passes `claudeProfileRoot` explicitly; an existing registration is preserved.
Without either, setup accepts its environment's `CLAUDE_PLUGIN_DATA`, or defaults
to `knownClaudeRoot` only with `standardClaudeOrigin:true`. Otherwise it returns
`claude_profile_root_required` without writes. Conflicting supplied profile roots
fail with `claude_profile_mismatch`. No setup process guesses the legacy default.

Other profiles remain unregistered at their own standalone roots. Cursor evidence
can select the legacy default only when there is no active or retired Claude registration.
An explicitly delivered record for a different profile fails visibly with
`pairing_record_mismatch`; hooks exit successfully without requests, while status
and controls report the error. A matching profile follows its binding through an
identity reset, including its new paused root, then through explicit re-pairing.

The macOS boot estimate assumes no wall-clock step larger than two seconds during
a setup lock hold; such a step could reap a live owner. Holds are short; native
host verification remains a CX-7/A6 gate.

Each reset retains `retired[].claude` with its root and `profileRoot`, whichever
client is primary. With Codex primary, the retired Claude remains disabled until
explicit adoption (`pairing_needed` without a record, `pairing_record_missing`
with the stale delivered option). Another profile stays unregistered at its own
root; it cannot overwrite that ownership. Re-initialization preserves the retired
profile when no explicit profile argument is supplied.

If coordination is unreadable or untrusted, standalone fallback prefers an
existing default-root key with Claude cursor evidence over creating a key in an
empty plugin-data root, reporting `standalone_unregistered`. Losing metadata later
therefore cannot cement a newly minted identity. Trusted active/retired metadata
still prevents cursor-based adoption by another profile. A plugin-data key that
already exists retains precedence. With plugin data unset, standalone uses the
default root, including its key and pause if shared by another client.

# Shared client pairing API

This library coordinates local identity and controls; it does not install hosts,
execute models, change targets, or implement a Codex transcript adapter.

`detectClients(options)` performs read-only checks. `stateLocations(options)`
returns exact coordination paths independent of `CLAUDE_PLUGIN_DATA`. Production
callers normally omit `home`, `temporary`, `env` and `liveness`; these are injection
seams for isolated fixtures. Setup passes `setup: true` to refuse an undetermined
home. A missing standard plugin path is not evidence of standard origin.

`initializePairing({root, adopt, standardClaudeOrigin, usesClaude, consent:
{claude:true,codex:true}, hostsStopped:true})` is the CX-7 joint/adoption API.
Only supply consent and stopped-worker assertions after actually obtaining them.
Unknown origin returns `claude_confirmation_needed` without writes. `adopt:true`
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
that record too. Conflicting record delivery or state-root environment fails closed.
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

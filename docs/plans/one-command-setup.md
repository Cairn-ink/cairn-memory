# One-command setup and npm distribution

Base: `b8af5cda1820fd0bb385aca784c2d2ee8c036b36` (#175 merged).
Code and evidence were examined at this base. The branch was then integrated with
main at `e7c4ecc47d4e632e4b78209bb3c176da7437f078` (#256 merged, docs only).
No code changed between these bases.

Status: proposed docs-only plan, researched 2026-09-27.
Revision: post-integration terminology, links and required-token evidence corrections.
Implements maintainer chichi's one-command decision through CX-7, after CX-5 and
before CX-6 in the [Codex client package order](codex-client.md#ordered-packages-and-exclusive-file-ownership).
This plan owns installer/distribution behavior; the [client contract](codex-client.md)
owns parsing, transport, identity, pause and host hooks. No implementation,
installation or publication is performed by this packet.

One-command setup installs the [one-brain configuration defined in privacy](../privacy.md#proposed-session-episodes-local-core).
Its episode default is subject to the installed local-core capability and
automatic-capture consent below; it does not change hosted behavior.

## Acceptance S01–S08

1. **S01 — Command and discovery.** The normal proposed release interface is
   `npx @cairn-ink/memory setup` for Claude Code and/or Codex. Cairn.ink's naming
   decision reserves `@cairn-ink`; the exact package name is **to verify at release**.
   Never use the unrelated `cairn-memory` npm package. Resolve supported clients
   on `PATH` without reading conversations, credentials or host credential configs.
   Before probes or writes, require a determined absolute home directory. If it
   is missing, empty, relative or cannot be resolved, refuse with
   `Cannot determine an absolute home directory; setup made no changes.` Never
   construct relative state/runtime paths or use the legacy temporary fallback.

2. **S02 — Dry-run and host processes.** `setup --dry-run` resolves executable
   paths and reads only non-executing metadata. It **never executes a host binary**,
   shell wrapper or helper, including `--version`, `--help` and plugin queries.
   Report each version as `not checked in dry-run`; do not guess from filenames.
   Print every planned change, exact destination/command with secret placeholders,
   and unresolved choices. Write nothing: no locks, keys, runtime, config, token,
   logs or install metadata; no OAuth/browser flow or mutating subprocess.
   A real setup may run bounded version commands and supported plugin commands.
   Host programs can have their own side effects, outside Cairn's guarantees;
   setup must disclose this before running them. **To verify (Codex 0.157.1):**
   `codex --version` may create PATH-alias helpers under `CODEX_HOME` before argument
   parsing. The review cites binary strings and an earlier PATH-alias warning;
   this packet does not independently reproduce that behavior. Dry-run safety
   must not depend on disproving it. npm's package download/cache precedes setup
   and is outside the installer's dry-run guarantee; A8 invokes the packed CLI.

3. **S03 — Target and informed consent.** Choose hosted or the local preview,
   then show clients/versions, target, exact changes and collection policy before
   asking explicit installation/automatic-capture consent for **each** client.
   The summary must say: capture allowlists user/assistant text and redacts locally
   before payload creation; tool calls/output, reasoning and arbitrary file reads
   are excluded; automatic recall sends the redacted prompt text to the selected
   target. It must also disclose that Claude's content-free telemetry defaults on
   under the current [privacy contract](../privacy.md#data-flow), independently
   disabled by setting the plugin's `telemetry` option to `false` in plugin
   configuration. Provide that choice before consent; preserve the
   [released Claude hosted behavior](codex-client.md#architecture-and-compatibility-profiles).
   Codex telemetry stays off by default. See [privacy controls](../privacy.md#disable-automatic-behavior)
   for redaction/pause limitations; pasted sensitive text can remain in ordinary
   conversation. Presence on `PATH` is not consent; declined clients stay unchanged.
   Collect secrets only after consent, never in dry-run. Hosted authentication
   uses token entry or OAuth where supported (**to verify:** Cairn OAuth support),
   never the host's login credentials. Local automatic capture requires LAC,
   its runtime/artifact/store binding and model/provider consent; otherwise show
   capture unavailable. Explicit MCP operations do not substitute for capture.
   Do not silently change an existing target/account when adding a client.

   Enable episodes by default with automatic capture only when the chosen target
   is the local core and the installed core supports the sibling's `episode-v1`
   mode, delivered by the SE packages. Use the sibling's [episode configuration](session-episodes.md#product-decisions-supplied-by-the-coordinator-2026-09-27).
   For hosted targets or a core without that installed capability, neither enable
   episodes nor describe them as active; status reports episodes as unavailable.
   The [privacy contract](../privacy.md#proposed-session-episodes-local-core)
   leaves hosted behavior unchanged.

   When episodes will be enabled, show these disclosures **before** asking for
   automatic-capture consent and before any capture starts:

   “Each captured session gets a short model-written summary. It is an
   interpretation, not verified fact.” See [episode privacy](../privacy.md#proposed-session-episodes-local-core)
   and [session episodes](session-episodes.md#record-vocabulary-and-source-bounds).

   “Selected source passages are kept with no automatic age limit, until the
   conversation is deleted. Deleting a conversation removes memories derived from
   it and invalidates its episodes.” See [episode privacy](../privacy.md#proposed-session-episodes-local-core)
   and [session episodes](session-episodes.md#entry-controls-deletion-correction-and-quick-questions)
   for retention, deletion and its limits.

   “Episode interpretation sends bounded, redacted session text to the configured
   model provider. Redaction is best-effort.” See [episode privacy](../privacy.md#proposed-session-episodes-local-core)
   and [session episodes](session-episodes.md#source-budget-retention-and-concurrency)
   for source and provider-exposure bounds; this plan adds no numbers.

   Episodes are part of each client's automatic-capture consent, not a separate
   question. Declining capture for a client also means no episodes from it. This
   plan adds no episode toggle; finer episode/session-context controls belong to
   the sibling's [entry controls](session-episodes.md#entry-controls-deletion-correction-and-quick-questions)
   and [session-start context](session-episodes.md#session-start-context-next-steps-and-procedural-memories).

4. **S04 — One root and key.** Use the client contract's
   [existing-client detection and state locations](codex-client.md#existing-client-detection-and-state-locations)
   before creating state. Under its setup lock, a fresh run with both consenting
   clients initializes one key/root, default `~/.cairn-memory`, and their shared
   binding together, with no pairing prompt or separate command. An existing
   Claude key produces one confirmation: “Share memory with the existing Cairn
   setup in Claude Code?” Setup performs adoption itself; use the corresponding
   confirmation when adding Claude to Codex. This does not replace per-client
   capture consent. Declining leaves the existing client working and the newcomer
   disconnected. Preserve the person's [explicit key choice and existing-client access](codex-client.md#existing-client-detection-and-state-locations)
   in conflicts. Standalone pairing is only for separate routes, legacy 0.1.0 Claude
   or conflicts. Record content-free progress in `install.json`; partial retries
   reuse the chosen key and keep new clients inactive until binding is complete.
   Never regenerate a paired key as repair or create a second root during fallback.

5. **S05 — Claude configuration.** Setup's automated Claude path requires
   **Claude Code >=2.1.147**. Its [CLI reference](https://code.claude.com/docs/en/plugins/cli-reference)
   documents repeatable `plugin install --config key=value` for manifest-declared
   userConfig, and the interactive `/plugin configure` dialog, from that version.
   Use supported marketplace installation, not direct edits to Claude's configs:

   ```sh
   claude plugin marketplace add Cairn-ink/cairn-memory
   claude plugin install cairn-memory@cairn-memory --scope user \
     --config api_endpoint=https://cairn.ink \
     --config pairing_record=/absolute/path/to/pairing.json
   ```

   Substitute the selected non-secret endpoint and actual record path as separate
   argv entries, not shell-interpolated strings. Omit the record option for an
   unpaired single-client install. If chosen, supply `--config telemetry=false`.
   CX-2 must declare `pairing_record` before this path ships. Preserve existing
   installs; **to verify on pinned hosts:** reconfiguration of an already-installed
   plugin and delivery to hooks, not the documented existence of `--config`.
   The plugin manifest declares `api_token` with `required: true`. **To verify:**
   whether installation with only the non-secret `--config` values prompts for
   that missing token, fails, or installs unconfigured. Do not assume one outcome.
   Never put `api_token` in command arguments, plans or logs. The person enters
   the token into Claude's sensitive `api_token` field through its configuration
   dialog; setup must not patch or read the host credential store. Print the exact
   remaining step: open an interactive Claude session, run
   `/plugin configure cairn-memory@cairn-memory`, and enter `api_token` in the
   sensitive field. If non-secret configuration remains pending, print the exact
   `api_endpoint` and `pairing_record` values to set in that same dialog.
   Below 2.1.147, leave Claude unchanged, report unsupported version and print:
   “Upgrade Claude Code to 2.1.147 or later, then run
   `npx @cairn-ink/memory setup`.” The configure dialog is not a workaround on an
   older host. Never claim ready until required configuration and binding finish.

6. **S06 — Codex installation and trust.** Copy the allowlisted runtime into
   `join(homedir(), ".cairn-memory-clients", "runtime", version)`, then write Cairn
   hooks to `~/.codex/hooks.json` or an explicitly selected supported hooks location.
   Use stable absolute runtime paths, never npx's transient cache; preserve other
   hooks and avoid duplicate Cairn registrations. Keep new hooks inactive until
   consent, configuration and binding finish. The person must then complete the
   initial `/hooks` review; changed definitions can need review again. Never use
   `--dangerously-bypass-hook-trust` or edit trust state. Existing verified host
   facts/version limits remain in the [client evidence](codex-client.md#evidence-and-version-boundary).
   Codex token entry is masked; write only the owner-only 0600
   `credentials/cairn-token` in the bound state root. Never print its value or use
   it in command arguments; do not import Claude's saved token.

7. **S07 — Rerun and removal.** Reruns report status and repair approved incomplete
   setup idempotently, preserving keys, pause state, cursors and existing hooks.
   A newly installed client gets its consent and sharing confirmation. Use the
   [shared controls](codex-client.md#controls) for `setup --remove claude` or
   `setup --remove codex`: stop affected workers, remove only owned registrations,
   and retain runtime files used by the other client. Preserve keys and memory
   data even when the last client is removed. In that last-client case, **offer
   separately to delete the stored Cairn token** at the exact bound credential
   file; delete only on explicit confirmation, without reading/printing its value.
   Declining retains it. Claude-managed credentials require its supported sensitive
   configuration controls; never edit its credential store, and report any manual
   credential-cleanup step instead of claiming automatic deletion. Memory-data
   deletion needs its own separate explicit confirmation, never the token prompt.
   Use Claude uninstall with `--keep-data`, or supported disable if unavailable;
   never remove the marketplace wholesale or delete its shared data directory.

8. **S08 — Distribution.** Bundle shared client library, Codex adapter and installer
   with an explicit file allowlist and no `preinstall`, `install`, `postinstall`
   or other install lifecycle scripts. Build from the single source tree; no
   second engine or repository-relative runtime imports. Claude keeps marketplace
   distribution; setup drives it. Root and local-preview manifests remain private.
   Produce a reviewable tarball with licenses/notices and dependency closure.
   Publication happens only in a separately approved release step using the
   maintainer's credentials and npm provenance. Neither this plan nor its build
   packages publish anything; publishing outside that release step is a non-goal.

## A8 installer gates

This is the detailed specification for [A8 in the client contract](codex-client.md#acceptance-gates).
Run offline on Node 22.16 and 24 using fake `claude`/`codex` executables on `PATH`,
temporary homes and synthetic credentials. Plugin-loaded/shared code keeps its
Node 20/22 gates. No real host installation, credentials, provider calls or publish.

- Both CLIs present: one run obtains each consent, binds one key, and has no
  pairing prompt. Declining a client leaves it unchanged. Capture stays inactive
  before consent/configuration/binding; pending host trust is reported honestly.
- Only Claude initially: later add Codex and require the sharing confirmation;
  adopt the same key. Reruns and interrupted setup preserve identity/control state
  and avoid duplicate hooks. Existing Claude keys at the documented
  [known/nonstandard paths](codex-client.md#existing-client-detection-and-state-locations)
  are confirmed and adopted; key conflicts preserve access until explicit choice.
- Dry-run: instrument the subprocess boundary and assert **zero host process
  starts**, including version/help/plugin probes and wrappers. Fake hosts that
  record invocation or would create PATH helpers must remain unexecuted. Also
  assert no home/state/config/trust writes, no locks/OAuth/browser flow, complete
  plans with secret placeholders, and `not checked in dry-run` versions.
- Missing, empty or relative home: clear refusal before any host invocation or
  writes; no paths under cwd and no temporary fallback, including during dry-run.
- Fake Claude below 2.1.147 gets the exact upgrade/rerun step and no install/config
  mutation. At/above the minimum, assert non-secret `--config` argv and exact dialog
  instructions for the token and any remaining configuration. Fake secrets never
  enter subprocess argv, logs or plans; no host credential-store reads.
- Before consent, assert summary includes redacted prompt recall, capture policy,
  Claude telemetry on by default and `telemetry=false` opt-out. Exercise hosted
  token/OAuth-capability and local-LAC-unavailable paths without network calls.
- With an episode-capable local core, assert all three episode disclosures appear
  before automatic-capture consent and any capture starts. Episodes follow that
  consent without another question; a declined client produces no episodes.
- With a hosted target or core without episode support, assert setup does not
  enable episodes or claim active episodes in its disclosures, and status reports
  them as unavailable. Cover the coordinator deferring the SE packages.
- Assert supported hook paths, stable runtime, other-hook preservation, no trust
  bypass argument, unchanged trust state and pending `/hooks` review.
- Remove either/last client repeatedly: preserve keys, memories and the other
  client's runtime. On last removal, both accept/decline token-deletion choices
  are covered, with memory deletion independently unapproved and data unchanged.
  Verify Claude `--keep-data`/disable and honest manual credential-cleanup status.
- Pack locally with scripts disabled; inspect the actual tarball for the scoped
  name, allowlist, dependency closure and no install scripts/secrets/dev files.
  Run outside the checkout. Version validation includes the public npm manifest;
  prove a mismatched version fails. Root/local preview stay private; provenance
  remains a separate release gate.

## CX-7 ownership and following stages

The [CX-7 package row](codex-client.md#ordered-packages-and-exclusive-file-ownership)
is the single allowed-file ledger: `integrations/setup/**`, `packaging/npm/**`,
`packaging/artifact-files.json`, `packaging/README.md`, `scripts/validate-json.mjs`,
the named installation/privacy/architecture docs, both plans and release records.
CX-7 owns its changelog and synchronized version bump in its PR, including the
public npm manifest. Its validator change checks that manifest's version alongside
existing root/plugin/marketplace/runtime versions. Keep existing manifests private.
Update root and packaging READMEs' current no-npx statements only with truthful
release availability. CX-7 keeps the [preview installer](preview-installer.md)
and [install artifact](install-artifact.md) packaging and no-publication boundaries
until the approved release step changes that availability. CX-2 supplies
identity/lock/pending-binding APIs; CX-5 supplies
host registration; LAC alone supplies local automatic capture for both clients.

Follow the [cross-plan handoff](codex-client.md#cross-plan-shared-files): one open PR
per shared file, including CI, version validation and release records. The
repository maintainer coordinates with the private umbrella plan and the sibling
[session episodes](session-episodes.md). CX-7 follows CX-5;
CX-6 receives tests for final verification. No competing shared-file owner.
Episode enablement and its consent disclosure depend on SE-1…SE-5, which precede
CX-5 and CX-7 in the proposed order. If the coordinator defers them, setup ships
with episodes unavailable as in A8's hosted/unsupported-core case, until the
installed core supports the mode; a merged design contract is not that capability.

## Verification and remaining evidence

Remaining **to verify**: exact npm name/availability, hosted OAuth, pinned-host
Claude reconfiguration/hook delivery, install behavior when required `api_token`
is omitted from `--config`, and Codex 0.157.1 PATH-helper side effects. The token
must never be supplied on argv, regardless of that behavior.
Primary CLI documentation establishes `--config`/configure availability, not a
completed integration test. A8 above specifies future tests; this docs packet
does not claim those installer tests ran. Repository checks and both plans' link
checks are recorded in the [client contract verification](codex-client.md#open-questions-non-goals-and-verification).

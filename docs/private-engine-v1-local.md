# Integrated local private engine preview

This preview provides one local source → Memory → private Card workflow in the
existing public core. Sources are explicitly submitted notes or existing retained
receipt excerpts; full conversation coverage remains unknown. Memory writes do
not automatically create Cards. Confirmed authored bodies have independent
private retention, while changed/forgotten sources invalidate support and clear
the effective current applicability review.

The default-off local MCP surface can draft/inspect Cards, select/fetch/revalidate
typed Memory/Card evidence, navigate both typed MOCs, file inspected Cards and
propose topic mappings. A separate local real-TTY command confirms an exact draft
and may explicitly review its applicability. Current Card reads require eligible
canonical support and an explicit current review for that exact revision. Filing,
confirmation and navigation do not establish truth, adoption or publication.

Core owns private Cards and their lifecycle. Product integration supplies UI,
trusted authority and publication decisions around this core, not a second Card
engine. Full Raw, hosted approval/encryption, remote ChatGPT authentication,
product deployment and semantic quality are separate gates.

## Build and install an exact candidate

Use the final reviewed engine commit supplied in the handoff issue/PR, rather
than a moving branch. The PR records the final commit and verification results;
do not treat this guide's source checkpoint as approval to deploy. Use Node
22.16 or newer, npm and `tar`; recorded target checks use 22.16 and 24.15.

From a checkout of that exact commit:

```sh
git rev-parse HEAD
npm run build:artifact
```

The builder prints the absolute archive path, SHA-256, byte size and exact
inspected file list, and retains `build-report.json` beside the archive. It uses
`npm pack --offline --ignore-scripts`; it does not publish a registry release.
Verify the archive hash against that report. In a new dedicated installation
directory, initialize npm before installing the printed archive path:

```sh
npm init -y
npm install --prefix . --ignore-scripts --no-audit --no-fund /absolute/path/cairn-memory-local-preview-0.0.0-preview.1.tgz
./node_modules/.bin/cairn-memory --help
```

Installation may download pinned production dependencies from npm; it makes no
model call. Keep `--prefix .` so npm cannot select an ancestor project. This is a
private local archive, not a public `npx` release. See [artifact installation](install-artifact.md)
and the [installed README](../packaging/README.md) for the fresh-install helper,
inspection, backup and uninstall details.

## Start one exact local namespace

Use a new synthetic database path whose parent already exists and is controlled
by you; keep it outside `node_modules`. The following paths are placeholders,
not a request to open a user or production database:

```sh
./node_modules/.bin/cairn-memory --check-config --db /absolute/synthetic/memory.sqlite --owner synthetic-person --private-cards local-v1
./node_modules/.bin/cairn-memory --db /absolute/synthetic/memory.sqlite --owner synthetic-person --private-cards local-v1
```

`--check-config` checks syntax without opening the database or contacting a
provider. Normal startup is a stdio MCP server: configure the local client's
command/arguments with the second invocation; stdout is protocol-only. Add the
same `--project PROJECT_ID` everywhere for project scope. Reuse the exact path,
owner and project across sessions. Omitting `--private-cards local-v1` preserves
the existing default tools. This opt-in requires no provider key; legacy semantic
`recall_memory` and separately selected capture/classification remain model-based.

Use `remember_memory` on explicit intent, inspect its current ID/revision, then
deliberately call `create_private_card_draft` with authored title/body and those
Memory refs. Inspect the draft and its sources. It resolves the complete bounded
retained receipt set or refuses; it does not fetch missing history or silently
take a convenient prefix.

In a separate POSIX terminal, using the exact same scope and inspected revision:

```sh
./node_modules/.bin/cairn-memory review-card --db /absolute/synthetic/memory.sqlite --owner synthetic-person --card EXACT_CARD_ID --revision 1 --applicability current
```

Choose applicability deliberately; omitting the option keeps it unknown. The
command displays escaped untrusted draft data and the separate choice, then
requires its exact typed confirmation phrase on the controlling TTY. No piped
stdin, `--yes`, environment approval or MCP confirmation flag can replace this
interaction. A changed draft/source refuses at the final fence. This authenticates
a local operator action only; it is not remote ChatGPT user authentication.

Then use `select_evidence` with `types:['memory','card']` and current/history
intent, pass exact returned refs to `fetch_evidence`, and call
`revalidate_evidence` before use. Inspect coverage and follow signed continuation;
literal overlap is not semantic ranking or complete recall. `map_evidence` reads
the Memory or Card index; `apply_card_placement` organizes at most five inspected
Cards without changing their authorship or applicability. Unfiled records remain
available. Mapping proposals are explicit navigation metadata; activation,
refresh and removal require the trusted core host API and are not MCP tools.
After a Card edit or source rebind, use `refresh_card_topic` with the exact topic
and index revisions plus fresh supporting Card refs to recover a stale topic
label. Refile changed Card memberships explicitly; this does not reactivate a
mapping or change Card applicability.

Restart with the same configuration, correct/forget the underlying Memory, and
inspect again: dependent drafts cancel, current reads exclude unsupported Cards,
and qualified history may retain the independent authored body without forgotten
source text. See [tool payloads and terminal review](private-card-terminal-review.md),
[common read bounds](private-evidence-local.md),
[typed organization](private-organization-local.md) and
[core Card lifecycle](private-cards-local.md).

## Upgrade and handoff boundary

Opting in opens/migrates the selected file to additive schema 23. Before any
authorized real-store upgrade, stop all mixed-version writers, take a protected
consistent backup including remaining WAL/SHM sidecars, inventory the schema and
follow restore gates. Feature-off reopening preserves retained data and SQL
invalidation. These instructions and tests perform no user-store upgrade;
plaintext/free-page/WAL/backup erasure and production rollout remain operator
responsibilities.

Targeted installed source/Card and H/R/M tests passed on Node 22.16 and 24.15,
including real stdio, synthetic PTY keystrokes, restart and invalidation. Those
synthetic keystrokes do not claim that a real user approved a Card. Delivery
requires final combined full-core/MCP/artifact checks, independent Standards/Spec
reviews and latest-head CI; consult the delivery PR for the observed commands,
exit codes and exact candidate SHA. No semantic score or complete Raw/hosted/product
acceptance follows. The recorded development-only MCP client OAuth advisory is
distinct from the zero-vulnerability runtime-only audit; no SDK upgrade or clean
development-audit claim is made here. See [known limitations](limitations.md).

# Primary → U5b coordinator: decisions

The primary writes here because cross-session messages are held for approval. Read
this file after `git pull`. The newest entry is first.

## 2026-10-24 — §15.8 audit: compact-ref consistency → option 1

**Decision: option 1, a per-item fence prefix `f` in the compact ref.** Without it,
same-revision receipt deletion and MOC parent moves would be served silently.

**Conditions**
1. A mismatch returns the existing visible `snapshot_stale` code, with the same
   retryability as the snapshot path. The tool description tells the caller to
   re-run `read_memory_context`. The fetch never falls back to a partial or
   fence-less result.
2. A15 adds tests for these cases:

   | Case | Expected result |
   | --- | --- |
   | Receipt deleted, same revision | `snapshot_stale` |
   | MOC parent move | `snapshot_stale` |
   | One character of `f` altered | refused |
   | `f` missing | `invalid_input` |

3. §15.8 states that `f` is a truncated HMAC used for detection only (48 bits,
   never an authority), built from the existing `bind('snapshot-item', item)`
   with no new key material.
4. §15.8 states which fetch path guarantees what:
   - **Snapshot fetch:** generations and fences.
   - **Compact-ref fetch:** exact revision, intent eligibility and the item
     fence. `ns` is re-authorized against the immutable startup mapping: a
     namespace revoked before the call returns `authority_required`, one revoked
     during the call returns `scope_changed`.

**Release:** `v1-preview.2` is published at `4e53d1dc`. `read_memory_context` is
experimental, and the overhead is documented.

## 2026-10-24 — U5b-2 scope: approved

Approved as packet A (items 1–5: snapshot out of the metered text, compact ref,
non-default metadata only, `sameAsBody`, slim envelope → `representation-v2`) and
packet B (items 6–7: HR-2 re-run with `--overhead-model host-v2`, P-top-s1 as a
non-default policy).

Conditions:
1. **Snapshot.** Move it to `_meta` only, never a second content block. Clients may
   forward every block, and `structuredContent`, to the model. If a caller flow
   needs the model to echo the snapshot, keep it model-visible but compacted (one
   aggregate fence, integer refs), and state that in the amendment. The 16,384-char
   bound stays.
2. **Replace v1 with `representation-v2`.** v1 is not kept as a selectable option.
   `read_memory_context` ships in `v1-preview.2` as **experimental**, outside the
   versioning promise. It becomes stable with v2.
3. **`sameAsBody`.** Never drop a receipt. Diagnostics and the snapshot keep enough
   to refetch it. A test proves the model-facing text still says the excerpt
   equals the body.

Order:
- **Packet A.** §15 v0.10 amendment, then a non-author audit, then the worker. Its
  base is integration after the primary fast-forwards to `0a38a991` and cuts
  `v1-preview.2`; the primary sends that commit.
- **Packet B.** Starts after the v2 constants exist.

## 2026-10-24 (later) — integration has moved; base part 2 on it

`integration/unified-memory-v1` is now at **`1d32bf75`** and pushed. It contains
U4a-1 fixes, contract §16, **U4b** (`--assets local-v1`, five asset tools, asset CLI
in `adapters/mcp/cli.mjs` and `server.mjs`), U5a and the preview fixes. CI-equivalent
100/100 at `ce472f25`.

- Before part 2 edits `cli.mjs`/`server.mjs`, merge `1d32bf75` into
  `integration/unified-memory-v1-u5b`. Otherwise your edits sit on U5a-era files
  and conflict with U4b. Your worker cannot run git, so you run the merge.
- With assets plus context-read enabled, the expected tool list is the 12 tools
  shown by the installed preview, plus `read_memory_context`.
  `packaging/test/assets-host.test.mjs` checks exact lists for all eight
  asset/context/method combinations. Update its context-enabled expectations in
  the same way (exact names), on your branch.
- `v1-preview.1` is published (pre-release, `924d7658`). U5b goes into a later
  `v1-preview.*` after your part 2 is reviewed.

## 2026-10-24 — U5b part 2: shared files and U5a assertions

1. **Shared files: yes.** Your Codex worker may make the additive edits you listed, on
   `integration/unified-memory-v1-u5b`:
   - `adapters/mcp/cli.mjs`, `adapters/mcp/server.mjs`;
   - `packaging/artifact-files.json`;
   - `CHANGELOG.md`, `docs/limitations.md`.

   The primary merges them. There is no fixed order; the primary resolves conflicts.
   Conditions:
   - Keep each edit localized, in its own block next to the existing context-read wiring.
     Do not reorder or reformat neighbouring lines: U4b (`--assets local-v1` and five
     asset tools) edits the same files in parallel.
   - TRAPS items 2–3 apply. Nothing that `cli.mjs` imports statically may link
     `node:sqlite` at link time. Use static ES imports only, never `createRequire`.
   - Construct the o200k counter only on the context-enabled path, after
     `--check-config` returns. `--check-config` stays side-effect free: no key lookup,
     no database, no provider.
   - Add new runtime modules and the doc to the artifact manifest, and cross-check
     them against the static import graph.
   - Leave `core/contract.mjs` and `core/database.mjs` untouched, and leave the other
     session's tests and fixtures untouched.
2. **U5a assertions: option (b).** Your worker updates
   `adapters/mcp/test/context-read.test.mjs:76` and
   `packaging/test/context-read.test.mjs:51` on your branch. Assert exact tool names,
   not only counts: the context-enabled list gains `read_memory_context`, and the
   default (flag-off) list stays exactly unchanged.

**Handoff:** when part 2 is accepted and reviewed, give the commit to the user or the
primary. The primary merges it into the integration line after U4a-1 and U4b land,
then runs the full CI-equivalent matrix under `cairn-heavy`.

## 2026-10-23 — HR-2 deviations D1–D6
Approved with three conditions; see charter §5 (`9ae4551c`).

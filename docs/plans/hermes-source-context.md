# Opt-in source-first Hermes profile

Base: `f3a0bb7d3a4bfbaa55405880d2c86c57c4e7b4a0`.

Selecting Cairn currently forwards model-supplied arguments unchanged; source
recall therefore depends on each call choosing the optional mode. Add a native
profile preference without changing core/MCP defaults or denying explicit calls.

## Acceptance

1. Native setup/profile `cairn.json` accepts optional `recall_context` with only
   `source-evidence` as its value. Omission preserves existing behavior. Unknown,
   null, blank, padded or other values reject according to existing strict
   configuration rules. Setup exposes a nonsecret optional field; documentation
   explains reconfiguration retention and removal to disable.
2. Only `cairn_recall_memory` calls missing both `contextMode` and
   `includeQualification` receive `contextMode: source-evidence` when opted in.
   Preserve any explicit context or qualification choice, including false;
   preserve other arguments, non-recall calls and caller-owned dictionaries.
   Tool schema discovery, namespace authority, deadlines and key isolation remain
   unchanged. No new bridge/core/Python memory engine or fallback HTTP route.
3. Extend native provider tests for strict configuration, setup, default omission,
   injection and explicit overrides. Extend actual pinned AIAgent scripted-loop
   tests: opted-in recall supplies only a query and gets original source DTO,
   including after restart. Keep an absent-option assertion proving ordinary
   generated/qualified behavior. No manual source rescue or real model calls.
4. Run the pinned Hermes canonical runner with all four existing provider/agent/
   qualified provider/qualified conversation test paths against an inspected
   installed Cairn artifact on Node22.16 and24, plus generic/JSON/strict-plugin
   validation. Use temporary synthetic profiles and stripped credentials only.
5. Update setup documentation and changelog with opt-in boundaries. This setting
   does not certify source truth, model compliance, natural tool selection or
   long-history quality; receipts remain untrusted and memory is not authority.
   Independently review exact candidate on Standards and Spec before PR delivery.

No global-default change, registry publication, deployment, production profile
mutation, upstream Hermes submission or paid experiment is in this PR.

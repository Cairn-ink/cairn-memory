# Explicit staged evidence access over MCP

Dependent base: `116695c43d70b8c7c5755cc395652c5d1e12f0dc`.
The embedded lifecycle must pass its final gates before this integration ships.
One shared engine; no default retention, paid run, package publication or deployment.

## Acceptance

1. CLI `--capture-evidence staged-v1` requires `--capture-qualification
   source-bound-v2` and opts into existing core staging. Separate
   `--capture-evidence-access staged-v1` exposes management without enabling
   retention, qualification or model work. Staging implies access. Unknown,
   duplicate, missing and unsupported values reject before database access.
   The programmatic server validates the same options before opening core.
2. Help and syntax-only `--check-config` distinguish retention from access.
   Check does not open a database or contact a provider. Both modes can start
   keyless; capture still requires a configured model. Default tool discovery
   and existing v1/v2 configurations remain unchanged.
3. Access exposes only `inspect_capture_evidence` and
   `discard_capture_evidence`, each with strict `{batchId}` input. Namespace
   comes from the startup snapshot and client is always `cairn-local-mcp`.
   No caller-controlled owner, project, client, eventId, view or source input.
   Inspect is local/read-only in semantic effect (expiry may prune); discard
   is local/destructive. Existing untrusted-evidence response envelope and
   transport size ceilings remain unchanged.
4. Capture forwards `captureEvidence` to shared core. No duplicated staging
   logic, retry, promotion, new provider method or broader recall exposure.
   Tool descriptions distinguish live processing and successful duplicate
   from failed/expired/discarded/forgotten event closure. Never recommend
   new batch IDs as a retry bypass. Original deterministic message IDs and
   source normalization/truncation stay unchanged.
5. Help and descriptions explain bounded 24-hour local retention, keyless
   inspection versus truth/authority, and lack of automatic capture. Successful
   correction/forgetting clears ALL staged payloads in the exact configured
   namespace, even after staging is disabled; other admitted memories remain.
   Discarding staged evidence does not forget an already admitted memory.
   No physical-erasure, journal/archive or semantic-quality guarantee.
6. Real stdio tests demonstrate failed capture then cold keyless access-only
   inspection/discard, namespace isolation and strict rejection, provider-call
   counts unchanged during management, source exclusion from ordinary reads,
   replay closure with staging enabled/disabled, and deletion during deferred
   extraction fencing subsequent qualification/admission. Invalid/missing
   mutations must not purge. Test actual installed archive and SDK transport,
   not only programmatic construction.

## Verification and delivery

- Node 22.16 and 24: complete MCP and artifact suites; new installed scenario
  explicitly exercises staging then keyless access-only restart.
- Generic tests, JSON and strict plugin validation; unchanged shared core
  must retain its independently verified lifecycle gates.
- Freeze candidate, independent Standards and Spec reviews; all required CI
  states must be SUCCESS before an authorized merge. No forced bypass.
- Remains explicit embedded/local stdio preview. Native Hermes exposure,
  automatic repair/retry and real-world semantic evaluation are later slices.

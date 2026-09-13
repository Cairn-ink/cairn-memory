# MCP source-candidate qualification (S5b)

Base `78fb7b96083480bb39077f38c41eb14196f22900`, verified shared v2 core and
adapter. Local dependent delivery; private security disclosure hold unchanged.

- M1: Accept explicit `--capture-qualification source-bound-v2` and matching
  createCairnServer constructor option, passed unchanged to the shared core.
  Absent retains five tools; either supported mode adds the same capture_memory
  sixth tool. Existing v1/default behavior and invalid-setting preflight remain.
  Help and --check-config state selected mode without opening DB/contacting model.
- M2: Keep tool input/schema unchanged: batchId plus bounded submitted messages,
  not source qualification, namespace, receipt identity, causal position, slot,
  currentness or authorization settings. No transcript reader or passive hook.
- M3: Actual SDK stdio with fake upstream exercises v2 capture → qualified
  inspection → process restart → inspect/replay with no new HTTP. V1/v2 replay
  mismatch rejects before any model request. Two new distinct captures retain
  source metadata without any automatic trusted slot/binding or retirement.
- M4: Fail malformed candidate output explicitly with no partial admission;
  retain qualification-aware revision/suppression safeguards. Caller mutations,
  invalid explicit options and unknown/oversized tool inputs remain fenced.
- M5: Root verifies the actual built installed MCP+adapter via existing experiment
  launcher and injected fake upstream. Launcher accepts v2; experiment parent
  fake session is NOT a paid guard grant. Old paid guards still deny the new
  method; no actual ledger, credentials or provider calls in this slice.
- M6: Both Node22.16/24 generic/JSON/plugin/OpenAI/MCP/artifact/live-offline +guard
  regression gates and independent Standards/Spec at final commit. Core is
  unchanged from452/452 on both versions. Update changelog/capture/MCP/protocol
  documentation accurately; semantic reliability and new paid capability remain
  unverified/separate. No release/deployment/security disclosure.

# Preserve the absolute provider input budget without a false relative cutoff

Base bbcaac46cf78f6e081bc9de6c989e600bf525168. During the explicitly authorized
USD20 shared-ledger experiment, a copy-only classification diagnostic counted
5173 actual provider input tokens for 4146 local tokens. The previous relative
limit was 4146+1024=5170, although the experiment and existing live harness
already enforce an absolute provider input cap of 7024. The dynamic structured
output schema measured 1147 tokens. Original pilot evidence is retained; the
original nested failure code was not recorded, so this reproduced failure is
not claimed to conclusively reconstruct the original failure.

## Acceptance

- F01: Keep local core input <=6000, provider input <=7024, output<=1024 and the
  selected model's context-window check. Remove only the falsely restrictive
  provider-input <= local-input+1024 comparison. No automatic truncation, retries,
  output-cap increase, schema weakening or model/default changes.
- F02: Offline tests demonstrate real adapter generation when counted input
  exceeds local+1024 but remains <=7024; test exact7024 acceptance,7025 refusal
  before generation, local>6000 refusal before count, malformed count/output
  failures and existing supported profiles. Audit live-harness/shared guard
  reservations remain based on the same7024 absolute cap; no spending expansion.
- F03: Primary independently verifies both Node22.16/24, actual guarded adapter
  fakeHTTP, and a paid classify-only probe on a fresh copy of the preserved
  failed-case database using the SAME global USD20 ledger. No applyPlacement,
  original evidence mutation, benchmark-score substitution or new ledger.
- F04: Public docs/changelog explain absolute versus local budgets. Contributor
  gates plus final fixed-base independent Standards and Spec reviews before PR;
  no merge, release, deployment or private application changes.

Worker: Sol high, adapter/test changes only. Primary: contracts, docs, independent
verification, live diagnostic and delivery. A successful diagnostic is not a
new full pilot score; keep the pre-fix pilot identities and outcomes explicit.

## Retained live diagnostic

The primary ran two separate classify-only attempts on fresh copies of the same
closed pilot-case database. Neither attempt applied the proposed placement.
The original database SHA256 before and after was
`9db28e76cce13c821e3e08acbcd140b854e602bb61f3d64a074451294eacc877`.

- Original adapter: local input4146, provider count5173, relative allowance5170;
  returned `context_budget_exceeded` after the count, without generation.
- Fixed adapter SHA256
  `911d885d95e522c07759b76c37466677a8f3fb21987e6da8cfbdfcc552e7f46d`:
  provider count5173, generation completed, five placement items proposed;
  usage input5173/output302, known generation estimate USD0.002554.
- The fixed attempt reserved USD0.010 for its two requests from the same global
  USD20 ledger. The count request's actual cost remains unknown, not zero.
  At this checkpoint the whole experiment had 687 requests, USD5.010 reserved,
  USD0.657139 known usage estimates and 328 unknown-cost requests.

This is targeted regression evidence, not a rerun of the seven-case pilot or
proof that every original partial ingestion had this cause. Original nested
classification errors were not retained by the comparison summary. No corpus
text, model output text or credentials are included here.

# Ordinary MOC retention comparison

Initial base `6b765d0f95beea15759e7ae82969e56ebaac536a`.
Delivery base after the results PR merged:
`76941b5a9f2293453d275c7dafe1f1c392d591d4`.
The fixed-candidate diagnostic found one useful changed-premise improvement and
additional irrelevant exposure. This next protocol tests applicability inside
ordinary selection; it does not promote the wrapper or authorize a run itself.

## Acceptance

1. Add fresh `evaluation/live/retention-moc-fixture.json` and
   `retention-moc-rubric.json` conforming exactly to existing
   `runMultiWindowFidelity` validation. ID `retention-moc-comparison-v1`;
   six histories, three matched pairs, three windows/history, six messages/window
   (five user/one assistant), complete NFKC-stable source content<=800 and unique
   safe IDs. Paired questions identical; exactly one user source differs in each
   pair, changing provisional versus committed status. At least one Chinese pair.
   Fresh sources, no old fixture reuse, real data or planted instructions.
2. Spread original reasons, changed premises and reaffirmed reasons across
   windows. Include actor/advice distractors and bounded temporal scope. Separate
   rubric fields retain existing required/irrelevant source membership, decisive
   qualifier quote, expectedCommitment, actor, reason and temporalLimit. No rubric
   fields enter model-facing requests. Do not force extraction/admission counts,
   rescue failed capture with trusted admission, or force fetched sets below6.
3. Add separate `retention-moc-negative-queries.json`: id matching fixture;
   exactly two entries `{id,historyId,question,expectedUnknowns}`. One English,
   one Chinese query bound to existing histories, requesting facts/authorization
   not established anywhere in those histories. Only question reaches models;
   expectedUnknowns is review-only. Both arms run each query independently on
   the same unchanged final captured store. Successful empty recall still gets
   an answer. Irrelevant returns and unsupported answers remain failures, not
   overwritten empty results. Never infer denied permission from absent evidence.
4. Reuse unchanged public multi-window driver for18 once-only captures with cold
   staged/admitted inspection, bounded snapshot check, six baseline answers and
   six labelled complete-source controls. A separately reviewed private sidecar
   adds six candidate recalls/answers and four negative-query recalls/answers.
   Ordinary classification and selection in both arms; replace only rank with
   existing small-candidate wrapper in candidate. Alternate arm order. Independent
   selection is deliberately not replayed: compare exact pre-wrapper candidates
   before attributing any difference to rank retention; unmatched sets remain
   end-to-end differences with selection variability.
5. Freeze ceiling226 HTTP requests:18 captures ×at most3 model generations;
   16 recalls ×at most2 selections+1rank; each generation has1count request;
   22 host answers including6 canonical controls. Thus<=102generation+102count
   +22host. Current policy reserves at mostUS$2.12; proposed local ceilingUS$3
   inside existing cumulativeUS$50, contingent on unchanged-ledger preflight.
   Use existing candidate-qualification/source-support grant and ordinary host
   guard, not a new capability or replenished allowance. Parent-only real key,
   random child proxy token only if subprocess required; never copy older unsafe
   credential environment flow. No scored retries or fixture edits after freeze.
6. Retain capture/admission/selection/ranking/answer failures separately, all22
   answer slots, source identities and actual method/HTTP traces, per-arm policy
   applicability, retained/lost required sources, irrelevant exposure, qualifier
   fidelity, context/token/call cost and unknown costs. Compare unchanged stores
   and classify exact-match versus unmatched fetched sets. Source-built experimental
   stdio is not installed-artifact or natural-client proof. Human/same-family
   review limitations explicit; no benchmark or default-promotion claim.
7. Independent tests verify fixture/rubric/negative query bounds and oracle
   isolation, exact pairing, canonical source text and compatibility through the
   existing driver using synthetic clients/model-free answers. No paid operator
   in this PR. Rootgeneric/JSON/strictplugin+full live-evidence-offline both
   Node22.16/24, exact independent Spec/Standards and all17 CI before merge.
   A later pinned operator must pass root+independent failure rehearsals before
   any paid run, with actual endpoint/method caps checked rather than assumed.

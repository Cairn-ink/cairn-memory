# Verified preview baseline and PR disposition

Base: `e8cecf271b7ebe75a0918163b82b5542909b2a61` (2026-09-18).
User explicitly requested consolidation after the 48-PR audit. This permits
scoped integration, independently verified merge, and explained PR closure;
not branch deletion, evidence deletion, package publication, deployment or paid
experiments. Decisions below are planned actions until the integration lands.
The allowed cumulative diff is the changed-file union from the four pinned heads
and the exact #136 extraction commit named in PC1, plus this plan,
`docs/limitations.md` and `ROADMAP.md`; no other files or descendants.

## Acceptance

- PC1: Integrate only existing #135 filing-only rationale preservation, #176
  explicit MCP source-evidence startup default, #177 provider byte ownership,
  and #178 installed cold-recall regression. Also extract only the direct
  premise-challenge read fix from #136 at exact commit
  `b3bb6b41a00eb119ba191ea4fe3ef3384b3b6389`, with `cherry-pick -x` to
  avoid adopting that branch's wider research stack. Preserve the four selected
  heads' original ancestry. Do not pull in later experimental descendants.
- PC2: Preserve current main's README/demo/limitations contributions. Resolve
  conflicts by retaining scoped changes from both sides, not replacing files
  wholesale. No semantic prompt/default/model/retention/permission relaxation.
- PC3: Update limitations and roadmap to distinguish this engineering baseline
  from unresolved semantic quality and a future public benchmark. No claimed
  LongMemEval score, runtime adoption of #168–173, or hidden paid evaluation.
- PC4: Preserve this complete 48-PR snapshot with exact heads and disposition.
  Archived means not selected for the baseline, NOT proved wrong or merged.
  #142 contains more than #135; do not call all of #142 delivered. #175 belongs
  to a parallel registry workflow and remains open and untouched. #136 is only
  partially extracted at the commit named in PC1; its remaining branch and
  evidence are archived, not delivered.
- PC5: Both Node22.16/24 run generic, JSON/plugin, core, OpenAI, MCP, artifact,
  experiment-budget and request-guard gates and applicable contributor demos;
  live-evidence and LongMemEval offline checks remain CI gates. Primary reruns
  integrated source-default/cold-recall/filing/stream tests personally, plus
  direct-only challenge and support-chain recall after restart and forgetting.
  `core/test/rationale-filing.test.mjs` asserts the combined direct-only
  challenge survives filing revision, cold inspection and recall, then cannot
  reappear after forgetting and another filing; the installed artifact test
  covers direct-only and support-chain variants across MCP restarts. Two
  independent reviewers inspect the frozen final diff; all latest-head CI must
  pass before authorized merge. A changed main/head requires reassessment.
- PC6: After merge, verify original selected heads are included or document
  exact equivalent changes before marking their PRs delivered. Close other
  selected obsolete/deferred PRs with this disposition link and a clear reason,
  preserving branches and immutable prior failures. Recheck head/state before
  each action; concurrently changed work is left open for separate handling.
  Because this repository may auto-delete a source branch on merge, capture and
  verify original selected refs before and after merging; restore those refs
  if the host deleted them. Do not alter repository settings.

## Snapshot and planned disposition

No prior green check or valid source citation is a semantic quality endorsement.
Archived PR pages/branches retain code and experiment evidence. Apart from the
selected #135 filing fix and extracted #136 read fix, the larger #142 lifecycle
API, #148–167 experimental paths, and #168–173 assessments are
not prerequisites for measuring the selected baseline. #166's additional
evaluation-only malformed-answer repair remains preserved, not silently applied.

| PR | Captured head | Disposition after integration | Scope |
| --- | --- | --- | --- |
| #5 | `c35857f2997d1ecec9ec1e6135210b57c08e0e35` | Close obsolete proposal, preserve history | feat: shared memory engine and local MCP (2B preview) |
| #11 | `11e83667c3d50f4dd83330ce1fd52f02cf789509` | Close obsolete proposal, preserve history | docs: prepare capture orchestration contract and acceptance (1b) |
| #132 | `0af6034774bcb065d93d31431309f95e5d9116da` | Close archived/deferred, not adopted or semantically certified | docs: show Lantern A question, all 15 memories and retrieval misses |
| #133 | `2d5f003aac0c4f8604c40b0376174211479c3395` | Close archived/deferred, not adopted or semantically certified | test: define decision-evolution acceptance contract |
| #134 | `832a93f74582c8cc108272d6af0a5a7e98b470bd` | Close archived/deferred, not adopted or semantically certified | test: trace decision evolution through actual capture and recall |
| #135 | `ac8b93c9e4715089bd55c0a84261cf3685595a69` | Integrate existing branch; close as included only after verification and merge | fix: preserve rationale across filing-only revisions |
| #136 | `54036d9d4002c6b2334d4b9867aa63cb7ff6cffc` | Close as partially extracted only after baseline merge; direct-challenge read fix `b3bb6b41a00eb119ba191ea4fe3ef3384b3b6389` adopted, remainder archived/deferred and not certified | fix: preserve and surface decision rationale with real-capture evidence |
| #137 | `e11ee2e3f60497a2b5eb9416fbbe6fd46f645419` | Close archived/deferred, not adopted or semantically certified | test: measure lightweight relation definitions without promoting defaults |
| #138 | `ccfcbc937d7513f70651e46bb77d183f31fafa85` | Close archived/deferred, not adopted or semantically certified | test: record bounded source-by-source basis coverage comparison |
| #139 | `819f60bcc32dbdffd142602f08654734e9949ea9` | Close archived/deferred, not adopted or semantically certified | test: verify migration memory lifecycle across cold sessions |
| #140 | `eb49aed388460925540fdb3e24e3fe599ec8fcd4` | Close archived/deferred, not adopted or semantically certified | feat: support bounded correction of proposed rationale |
| #141 | `74ab18c2ae0dfb7c0aa61827ade7b73528d01ccb` | Close archived/deferred, not adopted or semantically certified | feat: expose explicit bounded rationale correction over MCP |
| #142 | `2ad8800c246e8f3cf118b79134f3463ea86c6371` | Close archived/deferred, not adopted or semantically certified | fix: integrate rationale correction, filing preservation and cold-session lifecycle |
| #143 | `0c7c40bdb738c1144d12f3a21084619e4b084f96` | Close archived/deferred, not adopted or semantically certified | test: bound selective rationale correction diagnostic |
| #144 | `8975237e35282d7163fe3e56858fd4c35e87cbef` | Close archived/deferred, not adopted or semantically certified | test: isolate temporal rationale instruction candidate |
| #145 | `703a1bd538fa9aea32041992fd2cb157550a28ed` | Close archived/deferred, not adopted or semantically certified | test: retain selective correction evidence and temporal failure |
| #146 | `620044ddde593074a83355d1d8441d830e5570ca` | Close archived/deferred, not adopted or semantically certified | test: prepare guarded paired chronology comparison |
| #147 | `f2513e9f23b0538b245140d11dd0f39156963695` | Close archived/deferred, not adopted or semantically certified | docs: retain paired chronology evidence and limitations |
| #148 | `f9c91d4e8ba2515d61bb5def0ac4d1813f69d69d` | Close archived/deferred, not adopted or semantically certified | feat: review explicit relationship dispositions without writes |
| #149 | `e68d79f747e895a0dcffedcee3eda13d9793ba32` | Close archived/deferred, not adopted or semantically certified | feat: add explicit disposition adapter transport |
| #150 | `4e9044e6bb00fc884c3029af3f1d79add3dd7219` | Close archived/deferred, not adopted or semantically certified | fix: define disposition task semantics before evaluation |
| #151 | `7cf0d9e506bfd8237a3ba294e971d2ba884871a3` | Close archived/deferred, not adopted or semantically certified | test: bound read-only disposition comparison capability |
| #152 | `082e0736121ffd43cd3bb2000d14e9341e690f80` | Close archived/deferred, not adopted or semantically certified | test: add matched-input rationale disposition control |
| #153 | `1c65c94a8d8cfa5f9073345974abacd550193958` | Close archived/deferred, not adopted or semantically certified | test: freeze fresh disposition histories and separate rubric |
| #154 | `35f2c56f0df725b8959e7b088cbd8c247f6c3c8a` | Close archived/deferred, not adopted or semantically certified | test: integrate frozen read-only disposition comparison preparation |
| #155 | `4f71ed2dff56c8b5af421e6b596362d1e1c8e1c2` | Close archived/deferred, not adopted or semantically certified | docs: retain complete disposition comparison failures and evidence |
| #156 | `c82a6eb00ace70ca78a30bbefdecbba9b1aadb8b` | Close archived/deferred, not adopted or semantically certified | feat: carry bounded rationale neighborhood through recall and MCP |
| #157 | `964e4e5879956adb816c4920f2cda7a01015a6e3` | Close archived/deferred, not adopted or semantically certified | test: prepare cold-session neighborhood source comparison |
| #158 | `86cc993e0244d029c8d7f3e1e4133c2ef4abe55d` | Close archived/deferred, not adopted or semantically certified | docs: retain interrupted cold-neighborhood comparison evidence |
| #159 | `c7ccc68378918427d867747c58bd5d8732c7eb0c` | Close archived/deferred, not adopted or semantically certified | feat: expose source-only neighborhood projection in SDK and MCP |
| #160 | `bdc7be8a59b2a535144e1c851133a1fa970cc442` | Close archived/deferred, not adopted or semantically certified | test: freeze paired decision-transition evidence cases |
| #161 | `e6712331d24a76276ac7b4720f63d82006a32abc` | Close archived/deferred, not adopted or semantically certified | Add opt-in source-first ranking before neighborhood expansion |
| #162 | `3dc0f102ae407c2ef64890f424a7133350c9bc41` | Close archived/deferred, not adopted or semantically certified | Record decision-transition diagnostic results and remaining failures |
| #163 | `2a2aa05d79e12064385d9d1f0fdb3bc9e1391571` | Close archived/deferred, not adopted or semantically certified | Test source-event grouping without losing memory associations |
| #164 | `ff30ac05e3d91d259dca71348b0cf770bf220109` | Close archived/deferred, not adopted or semantically certified | feat: preserve source-event receipt associations in opt-in recall |
| #165 | `1bcde455f4ada8870993b26966364d72eed34486` | Close archived/deferred, not adopted or semantically certified | test: receive complete source-event evidence in answer consumer |
| #166 | `2c5dc6ff4105d523f10e54c421a4902484430d41` | Close archived/deferred, not adopted or semantically certified | fix: reject malformed legacy answer choices without throwing |
| #167 | `5ab9a3b8c414262fee62540fbd567930b2062201` | Close archived/deferred, not adopted or semantically certified | refactor: share exact source passage partition |
| #168 | `240520523867e24820cac226cd53ec16c5568d46` | Close archived/deferred, not adopted or semantically certified | feat: source-only context compilation in shared core |
| #169 | `7e212ec1d5a8dca9b2afbae2c9481b974475f423` | Close archived/deferred, not adopted or semantically certified | feat(core): bind source-context assessment to current receipts |
| #170 | `34801396ca2c0a5627d3311467d61dd230596371` | Close archived/deferred, not adopted or semantically certified | feat(openai): transport bound source-context review |
| #171 | `ecc39684a9fbc6a11149a65529f9cdf30e3a90dc` | Close archived/deferred, not adopted or semantically certified | feat(core): retain proposition-local source stance in opt-in assessments |
| #172 | `d479702705f752d7c0d0a02bb5508a97f50773a2` | Close archived/deferred, not adopted or semantically certified | Add opt-in source-local reason associations |
| #173 | `dc551d352b42322a0fea3cff93b60735e9f28682` | Close archived/deferred, not adopted or semantically certified | Align v3 source citations with compiler requirements |
| #175 | `5b9488d985b4a6bb7af33852bdbf7a3866e6c0d4` | Leave open: separately owned registry preparation | feat: describe the server for the official MCP Registry |
| #176 | `567ee6ea122efe8801196ef41cdf1df521bbacfc` | Integrate existing branch; close as included only after verification and merge | feat: configure source-evidence recall default for local MCP |
| #177 | `a2f123111c03942586f7a2d5422c9eb8f8a7c368` | Integrate existing branch; close as included only after verification and merge | fix: own provider response bytes before subsequent reads |
| #178 | `9eb5aaa5a553df123d618fe20b1e6c15cf5761f8` | Integrate existing branch; close as included only after verification and merge | test: verify rationale recall across installed MCP restarts |

The public benchmark is deferred to the next discussion after consolidation;
this plan does not authorize a live or paid evaluation.

## Verification and ownership

Primary owns disposition and final acceptance. A bounded Sol/high worker owns
integration and documentation; independent Standards and Spec review follow.
All test stores and HTTP fixtures are synthetic; no user keys or actual ledger.

**2026-10-24 — incremental re-audit: candidate 3, protocol v1.1**

All twenty changes pass. Full-audit judgments stand; world/filler hashes match. No new semantic/filler leaks, including lexical-check-passing leaks. English insertions do not quote complete facts. C4: 10 zh/10 en.

C2: zh queries; ⊂ marks longer Han runs.

| Query | Verdict | Required-region witness |
| --- | --- | --- |
| q-010 | C1:pass | CopperQuay; m-9fa1cb19037b1be8#s1 |
| q-028 | C2:pass | 依賴⊂的依賴關係整理; m-a6b9986f70fe4705#s2 |
| q-032 | C2:pass | 桌牌⊂的桌牌只負責裁邊; m-3187b024e7f073c4#s4 |
| q-192 | C2:pass | 當時/history admits 芍窗⊂袁沐在芍窗的偏好圖卡只負責陰影; m-1ac2107366d5613a#s1 |
| q-202 | C2:pass | 簽收⊂的簽收重播腳本; m-eee0a628caa14e0d#s4 |
| q-204 | C2:pass | 時間⊂的時間案例維護上限是; m-1ce52fce40303d15#s2 |
| q-205 | C2:pass | 層雲⊂層雲閂; m-2427af872c2c6179#s1 |
| q-206 | C2:pass | 作者⊂改動的原因是作者無法理解被刪段落的問題; m-2d1b45b496157585#s2 |
| q-210 | C2:pass | 租約⊂的租約索引只負責分隔頁; m-996faf00322f58ce#s1 |
| q-211 | C2:pass | 側欄⊂的側欄互動; m-36afc4f85bdbd9e5#s2 |
| q-001 | C1:pass | 鎏砂; m-02f1f77e2c4b567c#s2 |
| q-002 | C1:pass | 砌燈; m-82fa82ee3affe422#s2 |
| q-101 | C6:pass | Coalesced writes supersede individual writes; linked orphan-index reason. |
| q-102 | C6:pass | Startup→locale loading plus linked cold-start-memory reason. |
| q-122 | C7:pass | Script-owner support; poster-title negative m-8fe6797b60b7b0a5. |
| q-125 | C7:pass | Screenshot-role support; key-inventory negative m-1ebe1036fd4b1922. |
| q-141 | C8:pass | B-hr2b-t04-08 remains absent; zero members. |
| q-151 | FOREIGN:pass | FABLE-731; foreign body m-0fa4eca9eec26776. |
| q-177 | C5:pass | Disjoint caller-retry/script-owner supports: m-c9adab90a155b700 / m-e847956986e787d4. |
| q-178 | C5:pass | Disjoint system-clock/testing-owner supports: m-440383cf98451adf / m-1ce52fce40303d15. |

Removed ten stale recategorizations. Final overrides: add-member 1; all other actions 0. Sole reason class: foreign temporal entailment. Unchanged q-110 still needs B-hr2b-t19-02 from m-3a8c9c3f1c47ccf6, where=body: reservation-time labeling supports “before lending.” Flat detail retained; its dev group becomes body.

| Split | Stratum | Groups | Families |
| --- | --- | ---: | ---: |
| dev | body | 14 | 9 |
| dev | first-receipt | 19 | 9 |
| dev | later-receipt | 29 | 10 |
| test | body | 26 | 19 |
| test | first-receipt | 56 | 25 |
| test | later-receipt | 49 | 22 |

Later: groups/families; queries=families: dev/test.

| Category | Queries=families dev/test | Later dev | Later test |
| --- | ---: | ---: | ---: |
| C1 | 5/15 | 2/2 | 7/7 |
| C2 | 6/14 | 4/4 | 6/6 |
| C3 | 7/13 | 3/3 | 7/7 |
| C4 | 8/12 | 5/5 | 5/5 |
| C5 | 7/13 | 8/6 | 9/7 |
| C6 | 6/14 | 3/3 | 9/7 |
| C7 | 7/13 | 4/4 | 6/6 |

Primary/placement quotas pass: 20/category; dev 46/140=32.86%; pooled test guard 49 groups/22 families. Remaining later groups have no eligible earlier support.

Independent label/corpus censuses agree: 193 groups, 266 members. Final verification exits 0; two files cross-checked. No tests/commit.

Fixture can be frozen: yes (after retained override application and coordinator validation).

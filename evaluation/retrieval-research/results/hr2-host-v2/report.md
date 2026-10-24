# HR-2 budgeted assembly

Protocol: HR-2 v1.1. Primary decision: **inconclusive**. Reason: primary_cell_absent.

The sole confirmatory contrast is P-cover − P-top on test / S1000 / A3--bge-m3 / O=0 / B=512. Every other contrast and all dev output are exploratory. The shared statistics library receives exploratory:true solely to select the preregistered 95% endpoints.

This is a short, single-fact synthetic fixture with bodies at most 82 UTF-16 units and about 40% span-only required groups. These results do not establish behavior on long items, generated summaries, hosted applicability or production reliability. The initial policy must be revisited with a long-item fixture. McNemar is underpowered by design.

## Shared provenance

Frozen commit: c863e9d674f23ccebffaf3ad96ab1c4b34eabc82; counter: tiktoken@1.0.22:o200k_base:encode(text,[],[]).

All unrounded metrics, complete source runs, per-query admissions and stage identities are retained in JSON. Cell numbers below refer to the metrics table.

| Stage | Commit | Source SHA-256 | Dirty | Detached |
| --- | --- | --- | --- | --- |
| report | 14fdacb5dc36542e48f6aa5f2b69b626c9e2a0eb | e536ac62a587517a3d24222ca6f6a8941c4f428a3fa51c4b6c76809190d8ae46 | true | false |
| assembly | 14fdacb5dc36542e48f6aa5f2b69b626c9e2a0eb | e536ac62a587517a3d24222ca6f6a8941c4f428a3fa51c4b6c76809190d8ae46 | true | false |
| scorer | 14fdacb5dc36542e48f6aa5f2b69b626c9e2a0eb | e536ac62a587517a3d24222ca6f6a8941c4f428a3fa51c4b6c76809190d8ae46 | true | false |

Fixture hash sets:

{"hr1-facts.json":"339fbdb91158a7593265c129c31bc205f4efe6a552301bcab1e063e12f8e5087","hr1-corpus.json":"1ce357439f1ed28cfd2e2c8bf31e0bde1581e1110c40577f06d0a915d8db0bf5","hr1-facts-view.json":"65fc2e46c474f8d3f532bae7ea9a95441a17a67c4350fe01a091022b10e18971","hr1-queries.json":"91648404a6ea32866081a7e308e20235fd0209835ff2cfee09b7abe074bae9ea","hr1-split.json":"00e96f9e764da780d7024eac62bc15442dde3e02166c4057bbf49d82ae8c1ebb","hr1-labels.json":"7e9b8054cf7e5bec7b71789319696ee871a4d5c627c877cba0952f6c74211622","hr1-label-audit.json":"5e1e585fc5d85ccb92965fd0f15d70dea8f727dc7622990174ece03e21a01d0d"}

Environments:

{"node":"v22.16.0","cpu":"AMD Ryzen 9 9950X 16-Core Processor","logicalCores":32,"ramBytes":42058170368,"platform":"linux","os":"5.15.167.4-microsoft-standard-WSL2","arch":"x64"}

| Split | Ranking | Member SHA-256 |
| --- | --- | --- |
| test | A1 | 096d5ba71655eda1d91126d14ae5c1c465fb539faece86bb541bcee4bc7074ae |
| test | A3--bge-m3 | 57cb2ccad4928c338026327170de8fd4478a7cae057ececa873401bc405ee672 |
| test | F-RRF10--openai-3-small | f24fc35ffc351a4579645d4509a5f25e24b1597ad82e743f1c311849260064ea |

## Cell metrics

| Cell | Split | Ranking | Arm | O | B | Designation | Coverage | All-required | Full-ranking ceiling | Assembly loss | Token use p50 / p95 |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | test | A1 | P-cover | host-v2 | 1024 | exploratory | 0.5923 | 0.5042 | 0.8726 | 0.2804 | 0.9941 / 1.0000 |
| 2 | test | A1 | P-cover | host-v2 | 128 | exploratory | 0.3069 | 0.2506 | 0.8726 | 0.5657 | 0.9141 / 0.9871 |
| 3 | test | A1 | P-cover | host-v2 | 1536 | exploratory | 0.6514 | 0.5375 | 0.8726 | 0.2212 | 0.9967 / 0.9993 |
| 4 | test | A1 | P-cover | host-v2 | 192 | exploratory | 0.3915 | 0.3113 | 0.8726 | 0.4812 | 0.9844 / 1.0000 |
| 5 | test | A1 | P-cover | host-v2 | 256 | exploratory | 0.5357 | 0.4488 | 0.8726 | 0.3369 | 0.9785 / 1.0000 |
| 6 | test | A1 | P-cover | host-v2 | 384 | exploratory | 0.5968 | 0.5036 | 0.8726 | 0.2758 | 0.9831 / 1.0000 |
| 7 | test | A1 | P-cover | host-v2 | 512 | exploratory | 0.6181 | 0.5315 | 0.8726 | 0.2546 | 0.9883 / 1.0000 |
| 8 | test | A1 | P-cover | host-v2 | 768 | exploratory | 0.5478 | 0.4506 | 0.8726 | 0.3248 | 0.9928 / 1.0000 |
| 9 | test | A3--bge-m3 | P-cover | host-v2 | 1024 | exploratory | 0.7238 | 0.6155 | 0.9865 | 0.2627 | 0.9932 / 1.0000 |
| 10 | test | A3--bge-m3 | P-cover | host-v2 | 128 | exploratory | 0.3637 | 0.3113 | 0.9865 | 0.6228 | 0.9141 / 0.9691 |
| 11 | test | A3--bge-m3 | P-cover | host-v2 | 1536 | exploratory | 0.8591 | 0.7988 | 0.9865 | 0.1274 | 0.9967 / 1.0000 |
| 12 | test | A3--bge-m3 | P-cover | host-v2 | 192 | exploratory | 0.4208 | 0.3446 | 0.9865 | 0.5657 | 0.9844 / 1.0000 |
| 13 | test | A3--bge-m3 | P-cover | host-v2 | 256 | exploratory | 0.5800 | 0.4804 | 0.9865 | 0.4065 | 0.9727 / 1.0000 |
| 14 | test | A3--bge-m3 | P-cover | host-v2 | 384 | exploratory | 0.6895 | 0.6006 | 0.9865 | 0.2970 | 0.9831 / 0.9983 |
| 15 | test | A3--bge-m3 | P-cover | host-v2 | 512 | exploratory | 0.6970 | 0.6018 | 0.9865 | 0.2895 | 0.9922 / 1.0000 |
| 16 | test | A3--bge-m3 | P-cover | host-v2 | 768 | exploratory | 0.6933 | 0.5810 | 0.9865 | 0.2933 | 0.9961 / 1.0000 |
| 17 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 1024 | exploratory | 0.6940 | 0.5798 | 0.9778 | 0.2837 | 0.9941 / 1.0000 |
| 18 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 128 | exploratory | 0.3601 | 0.3018 | 0.9778 | 0.6177 | 0.9219 / 0.9871 |
| 19 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 1536 | exploratory | 0.6946 | 0.5732 | 0.9778 | 0.2831 | 0.9974 / 1.0000 |
| 20 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 192 | exploratory | 0.4188 | 0.3327 | 0.9778 | 0.5589 | 0.9844 / 1.0000 |
| 21 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 256 | exploratory | 0.5905 | 0.4917 | 0.9778 | 0.3873 | 0.9727 / 1.0000 |
| 22 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 384 | exploratory | 0.6611 | 0.5464 | 0.9778 | 0.3167 | 0.9844 / 1.0000 |
| 23 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 512 | exploratory | 0.6821 | 0.5679 | 0.9778 | 0.2956 | 0.9941 / 1.0000 |
| 24 | test | F-RRF10--openai-3-small | P-cover | host-v2 | 768 | exploratory | 0.6520 | 0.5524 | 0.9778 | 0.3258 | 0.9928 / 1.0000 |
| 25 | test | A1 | P-cover-s1 | host-v2 | 1024 | exploratory | 0.5923 | 0.5042 | 0.8726 | 0.2804 | 0.9912 / 1.0000 |
| 26 | test | A1 | P-cover-s1 | host-v2 | 128 | exploratory | 0.3069 | 0.2506 | 0.8726 | 0.5657 | 0.9141 / 0.9531 |
| 27 | test | A1 | P-cover-s1 | host-v2 | 1536 | exploratory | 0.6514 | 0.5375 | 0.8726 | 0.2212 | 0.9948 / 0.9996 |
| 28 | test | A1 | P-cover-s1 | host-v2 | 192 | exploratory | 0.3915 | 0.3113 | 0.8726 | 0.4812 | 0.9844 / 1.0000 |
| 29 | test | A1 | P-cover-s1 | host-v2 | 256 | exploratory | 0.5357 | 0.4488 | 0.8726 | 0.3369 | 0.9688 / 1.0000 |
| 30 | test | A1 | P-cover-s1 | host-v2 | 384 | exploratory | 0.6016 | 0.5036 | 0.8726 | 0.2710 | 0.9622 / 1.0000 |
| 31 | test | A1 | P-cover-s1 | host-v2 | 512 | exploratory | 0.6181 | 0.5315 | 0.8726 | 0.2546 | 0.9883 / 1.0000 |
| 32 | test | A1 | P-cover-s1 | host-v2 | 768 | exploratory | 0.5565 | 0.4506 | 0.8726 | 0.3161 | 0.9909 / 1.0000 |
| 33 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 1024 | exploratory | 0.7397 | 0.6274 | 0.9865 | 0.2468 | 0.9912 / 0.9990 |
| 34 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 128 | exploratory | 0.3637 | 0.3113 | 0.9865 | 0.6228 | 0.9141 / 0.9531 |
| 35 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 1536 | exploratory | 0.8687 | 0.8083 | 0.9865 | 0.1179 | 0.9954 / 1.0000 |
| 36 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 192 | exploratory | 0.4208 | 0.3446 | 0.9865 | 0.5657 | 0.9844 / 1.0000 |
| 37 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 256 | exploratory | 0.5879 | 0.4899 | 0.9865 | 0.3986 | 0.9727 / 1.0000 |
| 38 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 384 | exploratory | 0.7101 | 0.6125 | 0.9865 | 0.2764 | 0.9648 / 0.9974 |
| 39 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 512 | exploratory | 0.7089 | 0.6137 | 0.9865 | 0.2776 | 0.9863 / 1.0000 |
| 40 | test | A3--bge-m3 | P-cover-s1 | host-v2 | 768 | exploratory | 0.7052 | 0.6024 | 0.9865 | 0.2813 | 0.9948 / 1.0000 |
| 41 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 1024 | exploratory | 0.7060 | 0.5917 | 0.9778 | 0.2718 | 0.9922 / 1.0000 |
| 42 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 128 | exploratory | 0.3601 | 0.3018 | 0.9778 | 0.6177 | 0.9141 / 0.9531 |
| 43 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 1536 | exploratory | 0.7155 | 0.5940 | 0.9778 | 0.2623 | 0.9951 / 1.0000 |
| 44 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 192 | exploratory | 0.4188 | 0.3327 | 0.9778 | 0.5589 | 0.9844 / 1.0000 |
| 45 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 256 | exploratory | 0.5964 | 0.4917 | 0.9778 | 0.3813 | 0.9688 / 1.0000 |
| 46 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 384 | exploratory | 0.6778 | 0.5583 | 0.9778 | 0.3000 | 0.9635 / 1.0000 |
| 47 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 512 | exploratory | 0.6821 | 0.5679 | 0.9778 | 0.2956 | 0.9902 / 1.0000 |
| 48 | test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 768 | exploratory | 0.6579 | 0.5643 | 0.9778 | 0.3198 | 0.9909 / 1.0000 |
| 49 | test | A1 | P-top+tail | host-v2 | 1024 | exploratory | 0.7631 | 0.6952 | 0.8726 | 0.1095 | 0.9771 / 1.0000 |
| 50 | test | A1 | P-top+tail | host-v2 | 128 | exploratory | 0.3069 | 0.2506 | 0.8726 | 0.5657 | 0.9141 / 0.9531 |
| 51 | test | A1 | P-top+tail | host-v2 | 1536 | exploratory | 0.7877 | 0.7286 | 0.8726 | 0.0849 | 0.9756 / 0.9993 |
| 52 | test | A1 | P-top+tail | host-v2 | 192 | exploratory | 0.4698 | 0.3857 | 0.8726 | 0.4028 | 0.7708 / 0.8911 |
| 53 | test | A1 | P-top+tail | host-v2 | 256 | exploratory | 0.5712 | 0.4673 | 0.8726 | 0.3014 | 0.9102 / 0.9961 |
| 54 | test | A1 | P-top+tail | host-v2 | 384 | exploratory | 0.6228 | 0.5101 | 0.8726 | 0.2498 | 0.9440 / 0.9922 |
| 55 | test | A1 | P-top+tail | host-v2 | 512 | exploratory | 0.6974 | 0.6125 | 0.8726 | 0.1752 | 0.9375 / 0.9903 |
| 56 | test | A1 | P-top+tail | host-v2 | 768 | exploratory | 0.7385 | 0.6643 | 0.8726 | 0.1341 | 0.9635 / 0.9987 |
| 57 | test | A3--bge-m3 | P-top+tail | host-v2 | 1024 | exploratory | 0.9206 | 0.9048 | 0.9865 | 0.0659 | 0.9795 / 0.9980 |
| 58 | test | A3--bge-m3 | P-top+tail | host-v2 | 128 | exploratory | 0.3637 | 0.3113 | 0.9865 | 0.6228 | 0.9141 / 0.9531 |
| 59 | test | A3--bge-m3 | P-top+tail | host-v2 | 1536 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9850 / 0.9980 |
| 60 | test | A3--bge-m3 | P-top+tail | host-v2 | 192 | exploratory | 0.5712 | 0.4863 | 0.9865 | 0.4153 | 0.7760 / 0.9151 |
| 61 | test | A3--bge-m3 | P-top+tail | host-v2 | 256 | exploratory | 0.6530 | 0.5411 | 0.9865 | 0.3335 | 0.9141 / 0.9961 |
| 62 | test | A3--bge-m3 | P-top+tail | host-v2 | 384 | exploratory | 0.7437 | 0.6548 | 0.9865 | 0.2429 | 0.9492 / 0.9905 |
| 63 | test | A3--bge-m3 | P-top+tail | host-v2 | 512 | exploratory | 0.8143 | 0.7524 | 0.9865 | 0.1722 | 0.9482 / 1.0000 |
| 64 | test | A3--bge-m3 | P-top+tail | host-v2 | 768 | exploratory | 0.8837 | 0.8476 | 0.9865 | 0.1028 | 0.9596 / 0.9974 |
| 65 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 1024 | exploratory | 0.9155 | 0.8857 | 0.9778 | 0.0623 | 0.9814 / 0.9974 |
| 66 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 128 | exploratory | 0.3601 | 0.3018 | 0.9778 | 0.6177 | 0.9141 / 0.9531 |
| 67 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 1536 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9788 / 0.9993 |
| 68 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 192 | exploratory | 0.5433 | 0.4583 | 0.9778 | 0.4345 | 0.7760 / 0.9151 |
| 69 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 256 | exploratory | 0.6593 | 0.5435 | 0.9778 | 0.3185 | 0.9238 / 0.9896 |
| 70 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 384 | exploratory | 0.7431 | 0.6458 | 0.9778 | 0.2347 | 0.9479 / 0.9879 |
| 71 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 512 | exploratory | 0.8206 | 0.7500 | 0.9778 | 0.1571 | 0.9492 / 0.9851 |
| 72 | test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 768 | exploratory | 0.8766 | 0.8190 | 0.9778 | 0.1012 | 0.9603 / 0.9987 |
| 73 | test | A1 | P-top | host-v2 | 1024 | exploratory | 0.7631 | 0.6952 | 0.8726 | 0.1095 | 0.9883 / 1.0000 |
| 74 | test | A1 | P-top | host-v2 | 128 | exploratory | 0.3069 | 0.2506 | 0.8726 | 0.5657 | 0.9141 / 0.9871 |
| 75 | test | A1 | P-top | host-v2 | 1536 | exploratory | 0.7877 | 0.7286 | 0.8726 | 0.0849 | 0.9779 / 0.9993 |
| 76 | test | A1 | P-top | host-v2 | 192 | exploratory | 0.4698 | 0.3857 | 0.8726 | 0.4028 | 0.7708 / 0.8911 |
| 77 | test | A1 | P-top | host-v2 | 256 | exploratory | 0.5712 | 0.4673 | 0.8726 | 0.3014 | 0.9609 / 1.0000 |
| 78 | test | A1 | P-top | host-v2 | 384 | exploratory | 0.6355 | 0.5292 | 0.8726 | 0.2371 | 0.9544 / 0.9931 |
| 79 | test | A1 | P-top | host-v2 | 512 | exploratory | 0.6974 | 0.6125 | 0.8726 | 0.1752 | 0.9375 / 0.9903 |
| 80 | test | A1 | P-top | host-v2 | 768 | exploratory | 0.7385 | 0.6643 | 0.8726 | 0.1341 | 0.9674 / 0.9992 |
| 81 | test | A3--bge-m3 | P-top | host-v2 | 1024 | exploratory | 0.9206 | 0.9048 | 0.9865 | 0.0659 | 0.9863 / 0.9984 |
| 82 | test | A3--bge-m3 | P-top | host-v2 | 128 | exploratory | 0.3637 | 0.3113 | 0.9865 | 0.6228 | 0.9141 / 0.9691 |
| 83 | test | A3--bge-m3 | P-top | host-v2 | 1536 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9883 / 0.9993 |
| 84 | test | A3--bge-m3 | P-top | host-v2 | 192 | exploratory | 0.5712 | 0.4863 | 0.9865 | 0.4153 | 0.7760 / 0.9151 |
| 85 | test | A3--bge-m3 | P-top | host-v2 | 256 | exploratory | 0.6651 | 0.5500 | 0.9865 | 0.3214 | 0.9629 / 0.9961 |
| 86 | test | A3--bge-m3 | P-top | host-v2 | 384 | exploratory | 0.7437 | 0.6548 | 0.9865 | 0.2429 | 0.9557 / 0.9922 |
| 87 | test | A3--bge-m3 | P-top | host-v2 | 512 | exploratory | 0.8143 | 0.7524 | 0.9865 | 0.1722 | 0.9492 / 1.0000 |
| 88 | test | A3--bge-m3 | P-top | host-v2 | 768 | exploratory | 0.8837 | 0.8476 | 0.9865 | 0.1028 | 0.9642 / 0.9979 |
| 89 | test | F-RRF10--openai-3-small | P-top | host-v2 | 1024 | exploratory | 0.9155 | 0.8857 | 0.9778 | 0.0623 | 0.9873 / 0.9984 |
| 90 | test | F-RRF10--openai-3-small | P-top | host-v2 | 128 | exploratory | 0.3601 | 0.3018 | 0.9778 | 0.6177 | 0.9219 / 0.9871 |
| 91 | test | F-RRF10--openai-3-small | P-top | host-v2 | 1536 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9827 / 0.9993 |
| 92 | test | F-RRF10--openai-3-small | P-top | host-v2 | 192 | exploratory | 0.5433 | 0.4583 | 0.9778 | 0.4345 | 0.7760 / 0.9151 |
| 93 | test | F-RRF10--openai-3-small | P-top | host-v2 | 256 | exploratory | 0.6673 | 0.5435 | 0.9778 | 0.3105 | 0.9648 / 0.9961 |
| 94 | test | F-RRF10--openai-3-small | P-top | host-v2 | 384 | exploratory | 0.7431 | 0.6458 | 0.9778 | 0.2347 | 0.9557 / 0.9922 |
| 95 | test | F-RRF10--openai-3-small | P-top | host-v2 | 512 | exploratory | 0.8206 | 0.7500 | 0.9778 | 0.1571 | 0.9492 / 0.9916 |
| 96 | test | F-RRF10--openai-3-small | P-top | host-v2 | 768 | exploratory | 0.8766 | 0.8190 | 0.9778 | 0.1012 | 0.9635 / 1.0000 |
| 97 | test | A1 | P-top-s1 | host-v2 | 1024 | exploratory | 0.7679 | 0.7048 | 0.8726 | 0.1048 | 0.9785 / 0.9994 |
| 98 | test | A1 | P-top-s1 | host-v2 | 128 | exploratory | 0.3069 | 0.2506 | 0.8726 | 0.5657 | 0.9141 / 0.9531 |
| 99 | test | A1 | P-top-s1 | host-v2 | 1536 | exploratory | 0.8103 | 0.7524 | 0.8726 | 0.0623 | 0.9837 / 0.9993 |
| 100 | test | A1 | P-top-s1 | host-v2 | 192 | exploratory | 0.4698 | 0.3857 | 0.8726 | 0.4028 | 0.7448 / 0.7797 |
| 101 | test | A1 | P-top-s1 | host-v2 | 256 | exploratory | 0.5808 | 0.4673 | 0.8726 | 0.2919 | 0.9551 / 0.9936 |
| 102 | test | A1 | P-top-s1 | host-v2 | 384 | exploratory | 0.6522 | 0.5506 | 0.8726 | 0.2204 | 0.8984 / 0.9358 |
| 103 | test | A1 | P-top-s1 | host-v2 | 512 | exploratory | 0.6974 | 0.6125 | 0.8726 | 0.1752 | 0.8955 / 0.9980 |
| 104 | test | A1 | P-top-s1 | host-v2 | 768 | exploratory | 0.7480 | 0.6738 | 0.8726 | 0.1246 | 0.9746 / 0.9974 |
| 105 | test | A3--bge-m3 | P-top-s1 | host-v2 | 1024 | exploratory | 0.9325 | 0.9167 | 0.9865 | 0.0540 | 0.9766 / 0.9990 |
| 106 | test | A3--bge-m3 | P-top-s1 | host-v2 | 128 | exploratory | 0.3637 | 0.3113 | 0.9865 | 0.6228 | 0.9141 / 0.9531 |
| 107 | test | A3--bge-m3 | P-top-s1 | host-v2 | 1536 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9792 / 0.9996 |
| 108 | test | A3--bge-m3 | P-top-s1 | host-v2 | 192 | exploratory | 0.5712 | 0.4863 | 0.9865 | 0.4153 | 0.7500 / 0.7865 |
| 109 | test | A3--bge-m3 | P-top-s1 | host-v2 | 256 | exploratory | 0.6817 | 0.5595 | 0.9865 | 0.3048 | 0.9531 / 0.9818 |
| 110 | test | A3--bge-m3 | P-top-s1 | host-v2 | 384 | exploratory | 0.7484 | 0.6643 | 0.9865 | 0.2381 | 0.9010 / 0.9280 |
| 111 | test | A3--bge-m3 | P-top-s1 | host-v2 | 512 | exploratory | 0.8143 | 0.7524 | 0.9865 | 0.1722 | 0.8955 / 0.9980 |
| 112 | test | A3--bge-m3 | P-top-s1 | host-v2 | 768 | exploratory | 0.8869 | 0.8571 | 0.9865 | 0.0996 | 0.9714 / 0.9961 |
| 113 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 1024 | exploratory | 0.9155 | 0.8857 | 0.9778 | 0.0623 | 0.9707 / 1.0000 |
| 114 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 128 | exploratory | 0.3601 | 0.3018 | 0.9778 | 0.6177 | 0.9141 / 0.9531 |
| 115 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 1536 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9854 / 0.9996 |
| 116 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 192 | exploratory | 0.5433 | 0.4583 | 0.9778 | 0.4345 | 0.7500 / 0.7865 |
| 117 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 256 | exploratory | 0.6780 | 0.5435 | 0.9778 | 0.2998 | 0.9473 / 0.9844 |
| 118 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 384 | exploratory | 0.7567 | 0.6643 | 0.9778 | 0.2210 | 0.8997 / 0.9349 |
| 119 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 512 | exploratory | 0.8361 | 0.7714 | 0.9778 | 0.1417 | 0.8965 / 1.0000 |
| 120 | test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 768 | exploratory | 0.8865 | 0.8429 | 0.9778 | 0.0913 | 0.9714 / 0.9974 |

## host-v2 overhead (exploratory)

Exploratory fixed additive default-Memory calibration; not shipped-host token counts. UUID/text tokenization, later completeness transitions, cross-item sameAs deduplication, non-default metadata, sourceAccess and Cards are not modelled faithfully.

48 paired contrasts: P-cover − P-top and P-top-s1 − P-top. All intervals are pointwise, unadjusted, exploratory 95% CI. The frozen confirmatory selector remains numeric O=0; host-v2 does not change that decision.

Whole-unit skip-and-continue need not give monotone coverage. Reaching the evidence ceiling does not mean every candidate unit fits.

| Split | Ranking | Arm | O | 128 | 192 | 256 | 384 | 512 | 768 | 1024 | 1536 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| test | A1 | P-cover | host-v2 | 0.3069 | 0.3915 | 0.5357 | 0.5968 | 0.6181 | 0.5478 | 0.5923 | 0.6514 |
| test | A3--bge-m3 | P-cover | host-v2 | 0.3637 | 0.4208 | 0.5800 | 0.6895 | 0.6970 | 0.6933 | 0.7238 | 0.8591 |
| test | F-RRF10--openai-3-small | P-cover | host-v2 | 0.3601 | 0.4188 | 0.5905 | 0.6611 | 0.6821 | 0.6520 | 0.6940 | 0.6946 |
| test | A1 | P-cover-s1 | host-v2 | 0.3069 | 0.3915 | 0.5357 | 0.6016 | 0.6181 | 0.5565 | 0.5923 | 0.6514 |
| test | A3--bge-m3 | P-cover-s1 | host-v2 | 0.3637 | 0.4208 | 0.5879 | 0.7101 | 0.7089 | 0.7052 | 0.7397 | 0.8687 |
| test | F-RRF10--openai-3-small | P-cover-s1 | host-v2 | 0.3601 | 0.4188 | 0.5964 | 0.6778 | 0.6821 | 0.6579 | 0.7060 | 0.7155 |
| test | A1 | P-top+tail | host-v2 | 0.3069 | 0.4698 | 0.5712 | 0.6228 | 0.6974 | 0.7385 | 0.7631 | 0.7877 |
| test | A3--bge-m3 | P-top+tail | host-v2 | 0.3637 | 0.5712 | 0.6530 | 0.7437 | 0.8143 | 0.8837 | 0.9206 | 0.9770 |
| test | F-RRF10--openai-3-small | P-top+tail | host-v2 | 0.3601 | 0.5433 | 0.6593 | 0.7431 | 0.8206 | 0.8766 | 0.9155 | 0.9643 |
| test | A1 | P-top | host-v2 | 0.3069 | 0.4698 | 0.5712 | 0.6355 | 0.6974 | 0.7385 | 0.7631 | 0.7877 |
| test | A3--bge-m3 | P-top | host-v2 | 0.3637 | 0.5712 | 0.6651 | 0.7437 | 0.8143 | 0.8837 | 0.9206 | 0.9770 |
| test | F-RRF10--openai-3-small | P-top | host-v2 | 0.3601 | 0.5433 | 0.6673 | 0.7431 | 0.8206 | 0.8766 | 0.9155 | 0.9643 |
| test | A1 | P-top-s1 | host-v2 | 0.3069 | 0.4698 | 0.5808 | 0.6522 | 0.6974 | 0.7480 | 0.7679 | 0.8103 |
| test | A3--bge-m3 | P-top-s1 | host-v2 | 0.3637 | 0.5712 | 0.6817 | 0.7484 | 0.8143 | 0.8869 | 0.9325 | 0.9770 |
| test | F-RRF10--openai-3-small | P-top-s1 | host-v2 | 0.3601 | 0.5433 | 0.6780 | 0.7567 | 0.8361 | 0.8865 | 0.9155 | 0.9643 |

| Split | Ranking | Model SHA-256 | Saturation |
| --- | --- | --- | --- |
| test | A1 | 5eba1bd4448b17ce51598d1d561ff66280740573830c7ddc55a9b3271c79422b | not reached through 1,536 |
| test | A3--bge-m3 | 5eba1bd4448b17ce51598d1d561ff66280740573830c7ddc55a9b3271c79422b | not reached through 1,536 |
| test | F-RRF10--openai-3-small | 5eba1bd4448b17ce51598d1d561ff66280740573830c7ddc55a9b3271c79422b | not reached through 1,536 |

| Split | Ranking | Arm | B | Queries with budget-rejected scheduled units | Admitted body-equal spans | Ranked body-equal spans |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| test | A1 | P-cover | 1024 | 92 | 0 | 0 |
| test | A1 | P-cover | 128 | 94 | 0 | 0 |
| test | A1 | P-cover | 1536 | 90 | 0 | 0 |
| test | A1 | P-cover | 192 | 94 | 0 | 0 |
| test | A1 | P-cover | 256 | 94 | 0 | 0 |
| test | A1 | P-cover | 384 | 94 | 0 | 0 |
| test | A1 | P-cover | 512 | 93 | 0 | 0 |
| test | A1 | P-cover | 768 | 93 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 1024 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 128 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 1536 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 192 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 256 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 384 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 512 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover | 768 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 1024 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 128 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 1536 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 192 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 256 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 384 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 512 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover | 768 | 94 | 0 | 0 |
| test | A1 | P-cover-s1 | 1024 | 91 | 0 | 0 |
| test | A1 | P-cover-s1 | 128 | 94 | 0 | 0 |
| test | A1 | P-cover-s1 | 1536 | 89 | 0 | 0 |
| test | A1 | P-cover-s1 | 192 | 94 | 0 | 0 |
| test | A1 | P-cover-s1 | 256 | 94 | 0 | 0 |
| test | A1 | P-cover-s1 | 384 | 93 | 0 | 0 |
| test | A1 | P-cover-s1 | 512 | 93 | 0 | 0 |
| test | A1 | P-cover-s1 | 768 | 93 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 1024 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 128 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 1536 | 92 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 192 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 256 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 384 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 512 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-cover-s1 | 768 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 1024 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 128 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 1536 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 192 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 256 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 384 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 512 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-cover-s1 | 768 | 94 | 0 | 0 |
| test | A1 | P-top+tail | 1024 | 92 | 0 | 0 |
| test | A1 | P-top+tail | 128 | 94 | 0 | 0 |
| test | A1 | P-top+tail | 1536 | 90 | 0 | 0 |
| test | A1 | P-top+tail | 192 | 94 | 0 | 0 |
| test | A1 | P-top+tail | 256 | 94 | 0 | 0 |
| test | A1 | P-top+tail | 384 | 94 | 0 | 0 |
| test | A1 | P-top+tail | 512 | 93 | 0 | 0 |
| test | A1 | P-top+tail | 768 | 93 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 1024 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 128 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 1536 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 192 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 256 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 384 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 512 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top+tail | 768 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 1024 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 128 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 1536 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 192 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 256 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 384 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 512 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top+tail | 768 | 94 | 0 | 0 |
| test | A1 | P-top | 1024 | 92 | 0 | 0 |
| test | A1 | P-top | 128 | 94 | 0 | 0 |
| test | A1 | P-top | 1536 | 90 | 0 | 0 |
| test | A1 | P-top | 192 | 94 | 0 | 0 |
| test | A1 | P-top | 256 | 94 | 0 | 0 |
| test | A1 | P-top | 384 | 94 | 0 | 0 |
| test | A1 | P-top | 512 | 93 | 0 | 0 |
| test | A1 | P-top | 768 | 93 | 0 | 0 |
| test | A3--bge-m3 | P-top | 1024 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top | 128 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top | 1536 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top | 192 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top | 256 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top | 384 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top | 512 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top | 768 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 1024 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 128 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 1536 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 192 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 256 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 384 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 512 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top | 768 | 94 | 0 | 0 |
| test | A1 | P-top-s1 | 1024 | 91 | 0 | 0 |
| test | A1 | P-top-s1 | 128 | 94 | 0 | 0 |
| test | A1 | P-top-s1 | 1536 | 89 | 0 | 0 |
| test | A1 | P-top-s1 | 192 | 94 | 0 | 0 |
| test | A1 | P-top-s1 | 256 | 94 | 0 | 0 |
| test | A1 | P-top-s1 | 384 | 93 | 0 | 0 |
| test | A1 | P-top-s1 | 512 | 93 | 0 | 0 |
| test | A1 | P-top-s1 | 768 | 93 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 1024 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 128 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 1536 | 92 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 192 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 256 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 384 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 512 | 94 | 0 | 0 |
| test | A3--bge-m3 | P-top-s1 | 768 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 1024 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 128 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 1536 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 192 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 256 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 384 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 512 | 94 | 0 | 0 |
| test | F-RRF10--openai-3-small | P-top-s1 | 768 | 94 | 0 | 0 |

## Paired comparisons

Deltas and CIs are percentage points. Family counts are C1–C7; bootstrap status, accepted/rejected draws and McNemar discordants are explicit.

| Cell | Designation | Status | Delta | 95% CI | Families / C1–C7 | Accepted / rejected | Reason | McNemar baseline-only / candidate-only / p |
| ---: | --- | --- | ---: | --- | --- | --- | --- | --- |
| 1 | exploratory | ok | -17.0833 | -23.7236 / -11.0694 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 3 / 0 / 0.2500 |
| 2 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 3 | exploratory | ok | -13.6310 | -19.5968 / -7.7825 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 4 / 1 / 0.3750 |
| 4 | exploratory | ok | -7.8373 | -14.8670 / -0.7996 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 3 / 0.7266 |
| 5 | exploratory | ok | -3.5516 | -6.7902 / -1.0582 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 2 / 0 / 0.5000 |
| 6 | exploratory | ok | -3.8690 | -8.7574 / 0.7980 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 7 | exploratory | ok | -7.9365 | -13.7942 / -2.1549 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 2 / 1.0000 |
| 8 | exploratory | ok | -19.0675 | -25.9875 / -12.9491 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 0 / 0.0313 |
| 9 | exploratory | ok | -19.6825 | -26.0856 / -13.2562 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 4 / 1 / 0.3750 |
| 10 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 11 | exploratory | ok | -11.7857 | -18.3215 / -6.4702 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 2 / 0 / 0.5000 |
| 12 | exploratory | ok | -15.0397 | -22.7479 / -7.5384 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 2 / 0.1797 |
| 13 | exploratory | ok | -8.5119 | -13.2597 / -4.3795 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 4 / 0 / 0.1250 |
| 14 | exploratory | ok | -5.4167 | -12.0758 / 1.0107 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 2 / 0 / 0.5000 |
| 15 | exploratory | ok | -11.7262 | -18.0649 / -5.6972 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 2 / 1.0000 |
| 16 | exploratory | ok | -19.0476 | -26.3198 / -12.7974 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 0 / 0.0313 |
| 17 | exploratory | ok | -22.1429 | -29.1934 / -14.8370 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 4 / 0 / 0.1250 |
| 18 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 19 | exploratory | ok | -26.9643 | -34.6233 / -19.8013 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 0 / 0.0313 |
| 20 | exploratory | ok | -12.4405 | -20.0156 / -5.4988 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 21 | exploratory | ok | -7.6786 | -12.7812 / -3.3523 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 3 / 0 / 0.2500 |
| 22 | exploratory | ok | -8.1944 | -12.6588 / -4.1599 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 23 | exploratory | ok | -13.8492 | -22.4037 / -6.0439 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 24 | exploratory | ok | -22.4603 | -29.8812 / -15.0932 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 0 / 0.0625 |
| 97 | exploratory | ok | 0.4762 | 0.0000 / 1.5312 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 98 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 99 | exploratory | ok | 2.2619 | 0.0000 / 5.1948 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 100 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 101 | exploratory | ok | 0.9524 | 0.0000 / 2.3810 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 102 | exploratory | ok | 1.6667 | 0.0000 / 4.4913 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 103 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 104 | exploratory | ok | 0.9524 | 0.0000 / 3.1746 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 105 | exploratory | ok | 1.1905 | 0.0000 / 3.8961 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 106 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 107 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 108 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 109 | exploratory | ok | 1.6667 | 0.3401 / 3.4091 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 110 | exploratory | ok | 0.4762 | 0.0000 / 1.5873 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 111 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 112 | exploratory | ok | 0.3175 | 0.0000 / 1.0827 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 113 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 114 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 115 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 116 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 117 | exploratory | ok | 1.0714 | 0.0000 / 2.8914 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 118 | exploratory | ok | 1.3690 | 0.0000 / 3.7305 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 119 | exploratory | ok | 1.5476 | 0.0000 / 3.9541 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 120 | exploratory | ok | 0.9921 | 0.0000 / 2.5397 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |

## Category means and deltas

| Cell | Category | Queries | Groups | Coverage | All-required | Ceiling | Loss | Coverage delta vs P-top (pp) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | -8.3333 |
| 1 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | -18.7500 |
| 1 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | -20.0000 |
| 1 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | -8.3333 |
| 1 | C5 | 12 | 30 | 0.5833 | 0.3333 | 0.9306 | 0.3472 | -15.2778 |
| 1 | C6 | 15 | 37 | 0.4333 | 0.0667 | 0.9111 | 0.4778 | -32.2222 |
| 1 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 2 | C1 | 12 | 12 | 0.5000 | 0.5000 | 0.9167 | 0.4167 | 0.0000 |
| 2 | C2 | 16 | 16 | 0.4375 | 0.4375 | 1.0000 | 0.5625 | 0.0000 |
| 2 | C3 | 15 | 15 | 0.0667 | 0.0667 | 0.6000 | 0.5333 | 0.0000 |
| 2 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | 0.0000 |
| 2 | C5 | 12 | 30 | 0.1944 | 0.0000 | 0.9306 | 0.7361 | 0.0000 |
| 2 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9111 | 0.7111 | 0.0000 |
| 2 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 3 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | -8.3333 |
| 3 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | -18.7500 |
| 3 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | -13.3333 |
| 3 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | -8.3333 |
| 3 | C5 | 12 | 30 | 0.7083 | 0.3333 | 0.9306 | 0.2222 | -8.3333 |
| 3 | C6 | 15 | 37 | 0.4889 | 0.0667 | 0.9111 | 0.4222 | -30.0000 |
| 3 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 4 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -8.3333 |
| 4 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -18.7500 |
| 4 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | 6.6667 |
| 4 | C4 | 12 | 12 | 0.1667 | 0.1667 | 0.7500 | 0.5833 | 8.3333 |
| 4 | C5 | 12 | 30 | 0.2500 | 0.0000 | 0.9306 | 0.6806 | -8.3333 |
| 4 | C6 | 15 | 37 | 0.3111 | 0.0000 | 0.9111 | 0.6000 | -1.1111 |
| 4 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 5 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | 0.0000 |
| 5 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -6.2500 |
| 5 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.6000 | 0.4667 | -6.6667 |
| 5 | C4 | 12 | 12 | 0.2500 | 0.2500 | 0.7500 | 0.5000 | 0.0000 |
| 5 | C5 | 12 | 30 | 0.3194 | 0.0000 | 0.9306 | 0.6111 | -9.7222 |
| 5 | C6 | 15 | 37 | 0.4222 | 0.1333 | 0.9111 | 0.4889 | -2.2222 |
| 5 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 6 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | 0.0000 |
| 6 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -6.2500 |
| 6 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | 0.0000 |
| 6 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 6 | C5 | 12 | 30 | 0.5694 | 0.2500 | 0.9306 | 0.3611 | 4.1667 |
| 6 | C6 | 15 | 37 | 0.4667 | 0.1333 | 0.9111 | 0.4444 | -16.6667 |
| 6 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 7 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | -8.3333 |
| 7 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 7 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | 0.0000 |
| 7 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 7 | C5 | 12 | 30 | 0.5833 | 0.3333 | 0.9306 | 0.3472 | -8.3333 |
| 7 | C6 | 15 | 37 | 0.4889 | 0.1333 | 0.9111 | 0.4222 | -22.2222 |
| 7 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 8 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 8 | C2 | 16 | 16 | 0.6875 | 0.6875 | 1.0000 | 0.3125 | -31.2500 |
| 8 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | -13.3333 |
| 8 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 8 | C5 | 12 | 30 | 0.5417 | 0.2500 | 0.9306 | 0.3889 | -19.4444 |
| 8 | C6 | 15 | 37 | 0.4556 | 0.0667 | 0.9111 | 0.4556 | -27.7778 |
| 8 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 9 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -8.3333 |
| 9 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -12.5000 |
| 9 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | -13.3333 |
| 9 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -33.3333 |
| 9 | C5 | 12 | 30 | 0.7917 | 0.5000 | 0.9722 | 0.1806 | -15.2778 |
| 9 | C6 | 15 | 37 | 0.5333 | 0.0667 | 1.0000 | 0.4667 | -46.6667 |
| 9 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 10 | C1 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | 0.0000 |
| 10 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | 0.0000 |
| 10 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.9333 | 0.7333 | 0.0000 |
| 10 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | 0.0000 |
| 10 | C5 | 12 | 30 | 0.1667 | 0.0000 | 0.9722 | 0.8056 | 0.0000 |
| 10 | C6 | 15 | 37 | 0.2000 | 0.0000 | 1.0000 | 0.8000 | 0.0000 |
| 10 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 11 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 11 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -12.5000 |
| 11 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.9333 | 0.3333 | -26.6667 |
| 11 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 11 | C5 | 12 | 30 | 0.9167 | 0.7500 | 0.9722 | 0.0556 | -5.5556 |
| 11 | C6 | 15 | 37 | 0.7889 | 0.5333 | 1.0000 | 0.2111 | -21.1111 |
| 11 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 12 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -8.3333 |
| 12 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 12 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.9333 | 0.6667 | -13.3333 |
| 12 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | 0.0000 |
| 12 | C5 | 12 | 30 | 0.2222 | 0.0000 | 0.9722 | 0.7500 | -8.3333 |
| 12 | C6 | 15 | 37 | 0.3111 | 0.0000 | 1.0000 | 0.6889 | -4.4444 |
| 12 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 13 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -8.3333 |
| 13 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | -18.7500 |
| 13 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -6.6667 |
| 13 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | -8.3333 |
| 13 | C5 | 12 | 30 | 0.3194 | 0.0000 | 0.9722 | 0.6528 | -9.7222 |
| 13 | C6 | 15 | 37 | 0.4444 | 0.0667 | 1.0000 | 0.5556 | -7.7778 |
| 13 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 14 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 14 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | -6.2500 |
| 14 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 14 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -16.6667 |
| 14 | C5 | 12 | 30 | 0.6389 | 0.4167 | 0.9722 | 0.3333 | 8.3333 |
| 14 | C6 | 15 | 37 | 0.5333 | 0.1333 | 1.0000 | 0.4667 | -23.3333 |
| 14 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 15 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 15 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | -18.7500 |
| 15 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.9333 | 0.3333 | 6.6667 |
| 15 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | -25.0000 |
| 15 | C5 | 12 | 30 | 0.7222 | 0.5000 | 0.9722 | 0.2500 | 2.7778 |
| 15 | C6 | 15 | 37 | 0.5778 | 0.1333 | 1.0000 | 0.4222 | -31.1111 |
| 15 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 16 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -16.6667 |
| 16 | C2 | 16 | 16 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -25.0000 |
| 16 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | -13.3333 |
| 16 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -8.3333 |
| 16 | C5 | 12 | 30 | 0.7083 | 0.3333 | 0.9722 | 0.2639 | -16.6667 |
| 16 | C6 | 15 | 37 | 0.6111 | 0.2000 | 1.0000 | 0.3889 | -36.6667 |
| 16 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 17 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -25.0000 |
| 17 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -12.5000 |
| 17 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | -20.0000 |
| 17 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | -33.3333 |
| 17 | C5 | 12 | 30 | 0.7500 | 0.4167 | 1.0000 | 0.2500 | -18.0556 |
| 17 | C6 | 15 | 37 | 0.5333 | 0.0667 | 0.9778 | 0.4444 | -37.7778 |
| 17 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 18 | C1 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | 0.0000 |
| 18 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | 0.0000 |
| 18 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.8667 | 0.7333 | 0.0000 |
| 18 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | 0.0000 |
| 18 | C5 | 12 | 30 | 0.2083 | 0.0000 | 1.0000 | 0.7917 | 0.0000 |
| 18 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9778 | 0.7778 | 0.0000 |
| 18 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 19 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -25.0000 |
| 19 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | -18.7500 |
| 19 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | -33.3333 |
| 19 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -41.6667 |
| 19 | C5 | 12 | 30 | 0.7778 | 0.4167 | 1.0000 | 0.2222 | -19.4444 |
| 19 | C6 | 15 | 37 | 0.5556 | 0.0667 | 0.9778 | 0.4222 | -42.2222 |
| 19 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 20 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 20 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -31.2500 |
| 20 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.8667 | 0.6000 | 0.0000 |
| 20 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | 0.0000 |
| 20 | C5 | 12 | 30 | 0.2917 | 0.0000 | 1.0000 | 0.7083 | -1.3889 |
| 20 | C6 | 15 | 37 | 0.3111 | 0.0000 | 0.9778 | 0.6667 | -4.4444 |
| 20 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 21 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 21 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -6.2500 |
| 21 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.8667 | 0.6000 | -13.3333 |
| 21 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | -16.6667 |
| 21 | C5 | 12 | 30 | 0.3472 | 0.0000 | 1.0000 | 0.6528 | -9.7222 |
| 21 | C6 | 15 | 37 | 0.4778 | 0.1333 | 0.9778 | 0.5000 | -7.7778 |
| 21 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 22 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 8.3333 |
| 22 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -6.2500 |
| 22 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -6.6667 |
| 22 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -25.0000 |
| 22 | C5 | 12 | 30 | 0.5694 | 0.1667 | 1.0000 | 0.4306 | 2.7778 |
| 22 | C6 | 15 | 37 | 0.5333 | 0.1333 | 0.9778 | 0.4444 | -22.2222 |
| 22 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 23 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 23 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -12.5000 |
| 23 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | -6.6667 |
| 23 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | -25.0000 |
| 23 | C5 | 12 | 30 | 0.6389 | 0.2500 | 1.0000 | 0.3611 | -2.7778 |
| 23 | C6 | 15 | 37 | 0.5444 | 0.1333 | 0.9778 | 0.4333 | -33.3333 |
| 23 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 24 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 24 | C2 | 16 | 16 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -25.0000 |
| 24 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -20.0000 |
| 24 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -41.6667 |
| 24 | C5 | 12 | 30 | 0.7361 | 0.4167 | 1.0000 | 0.2639 | -5.5556 |
| 24 | C6 | 15 | 37 | 0.5111 | 0.1333 | 0.9778 | 0.4667 | -40.0000 |
| 24 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 25 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 25 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | — |
| 25 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | — |
| 25 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 25 | C5 | 12 | 30 | 0.5833 | 0.3333 | 0.9306 | 0.3472 | — |
| 25 | C6 | 15 | 37 | 0.4333 | 0.0667 | 0.9111 | 0.4778 | — |
| 25 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 26 | C1 | 12 | 12 | 0.5000 | 0.5000 | 0.9167 | 0.4167 | — |
| 26 | C2 | 16 | 16 | 0.4375 | 0.4375 | 1.0000 | 0.5625 | — |
| 26 | C3 | 15 | 15 | 0.0667 | 0.0667 | 0.6000 | 0.5333 | — |
| 26 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | — |
| 26 | C5 | 12 | 30 | 0.1944 | 0.0000 | 0.9306 | 0.7361 | — |
| 26 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9111 | 0.7111 | — |
| 26 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 27 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 27 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | — |
| 27 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | — |
| 27 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | — |
| 27 | C5 | 12 | 30 | 0.7083 | 0.3333 | 0.9306 | 0.2222 | — |
| 27 | C6 | 15 | 37 | 0.4889 | 0.0667 | 0.9111 | 0.4222 | — |
| 27 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 28 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | — |
| 28 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 28 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | — |
| 28 | C4 | 12 | 12 | 0.1667 | 0.1667 | 0.7500 | 0.5833 | — |
| 28 | C5 | 12 | 30 | 0.2500 | 0.0000 | 0.9306 | 0.6806 | — |
| 28 | C6 | 15 | 37 | 0.3111 | 0.0000 | 0.9111 | 0.6000 | — |
| 28 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 29 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 29 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 29 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.6000 | 0.4667 | — |
| 29 | C4 | 12 | 12 | 0.2500 | 0.2500 | 0.7500 | 0.5000 | — |
| 29 | C5 | 12 | 30 | 0.3194 | 0.0000 | 0.9306 | 0.6111 | — |
| 29 | C6 | 15 | 37 | 0.4222 | 0.1333 | 0.9111 | 0.4889 | — |
| 29 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 30 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 30 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 30 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | — |
| 30 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 30 | C5 | 12 | 30 | 0.5694 | 0.2500 | 0.9306 | 0.3611 | — |
| 30 | C6 | 15 | 37 | 0.5000 | 0.1333 | 0.9111 | 0.4111 | — |
| 30 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 31 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 31 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 31 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | — |
| 31 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 31 | C5 | 12 | 30 | 0.5833 | 0.3333 | 0.9306 | 0.3472 | — |
| 31 | C6 | 15 | 37 | 0.4889 | 0.1333 | 0.9111 | 0.4222 | — |
| 31 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 32 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | — |
| 32 | C2 | 16 | 16 | 0.6875 | 0.6875 | 1.0000 | 0.3125 | — |
| 32 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | — |
| 32 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 32 | C5 | 12 | 30 | 0.5694 | 0.2500 | 0.9306 | 0.3611 | — |
| 32 | C6 | 15 | 37 | 0.4889 | 0.0667 | 0.9111 | 0.4222 | — |
| 32 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 33 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 33 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 33 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | — |
| 33 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 33 | C5 | 12 | 30 | 0.8194 | 0.5000 | 0.9722 | 0.1528 | — |
| 33 | C6 | 15 | 37 | 0.5333 | 0.0667 | 1.0000 | 0.4667 | — |
| 33 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 34 | C1 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | — |
| 34 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 34 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.9333 | 0.7333 | — |
| 34 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 34 | C5 | 12 | 30 | 0.1667 | 0.0000 | 0.9722 | 0.8056 | — |
| 34 | C6 | 15 | 37 | 0.2000 | 0.0000 | 1.0000 | 0.8000 | — |
| 34 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 35 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 35 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 35 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 35 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 35 | C5 | 12 | 30 | 0.9167 | 0.7500 | 0.9722 | 0.0556 | — |
| 35 | C6 | 15 | 37 | 0.7889 | 0.5333 | 1.0000 | 0.2111 | — |
| 35 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 36 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | — |
| 36 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 36 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.9333 | 0.6667 | — |
| 36 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 36 | C5 | 12 | 30 | 0.2222 | 0.0000 | 0.9722 | 0.7500 | — |
| 36 | C6 | 15 | 37 | 0.3111 | 0.0000 | 1.0000 | 0.6889 | — |
| 36 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 37 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 37 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | — |
| 37 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | — |
| 37 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 37 | C5 | 12 | 30 | 0.3194 | 0.0000 | 0.9722 | 0.6528 | — |
| 37 | C6 | 15 | 37 | 0.5000 | 0.1333 | 1.0000 | 0.5000 | — |
| 37 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 38 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 38 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 38 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 38 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 38 | C5 | 12 | 30 | 0.6667 | 0.4167 | 0.9722 | 0.3056 | — |
| 38 | C6 | 15 | 37 | 0.5667 | 0.1333 | 1.0000 | 0.4333 | — |
| 38 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 39 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 39 | C2 | 16 | 16 | 0.8125 | 0.8125 | 1.0000 | 0.1875 | — |
| 39 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.9333 | 0.3333 | — |
| 39 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | — |
| 39 | C5 | 12 | 30 | 0.7222 | 0.5000 | 0.9722 | 0.2500 | — |
| 39 | C6 | 15 | 37 | 0.5778 | 0.1333 | 1.0000 | 0.4222 | — |
| 39 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 40 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 40 | C2 | 16 | 16 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 40 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | — |
| 40 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 40 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9722 | 0.2361 | — |
| 40 | C6 | 15 | 37 | 0.6667 | 0.2667 | 1.0000 | 0.3333 | — |
| 40 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 41 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 41 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 41 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | — |
| 41 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | — |
| 41 | C5 | 12 | 30 | 0.7500 | 0.4167 | 1.0000 | 0.2500 | — |
| 41 | C6 | 15 | 37 | 0.5333 | 0.0667 | 0.9778 | 0.4444 | — |
| 41 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 42 | C1 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 42 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 42 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.8667 | 0.7333 | — |
| 42 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | — |
| 42 | C5 | 12 | 30 | 0.2083 | 0.0000 | 1.0000 | 0.7917 | — |
| 42 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9778 | 0.7778 | — |
| 42 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 43 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 43 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 43 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | — |
| 43 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 43 | C5 | 12 | 30 | 0.7778 | 0.4167 | 1.0000 | 0.2222 | — |
| 43 | C6 | 15 | 37 | 0.5556 | 0.0667 | 0.9778 | 0.4222 | — |
| 43 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 44 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | — |
| 44 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 44 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.8667 | 0.6000 | — |
| 44 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | — |
| 44 | C5 | 12 | 30 | 0.2917 | 0.0000 | 1.0000 | 0.7083 | — |
| 44 | C6 | 15 | 37 | 0.3111 | 0.0000 | 0.9778 | 0.6667 | — |
| 44 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 45 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 45 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 45 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.8667 | 0.6000 | — |
| 45 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 45 | C5 | 12 | 30 | 0.3889 | 0.0000 | 1.0000 | 0.6111 | — |
| 45 | C6 | 15 | 37 | 0.4778 | 0.1333 | 0.9778 | 0.5000 | — |
| 45 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 46 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 46 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 46 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | — |
| 46 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 46 | C5 | 12 | 30 | 0.5694 | 0.1667 | 1.0000 | 0.4306 | — |
| 46 | C6 | 15 | 37 | 0.5667 | 0.1333 | 0.9778 | 0.4111 | — |
| 46 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 47 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 47 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 47 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | — |
| 47 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 47 | C5 | 12 | 30 | 0.6389 | 0.2500 | 1.0000 | 0.3611 | — |
| 47 | C6 | 15 | 37 | 0.5444 | 0.1333 | 0.9778 | 0.4333 | — |
| 47 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 48 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 48 | C2 | 16 | 16 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 48 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | — |
| 48 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | — |
| 48 | C5 | 12 | 30 | 0.7778 | 0.5000 | 1.0000 | 0.2222 | — |
| 48 | C6 | 15 | 37 | 0.5111 | 0.1333 | 0.9778 | 0.4667 | — |
| 48 | C7 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 49 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 49 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 49 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 49 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | — |
| 49 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 49 | C6 | 15 | 37 | 0.7556 | 0.6000 | 0.9111 | 0.1556 | — |
| 49 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 50 | C1 | 12 | 12 | 0.5000 | 0.5000 | 0.9167 | 0.4167 | — |
| 50 | C2 | 16 | 16 | 0.4375 | 0.4375 | 1.0000 | 0.5625 | — |
| 50 | C3 | 15 | 15 | 0.0667 | 0.0667 | 0.6000 | 0.5333 | — |
| 50 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | — |
| 50 | C5 | 12 | 30 | 0.1944 | 0.0000 | 0.9306 | 0.7361 | — |
| 50 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9111 | 0.7111 | — |
| 50 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 51 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 51 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 51 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 51 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | — |
| 51 | C5 | 12 | 30 | 0.7917 | 0.5000 | 0.9306 | 0.1389 | — |
| 51 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | — |
| 51 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 52 | C1 | 12 | 12 | 0.6667 | 0.6667 | 0.9167 | 0.2500 | — |
| 52 | C2 | 16 | 16 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 52 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.6000 | 0.4667 | — |
| 52 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | — |
| 52 | C5 | 12 | 30 | 0.3333 | 0.0000 | 0.9306 | 0.5972 | — |
| 52 | C6 | 15 | 37 | 0.3222 | 0.0667 | 0.9111 | 0.5889 | — |
| 52 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 53 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 53 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 53 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | — |
| 53 | C4 | 12 | 12 | 0.2500 | 0.2500 | 0.7500 | 0.5000 | — |
| 53 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9306 | 0.5139 | — |
| 53 | C6 | 15 | 37 | 0.4444 | 0.1333 | 0.9111 | 0.4667 | — |
| 53 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 54 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 54 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 54 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | — |
| 54 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 54 | C5 | 12 | 30 | 0.5278 | 0.0833 | 0.9306 | 0.4028 | — |
| 54 | C6 | 15 | 37 | 0.6111 | 0.2667 | 0.9111 | 0.3000 | — |
| 54 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 55 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 55 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 55 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | — |
| 55 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 55 | C5 | 12 | 30 | 0.6667 | 0.2500 | 0.9306 | 0.2639 | — |
| 55 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | — |
| 55 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 56 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 56 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 56 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | — |
| 56 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 56 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 56 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | — |
| 56 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 57 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 57 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 57 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 57 | C4 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 57 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | — |
| 57 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 57 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 58 | C1 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | — |
| 58 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 58 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.9333 | 0.7333 | — |
| 58 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 58 | C5 | 12 | 30 | 0.1667 | 0.0000 | 0.9722 | 0.8056 | — |
| 58 | C6 | 15 | 37 | 0.2000 | 0.0000 | 1.0000 | 0.8000 | — |
| 58 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 59 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 59 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 59 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | — |
| 59 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 59 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | — |
| 59 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 59 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 60 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 60 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 60 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | — |
| 60 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 60 | C5 | 12 | 30 | 0.3056 | 0.0000 | 0.9722 | 0.6667 | — |
| 60 | C6 | 15 | 37 | 0.3556 | 0.0667 | 1.0000 | 0.6444 | — |
| 60 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 61 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 61 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 61 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 61 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | — |
| 61 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9722 | 0.5556 | — |
| 61 | C6 | 15 | 37 | 0.5000 | 0.1333 | 1.0000 | 0.5000 | — |
| 61 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 62 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 62 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 62 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 62 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | — |
| 62 | C5 | 12 | 30 | 0.5556 | 0.1667 | 0.9722 | 0.4167 | — |
| 62 | C6 | 15 | 37 | 0.7667 | 0.5333 | 1.0000 | 0.2333 | — |
| 62 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 63 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 63 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 63 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | — |
| 63 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 63 | C5 | 12 | 30 | 0.6944 | 0.4167 | 0.9722 | 0.2778 | — |
| 63 | C6 | 15 | 37 | 0.8889 | 0.7333 | 1.0000 | 0.1111 | — |
| 63 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 64 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 64 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 64 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 64 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 64 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | — |
| 64 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | — |
| 64 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 65 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 65 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 65 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | — |
| 65 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 65 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | — |
| 65 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 65 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 66 | C1 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 66 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 66 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.8667 | 0.7333 | — |
| 66 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | — |
| 66 | C5 | 12 | 30 | 0.2083 | 0.0000 | 1.0000 | 0.7917 | — |
| 66 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9778 | 0.7778 | — |
| 66 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 67 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 67 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 67 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | — |
| 67 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 67 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | — |
| 67 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 67 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 68 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 68 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 68 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.8667 | 0.6000 | — |
| 68 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | — |
| 68 | C5 | 12 | 30 | 0.3056 | 0.0000 | 1.0000 | 0.6944 | — |
| 68 | C6 | 15 | 37 | 0.3556 | 0.0667 | 0.9778 | 0.6222 | — |
| 68 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 69 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 69 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 69 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | — |
| 69 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 69 | C5 | 12 | 30 | 0.4444 | 0.0000 | 1.0000 | 0.5556 | — |
| 69 | C6 | 15 | 37 | 0.5000 | 0.1333 | 0.9778 | 0.4778 | — |
| 69 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 70 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 70 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 70 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | — |
| 70 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 70 | C5 | 12 | 30 | 0.5417 | 0.0833 | 1.0000 | 0.4583 | — |
| 70 | C6 | 15 | 37 | 0.7556 | 0.5333 | 0.9778 | 0.2222 | — |
| 70 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 71 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 71 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 71 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | — |
| 71 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 71 | C5 | 12 | 30 | 0.6667 | 0.2500 | 1.0000 | 0.3333 | — |
| 71 | C6 | 15 | 37 | 0.8778 | 0.8000 | 0.9778 | 0.1000 | — |
| 71 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 72 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 72 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 72 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | — |
| 72 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 72 | C5 | 12 | 30 | 0.7917 | 0.5000 | 1.0000 | 0.2083 | — |
| 72 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 72 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 73 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 73 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 73 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 73 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | — |
| 73 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 73 | C6 | 15 | 37 | 0.7556 | 0.6000 | 0.9111 | 0.1556 | — |
| 73 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 74 | C1 | 12 | 12 | 0.5000 | 0.5000 | 0.9167 | 0.4167 | — |
| 74 | C2 | 16 | 16 | 0.4375 | 0.4375 | 1.0000 | 0.5625 | — |
| 74 | C3 | 15 | 15 | 0.0667 | 0.0667 | 0.6000 | 0.5333 | — |
| 74 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | — |
| 74 | C5 | 12 | 30 | 0.1944 | 0.0000 | 0.9306 | 0.7361 | — |
| 74 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9111 | 0.7111 | — |
| 74 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 75 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 75 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 75 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 75 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | — |
| 75 | C5 | 12 | 30 | 0.7917 | 0.5000 | 0.9306 | 0.1389 | — |
| 75 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | — |
| 75 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 76 | C1 | 12 | 12 | 0.6667 | 0.6667 | 0.9167 | 0.2500 | — |
| 76 | C2 | 16 | 16 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 76 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.6000 | 0.4667 | — |
| 76 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | — |
| 76 | C5 | 12 | 30 | 0.3333 | 0.0000 | 0.9306 | 0.5972 | — |
| 76 | C6 | 15 | 37 | 0.3222 | 0.0667 | 0.9111 | 0.5889 | — |
| 76 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 77 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 77 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 77 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | — |
| 77 | C4 | 12 | 12 | 0.2500 | 0.2500 | 0.7500 | 0.5000 | — |
| 77 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9306 | 0.5139 | — |
| 77 | C6 | 15 | 37 | 0.4444 | 0.1333 | 0.9111 | 0.4667 | — |
| 77 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 78 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 78 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 78 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | — |
| 78 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 78 | C5 | 12 | 30 | 0.5278 | 0.0833 | 0.9306 | 0.4028 | — |
| 78 | C6 | 15 | 37 | 0.6333 | 0.3333 | 0.9111 | 0.2778 | — |
| 78 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 79 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 79 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 79 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | — |
| 79 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 79 | C5 | 12 | 30 | 0.6667 | 0.2500 | 0.9306 | 0.2639 | — |
| 79 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | — |
| 79 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 80 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 80 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 80 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | — |
| 80 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 80 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 80 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | — |
| 80 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 81 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 81 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 81 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 81 | C4 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 81 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | — |
| 81 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 81 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 82 | C1 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | — |
| 82 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 82 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.9333 | 0.7333 | — |
| 82 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 82 | C5 | 12 | 30 | 0.1667 | 0.0000 | 0.9722 | 0.8056 | — |
| 82 | C6 | 15 | 37 | 0.2000 | 0.0000 | 1.0000 | 0.8000 | — |
| 82 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 83 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 83 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 83 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | — |
| 83 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 83 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | — |
| 83 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 83 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 84 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 84 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 84 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | — |
| 84 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | — |
| 84 | C5 | 12 | 30 | 0.3056 | 0.0000 | 0.9722 | 0.6667 | — |
| 84 | C6 | 15 | 37 | 0.3556 | 0.0667 | 1.0000 | 0.6444 | — |
| 84 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 85 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 85 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 85 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 85 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | — |
| 85 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9722 | 0.5556 | — |
| 85 | C6 | 15 | 37 | 0.5222 | 0.1333 | 1.0000 | 0.4778 | — |
| 85 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 86 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 86 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 86 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 86 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | — |
| 86 | C5 | 12 | 30 | 0.5556 | 0.1667 | 0.9722 | 0.4167 | — |
| 86 | C6 | 15 | 37 | 0.7667 | 0.5333 | 1.0000 | 0.2333 | — |
| 86 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 87 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 87 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 87 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | — |
| 87 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 87 | C5 | 12 | 30 | 0.6944 | 0.4167 | 0.9722 | 0.2778 | — |
| 87 | C6 | 15 | 37 | 0.8889 | 0.7333 | 1.0000 | 0.1111 | — |
| 87 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 88 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 88 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 88 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 88 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 88 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | — |
| 88 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | — |
| 88 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 89 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 89 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 89 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | — |
| 89 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 89 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | — |
| 89 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 89 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 90 | C1 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 90 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | — |
| 90 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.8667 | 0.7333 | — |
| 90 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | — |
| 90 | C5 | 12 | 30 | 0.2083 | 0.0000 | 1.0000 | 0.7917 | — |
| 90 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9778 | 0.7778 | — |
| 90 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 91 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 91 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 91 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | — |
| 91 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 91 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | — |
| 91 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 91 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 92 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 92 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | — |
| 92 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.8667 | 0.6000 | — |
| 92 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | — |
| 92 | C5 | 12 | 30 | 0.3056 | 0.0000 | 1.0000 | 0.6944 | — |
| 92 | C6 | 15 | 37 | 0.3556 | 0.0667 | 0.9778 | 0.6222 | — |
| 92 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 93 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 93 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 93 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | — |
| 93 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 93 | C5 | 12 | 30 | 0.4444 | 0.0000 | 1.0000 | 0.5556 | — |
| 93 | C6 | 15 | 37 | 0.5556 | 0.1333 | 0.9778 | 0.4222 | — |
| 93 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 94 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 94 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 94 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | — |
| 94 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 94 | C5 | 12 | 30 | 0.5417 | 0.0833 | 1.0000 | 0.4583 | — |
| 94 | C6 | 15 | 37 | 0.7556 | 0.5333 | 0.9778 | 0.2222 | — |
| 94 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 95 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 95 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 95 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | — |
| 95 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 95 | C5 | 12 | 30 | 0.6667 | 0.2500 | 1.0000 | 0.3333 | — |
| 95 | C6 | 15 | 37 | 0.8778 | 0.8000 | 0.9778 | 0.1000 | — |
| 95 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 96 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 96 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 96 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | — |
| 96 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 96 | C5 | 12 | 30 | 0.7917 | 0.5000 | 1.0000 | 0.2083 | — |
| 96 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 96 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 97 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 97 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 97 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 97 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 97 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 97 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | 3.3333 |
| 97 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 98 | C1 | 12 | 12 | 0.5000 | 0.5000 | 0.9167 | 0.4167 | 0.0000 |
| 98 | C2 | 16 | 16 | 0.4375 | 0.4375 | 1.0000 | 0.5625 | 0.0000 |
| 98 | C3 | 15 | 15 | 0.0667 | 0.0667 | 0.6000 | 0.5333 | 0.0000 |
| 98 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | 0.0000 |
| 98 | C5 | 12 | 30 | 0.1944 | 0.0000 | 0.9306 | 0.7361 | 0.0000 |
| 98 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9111 | 0.7111 | 0.0000 |
| 98 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 99 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 99 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 99 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 99 | C4 | 12 | 12 | 0.5833 | 0.5833 | 0.7500 | 0.1667 | 8.3333 |
| 99 | C5 | 12 | 30 | 0.8333 | 0.5833 | 0.9306 | 0.0972 | 4.1667 |
| 99 | C6 | 15 | 37 | 0.8222 | 0.6667 | 0.9111 | 0.0889 | 3.3333 |
| 99 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 100 | C1 | 12 | 12 | 0.6667 | 0.6667 | 0.9167 | 0.2500 | 0.0000 |
| 100 | C2 | 16 | 16 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 100 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.6000 | 0.4667 | 0.0000 |
| 100 | C4 | 12 | 12 | 0.0833 | 0.0833 | 0.7500 | 0.6667 | 0.0000 |
| 100 | C5 | 12 | 30 | 0.3333 | 0.0000 | 0.9306 | 0.5972 | 0.0000 |
| 100 | C6 | 15 | 37 | 0.3222 | 0.0667 | 0.9111 | 0.5889 | 0.0000 |
| 100 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 101 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | 0.0000 |
| 101 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 101 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | 0.0000 |
| 101 | C4 | 12 | 12 | 0.2500 | 0.2500 | 0.7500 | 0.5000 | 0.0000 |
| 101 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9306 | 0.5139 | 0.0000 |
| 101 | C6 | 15 | 37 | 0.5111 | 0.1333 | 0.9111 | 0.4000 | 6.6667 |
| 101 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 102 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 8.3333 |
| 102 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 102 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | 0.0000 |
| 102 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 102 | C5 | 12 | 30 | 0.5278 | 0.0833 | 0.9306 | 0.4028 | 0.0000 |
| 102 | C6 | 15 | 37 | 0.6667 | 0.4000 | 0.9111 | 0.2444 | 3.3333 |
| 102 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 103 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 103 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 103 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | 0.0000 |
| 103 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 103 | C5 | 12 | 30 | 0.6667 | 0.2500 | 0.9306 | 0.2639 | 0.0000 |
| 103 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | 0.0000 |
| 103 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 104 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 104 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 104 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 6.6667 |
| 104 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 104 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 104 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | 0.0000 |
| 104 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 105 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 105 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 105 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 105 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 8.3333 |
| 105 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | 0.0000 |
| 105 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 105 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 106 | C1 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | 0.0000 |
| 106 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | 0.0000 |
| 106 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.9333 | 0.7333 | 0.0000 |
| 106 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | 0.0000 |
| 106 | C5 | 12 | 30 | 0.1667 | 0.0000 | 0.9722 | 0.8056 | 0.0000 |
| 106 | C6 | 15 | 37 | 0.2000 | 0.0000 | 1.0000 | 0.8000 | 0.0000 |
| 106 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 107 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 107 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 107 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 107 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 107 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 107 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 107 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 108 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 108 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 108 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | 0.0000 |
| 108 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | 0.0000 |
| 108 | C5 | 12 | 30 | 0.3056 | 0.0000 | 0.9722 | 0.6667 | 0.0000 |
| 108 | C6 | 15 | 37 | 0.3556 | 0.0667 | 1.0000 | 0.6444 | 0.0000 |
| 108 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 109 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 109 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 109 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 109 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | 0.0000 |
| 109 | C5 | 12 | 30 | 0.4444 | 0.0000 | 0.9722 | 0.5278 | 2.7778 |
| 109 | C6 | 15 | 37 | 0.6111 | 0.2000 | 1.0000 | 0.3889 | 8.8889 |
| 109 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 110 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 110 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 110 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 110 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | 0.0000 |
| 110 | C5 | 12 | 30 | 0.5556 | 0.1667 | 0.9722 | 0.4167 | 0.0000 |
| 110 | C6 | 15 | 37 | 0.8000 | 0.6000 | 1.0000 | 0.2000 | 3.3333 |
| 110 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 111 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 111 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 111 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | 0.0000 |
| 111 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 111 | C5 | 12 | 30 | 0.6944 | 0.4167 | 0.9722 | 0.2778 | 0.0000 |
| 111 | C6 | 15 | 37 | 0.8889 | 0.7333 | 1.0000 | 0.1111 | 0.0000 |
| 111 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 112 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 112 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 112 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 112 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 112 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | 0.0000 |
| 112 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 2.2222 |
| 112 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | 0.0000 |
| 113 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 113 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | 0.0000 |
| 113 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 113 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 114 | C1 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | 0.0000 |
| 114 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | 0.0000 |
| 114 | C3 | 15 | 15 | 0.1333 | 0.1333 | 0.8667 | 0.7333 | 0.0000 |
| 114 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | 0.0000 |
| 114 | C5 | 12 | 30 | 0.2083 | 0.0000 | 1.0000 | 0.7917 | 0.0000 |
| 114 | C6 | 15 | 37 | 0.2000 | 0.0000 | 0.9778 | 0.7778 | 0.0000 |
| 114 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 115 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 115 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | 0.0000 |
| 115 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 115 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 116 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 116 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | 0.0000 |
| 116 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.8667 | 0.6000 | 0.0000 |
| 116 | C4 | 12 | 12 | 0.2500 | 0.2500 | 1.0000 | 0.7500 | 0.0000 |
| 116 | C5 | 12 | 30 | 0.3056 | 0.0000 | 1.0000 | 0.6944 | 0.0000 |
| 116 | C6 | 15 | 37 | 0.3556 | 0.0667 | 0.9778 | 0.6222 | 0.0000 |
| 116 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 117 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 117 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 117 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | 0.0000 |
| 117 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | 0.0000 |
| 117 | C5 | 12 | 30 | 0.4861 | 0.0000 | 1.0000 | 0.5139 | 4.1667 |
| 117 | C6 | 15 | 37 | 0.5889 | 0.1333 | 0.9778 | 0.3889 | 3.3333 |
| 117 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 118 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 118 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 6.2500 |
| 118 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | 0.0000 |
| 118 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 118 | C5 | 12 | 30 | 0.5417 | 0.0833 | 1.0000 | 0.4583 | 0.0000 |
| 118 | C6 | 15 | 37 | 0.7889 | 0.6000 | 0.9778 | 0.1889 | 3.3333 |
| 118 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 119 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 119 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 119 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 6.6667 |
| 119 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 119 | C5 | 12 | 30 | 0.7083 | 0.3333 | 1.0000 | 0.2917 | 4.1667 |
| 119 | C6 | 15 | 37 | 0.8778 | 0.8000 | 0.9778 | 0.1000 | 0.0000 |
| 119 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 0.0000 |
| 120 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 120 | C5 | 12 | 30 | 0.8611 | 0.6667 | 1.0000 | 0.1389 | 6.9444 |
| 120 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 120 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |

## Fidelity and language strata

Queries without matching groups are omitted; macros average represented categories. Category strata appear in the category table.

| Cell | Stratum | Queries | Groups | Represented categories | Coverage | All-required | Ceiling | Loss |
| ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 1 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3224 | 0.3224 | 0.8901 | 0.5677 |
| 1 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5998 | 0.5160 | 0.8987 | 0.2989 |
| 1 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 0.6597 | 0.2083 |
| 1 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5333 | 0.4000 | 0.9778 | 0.4444 |
| 2 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.4912 | 0.4300 | 0.8495 | 0.3583 |
| 2 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 2 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3111 | 0.2569 | 0.8987 | 0.5877 |
| 2 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2431 | 0.1875 | 0.6597 | 0.4167 |
| 2 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 3 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 3 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3317 | 0.3270 | 0.8901 | 0.5584 |
| 3 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6564 | 0.5517 | 0.8987 | 0.2423 |
| 3 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 3 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7222 | 0.5333 | 0.9778 | 0.2556 |
| 4 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6395 | 0.5765 | 0.8495 | 0.2100 |
| 4 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 4 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4061 | 0.3244 | 0.8987 | 0.4926 |
| 4 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2639 | 0.2083 | 0.6597 | 0.3958 |
| 4 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3111 | 0.2000 | 0.9778 | 0.6667 |
| 5 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6471 | 0.5893 | 0.8495 | 0.2024 |
| 5 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3766 | 0.3766 | 0.8901 | 0.5135 |
| 5 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5742 | 0.4863 | 0.8987 | 0.3245 |
| 5 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2639 | 0.2083 | 0.6597 | 0.3958 |
| 5 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4667 | 0.3333 | 0.9778 | 0.5111 |
| 6 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7415 | 0.7058 | 0.8495 | 0.1080 |
| 6 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3836 | 0.3836 | 0.8901 | 0.5066 |
| 6 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6123 | 0.5200 | 0.8987 | 0.2864 |
| 6 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2292 | 0.6597 | 0.3194 |
| 6 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4667 | 0.9778 | 0.3778 |
| 7 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 7 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3776 | 0.3728 | 0.8901 | 0.5126 |
| 7 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6242 | 0.5468 | 0.8987 | 0.2745 |
| 7 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 7 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5333 | 0.4000 | 0.9778 | 0.4444 |
| 8 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 8 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.1991 | 0.1943 | 0.8901 | 0.6910 |
| 8 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5433 | 0.4624 | 0.8987 | 0.3554 |
| 8 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 8 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.3333 | 0.9778 | 0.4667 |
| 9 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 9 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3786 | 0.3786 | 1.0000 | 0.6214 |
| 9 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7616 | 0.6618 | 1.0000 | 0.2384 |
| 9 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 9 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 1.0000 | 0.3444 |
| 10 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5961 | 0.5408 | 0.9762 | 0.3801 |
| 10 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 10 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3745 | 0.3264 | 1.0000 | 0.6255 |
| 10 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 10 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2222 | 0.1333 | 1.0000 | 0.7778 |
| 11 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 11 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7220 | 0.7220 | 1.0000 | 0.2780 |
| 11 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9026 | 0.8517 | 1.0000 | 0.0974 |
| 11 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8472 | 0.7361 | 0.8889 | 0.0417 |
| 11 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6667 | 1.0000 | 0.2333 |
| 12 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6922 | 0.6352 | 0.9762 | 0.2840 |
| 12 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 12 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4359 | 0.3601 | 1.0000 | 0.5641 |
| 12 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 12 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3111 | 0.2000 | 1.0000 | 0.6889 |
| 13 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6973 | 0.6454 | 0.9762 | 0.2789 |
| 13 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4224 | 0.4224 | 1.0000 | 0.5776 |
| 13 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5954 | 0.4961 | 1.0000 | 0.4046 |
| 13 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 13 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5556 | 0.4000 | 1.0000 | 0.4444 |
| 14 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 14 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5212 | 0.5212 | 1.0000 | 0.4788 |
| 14 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7106 | 0.6143 | 1.0000 | 0.2894 |
| 14 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4167 | 0.3056 | 0.8889 | 0.4722 |
| 14 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6222 | 0.5333 | 1.0000 | 0.3778 |
| 15 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 15 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4325 | 0.4325 | 1.0000 | 0.5675 |
| 15 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7378 | 0.6529 | 1.0000 | 0.2622 |
| 15 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5833 | 0.5278 | 0.8889 | 0.3056 |
| 15 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5889 | 0.4000 | 1.0000 | 0.4111 |
| 16 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 16 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3385 | 0.3338 | 1.0000 | 0.6615 |
| 16 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7546 | 0.6521 | 1.0000 | 0.2454 |
| 16 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5486 | 0.3819 | 0.8889 | 0.3403 |
| 16 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5222 | 0.3333 | 1.0000 | 0.4778 |
| 17 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9379 | 0.9320 | 0.9821 | 0.0442 |
| 17 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3270 | 0.3270 | 0.9748 | 0.6478 |
| 17 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6674 | 0.5586 | 0.9683 | 0.3009 |
| 17 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5486 | 0.4375 | 1.0000 | 0.4514 |
| 17 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 18 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5816 | 0.5204 | 0.9821 | 0.4005 |
| 18 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 18 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3676 | 0.3105 | 0.9683 | 0.6006 |
| 18 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3194 | 0.2639 | 1.0000 | 0.6806 |
| 18 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 19 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 19 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.2909 | 0.2862 | 0.9748 | 0.6839 |
| 19 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6942 | 0.5854 | 0.9683 | 0.2741 |
| 19 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 1.0000 | 0.3958 |
| 19 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 20 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6837 | 0.6148 | 0.9821 | 0.2985 |
| 20 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 20 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4508 | 0.3601 | 0.9683 | 0.5175 |
| 20 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3194 | 0.2639 | 1.0000 | 0.6806 |
| 20 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3111 | 0.2000 | 0.9778 | 0.6667 |
| 21 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7143 | 0.6556 | 0.9821 | 0.2679 |
| 21 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4219 | 0.4219 | 0.9748 | 0.5529 |
| 21 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6188 | 0.5200 | 0.9683 | 0.3495 |
| 21 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 1.0000 | 0.6597 |
| 21 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4889 | 0.3333 | 0.9778 | 0.4889 |
| 22 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7517 | 0.9821 | 0.1888 |
| 22 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4778 | 0.4778 | 0.9748 | 0.4971 |
| 22 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6723 | 0.5557 | 0.9683 | 0.2959 |
| 22 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 1.0000 | 0.5486 |
| 22 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7000 | 0.5333 | 0.9778 | 0.2778 |
| 23 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8257 | 0.9821 | 0.1327 |
| 23 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4262 | 0.4262 | 0.9748 | 0.5486 |
| 23 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6748 | 0.5606 | 0.9683 | 0.2935 |
| 23 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5833 | 1.0000 | 0.3611 |
| 23 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 24 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8971 | 0.8912 | 0.9821 | 0.0850 |
| 24 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.2954 | 0.2906 | 0.9748 | 0.6795 |
| 24 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6558 | 0.5716 | 0.9683 | 0.3125 |
| 24 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 24 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5889 | 0.4000 | 0.9778 | 0.3889 |
| 25 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 25 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3224 | 0.3224 | 0.8901 | 0.5677 |
| 25 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5998 | 0.5160 | 0.8987 | 0.2989 |
| 25 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 0.6597 | 0.2083 |
| 25 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5333 | 0.4000 | 0.9778 | 0.4444 |
| 26 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.4912 | 0.4300 | 0.8495 | 0.3583 |
| 26 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 26 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3111 | 0.2569 | 0.8987 | 0.5877 |
| 26 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2431 | 0.1875 | 0.6597 | 0.4167 |
| 26 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 27 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 27 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3317 | 0.3270 | 0.8901 | 0.5584 |
| 27 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6564 | 0.5517 | 0.8987 | 0.2423 |
| 27 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 27 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7222 | 0.5333 | 0.9778 | 0.2556 |
| 28 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6395 | 0.5765 | 0.8495 | 0.2100 |
| 28 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 28 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4061 | 0.3244 | 0.8987 | 0.4926 |
| 28 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2639 | 0.2083 | 0.6597 | 0.3958 |
| 28 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3111 | 0.2000 | 0.9778 | 0.6667 |
| 29 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6471 | 0.5893 | 0.8495 | 0.2024 |
| 29 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3766 | 0.3766 | 0.8901 | 0.5135 |
| 29 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5742 | 0.4863 | 0.8987 | 0.3245 |
| 29 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2639 | 0.2083 | 0.6597 | 0.3958 |
| 29 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4667 | 0.3333 | 0.9778 | 0.5111 |
| 30 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7415 | 0.7058 | 0.8495 | 0.1080 |
| 30 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3883 | 0.3836 | 0.8901 | 0.5018 |
| 30 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6188 | 0.5200 | 0.8987 | 0.2799 |
| 30 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2292 | 0.6597 | 0.3194 |
| 30 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4667 | 0.9778 | 0.3778 |
| 31 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 31 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3776 | 0.3728 | 0.8901 | 0.5126 |
| 31 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6242 | 0.5468 | 0.8987 | 0.2745 |
| 31 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 31 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5333 | 0.4000 | 0.9778 | 0.4444 |
| 32 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 32 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.2245 | 0.2197 | 0.8901 | 0.6656 |
| 32 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5498 | 0.4624 | 0.8987 | 0.3489 |
| 32 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 32 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5333 | 0.3333 | 0.9778 | 0.4444 |
| 33 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 33 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4230 | 0.4230 | 1.0000 | 0.5770 |
| 33 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7616 | 0.6618 | 1.0000 | 0.2384 |
| 33 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5139 | 0.3472 | 0.8889 | 0.3750 |
| 33 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 1.0000 | 0.3444 |
| 34 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5961 | 0.5408 | 0.9762 | 0.3801 |
| 34 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 34 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3745 | 0.3264 | 1.0000 | 0.6255 |
| 34 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 34 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2222 | 0.1333 | 1.0000 | 0.7778 |
| 35 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 35 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7424 | 0.7424 | 1.0000 | 0.2576 |
| 35 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9185 | 0.8676 | 1.0000 | 0.0815 |
| 35 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8472 | 0.7361 | 0.8889 | 0.0417 |
| 35 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6667 | 1.0000 | 0.2333 |
| 36 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6922 | 0.6352 | 0.9762 | 0.2840 |
| 36 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 36 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4359 | 0.3601 | 1.0000 | 0.5641 |
| 36 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 36 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3111 | 0.2000 | 1.0000 | 0.6889 |
| 37 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6973 | 0.6454 | 0.9762 | 0.2789 |
| 37 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4367 | 0.4320 | 1.0000 | 0.5633 |
| 37 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6019 | 0.5091 | 1.0000 | 0.3981 |
| 37 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 37 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5778 | 0.4000 | 1.0000 | 0.4222 |
| 38 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 38 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5704 | 0.5656 | 1.0000 | 0.4296 |
| 38 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7171 | 0.6143 | 1.0000 | 0.2829 |
| 38 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4931 | 0.3264 | 0.8889 | 0.3958 |
| 38 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6222 | 0.5333 | 1.0000 | 0.3778 |
| 39 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 39 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4611 | 0.4611 | 1.0000 | 0.5389 |
| 39 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7378 | 0.6529 | 1.0000 | 0.2622 |
| 39 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.5486 | 0.8889 | 0.2847 |
| 39 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5889 | 0.4000 | 1.0000 | 0.4111 |
| 40 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 40 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3687 | 0.3592 | 1.0000 | 0.6313 |
| 40 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7611 | 0.6650 | 1.0000 | 0.2389 |
| 40 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5486 | 0.3819 | 0.8889 | 0.3403 |
| 40 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5667 | 0.4000 | 1.0000 | 0.4333 |
| 41 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9379 | 0.9320 | 0.9821 | 0.0442 |
| 41 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3556 | 0.3556 | 0.9748 | 0.6193 |
| 41 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6674 | 0.5586 | 0.9683 | 0.3009 |
| 41 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5694 | 0.4583 | 1.0000 | 0.4306 |
| 41 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 42 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5816 | 0.5204 | 0.9821 | 0.4005 |
| 42 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 42 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3676 | 0.3105 | 0.9683 | 0.6006 |
| 42 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3194 | 0.2639 | 1.0000 | 0.6806 |
| 42 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 43 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 43 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3399 | 0.3351 | 0.9748 | 0.6349 |
| 43 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7031 | 0.5943 | 0.9683 | 0.2652 |
| 43 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6250 | 0.4028 | 1.0000 | 0.3750 |
| 43 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 44 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6837 | 0.6148 | 0.9821 | 0.2985 |
| 44 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 44 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4508 | 0.3601 | 0.9683 | 0.5175 |
| 44 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3194 | 0.2639 | 1.0000 | 0.6806 |
| 44 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3111 | 0.2000 | 0.9778 | 0.6667 |
| 45 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7143 | 0.6556 | 0.9821 | 0.2679 |
| 45 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4378 | 0.4378 | 0.9748 | 0.5371 |
| 45 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6277 | 0.5200 | 0.9683 | 0.3405 |
| 45 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 1.0000 | 0.6597 |
| 45 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4889 | 0.3333 | 0.9778 | 0.4889 |
| 46 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7517 | 0.9821 | 0.1888 |
| 46 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5111 | 0.5063 | 0.9748 | 0.4637 |
| 46 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6788 | 0.5557 | 0.9683 | 0.2894 |
| 46 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4722 | 0.3611 | 1.0000 | 0.5278 |
| 46 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7000 | 0.5333 | 0.9778 | 0.2778 |
| 47 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8257 | 0.9821 | 0.1327 |
| 47 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4262 | 0.4262 | 0.9748 | 0.5486 |
| 47 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6748 | 0.5606 | 0.9683 | 0.2935 |
| 47 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5833 | 1.0000 | 0.3611 |
| 47 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 48 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8971 | 0.8912 | 0.9821 | 0.0850 |
| 48 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.3112 | 0.3065 | 0.9748 | 0.6636 |
| 48 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6647 | 0.5895 | 0.9683 | 0.3036 |
| 48 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 48 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5889 | 0.4000 | 0.9778 | 0.3889 |
| 49 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 49 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7505 | 0.7457 | 0.8901 | 0.1397 |
| 49 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7385 | 0.6723 | 0.8987 | 0.1602 |
| 49 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 49 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 50 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.4912 | 0.4300 | 0.8495 | 0.3583 |
| 50 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 50 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3111 | 0.2569 | 0.8987 | 0.5877 |
| 50 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2431 | 0.1875 | 0.6597 | 0.4167 |
| 50 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 51 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7713 | 0.7474 | 0.8495 | 0.0782 |
| 51 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8044 | 0.7997 | 0.8901 | 0.0857 |
| 51 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7927 | 0.7388 | 0.8987 | 0.1061 |
| 51 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 51 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 52 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5014 | 0.4402 | 0.8495 | 0.3481 |
| 52 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4240 | 0.4193 | 0.8901 | 0.4661 |
| 52 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4704 | 0.3860 | 0.8987 | 0.4283 |
| 52 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3542 | 0.2431 | 0.6597 | 0.3056 |
| 52 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.3333 | 0.9778 | 0.5333 |
| 53 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6471 | 0.5893 | 0.8495 | 0.2024 |
| 53 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4698 | 0.4651 | 0.8901 | 0.4203 |
| 53 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5921 | 0.4952 | 0.8987 | 0.3066 |
| 53 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3750 | 0.2639 | 0.6597 | 0.2847 |
| 53 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.3333 | 0.9778 | 0.4667 |
| 54 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6956 | 0.6420 | 0.8495 | 0.1539 |
| 54 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5143 | 0.5095 | 0.8901 | 0.3759 |
| 54 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6337 | 0.5261 | 0.8987 | 0.2650 |
| 54 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.2847 | 0.6597 | 0.1528 |
| 54 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5333 | 0.4000 | 0.9778 | 0.4444 |
| 55 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7415 | 0.7058 | 0.8495 | 0.1080 |
| 55 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 55 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7164 | 0.6325 | 0.8987 | 0.1824 |
| 55 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 55 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 56 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 56 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6920 | 0.6872 | 0.8901 | 0.1982 |
| 56 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 56 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 56 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 57 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9141 | 0.9022 | 0.9762 | 0.0621 |
| 57 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 57 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9266 | 0.9147 | 1.0000 | 0.0734 |
| 57 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 57 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 58 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5961 | 0.5408 | 0.9762 | 0.3801 |
| 58 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 58 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3745 | 0.3264 | 1.0000 | 0.6255 |
| 58 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 58 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2222 | 0.1333 | 1.0000 | 0.7778 |
| 59 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 59 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 59 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 59 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 59 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 60 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6063 | 0.5510 | 0.9762 | 0.3699 |
| 60 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5305 | 0.5257 | 1.0000 | 0.4695 |
| 60 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5831 | 0.4981 | 1.0000 | 0.4169 |
| 60 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 0.8889 | 0.4375 |
| 60 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.3333 | 1.0000 | 0.5556 |
| 61 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6973 | 0.6454 | 0.9762 | 0.2789 |
| 61 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6051 | 0.6051 | 1.0000 | 0.3949 |
| 61 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6422 | 0.5448 | 1.0000 | 0.3578 |
| 61 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 0.8889 | 0.3611 |
| 61 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4000 | 1.0000 | 0.4000 |
| 62 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7355 | 0.6998 | 0.9762 | 0.2406 |
| 62 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7557 | 0.7461 | 1.0000 | 0.2443 |
| 62 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7480 | 0.6723 | 1.0000 | 0.2520 |
| 62 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 0.8889 | 0.2847 |
| 62 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6667 | 0.5333 | 1.0000 | 0.3333 |
| 63 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 63 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8080 | 0.8033 | 1.0000 | 0.1920 |
| 63 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8007 | 0.7498 | 1.0000 | 0.1993 |
| 63 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 63 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7222 | 0.6000 | 1.0000 | 0.2778 |
| 64 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 64 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9054 | 0.9007 | 1.0000 | 0.0946 |
| 64 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8760 | 0.8433 | 1.0000 | 0.1240 |
| 64 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8681 | 0.7569 | 0.8889 | 0.0208 |
| 64 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 65 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8971 | 0.8912 | 0.9821 | 0.0850 |
| 65 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 65 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8948 | 0.8728 | 0.9683 | 0.0735 |
| 65 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 65 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 66 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5816 | 0.5204 | 0.9821 | 0.4005 |
| 66 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 66 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3676 | 0.3105 | 0.9683 | 0.6006 |
| 66 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3194 | 0.2639 | 1.0000 | 0.6806 |
| 66 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 67 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 67 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 67 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 67 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 67 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 68 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5918 | 0.5306 | 0.9821 | 0.3903 |
| 68 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4738 | 0.4690 | 0.9748 | 0.5010 |
| 68 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5424 | 0.4574 | 0.9683 | 0.4259 |
| 68 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4306 | 0.3194 | 1.0000 | 0.5694 |
| 68 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.4000 | 0.9778 | 0.4667 |
| 69 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7143 | 0.6556 | 0.9821 | 0.2679 |
| 69 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5879 | 0.5879 | 0.9748 | 0.3870 |
| 69 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6680 | 0.5647 | 0.9683 | 0.3002 |
| 69 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 69 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4000 | 0.9778 | 0.3778 |
| 70 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7253 | 0.6777 | 0.9821 | 0.2568 |
| 70 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7734 | 0.7638 | 0.9748 | 0.2015 |
| 70 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7473 | 0.6653 | 0.9683 | 0.2210 |
| 70 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 1.0000 | 0.3958 |
| 70 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6000 | 0.9778 | 0.2111 |
| 71 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7517 | 0.9821 | 0.1888 |
| 71 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8570 | 0.8523 | 0.9748 | 0.1178 |
| 71 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8119 | 0.7518 | 0.9683 | 0.1564 |
| 71 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 1.0000 | 0.3194 |
| 71 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.7333 | 0.9778 | 0.1111 |
| 72 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8257 | 0.9821 | 0.1327 |
| 72 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 72 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8332 | 0.7697 | 0.9683 | 0.1350 |
| 72 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 72 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 73 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 73 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7505 | 0.7457 | 0.8901 | 0.1397 |
| 73 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7385 | 0.6723 | 0.8987 | 0.1602 |
| 73 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 73 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 74 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.4912 | 0.4300 | 0.8495 | 0.3583 |
| 74 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 74 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3111 | 0.2569 | 0.8987 | 0.5877 |
| 74 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2431 | 0.1875 | 0.6597 | 0.4167 |
| 74 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 75 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7713 | 0.7474 | 0.8495 | 0.0782 |
| 75 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8044 | 0.7997 | 0.8901 | 0.0857 |
| 75 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7927 | 0.7388 | 0.8987 | 0.1061 |
| 75 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 75 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 76 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5014 | 0.4402 | 0.8495 | 0.3481 |
| 76 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4240 | 0.4193 | 0.8901 | 0.4661 |
| 76 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4704 | 0.3860 | 0.8987 | 0.4283 |
| 76 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3542 | 0.2431 | 0.6597 | 0.3056 |
| 76 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.3333 | 0.9778 | 0.5333 |
| 77 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6471 | 0.5893 | 0.8495 | 0.2024 |
| 77 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4698 | 0.4651 | 0.8901 | 0.4203 |
| 77 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5921 | 0.4952 | 0.8987 | 0.3066 |
| 77 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3750 | 0.2639 | 0.6597 | 0.2847 |
| 77 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.3333 | 0.9778 | 0.4667 |
| 78 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6956 | 0.6420 | 0.8495 | 0.1539 |
| 78 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5442 | 0.5395 | 0.8901 | 0.3459 |
| 78 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6381 | 0.5391 | 0.8987 | 0.2606 |
| 78 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.2847 | 0.6597 | 0.1528 |
| 78 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4667 | 0.9778 | 0.3778 |
| 79 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7415 | 0.7058 | 0.8495 | 0.1080 |
| 79 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 79 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7164 | 0.6325 | 0.8987 | 0.1824 |
| 79 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 79 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 80 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 80 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6920 | 0.6872 | 0.8901 | 0.1982 |
| 80 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 80 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 80 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 81 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9141 | 0.9022 | 0.9762 | 0.0621 |
| 81 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 81 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9266 | 0.9147 | 1.0000 | 0.0734 |
| 81 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 81 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 82 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5961 | 0.5408 | 0.9762 | 0.3801 |
| 82 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 82 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3745 | 0.3264 | 1.0000 | 0.6255 |
| 82 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 82 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2222 | 0.1333 | 1.0000 | 0.7778 |
| 83 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 83 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 83 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 83 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 83 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 84 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6063 | 0.5510 | 0.9762 | 0.3699 |
| 84 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5305 | 0.5257 | 1.0000 | 0.4695 |
| 84 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5831 | 0.4981 | 1.0000 | 0.4169 |
| 84 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 0.8889 | 0.4375 |
| 84 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.3333 | 1.0000 | 0.5556 |
| 85 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6973 | 0.6454 | 0.9762 | 0.2789 |
| 85 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6350 | 0.6350 | 1.0000 | 0.3650 |
| 85 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6555 | 0.5538 | 1.0000 | 0.3445 |
| 85 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 0.8889 | 0.3611 |
| 85 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4000 | 1.0000 | 0.4000 |
| 86 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7355 | 0.6998 | 0.9762 | 0.2406 |
| 86 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7557 | 0.7461 | 1.0000 | 0.2443 |
| 86 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7480 | 0.6723 | 1.0000 | 0.2520 |
| 86 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 0.8889 | 0.2847 |
| 86 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6667 | 0.5333 | 1.0000 | 0.3333 |
| 87 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 87 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8080 | 0.8033 | 1.0000 | 0.1920 |
| 87 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8007 | 0.7498 | 1.0000 | 0.1993 |
| 87 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 87 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7222 | 0.6000 | 1.0000 | 0.2778 |
| 88 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 88 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9054 | 0.9007 | 1.0000 | 0.0946 |
| 88 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8760 | 0.8433 | 1.0000 | 0.1240 |
| 88 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8681 | 0.7569 | 0.8889 | 0.0208 |
| 88 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 89 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8971 | 0.8912 | 0.9821 | 0.0850 |
| 89 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 89 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8948 | 0.8728 | 0.9683 | 0.0735 |
| 89 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 89 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 90 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5816 | 0.5204 | 0.9821 | 0.4005 |
| 90 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 90 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3676 | 0.3105 | 0.9683 | 0.6006 |
| 90 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3194 | 0.2639 | 1.0000 | 0.6806 |
| 90 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 91 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 91 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 91 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 91 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 91 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 92 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5918 | 0.5306 | 0.9821 | 0.3903 |
| 92 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4738 | 0.4690 | 0.9748 | 0.5010 |
| 92 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5424 | 0.4574 | 0.9683 | 0.4259 |
| 92 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4306 | 0.3194 | 1.0000 | 0.5694 |
| 92 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.4000 | 0.9778 | 0.4667 |
| 93 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7143 | 0.6556 | 0.9821 | 0.2679 |
| 93 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6069 | 0.6069 | 0.9748 | 0.3679 |
| 93 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6723 | 0.5647 | 0.9683 | 0.2959 |
| 93 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 93 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6333 | 0.4000 | 0.9778 | 0.3444 |
| 94 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7253 | 0.6777 | 0.9821 | 0.2568 |
| 94 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7734 | 0.7638 | 0.9748 | 0.2015 |
| 94 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7473 | 0.6653 | 0.9683 | 0.2210 |
| 94 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 1.0000 | 0.3958 |
| 94 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6000 | 0.9778 | 0.2111 |
| 95 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7517 | 0.9821 | 0.1888 |
| 95 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8570 | 0.8523 | 0.9748 | 0.1178 |
| 95 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8119 | 0.7518 | 0.9683 | 0.1564 |
| 95 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 1.0000 | 0.3194 |
| 95 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.7333 | 0.9778 | 0.1111 |
| 96 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8257 | 0.9821 | 0.1327 |
| 96 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 96 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8332 | 0.7697 | 0.9683 | 0.1350 |
| 96 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 96 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 97 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 97 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7600 | 0.7552 | 0.8901 | 0.1302 |
| 97 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7450 | 0.6852 | 0.8987 | 0.1537 |
| 97 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 97 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 98 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.4912 | 0.4300 | 0.8495 | 0.3583 |
| 98 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 98 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3111 | 0.2569 | 0.8987 | 0.5877 |
| 98 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.2431 | 0.1875 | 0.6597 | 0.4167 |
| 98 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 99 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7874 | 0.7696 | 0.8495 | 0.0621 |
| 99 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8330 | 0.8282 | 0.8901 | 0.0571 |
| 99 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8373 | 0.7924 | 0.8987 | 0.0614 |
| 99 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 99 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8556 | 0.7333 | 0.9778 | 0.1222 |
| 100 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5014 | 0.4402 | 0.8495 | 0.3481 |
| 100 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4240 | 0.4193 | 0.8901 | 0.4661 |
| 100 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4704 | 0.3860 | 0.8987 | 0.4283 |
| 100 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3542 | 0.2431 | 0.6597 | 0.3056 |
| 100 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.3333 | 0.9778 | 0.5333 |
| 101 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6471 | 0.5893 | 0.8495 | 0.2024 |
| 101 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4841 | 0.4746 | 0.8901 | 0.4060 |
| 101 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6051 | 0.4952 | 0.8987 | 0.2937 |
| 101 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3750 | 0.2639 | 0.6597 | 0.2847 |
| 101 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.3333 | 0.9778 | 0.4667 |
| 102 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6956 | 0.6420 | 0.8495 | 0.1539 |
| 102 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5847 | 0.5847 | 0.8901 | 0.3054 |
| 102 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6624 | 0.5699 | 0.8987 | 0.2363 |
| 102 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.2847 | 0.6597 | 0.1528 |
| 102 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4667 | 0.9778 | 0.3778 |
| 103 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7415 | 0.7058 | 0.8495 | 0.1080 |
| 103 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 103 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7164 | 0.6325 | 0.8987 | 0.1824 |
| 103 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 103 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 104 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 104 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7124 | 0.7076 | 0.8901 | 0.1778 |
| 104 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 104 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 104 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 105 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 105 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 105 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9623 | 0.9504 | 1.0000 | 0.0377 |
| 105 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 105 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 106 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5961 | 0.5408 | 0.9762 | 0.3801 |
| 106 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 106 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3745 | 0.3264 | 1.0000 | 0.6255 |
| 106 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3403 | 0.2847 | 0.8889 | 0.5486 |
| 106 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2222 | 0.1333 | 1.0000 | 0.7778 |
| 107 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 107 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 107 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 107 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 107 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 108 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6063 | 0.5510 | 0.9762 | 0.3699 |
| 108 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5305 | 0.5257 | 1.0000 | 0.4695 |
| 108 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5831 | 0.4981 | 1.0000 | 0.4169 |
| 108 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 0.8889 | 0.4375 |
| 108 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.3333 | 1.0000 | 0.5556 |
| 109 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6973 | 0.6454 | 0.9762 | 0.2789 |
| 109 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6700 | 0.6604 | 1.0000 | 0.3300 |
| 109 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6685 | 0.5667 | 1.0000 | 0.3315 |
| 109 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5833 | 0.3611 | 0.8889 | 0.3056 |
| 109 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6222 | 0.4000 | 1.0000 | 0.3778 |
| 110 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7355 | 0.6998 | 0.9762 | 0.2406 |
| 110 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7604 | 0.7557 | 1.0000 | 0.2396 |
| 110 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7545 | 0.6852 | 1.0000 | 0.2455 |
| 110 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 0.8889 | 0.2847 |
| 110 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6667 | 0.5333 | 1.0000 | 0.3333 |
| 111 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 111 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8080 | 0.8033 | 1.0000 | 0.1920 |
| 111 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8007 | 0.7498 | 1.0000 | 0.1993 |
| 111 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 111 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7222 | 0.6000 | 1.0000 | 0.2778 |
| 112 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 112 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9102 | 0.9102 | 1.0000 | 0.0898 |
| 112 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8760 | 0.8433 | 1.0000 | 0.1240 |
| 112 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8681 | 0.7569 | 0.8889 | 0.0208 |
| 112 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 113 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8971 | 0.8912 | 0.9821 | 0.0850 |
| 113 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 113 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8948 | 0.8728 | 0.9683 | 0.0735 |
| 113 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 113 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 114 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5816 | 0.5204 | 0.9821 | 0.4005 |
| 114 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 114 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.3676 | 0.3105 | 0.9683 | 0.6006 |
| 114 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3194 | 0.2639 | 1.0000 | 0.6806 |
| 114 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.2889 | 0.2000 | 0.9778 | 0.6889 |
| 115 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 115 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 115 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 115 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 115 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 116 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.5918 | 0.5306 | 0.9821 | 0.3903 |
| 116 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4738 | 0.4690 | 0.9748 | 0.5010 |
| 116 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5424 | 0.4574 | 0.9683 | 0.4259 |
| 116 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4306 | 0.3194 | 1.0000 | 0.5694 |
| 116 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.4000 | 0.9778 | 0.4667 |
| 117 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7143 | 0.6556 | 0.9821 | 0.2679 |
| 117 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6276 | 0.6228 | 0.9748 | 0.3473 |
| 117 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6878 | 0.5647 | 0.9683 | 0.2805 |
| 117 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 117 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6333 | 0.4000 | 0.9778 | 0.3444 |
| 118 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7253 | 0.6777 | 0.9821 | 0.2568 |
| 118 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7985 | 0.7938 | 0.9748 | 0.1763 |
| 118 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7627 | 0.6872 | 0.9683 | 0.2055 |
| 118 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 1.0000 | 0.3958 |
| 118 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6000 | 0.9778 | 0.2111 |
| 119 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8172 | 0.7815 | 0.9821 | 0.1650 |
| 119 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8570 | 0.8523 | 0.9748 | 0.1178 |
| 119 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8208 | 0.7697 | 0.9683 | 0.1475 |
| 119 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7361 | 0.6250 | 1.0000 | 0.2639 |
| 119 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.7333 | 0.9778 | 0.1111 |
| 120 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8614 | 0.8495 | 0.9821 | 0.1207 |
| 120 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 120 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8481 | 0.8054 | 0.9683 | 0.1201 |
| 120 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 120 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |

The ceiling uses the complete ranking and all spans, including for s1 arms. JSON retains exhaustive per-query, stratum and provenance data.

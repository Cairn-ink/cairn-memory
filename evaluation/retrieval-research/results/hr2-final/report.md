# HR-2 budgeted assembly

Protocol: HR-2 v1.1. Primary decision: **rank-first-initial-default**. Reason: decision rule §4.

The sole confirmatory contrast is P-cover − P-top on test / S1000 / A3--bge-m3 / O=0 / B=512. Every other contrast and all dev output are exploratory. The shared statistics library receives exploratory:true solely to select the preregistered 95% endpoints.

This is a short, single-fact synthetic fixture with bodies at most 82 UTF-16 units and about 40% span-only required groups. These results do not establish behavior on long items, generated summaries, hosted applicability or production reliability. The initial policy must be revisited with a long-item fixture. McNemar is underpowered by design.

## Shared provenance

Frozen commit: c863e9d674f23ccebffaf3ad96ab1c4b34eabc82; counter: tiktoken@1.0.22:o200k_base:encode(text,[],[]).

All unrounded metrics, complete source runs, per-query admissions and stage identities are retained in JSON. Cell numbers below refer to the metrics table.

| Stage | Commit | Source SHA-256 | Dirty | Detached |
| --- | --- | --- | --- | --- |
| report | 241fad89b377a6c084e62a41364e62e2734d3a23 | 28d76e3466722e28bf52c9168208c6e797ce61accd57499648adc89e79c5fd74 | true | false |
| assembly | 241fad89b377a6c084e62a41364e62e2734d3a23 | 28d76e3466722e28bf52c9168208c6e797ce61accd57499648adc89e79c5fd74 | true | false |
| scorer | 241fad89b377a6c084e62a41364e62e2734d3a23 | 28d76e3466722e28bf52c9168208c6e797ce61accd57499648adc89e79c5fd74 | true | false |

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
| 1 | test | A1 | P-cover | 0 | 1024 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.9692 / 0.9971 |
| 2 | test | A1 | P-cover | 0 | 128 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9844 / 1.0000 |
| 3 | test | A1 | P-cover | 0 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.6462 / 0.7038 |
| 4 | test | A1 | P-cover | 0 | 192 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9896 / 1.0000 |
| 5 | test | A1 | P-cover | 0 | 256 | exploratory | 0.5030 | 0.3994 | 0.8726 | 0.3696 | 0.9961 / 1.0000 |
| 6 | test | A1 | P-cover | 0 | 384 | exploratory | 0.5645 | 0.4542 | 0.8726 | 0.3081 | 0.9922 / 1.0000 |
| 7 | test | A1 | P-cover | 0 | 512 | exploratory | 0.7788 | 0.7268 | 0.8726 | 0.0938 | 0.9941 / 1.0000 |
| 8 | test | A1 | P-cover | 0 | 768 | exploratory | 0.8528 | 0.8119 | 0.8726 | 0.0198 | 0.9948 / 1.0000 |
| 9 | test | A1 | P-cover | 8 | 1024 | exploratory | 0.8480 | 0.8119 | 0.8726 | 0.0246 | 0.9941 / 1.0000 |
| 10 | test | A1 | P-cover | 8 | 128 | exploratory | 0.4692 | 0.3685 | 0.8726 | 0.4034 | 0.9609 / 1.0000 |
| 11 | test | A1 | P-cover | 8 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.9661 / 0.9976 |
| 12 | test | A1 | P-cover | 8 | 192 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9792 / 1.0000 |
| 13 | test | A1 | P-cover | 8 | 256 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9766 / 1.0000 |
| 14 | test | A1 | P-cover | 8 | 384 | exploratory | 0.4974 | 0.3899 | 0.8726 | 0.3752 | 0.9870 / 1.0000 |
| 15 | test | A1 | P-cover | 8 | 512 | exploratory | 0.5438 | 0.4232 | 0.8726 | 0.3288 | 0.9902 / 1.0000 |
| 16 | test | A1 | P-cover | 8 | 768 | exploratory | 0.7837 | 0.7238 | 0.8726 | 0.0889 | 0.9935 / 1.0000 |
| 17 | test | A3--bge-m3 | P-cover | 0 | 1024 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.7700 / 0.9146 |
| 18 | test | A3--bge-m3 | P-cover | 0 | 128 | exploratory | 0.5601 | 0.4351 | 0.9865 | 0.4264 | 0.9844 / 1.0000 |
| 19 | test | A3--bge-m3 | P-cover | 0 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.5133 / 0.6097 |
| 20 | test | A3--bge-m3 | P-cover | 0 | 192 | exploratory | 0.5760 | 0.4470 | 0.9865 | 0.4105 | 0.9896 / 1.0000 |
| 21 | test | A3--bge-m3 | P-cover | 0 | 256 | exploratory | 0.5927 | 0.4565 | 0.9865 | 0.3938 | 0.9883 / 1.0000 |
| 22 | test | A3--bge-m3 | P-cover | 0 | 384 | exploratory | 0.8736 | 0.8149 | 0.9865 | 0.1129 | 0.9948 / 1.0000 |
| 23 | test | A3--bge-m3 | P-cover | 0 | 512 | confirmatory | 0.9484 | 0.9405 | 0.9865 | 0.0381 | 0.9941 / 1.0000 |
| 24 | test | A3--bge-m3 | P-cover | 0 | 768 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.9896 / 1.0000 |
| 25 | test | A3--bge-m3 | P-cover | 8 | 1024 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9912 / 1.0000 |
| 26 | test | A3--bge-m3 | P-cover | 8 | 128 | exploratory | 0.5089 | 0.3994 | 0.9865 | 0.4776 | 0.9453 / 1.0000 |
| 27 | test | A3--bge-m3 | P-cover | 8 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.7669 / 0.9102 |
| 28 | test | A3--bge-m3 | P-cover | 8 | 192 | exploratory | 0.5482 | 0.4232 | 0.9865 | 0.4383 | 0.9844 / 1.0000 |
| 29 | test | A3--bge-m3 | P-cover | 8 | 256 | exploratory | 0.5641 | 0.4351 | 0.9865 | 0.4224 | 0.9844 / 1.0000 |
| 30 | test | A3--bge-m3 | P-cover | 8 | 384 | exploratory | 0.5895 | 0.4565 | 0.9865 | 0.3970 | 0.9870 / 1.0000 |
| 31 | test | A3--bge-m3 | P-cover | 8 | 512 | exploratory | 0.7742 | 0.6845 | 0.9865 | 0.2123 | 0.9922 / 1.0000 |
| 32 | test | A3--bge-m3 | P-cover | 8 | 768 | exploratory | 0.9484 | 0.9405 | 0.9865 | 0.0381 | 0.9928 / 0.9992 |
| 33 | test | F-RRF10--openai-3-small | P-cover | 0 | 1024 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.9727 / 0.9990 |
| 34 | test | F-RRF10--openai-3-small | P-cover | 0 | 128 | exploratory | 0.5331 | 0.4137 | 0.9778 | 0.4446 | 0.9844 / 1.0000 |
| 35 | test | F-RRF10--openai-3-small | P-cover | 0 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.6484 / 0.6992 |
| 36 | test | F-RRF10--openai-3-small | P-cover | 0 | 192 | exploratory | 0.5681 | 0.4351 | 0.9778 | 0.4097 | 0.9896 / 1.0000 |
| 37 | test | F-RRF10--openai-3-small | P-cover | 0 | 256 | exploratory | 0.5839 | 0.4470 | 0.9778 | 0.3938 | 0.9922 / 1.0000 |
| 38 | test | F-RRF10--openai-3-small | P-cover | 0 | 384 | exploratory | 0.6411 | 0.5232 | 0.9778 | 0.3367 | 0.9922 / 1.0000 |
| 39 | test | F-RRF10--openai-3-small | P-cover | 0 | 512 | exploratory | 0.9208 | 0.9006 | 0.9778 | 0.0569 | 0.9941 / 1.0000 |
| 40 | test | F-RRF10--openai-3-small | P-cover | 0 | 768 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9961 / 1.0000 |
| 41 | test | F-RRF10--openai-3-small | P-cover | 8 | 1024 | exploratory | 0.9587 | 0.9524 | 0.9778 | 0.0190 | 0.9941 / 1.0000 |
| 42 | test | F-RRF10--openai-3-small | P-cover | 8 | 128 | exploratory | 0.5014 | 0.3899 | 0.9778 | 0.4764 | 0.9453 / 1.0000 |
| 43 | test | F-RRF10--openai-3-small | P-cover | 8 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.9639 / 0.9976 |
| 44 | test | F-RRF10--openai-3-small | P-cover | 8 | 192 | exploratory | 0.5331 | 0.4137 | 0.9778 | 0.4446 | 0.9844 / 1.0000 |
| 45 | test | F-RRF10--openai-3-small | P-cover | 8 | 256 | exploratory | 0.5514 | 0.4232 | 0.9778 | 0.4264 | 0.9844 / 1.0000 |
| 46 | test | F-RRF10--openai-3-small | P-cover | 8 | 384 | exploratory | 0.5800 | 0.4470 | 0.9778 | 0.3978 | 0.9922 / 1.0000 |
| 47 | test | F-RRF10--openai-3-small | P-cover | 8 | 512 | exploratory | 0.5871 | 0.4470 | 0.9778 | 0.3907 | 0.9922 / 1.0000 |
| 48 | test | F-RRF10--openai-3-small | P-cover | 8 | 768 | exploratory | 0.9298 | 0.9095 | 0.9778 | 0.0480 | 0.9922 / 1.0000 |
| 49 | test | A1 | P-cover-s1 | 0 | 1024 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.8716 / 0.9493 |
| 50 | test | A1 | P-cover-s1 | 0 | 128 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9609 / 1.0000 |
| 51 | test | A1 | P-cover-s1 | 0 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.5811 / 0.6328 |
| 52 | test | A1 | P-cover-s1 | 0 | 192 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9740 / 1.0000 |
| 53 | test | A1 | P-cover-s1 | 0 | 256 | exploratory | 0.5030 | 0.3994 | 0.8726 | 0.3696 | 0.9883 / 1.0000 |
| 54 | test | A1 | P-cover-s1 | 0 | 384 | exploratory | 0.5645 | 0.4542 | 0.8726 | 0.3081 | 0.9870 / 1.0000 |
| 55 | test | A1 | P-cover-s1 | 0 | 512 | exploratory | 0.7867 | 0.7268 | 0.8726 | 0.0859 | 0.9863 / 1.0000 |
| 56 | test | A1 | P-cover-s1 | 0 | 768 | exploratory | 0.8647 | 0.8238 | 0.8726 | 0.0079 | 0.9883 / 1.0000 |
| 57 | test | A1 | P-cover-s1 | 8 | 1024 | exploratory | 0.8528 | 0.8119 | 0.8726 | 0.0198 | 0.9883 / 0.9980 |
| 58 | test | A1 | P-cover-s1 | 8 | 128 | exploratory | 0.4692 | 0.3685 | 0.8726 | 0.4034 | 0.9414 / 1.0000 |
| 59 | test | A1 | P-cover-s1 | 8 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.8307 / 0.8828 |
| 60 | test | A1 | P-cover-s1 | 8 | 192 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9531 / 1.0000 |
| 61 | test | A1 | P-cover-s1 | 8 | 256 | exploratory | 0.4788 | 0.3780 | 0.8726 | 0.3938 | 0.9629 / 1.0000 |
| 62 | test | A1 | P-cover-s1 | 8 | 384 | exploratory | 0.4974 | 0.3899 | 0.8726 | 0.3752 | 0.9792 / 1.0000 |
| 63 | test | A1 | P-cover-s1 | 8 | 512 | exploratory | 0.5534 | 0.4327 | 0.8726 | 0.3192 | 0.9883 / 1.0000 |
| 64 | test | A1 | P-cover-s1 | 8 | 768 | exploratory | 0.8028 | 0.7476 | 0.8726 | 0.0698 | 0.9896 / 0.9992 |
| 65 | test | A3--bge-m3 | P-cover-s1 | 0 | 1024 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.6904 / 0.8157 |
| 66 | test | A3--bge-m3 | P-cover-s1 | 0 | 128 | exploratory | 0.5601 | 0.4351 | 0.9865 | 0.4264 | 0.9766 / 1.0000 |
| 67 | test | A3--bge-m3 | P-cover-s1 | 0 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.4603 / 0.5438 |
| 68 | test | A3--bge-m3 | P-cover-s1 | 0 | 192 | exploratory | 0.5760 | 0.4470 | 0.9865 | 0.4105 | 0.9792 / 1.0000 |
| 69 | test | A3--bge-m3 | P-cover-s1 | 0 | 256 | exploratory | 0.5966 | 0.4565 | 0.9865 | 0.3899 | 0.9844 / 1.0000 |
| 70 | test | A3--bge-m3 | P-cover-s1 | 0 | 384 | exploratory | 0.8855 | 0.8268 | 0.9865 | 0.1010 | 0.9896 / 1.0000 |
| 71 | test | A3--bge-m3 | P-cover-s1 | 0 | 512 | exploratory | 0.9579 | 0.9500 | 0.9865 | 0.0286 | 0.9883 / 1.0000 |
| 72 | test | A3--bge-m3 | P-cover-s1 | 0 | 768 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.9206 / 0.9979 |
| 73 | test | A3--bge-m3 | P-cover-s1 | 8 | 1024 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.9780 / 0.9971 |
| 74 | test | A3--bge-m3 | P-cover-s1 | 8 | 128 | exploratory | 0.5089 | 0.3994 | 0.9865 | 0.4776 | 0.9375 / 1.0000 |
| 75 | test | A3--bge-m3 | P-cover-s1 | 8 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.6589 / 0.7870 |
| 76 | test | A3--bge-m3 | P-cover-s1 | 8 | 192 | exploratory | 0.5482 | 0.4232 | 0.9865 | 0.4383 | 0.9688 / 1.0000 |
| 77 | test | A3--bge-m3 | P-cover-s1 | 8 | 256 | exploratory | 0.5641 | 0.4351 | 0.9865 | 0.4224 | 0.9727 / 1.0000 |
| 78 | test | A3--bge-m3 | P-cover-s1 | 8 | 384 | exploratory | 0.5895 | 0.4565 | 0.9865 | 0.3970 | 0.9818 / 1.0000 |
| 79 | test | A3--bge-m3 | P-cover-s1 | 8 | 512 | exploratory | 0.7849 | 0.7060 | 0.9865 | 0.2016 | 0.9824 / 1.0000 |
| 80 | test | A3--bge-m3 | P-cover-s1 | 8 | 768 | exploratory | 0.9675 | 0.9595 | 0.9865 | 0.0190 | 0.9850 / 0.9987 |
| 81 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 1024 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.8779 / 0.9482 |
| 82 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 128 | exploratory | 0.5331 | 0.4137 | 0.9778 | 0.4446 | 0.9688 / 1.0000 |
| 83 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.5853 / 0.6322 |
| 84 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 192 | exploratory | 0.5681 | 0.4351 | 0.9778 | 0.4097 | 0.9766 / 1.0000 |
| 85 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 256 | exploratory | 0.5839 | 0.4470 | 0.9778 | 0.3938 | 0.9805 / 1.0000 |
| 86 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 384 | exploratory | 0.6411 | 0.5232 | 0.9778 | 0.3367 | 0.9844 / 1.0000 |
| 87 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 512 | exploratory | 0.9393 | 0.9190 | 0.9778 | 0.0385 | 0.9922 / 1.0000 |
| 88 | test | F-RRF10--openai-3-small | P-cover-s1 | 0 | 768 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9909 / 1.0000 |
| 89 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 1024 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9897 / 1.0000 |
| 90 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 128 | exploratory | 0.5014 | 0.3899 | 0.9778 | 0.4764 | 0.9375 / 0.9949 |
| 91 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.8353 / 0.8822 |
| 92 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 192 | exploratory | 0.5331 | 0.4137 | 0.9778 | 0.4446 | 0.9609 / 1.0000 |
| 93 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 256 | exploratory | 0.5514 | 0.4232 | 0.9778 | 0.4264 | 0.9609 / 1.0000 |
| 94 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 384 | exploratory | 0.5800 | 0.4470 | 0.9778 | 0.3978 | 0.9792 / 1.0000 |
| 95 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 512 | exploratory | 0.5871 | 0.4470 | 0.9778 | 0.3907 | 0.9902 / 1.0000 |
| 96 | test | F-RRF10--openai-3-small | P-cover-s1 | 8 | 768 | exploratory | 0.9393 | 0.9190 | 0.9778 | 0.0385 | 0.9896 / 1.0000 |
| 97 | test | A1 | P-top+tail | 0 | 1024 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.9692 / 0.9951 |
| 98 | test | A1 | P-top+tail | 0 | 128 | exploratory | 0.6319 | 0.5315 | 0.8726 | 0.2407 | 0.9648 / 1.0000 |
| 99 | test | A1 | P-top+tail | 0 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.6462 / 0.7038 |
| 100 | test | A1 | P-top+tail | 0 | 192 | exploratory | 0.7129 | 0.6339 | 0.8726 | 0.1597 | 0.9792 / 1.0000 |
| 101 | test | A1 | P-top+tail | 0 | 256 | exploratory | 0.7385 | 0.6643 | 0.8726 | 0.1341 | 0.9844 / 1.0000 |
| 102 | test | A1 | P-top+tail | 0 | 384 | exploratory | 0.7631 | 0.6952 | 0.8726 | 0.1095 | 0.9870 / 1.0000 |
| 103 | test | A1 | P-top+tail | 0 | 512 | exploratory | 0.7837 | 0.7167 | 0.8726 | 0.0889 | 0.9902 / 1.0000 |
| 104 | test | A1 | P-top+tail | 0 | 768 | exploratory | 0.8548 | 0.8000 | 0.8726 | 0.0179 | 0.9909 / 0.9992 |
| 105 | test | A1 | P-top+tail | 8 | 1024 | exploratory | 0.8190 | 0.7643 | 0.8726 | 0.0536 | 0.9912 / 1.0000 |
| 106 | test | A1 | P-top+tail | 8 | 128 | exploratory | 0.5938 | 0.5006 | 0.8726 | 0.2788 | 0.9453 / 1.0000 |
| 107 | test | A1 | P-top+tail | 8 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.9661 / 0.9970 |
| 108 | test | A1 | P-top+tail | 8 | 192 | exploratory | 0.6359 | 0.5315 | 0.8726 | 0.2367 | 0.9609 / 0.9948 |
| 109 | test | A1 | P-top+tail | 8 | 256 | exploratory | 0.7069 | 0.6220 | 0.8726 | 0.1657 | 0.9648 / 1.0000 |
| 110 | test | A1 | P-top+tail | 8 | 384 | exploratory | 0.7385 | 0.6643 | 0.8726 | 0.1341 | 0.9766 / 1.0000 |
| 111 | test | A1 | P-top+tail | 8 | 512 | exploratory | 0.7631 | 0.6952 | 0.8726 | 0.1095 | 0.9785 / 1.0000 |
| 112 | test | A1 | P-top+tail | 8 | 768 | exploratory | 0.7837 | 0.7167 | 0.8726 | 0.0889 | 0.9909 / 1.0000 |
| 113 | test | A3--bge-m3 | P-top+tail | 0 | 1024 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.7700 / 0.9146 |
| 114 | test | A3--bge-m3 | P-top+tail | 0 | 128 | exploratory | 0.7687 | 0.6881 | 0.9865 | 0.2179 | 0.9688 / 1.0000 |
| 115 | test | A3--bge-m3 | P-top+tail | 0 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.5133 / 0.6097 |
| 116 | test | A3--bge-m3 | P-top+tail | 0 | 192 | exploratory | 0.8369 | 0.7929 | 0.9865 | 0.1496 | 0.9818 / 1.0000 |
| 117 | test | A3--bge-m3 | P-top+tail | 0 | 256 | exploratory | 0.8837 | 0.8476 | 0.9865 | 0.1028 | 0.9844 / 1.0000 |
| 118 | test | A3--bge-m3 | P-top+tail | 0 | 384 | exploratory | 0.9325 | 0.9167 | 0.9865 | 0.0540 | 0.9896 / 1.0000 |
| 119 | test | A3--bge-m3 | P-top+tail | 0 | 512 | exploratory | 0.9730 | 0.9571 | 0.9865 | 0.0135 | 0.9902 / 1.0000 |
| 120 | test | A3--bge-m3 | P-top+tail | 0 | 768 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9837 / 0.9987 |
| 121 | test | A3--bge-m3 | P-top+tail | 8 | 1024 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9883 / 0.9990 |
| 122 | test | A3--bge-m3 | P-top+tail | 8 | 128 | exploratory | 0.6837 | 0.5714 | 0.9865 | 0.3028 | 0.9453 / 1.0000 |
| 123 | test | A3--bge-m3 | P-top+tail | 8 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.7669 / 0.9102 |
| 124 | test | A3--bge-m3 | P-top+tail | 8 | 192 | exploratory | 0.7687 | 0.6881 | 0.9865 | 0.2179 | 0.9557 / 1.0000 |
| 125 | test | A3--bge-m3 | P-top+tail | 8 | 256 | exploratory | 0.8143 | 0.7524 | 0.9865 | 0.1722 | 0.9844 / 1.0000 |
| 126 | test | A3--bge-m3 | P-top+tail | 8 | 384 | exploratory | 0.8837 | 0.8476 | 0.9865 | 0.1028 | 0.9844 / 1.0000 |
| 127 | test | A3--bge-m3 | P-top+tail | 8 | 512 | exploratory | 0.9147 | 0.8929 | 0.9865 | 0.0718 | 0.9854 / 1.0000 |
| 128 | test | A3--bge-m3 | P-top+tail | 8 | 768 | exploratory | 0.9730 | 0.9571 | 0.9865 | 0.0135 | 0.9896 / 0.9987 |
| 129 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 1024 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.9722 / 0.9961 |
| 130 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 128 | exploratory | 0.7581 | 0.6792 | 0.9778 | 0.2196 | 0.9688 / 1.0000 |
| 131 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.6484 / 0.6992 |
| 132 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 192 | exploratory | 0.8448 | 0.7833 | 0.9778 | 0.1329 | 0.9792 / 1.0000 |
| 133 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 256 | exploratory | 0.8825 | 0.8310 | 0.9778 | 0.0952 | 0.9844 / 1.0000 |
| 134 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 384 | exploratory | 0.9202 | 0.8952 | 0.9778 | 0.0575 | 0.9896 / 1.0000 |
| 135 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 512 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9922 / 1.0000 |
| 136 | test | F-RRF10--openai-3-small | P-top+tail | 0 | 768 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9909 / 1.0000 |
| 137 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 1024 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9922 / 1.0000 |
| 138 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 128 | exploratory | 0.6720 | 0.5530 | 0.9778 | 0.3058 | 0.9453 / 1.0000 |
| 139 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.9629 / 0.9950 |
| 140 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 192 | exploratory | 0.7581 | 0.6792 | 0.9778 | 0.2196 | 0.9583 / 1.0000 |
| 141 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 256 | exploratory | 0.8246 | 0.7619 | 0.9778 | 0.1532 | 0.9746 / 1.0000 |
| 142 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 384 | exploratory | 0.8825 | 0.8310 | 0.9778 | 0.0952 | 0.9714 / 1.0000 |
| 143 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 512 | exploratory | 0.9020 | 0.8643 | 0.9778 | 0.0758 | 0.9902 / 1.0000 |
| 144 | test | F-RRF10--openai-3-small | P-top+tail | 8 | 768 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9870 / 1.0000 |
| 145 | test | A1 | P-top | 0 | 1024 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.9692 / 0.9971 |
| 146 | test | A1 | P-top | 0 | 128 | exploratory | 0.6387 | 0.5387 | 0.8726 | 0.2339 | 0.9688 / 1.0000 |
| 147 | test | A1 | P-top | 0 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.6462 / 0.7038 |
| 148 | test | A1 | P-top | 0 | 192 | exploratory | 0.7129 | 0.6339 | 0.8726 | 0.1597 | 0.9792 / 1.0000 |
| 149 | test | A1 | P-top | 0 | 256 | exploratory | 0.7385 | 0.6643 | 0.8726 | 0.1341 | 0.9844 / 1.0000 |
| 150 | test | A1 | P-top | 0 | 384 | exploratory | 0.7631 | 0.6952 | 0.8726 | 0.1095 | 0.9883 / 1.0000 |
| 151 | test | A1 | P-top | 0 | 512 | exploratory | 0.7956 | 0.7286 | 0.8726 | 0.0770 | 0.9902 / 1.0000 |
| 152 | test | A1 | P-top | 0 | 768 | exploratory | 0.8548 | 0.8000 | 0.8726 | 0.0179 | 0.9922 / 1.0000 |
| 153 | test | A1 | P-top | 8 | 1024 | exploratory | 0.8190 | 0.7643 | 0.8726 | 0.0536 | 0.9922 / 1.0000 |
| 154 | test | A1 | P-top | 8 | 128 | exploratory | 0.5855 | 0.4768 | 0.8726 | 0.2871 | 0.9453 / 1.0000 |
| 155 | test | A1 | P-top | 8 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.9661 / 0.9974 |
| 156 | test | A1 | P-top | 8 | 192 | exploratory | 0.6427 | 0.5387 | 0.8726 | 0.2300 | 0.9609 / 0.9948 |
| 157 | test | A1 | P-top | 8 | 256 | exploratory | 0.6974 | 0.6125 | 0.8726 | 0.1752 | 0.9688 / 1.0000 |
| 158 | test | A1 | P-top | 8 | 384 | exploratory | 0.7385 | 0.6643 | 0.8726 | 0.1341 | 0.9766 / 1.0000 |
| 159 | test | A1 | P-top | 8 | 512 | exploratory | 0.7631 | 0.6952 | 0.8726 | 0.1095 | 0.9805 / 1.0000 |
| 160 | test | A1 | P-top | 8 | 768 | exploratory | 0.7837 | 0.7167 | 0.8726 | 0.0889 | 0.9909 / 1.0000 |
| 161 | test | A3--bge-m3 | P-top | 0 | 1024 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.7700 / 0.9146 |
| 162 | test | A3--bge-m3 | P-top | 0 | 128 | exploratory | 0.7587 | 0.6762 | 0.9865 | 0.2278 | 0.9766 / 1.0000 |
| 163 | test | A3--bge-m3 | P-top | 0 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.5133 / 0.6097 |
| 164 | test | A3--bge-m3 | P-top | 0 | 192 | exploratory | 0.8321 | 0.7833 | 0.9865 | 0.1544 | 0.9792 / 1.0000 |
| 165 | test | A3--bge-m3 | P-top | 0 | 256 | exploratory | 0.8837 | 0.8476 | 0.9865 | 0.1028 | 0.9844 / 1.0000 |
| 166 | test | A3--bge-m3 | P-top | 0 | 384 | exploratory | 0.9325 | 0.9167 | 0.9865 | 0.0540 | 0.9896 / 1.0000 |
| 167 | test | A3--bge-m3 | P-top | 0 | 512 | confirmatory | 0.9730 | 0.9571 | 0.9865 | 0.0135 | 0.9902 / 1.0000 |
| 168 | test | A3--bge-m3 | P-top | 0 | 768 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9883 / 0.9987 |
| 169 | test | A3--bge-m3 | P-top | 8 | 1024 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9902 / 0.9990 |
| 170 | test | A3--bge-m3 | P-top | 8 | 128 | exploratory | 0.6825 | 0.5595 | 0.9865 | 0.3040 | 0.9570 / 1.0000 |
| 171 | test | A3--bge-m3 | P-top | 8 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.7669 / 0.9102 |
| 172 | test | A3--bge-m3 | P-top | 8 | 192 | exploratory | 0.7587 | 0.6762 | 0.9865 | 0.2278 | 0.9531 / 1.0000 |
| 173 | test | A3--bge-m3 | P-top | 8 | 256 | exploratory | 0.8143 | 0.7524 | 0.9865 | 0.1722 | 0.9785 / 1.0000 |
| 174 | test | A3--bge-m3 | P-top | 8 | 384 | exploratory | 0.8837 | 0.8476 | 0.9865 | 0.1028 | 0.9818 / 1.0000 |
| 175 | test | A3--bge-m3 | P-top | 8 | 512 | exploratory | 0.9147 | 0.8929 | 0.9865 | 0.0718 | 0.9883 / 1.0000 |
| 176 | test | A3--bge-m3 | P-top | 8 | 768 | exploratory | 0.9730 | 0.9571 | 0.9865 | 0.0135 | 0.9902 / 0.9987 |
| 177 | test | F-RRF10--openai-3-small | P-top | 0 | 1024 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.9727 / 0.9990 |
| 178 | test | F-RRF10--openai-3-small | P-top | 0 | 128 | exploratory | 0.7462 | 0.6554 | 0.9778 | 0.2315 | 0.9688 / 1.0000 |
| 179 | test | F-RRF10--openai-3-small | P-top | 0 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.6484 / 0.6992 |
| 180 | test | F-RRF10--openai-3-small | P-top | 0 | 192 | exploratory | 0.8448 | 0.7833 | 0.9778 | 0.1329 | 0.9844 / 1.0000 |
| 181 | test | F-RRF10--openai-3-small | P-top | 0 | 256 | exploratory | 0.8766 | 0.8190 | 0.9778 | 0.1012 | 0.9844 / 1.0000 |
| 182 | test | F-RRF10--openai-3-small | P-top | 0 | 384 | exploratory | 0.9202 | 0.8952 | 0.9778 | 0.0575 | 0.9909 / 1.0000 |
| 183 | test | F-RRF10--openai-3-small | P-top | 0 | 512 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9941 / 1.0000 |
| 184 | test | F-RRF10--openai-3-small | P-top | 0 | 768 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9941 / 1.0000 |
| 185 | test | F-RRF10--openai-3-small | P-top | 8 | 1024 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9922 / 1.0000 |
| 186 | test | F-RRF10--openai-3-small | P-top | 8 | 128 | exploratory | 0.6768 | 0.5530 | 0.9778 | 0.3010 | 0.9453 / 1.0000 |
| 187 | test | F-RRF10--openai-3-small | P-top | 8 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.9639 / 0.9961 |
| 188 | test | F-RRF10--openai-3-small | P-top | 8 | 192 | exploratory | 0.7462 | 0.6554 | 0.9778 | 0.2315 | 0.9583 / 1.0000 |
| 189 | test | F-RRF10--openai-3-small | P-top | 8 | 256 | exploratory | 0.8246 | 0.7619 | 0.9778 | 0.1532 | 0.9766 / 1.0000 |
| 190 | test | F-RRF10--openai-3-small | P-top | 8 | 384 | exploratory | 0.8766 | 0.8190 | 0.9778 | 0.1012 | 0.9740 / 1.0000 |
| 191 | test | F-RRF10--openai-3-small | P-top | 8 | 512 | exploratory | 0.9020 | 0.8643 | 0.9778 | 0.0758 | 0.9883 / 1.0000 |
| 192 | test | F-RRF10--openai-3-small | P-top | 8 | 768 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9896 / 1.0000 |
| 193 | test | A1 | P-top-s1 | 0 | 1024 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.8716 / 0.9493 |
| 194 | test | A1 | P-top-s1 | 0 | 128 | exploratory | 0.6653 | 0.5720 | 0.8726 | 0.2073 | 0.9688 / 1.0000 |
| 195 | test | A1 | P-top-s1 | 0 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.5811 / 0.6328 |
| 196 | test | A1 | P-top-s1 | 0 | 192 | exploratory | 0.7129 | 0.6339 | 0.8726 | 0.1597 | 0.9844 / 1.0000 |
| 197 | test | A1 | P-top-s1 | 0 | 256 | exploratory | 0.7504 | 0.6762 | 0.8726 | 0.1222 | 0.9805 / 1.0000 |
| 198 | test | A1 | P-top-s1 | 0 | 384 | exploratory | 0.7837 | 0.7167 | 0.8726 | 0.0889 | 0.9870 / 1.0000 |
| 199 | test | A1 | P-top-s1 | 0 | 512 | exploratory | 0.8016 | 0.7405 | 0.8726 | 0.0710 | 0.9902 / 1.0000 |
| 200 | test | A1 | P-top-s1 | 0 | 768 | exploratory | 0.8694 | 0.8333 | 0.8726 | 0.0032 | 0.9883 / 0.9987 |
| 201 | test | A1 | P-top-s1 | 8 | 1024 | exploratory | 0.8655 | 0.8214 | 0.8726 | 0.0071 | 0.9907 / 1.0000 |
| 202 | test | A1 | P-top-s1 | 8 | 128 | exploratory | 0.5982 | 0.4863 | 0.8726 | 0.2744 | 0.9688 / 1.0000 |
| 203 | test | A1 | P-top-s1 | 8 | 1536 | exploratory | 0.8726 | 0.8429 | 0.8726 | 0.0000 | 0.8307 / 0.8828 |
| 204 | test | A1 | P-top-s1 | 8 | 192 | exploratory | 0.6788 | 0.5815 | 0.8726 | 0.1938 | 0.9688 / 1.0000 |
| 205 | test | A1 | P-top-s1 | 8 | 256 | exploratory | 0.7129 | 0.6339 | 0.8726 | 0.1597 | 0.9648 / 1.0000 |
| 206 | test | A1 | P-top-s1 | 8 | 384 | exploratory | 0.7504 | 0.6762 | 0.8726 | 0.1222 | 0.9766 / 1.0000 |
| 207 | test | A1 | P-top-s1 | 8 | 512 | exploratory | 0.7679 | 0.7048 | 0.8726 | 0.1048 | 0.9824 / 1.0000 |
| 208 | test | A1 | P-top-s1 | 8 | 768 | exploratory | 0.8056 | 0.7524 | 0.8726 | 0.0671 | 0.9870 / 1.0000 |
| 209 | test | A3--bge-m3 | P-top-s1 | 0 | 1024 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.6904 / 0.8157 |
| 210 | test | A3--bge-m3 | P-top-s1 | 0 | 128 | exploratory | 0.7992 | 0.7452 | 0.9865 | 0.1873 | 0.9688 / 1.0000 |
| 211 | test | A3--bge-m3 | P-top-s1 | 0 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.4603 / 0.5438 |
| 212 | test | A3--bge-m3 | P-top-s1 | 0 | 192 | exploratory | 0.8468 | 0.7952 | 0.9865 | 0.1397 | 0.9792 / 1.0000 |
| 213 | test | A3--bge-m3 | P-top-s1 | 0 | 256 | exploratory | 0.9194 | 0.8833 | 0.9865 | 0.0671 | 0.9883 / 1.0000 |
| 214 | test | A3--bge-m3 | P-top-s1 | 0 | 384 | exploratory | 0.9444 | 0.9286 | 0.9865 | 0.0421 | 0.9922 / 1.0000 |
| 215 | test | A3--bge-m3 | P-top-s1 | 0 | 512 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9922 / 1.0000 |
| 216 | test | A3--bge-m3 | P-top-s1 | 0 | 768 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.9206 / 0.9979 |
| 217 | test | A3--bge-m3 | P-top-s1 | 8 | 1024 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9785 / 0.9974 |
| 218 | test | A3--bge-m3 | P-top-s1 | 8 | 128 | exploratory | 0.6952 | 0.5810 | 0.9865 | 0.2913 | 0.9453 / 1.0000 |
| 219 | test | A3--bge-m3 | P-top-s1 | 8 | 1536 | exploratory | 0.9865 | 0.9786 | 0.9865 | 0.0000 | 0.6589 / 0.7870 |
| 220 | test | A3--bge-m3 | P-top-s1 | 8 | 192 | exploratory | 0.8048 | 0.7429 | 0.9865 | 0.1817 | 0.9740 / 1.0000 |
| 221 | test | A3--bge-m3 | P-top-s1 | 8 | 256 | exploratory | 0.8385 | 0.7833 | 0.9865 | 0.1480 | 0.9668 / 1.0000 |
| 222 | test | A3--bge-m3 | P-top-s1 | 8 | 384 | exploratory | 0.9226 | 0.8929 | 0.9865 | 0.0639 | 0.9870 / 1.0000 |
| 223 | test | A3--bge-m3 | P-top-s1 | 8 | 512 | exploratory | 0.9325 | 0.9167 | 0.9865 | 0.0540 | 0.9834 / 1.0000 |
| 224 | test | A3--bge-m3 | P-top-s1 | 8 | 768 | exploratory | 0.9770 | 0.9690 | 0.9865 | 0.0095 | 0.9870 / 0.9992 |
| 225 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 1024 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.8779 / 0.9482 |
| 226 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 128 | exploratory | 0.7766 | 0.6952 | 0.9778 | 0.2012 | 0.9609 / 1.0000 |
| 227 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.5853 / 0.6322 |
| 228 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 192 | exploratory | 0.8687 | 0.8071 | 0.9778 | 0.1091 | 0.9792 / 1.0000 |
| 229 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 256 | exploratory | 0.8865 | 0.8429 | 0.9778 | 0.0913 | 0.9883 / 1.0000 |
| 230 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 384 | exploratory | 0.9381 | 0.9190 | 0.9778 | 0.0397 | 0.9909 / 1.0000 |
| 231 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 512 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9922 / 1.0000 |
| 232 | test | F-RRF10--openai-3-small | P-top-s1 | 0 | 768 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9909 / 1.0000 |
| 233 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 1024 | exploratory | 0.9683 | 0.9619 | 0.9778 | 0.0095 | 0.9912 / 0.9990 |
| 234 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 128 | exploratory | 0.6867 | 0.5649 | 0.9778 | 0.2911 | 0.9297 / 1.0000 |
| 235 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 1536 | exploratory | 0.9778 | 0.9714 | 0.9778 | 0.0000 | 0.8353 / 0.8822 |
| 236 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 192 | exploratory | 0.7885 | 0.7071 | 0.9778 | 0.1893 | 0.9688 / 1.0000 |
| 237 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 256 | exploratory | 0.8448 | 0.7833 | 0.9778 | 0.1329 | 0.9609 / 1.0000 |
| 238 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 384 | exploratory | 0.8865 | 0.8429 | 0.9778 | 0.0913 | 0.9870 / 1.0000 |
| 239 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 512 | exploratory | 0.9155 | 0.8857 | 0.9778 | 0.0623 | 0.9824 / 1.0000 |
| 240 | test | F-RRF10--openai-3-small | P-top-s1 | 8 | 768 | exploratory | 0.9643 | 0.9500 | 0.9778 | 0.0135 | 0.9915 / 1.0000 |

## Paired comparisons

Deltas and CIs are percentage points. Family counts are C1–C7; bootstrap status, accepted/rejected draws and McNemar discordants are explicit.

| Cell | Designation | Status | Delta | 95% CI | Families / C1–C7 | Accepted / rejected | Reason | McNemar baseline-only / candidate-only / p |
| ---: | --- | --- | ---: | --- | --- | --- | --- | --- |
| 1 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 2 | exploratory | ok | -15.9921 | -22.8932 / -9.2490 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 3 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 4 | exploratory | ok | -23.4127 | -30.0063 / -17.2422 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 0 / 0.0313 |
| 5 | exploratory | ok | -23.5516 | -30.2644 / -17.5453 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 0 / 0.0156 |
| 6 | exploratory | ok | -19.8611 | -27.1182 / -12.7961 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 1 / 0.1250 |
| 7 | exploratory | ok | -1.6865 | -7.1736 / 3.4584 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 1 / 1.0000 |
| 8 | exploratory | ok | -0.1984 | -3.2967 / 2.2222 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 9 | exploratory | ok | 2.8968 | -0.3735 / 6.9841 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 10 | exploratory | ok | -11.6270 | -19.1767 / -3.7076 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 11 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 12 | exploratory | ok | -16.3889 | -23.0234 / -9.8057 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 13 | exploratory | ok | -21.8651 | -28.9928 / -14.8778 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 1 / 0.1250 |
| 14 | exploratory | ok | -24.1071 | -31.2516 / -17.7825 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 15 | exploratory | ok | -21.9246 | -29.4344 / -15.0397 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 16 | exploratory | ok | 0.0000 | -4.8341 / 4.7884 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 17 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 18 | exploratory | ok | -19.8611 | -28.6528 / -11.5807 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 19 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 20 | exploratory | ok | -25.6151 | -33.6199 / -17.7947 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 2 / 0.1094 |
| 21 | exploratory | ok | -29.1071 | -37.2653 / -21.6046 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 1 / 0.0215 |
| 22 | exploratory | ok | -5.8929 | -12.1154 / 0.1266 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 1 / 1.0000 |
| 23 | confirmatory | ok | -2.4603 | -6.6138 / 1.4960 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 24 | exploratory | ok | 0.9524 | 0.0000 / 3.1746 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 25 | exploratory | ok | 0.0000 | -2.8571 / 2.6786 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 26 | exploratory | ok | -17.3611 | -25.6445 / -9.3245 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 27 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 28 | exploratory | ok | -21.0516 | -29.1932 / -13.3690 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 29 | exploratory | ok | -25.0198 | -32.5044 / -17.7222 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 30 | exploratory | ok | -29.4246 | -37.4800 / -21.9682 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 1 / 0.0215 |
| 31 | exploratory | ok | -14.0476 | -23.3536 / -5.3139 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 32 | exploratory | ok | -2.4603 | -6.6138 / 1.4960 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 33 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 34 | exploratory | ok | -21.3095 | -30.2122 / -12.5658 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 35 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 36 | exploratory | ok | -27.6786 | -37.1045 / -18.6440 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 37 | exploratory | ok | -29.2659 | -37.9394 / -21.0535 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 0 / 0.0039 |
| 38 | exploratory | ok | -27.9167 | -36.8299 / -19.8206 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 39 | exploratory | ok | -4.3452 | -8.3333 / -0.8929 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 2 / 0 / 0.5000 |
| 40 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 41 | exploratory | ok | -0.9524 | -3.2967 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 42 | exploratory | ok | -17.5397 | -25.1053 / -10.3099 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 43 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 44 | exploratory | ok | -21.3095 | -30.2122 / -12.5658 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 45 | exploratory | ok | -27.3214 | -36.8063 / -18.0392 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 46 | exploratory | ok | -29.6627 | -38.3818 / -21.2921 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 0 / 0.0039 |
| 47 | exploratory | ok | -31.4881 | -40.5657 / -22.7351 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 10 / 0 / 0.0020 |
| 48 | exploratory | ok | -3.4524 | -7.0696 / -0.3133 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 49 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 50 | exploratory | ok | -15.9921 | -22.8932 / -9.2490 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 51 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 52 | exploratory | ok | -23.4127 | -30.0063 / -17.2422 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 0 / 0.0313 |
| 53 | exploratory | ok | -23.5516 | -30.2644 / -17.5453 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 0 / 0.0156 |
| 54 | exploratory | ok | -19.8611 | -27.1182 / -12.7961 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 1 / 0.1250 |
| 55 | exploratory | ok | -0.8929 | -6.7608 / 4.2754 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 1 / 1.0000 |
| 56 | exploratory | ok | 0.9921 | 0.0000 / 2.3810 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 57 | exploratory | ok | 3.3730 | 0.4326 / 7.2495 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 58 | exploratory | ok | -11.6270 | -19.1767 / -3.7076 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 59 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 60 | exploratory | ok | -16.3889 | -23.0234 / -9.8057 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 61 | exploratory | ok | -21.8651 | -28.9928 / -14.8778 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 1 / 0.1250 |
| 62 | exploratory | ok | -24.1071 | -31.2516 / -17.7825 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 63 | exploratory | ok | -20.9722 | -27.7069 / -14.5360 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 6 / 1 / 0.1250 |
| 64 | exploratory | ok | 1.9048 | -2.4802 / 6.3168 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 65 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 66 | exploratory | ok | -19.8611 | -28.6528 / -11.5807 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 67 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 68 | exploratory | ok | -25.6151 | -33.6199 / -17.7947 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 2 / 0.1094 |
| 69 | exploratory | ok | -28.7103 | -36.8073 / -21.2754 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 1 / 0.0215 |
| 70 | exploratory | ok | -4.7024 | -10.5651 / 0.9849 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 1 / 1.0000 |
| 71 | exploratory | ok | -1.5079 | -5.3571 / 2.1978 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 72 | exploratory | ok | 0.9524 | 0.0000 / 3.1746 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 73 | exploratory | ok | 0.9524 | 0.0000 / 3.1746 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 74 | exploratory | ok | -17.3611 | -25.6445 / -9.3245 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 75 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 76 | exploratory | ok | -21.0516 | -29.1932 / -13.3690 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 77 | exploratory | ok | -25.0198 | -32.5044 / -17.7222 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 1 / 0.0391 |
| 78 | exploratory | ok | -29.4246 | -37.4800 / -21.9682 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 1 / 0.0215 |
| 79 | exploratory | ok | -12.9762 | -22.5148 / -3.9477 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 5 / 1 / 0.2188 |
| 80 | exploratory | ok | -0.5556 | -4.0660 / 2.7381 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 81 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 82 | exploratory | ok | -21.3095 | -30.2122 / -12.5658 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 83 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 84 | exploratory | ok | -27.6786 | -37.1045 / -18.6440 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 85 | exploratory | ok | -29.2659 | -37.9394 / -21.0535 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 0 / 0.0039 |
| 86 | exploratory | ok | -27.9167 | -36.8299 / -19.8206 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 87 | exploratory | ok | -2.5000 | -5.8533 / 0.2165 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 88 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 89 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 90 | exploratory | ok | -17.5397 | -25.1053 / -10.3099 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 91 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 92 | exploratory | ok | -21.3095 | -30.2122 / -12.5658 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 7 / 1 / 0.0703 |
| 93 | exploratory | ok | -27.3214 | -36.8063 / -18.0392 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 8 / 0 / 0.0078 |
| 94 | exploratory | ok | -29.6627 | -38.3818 / -21.2921 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 9 / 0 / 0.0039 |
| 95 | exploratory | ok | -31.4881 | -40.5657 / -22.7351 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 10 / 0 / 0.0020 |
| 96 | exploratory | ok | -2.5000 | -5.8533 / 0.2165 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 97 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 98 | exploratory | ok | -0.6746 | -3.1479 / 1.3839 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 99 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 100 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 101 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 102 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 103 | exploratory | ok | -1.1905 | -3.8961 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 104 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 105 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 106 | exploratory | ok | 0.8333 | -1.6879 / 3.8730 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 107 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 108 | exploratory | ok | -0.6746 | -3.1479 / 1.3839 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 1 / 0 / 1.0000 |
| 109 | exploratory | ok | 0.9524 | 0.0000 / 3.0612 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 110 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 111 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 112 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 113 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 114 | exploratory | ok | 0.9921 | 0.0000 / 2.3810 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 115 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 116 | exploratory | ok | 0.4762 | 0.0000 / 1.5873 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 117 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 118 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 119 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 120 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 121 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 122 | exploratory | ok | 0.1190 | -1.2605 / 1.6484 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 123 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 124 | exploratory | ok | 0.9921 | 0.0000 / 2.3810 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 125 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 126 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 127 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 128 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 129 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 130 | exploratory | ok | 1.1905 | 0.0000 / 2.9762 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 131 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 132 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 133 | exploratory | ok | 0.5952 | 0.0000 / 1.9481 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 134 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 135 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 136 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 137 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 138 | exploratory | ok | -0.4762 | -1.5873 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 139 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 140 | exploratory | ok | 1.1905 | 0.0000 / 2.9762 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 141 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 142 | exploratory | ok | 0.5952 | 0.0000 / 1.9481 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 143 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 144 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 193 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 194 | exploratory | ok | 2.6587 | 0.4329 / 5.6710 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 195 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 196 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 197 | exploratory | ok | 1.1905 | 0.0000 / 3.8961 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 198 | exploratory | ok | 2.0635 | 0.0000 / 4.9206 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 199 | exploratory | ok | 0.5952 | 0.0000 / 1.9481 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 200 | exploratory | ok | 1.4683 | 0.0000 / 3.7253 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 201 | exploratory | ok | 4.6429 | 1.1054 / 8.6709 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 202 | exploratory | ok | 1.2698 | 0.0000 / 3.5714 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 203 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 204 | exploratory | ok | 3.6111 | 0.8730 / 6.9975 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 205 | exploratory | ok | 1.5476 | 0.0000 / 3.9496 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 206 | exploratory | ok | 1.1905 | 0.0000 / 3.8961 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 207 | exploratory | ok | 0.4762 | 0.0000 / 1.5312 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 208 | exploratory | ok | 2.1825 | 0.0000 / 5.1948 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 209 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 210 | exploratory | ok | 4.0476 | 1.1905 / 7.7383 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 211 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 212 | exploratory | ok | 1.4683 | -0.8929 / 4.2868 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 2 / 0.5000 |
| 213 | exploratory | ok | 3.5714 | 0.0000 / 7.1429 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 214 | exploratory | ok | 1.1905 | 0.0000 / 3.8961 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 215 | exploratory | ok | 0.3968 | 0.0000 / 1.2987 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 216 | exploratory | ok | 0.9524 | 0.0000 / 3.1746 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 217 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 218 | exploratory | ok | 1.2698 | 0.0000 / 2.6688 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 219 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 220 | exploratory | ok | 4.6032 | 1.3357 / 8.5120 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 221 | exploratory | ok | 2.4206 | 0.4329 / 5.0681 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 222 | exploratory | ok | 3.8889 | 0.3663 / 7.8755 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 223 | exploratory | ok | 1.7857 | 0.0000 / 4.6898 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 224 | exploratory | ok | 0.3968 | 0.0000 / 1.2987 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 225 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 226 | exploratory | ok | 3.0357 | 0.7937 / 5.9871 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 227 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 228 | exploratory | ok | 2.3810 | 0.0000 / 5.9524 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 1 / 1.0000 |
| 229 | exploratory | ok | 0.9921 | 0.0000 / 2.5397 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 230 | exploratory | ok | 1.7857 | 0.0000 / 4.5918 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 231 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 232 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 233 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 234 | exploratory | ok | 0.9921 | 0.0000 / 2.5510 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 235 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 236 | exploratory | ok | 4.2262 | 1.2620 / 8.2098 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 2 / 0.5000 |
| 237 | exploratory | ok | 2.0238 | 0.0000 / 4.5835 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 238 | exploratory | ok | 0.9921 | 0.0000 / 2.5397 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 239 | exploratory | ok | 1.3492 | 0.0000 / 3.5897 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |
| 240 | exploratory | ok | 0.0000 | 0.0000 / 0.0000 | 29 / 12,16,15,12,12,15,12 | 10000 / 0 | — | 0 / 0 / 1.0000 |

## Category means and deltas

| Cell | Category | Queries | Groups | Coverage | All-required | Ceiling | Loss | Coverage delta vs P-top (pp) |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 1 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 1 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 1 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 1 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 1 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 1 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 2 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -16.6667 |
| 2 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 2 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | 6.6667 |
| 2 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 2 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -5.5556 |
| 2 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -25.5556 |
| 2 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 3 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 3 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 3 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 3 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 3 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 3 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 3 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 4 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 4 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 4 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | -13.3333 |
| 4 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 4 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -23.6111 |
| 4 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -31.1111 |
| 4 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 5 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 5 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 5 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | -13.3333 |
| 5 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 5 | C5 | 12 | 30 | 0.5417 | 0.2500 | 0.9306 | 0.3889 | -19.4444 |
| 5 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9111 | 0.4778 | -30.0000 |
| 5 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 6 | C1 | 12 | 12 | 0.6667 | 0.6667 | 0.9167 | 0.2500 | -16.6667 |
| 6 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 6 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | -13.3333 |
| 6 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 6 | C5 | 12 | 30 | 0.6944 | 0.3333 | 0.9306 | 0.2361 | -4.1667 |
| 6 | C6 | 15 | 37 | 0.4778 | 0.0667 | 0.9111 | 0.4333 | -27.7778 |
| 6 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 7 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 8.3333 |
| 7 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | -6.2500 |
| 7 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | -6.6667 |
| 7 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | -16.6667 |
| 7 | C5 | 12 | 30 | 0.9028 | 0.7500 | 0.9306 | 0.0278 | 13.8889 |
| 7 | C6 | 15 | 37 | 0.7444 | 0.5333 | 0.9111 | 0.1667 | -4.4444 |
| 7 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 8 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 8 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 8 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 8 | C4 | 12 | 12 | 0.6667 | 0.6667 | 0.7500 | 0.0833 | -8.3333 |
| 8 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 6.9444 |
| 8 | C6 | 15 | 37 | 0.8556 | 0.6667 | 0.9111 | 0.0556 | 0.0000 |
| 8 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 9 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 8.3333 |
| 9 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 9 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 9 | C4 | 12 | 12 | 0.6667 | 0.6667 | 0.7500 | 0.0833 | 8.3333 |
| 9 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 6.9444 |
| 9 | C6 | 15 | 37 | 0.8222 | 0.6667 | 0.9111 | 0.0889 | -3.3333 |
| 9 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 10 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -16.6667 |
| 10 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 10 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | 6.6667 |
| 10 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 8.3333 |
| 10 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | 5.5556 |
| 10 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -14.4444 |
| 10 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 11 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 11 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 11 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 11 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 11 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 11 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 11 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 12 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -16.6667 |
| 12 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 12 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | 6.6667 |
| 12 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 12 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -8.3333 |
| 12 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -25.5556 |
| 12 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 13 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 13 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 13 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | -6.6667 |
| 13 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 13 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -19.4444 |
| 13 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -31.1111 |
| 13 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 14 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 14 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 14 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | -20.0000 |
| 14 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 14 | C5 | 12 | 30 | 0.5694 | 0.2500 | 0.9306 | 0.3611 | -16.6667 |
| 14 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9111 | 0.4778 | -30.0000 |
| 14 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 15 | C1 | 12 | 12 | 0.6667 | 0.6667 | 0.9167 | 0.2500 | -16.6667 |
| 15 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 15 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | -20.0000 |
| 15 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 15 | C5 | 12 | 30 | 0.6389 | 0.2500 | 0.9306 | 0.2917 | -9.7222 |
| 15 | C6 | 15 | 37 | 0.4556 | 0.0000 | 0.9111 | 0.4556 | -30.0000 |
| 15 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 16 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 8.3333 |
| 16 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 16 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | -6.6667 |
| 16 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | -8.3333 |
| 16 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9306 | 0.0556 | 11.1111 |
| 16 | C6 | 15 | 37 | 0.7444 | 0.5333 | 0.9111 | 0.1667 | -4.4444 |
| 16 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 17 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 17 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 17 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 17 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 17 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 17 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 17 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 18 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 18 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 18 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -6.6667 |
| 18 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -8.3333 |
| 18 | C5 | 12 | 30 | 0.6250 | 0.2500 | 0.9722 | 0.3472 | 6.9444 |
| 18 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -28.8889 |
| 18 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 19 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 19 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 19 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 19 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 19 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 19 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 19 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 20 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 20 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 20 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -13.3333 |
| 20 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 20 | C5 | 12 | 30 | 0.6528 | 0.2500 | 0.9722 | 0.3194 | -11.1111 |
| 20 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -44.4444 |
| 20 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 21 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 21 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 21 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | -20.0000 |
| 21 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 21 | C5 | 12 | 30 | 0.6806 | 0.2500 | 0.9722 | 0.2917 | -19.4444 |
| 21 | C6 | 15 | 37 | 0.5222 | 0.0000 | 1.0000 | 0.4778 | -45.5556 |
| 21 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 22 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 8.3333 |
| 22 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | -6.2500 |
| 22 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 22 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -25.0000 |
| 22 | C5 | 12 | 30 | 0.9167 | 0.7500 | 0.9722 | 0.0556 | -2.7778 |
| 22 | C6 | 15 | 37 | 0.8444 | 0.6000 | 1.0000 | 0.1556 | -15.5556 |
| 22 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 23 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 23 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 23 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | -20.0000 |
| 23 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 23 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 2.7778 |
| 23 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 23 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 24 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 24 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 24 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 6.6667 |
| 24 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 24 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 24 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 24 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 25 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 25 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 25 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 25 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 25 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 25 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 25 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 26 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 26 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 26 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -6.6667 |
| 26 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | 0.0000 |
| 26 | C5 | 12 | 30 | 0.5000 | 0.1667 | 0.9722 | 0.4722 | 8.3333 |
| 26 | C6 | 15 | 37 | 0.4333 | 0.0000 | 1.0000 | 0.5667 | -21.1111 |
| 26 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 27 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 27 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 27 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 27 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 27 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 27 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 27 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 28 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 28 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 28 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -6.6667 |
| 28 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | -16.6667 |
| 28 | C5 | 12 | 30 | 0.6250 | 0.2500 | 0.9722 | 0.3472 | 6.9444 |
| 28 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -28.8889 |
| 28 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 29 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 29 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 29 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -13.3333 |
| 29 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 29 | C5 | 12 | 30 | 0.6528 | 0.2500 | 0.9722 | 0.3194 | -4.1667 |
| 29 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -38.8889 |
| 29 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 30 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 30 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 30 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | -20.0000 |
| 30 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 30 | C5 | 12 | 30 | 0.6806 | 0.2500 | 0.9722 | 0.2917 | -19.4444 |
| 30 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -47.7778 |
| 30 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 31 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -16.6667 |
| 31 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -12.5000 |
| 31 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.9333 | 0.3333 | -6.6667 |
| 31 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -16.6667 |
| 31 | C5 | 12 | 30 | 0.8056 | 0.5000 | 0.9722 | 0.1667 | -9.7222 |
| 31 | C6 | 15 | 37 | 0.7222 | 0.4000 | 1.0000 | 0.2778 | -27.7778 |
| 31 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 32 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 32 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 32 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | -20.0000 |
| 32 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 32 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 2.7778 |
| 32 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 32 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 33 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 33 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 33 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 33 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 33 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 33 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 33 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 34 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 34 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 34 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.8667 | 0.5333 | -13.3333 |
| 34 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -25.0000 |
| 34 | C5 | 12 | 30 | 0.6528 | 0.2500 | 1.0000 | 0.3472 | 11.1111 |
| 34 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9778 | 0.5444 | -34.4444 |
| 34 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 35 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 35 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 35 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 35 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 35 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 35 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 35 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 36 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 36 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 36 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -20.0000 |
| 36 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | -25.0000 |
| 36 | C5 | 12 | 30 | 0.6806 | 0.2500 | 1.0000 | 0.3194 | -5.5556 |
| 36 | C6 | 15 | 37 | 0.5000 | 0.0000 | 0.9778 | 0.4778 | -41.1111 |
| 36 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 37 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 37 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 37 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -20.0000 |
| 37 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 37 | C5 | 12 | 30 | 0.7083 | 0.2500 | 1.0000 | 0.2917 | -8.3333 |
| 37 | C6 | 15 | 37 | 0.5000 | 0.0000 | 0.9778 | 0.4778 | -41.1111 |
| 37 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 38 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 38 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 38 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | -20.0000 |
| 38 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -8.3333 |
| 38 | C5 | 12 | 30 | 0.7639 | 0.4167 | 1.0000 | 0.2361 | -16.6667 |
| 38 | C6 | 15 | 37 | 0.5444 | 0.0667 | 0.9778 | 0.4333 | -40.0000 |
| 38 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 39 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 39 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | -6.2500 |
| 39 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | -20.0000 |
| 39 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 39 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | -4.1667 |
| 39 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 39 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 40 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 40 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 40 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 40 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 40 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 40 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 40 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 41 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 41 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 41 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | -6.6667 |
| 41 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 41 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 41 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 41 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 42 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 42 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 42 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.8667 | 0.5333 | -6.6667 |
| 42 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | -16.6667 |
| 42 | C5 | 12 | 30 | 0.5139 | 0.1667 | 1.0000 | 0.4861 | 6.9444 |
| 42 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9778 | 0.5444 | -18.8889 |
| 42 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 43 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 43 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 43 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 43 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 43 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 43 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 43 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 44 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 44 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 44 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.8667 | 0.5333 | -13.3333 |
| 44 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -25.0000 |
| 44 | C5 | 12 | 30 | 0.6528 | 0.2500 | 1.0000 | 0.3472 | 11.1111 |
| 44 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9778 | 0.5444 | -34.4444 |
| 44 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 45 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 45 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 45 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -13.3333 |
| 45 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -33.3333 |
| 45 | C5 | 12 | 30 | 0.6806 | 0.2500 | 1.0000 | 0.3194 | -1.3889 |
| 45 | C6 | 15 | 37 | 0.4667 | 0.0000 | 0.9778 | 0.5111 | -41.1111 |
| 45 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 46 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 46 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 46 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -20.0000 |
| 46 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 46 | C5 | 12 | 30 | 0.6806 | 0.2500 | 1.0000 | 0.3194 | -11.1111 |
| 46 | C6 | 15 | 37 | 0.5000 | 0.0000 | 0.9778 | 0.4778 | -41.1111 |
| 46 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 47 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 47 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 47 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -26.6667 |
| 47 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 47 | C5 | 12 | 30 | 0.7083 | 0.2500 | 1.0000 | 0.2917 | -19.4444 |
| 47 | C6 | 15 | 37 | 0.5222 | 0.0000 | 0.9778 | 0.4556 | -38.8889 |
| 47 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 48 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 48 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 48 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | -20.0000 |
| 48 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 48 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | -4.1667 |
| 48 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 48 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 49 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 49 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 49 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 49 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 49 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 49 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 49 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 50 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -16.6667 |
| 50 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 50 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | 6.6667 |
| 50 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 50 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -5.5556 |
| 50 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -25.5556 |
| 50 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 51 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 51 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 51 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 51 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 51 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 51 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 51 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 52 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 52 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 52 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | -13.3333 |
| 52 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 52 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -23.6111 |
| 52 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -31.1111 |
| 52 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 53 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 53 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 53 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | -13.3333 |
| 53 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 53 | C5 | 12 | 30 | 0.5417 | 0.2500 | 0.9306 | 0.3889 | -19.4444 |
| 53 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9111 | 0.4778 | -30.0000 |
| 53 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 54 | C1 | 12 | 12 | 0.6667 | 0.6667 | 0.9167 | 0.2500 | -16.6667 |
| 54 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 54 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | -13.3333 |
| 54 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 54 | C5 | 12 | 30 | 0.6944 | 0.3333 | 0.9306 | 0.2361 | -4.1667 |
| 54 | C6 | 15 | 37 | 0.4778 | 0.0667 | 0.9111 | 0.4333 | -27.7778 |
| 54 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 55 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 8.3333 |
| 55 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | -6.2500 |
| 55 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | -6.6667 |
| 55 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | -8.3333 |
| 55 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9306 | 0.0556 | 11.1111 |
| 55 | C6 | 15 | 37 | 0.7444 | 0.5333 | 0.9111 | 0.1667 | -4.4444 |
| 55 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 56 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 56 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 56 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 56 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 56 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 6.9444 |
| 56 | C6 | 15 | 37 | 0.8556 | 0.6667 | 0.9111 | 0.0556 | 0.0000 |
| 56 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 57 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 8.3333 |
| 57 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 57 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 57 | C4 | 12 | 12 | 0.6667 | 0.6667 | 0.7500 | 0.0833 | 8.3333 |
| 57 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 6.9444 |
| 57 | C6 | 15 | 37 | 0.8556 | 0.6667 | 0.9111 | 0.0556 | 0.0000 |
| 57 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 58 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -16.6667 |
| 58 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 58 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | 6.6667 |
| 58 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 8.3333 |
| 58 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | 5.5556 |
| 58 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -14.4444 |
| 58 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 59 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 59 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 59 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 59 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 59 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 59 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 59 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 60 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -16.6667 |
| 60 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 60 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | 6.6667 |
| 60 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 60 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -8.3333 |
| 60 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -25.5556 |
| 60 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 61 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 61 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 61 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | -6.6667 |
| 61 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 61 | C5 | 12 | 30 | 0.4722 | 0.1667 | 0.9306 | 0.4583 | -19.4444 |
| 61 | C6 | 15 | 37 | 0.4000 | 0.0000 | 0.9111 | 0.5111 | -31.1111 |
| 61 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 62 | C1 | 12 | 12 | 0.5833 | 0.5833 | 0.9167 | 0.3333 | -25.0000 |
| 62 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 62 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | -20.0000 |
| 62 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 62 | C5 | 12 | 30 | 0.5694 | 0.2500 | 0.9306 | 0.3611 | -16.6667 |
| 62 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9111 | 0.4778 | -30.0000 |
| 62 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 63 | C1 | 12 | 12 | 0.6667 | 0.6667 | 0.9167 | 0.2500 | -16.6667 |
| 63 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 63 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | -13.3333 |
| 63 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 63 | C5 | 12 | 30 | 0.6389 | 0.2500 | 0.9306 | 0.2917 | -9.7222 |
| 63 | C6 | 15 | 37 | 0.4556 | 0.0000 | 0.9111 | 0.4556 | -30.0000 |
| 63 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 64 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 8.3333 |
| 64 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 64 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | -6.6667 |
| 64 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | 0.0000 |
| 64 | C5 | 12 | 30 | 0.9028 | 0.7500 | 0.9306 | 0.0278 | 13.8889 |
| 64 | C6 | 15 | 37 | 0.7667 | 0.5333 | 0.9111 | 0.1444 | -2.2222 |
| 64 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 65 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 65 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 65 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 65 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 65 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 65 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 65 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 66 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 66 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 66 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -6.6667 |
| 66 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -8.3333 |
| 66 | C5 | 12 | 30 | 0.6250 | 0.2500 | 0.9722 | 0.3472 | 6.9444 |
| 66 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -28.8889 |
| 66 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 67 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 67 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 67 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 67 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 67 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 67 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 67 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 68 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 68 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 68 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -13.3333 |
| 68 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 68 | C5 | 12 | 30 | 0.6528 | 0.2500 | 0.9722 | 0.3194 | -11.1111 |
| 68 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -44.4444 |
| 68 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 69 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 69 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 69 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | -20.0000 |
| 69 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 69 | C5 | 12 | 30 | 0.7083 | 0.2500 | 0.9722 | 0.2639 | -16.6667 |
| 69 | C6 | 15 | 37 | 0.5222 | 0.0000 | 1.0000 | 0.4778 | -45.5556 |
| 69 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 70 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 8.3333 |
| 70 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | -6.2500 |
| 70 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 70 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | -16.6667 |
| 70 | C5 | 12 | 30 | 0.9167 | 0.7500 | 0.9722 | 0.0556 | -2.7778 |
| 70 | C6 | 15 | 37 | 0.8444 | 0.6000 | 1.0000 | 0.1556 | -15.5556 |
| 70 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 71 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 71 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 71 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.9333 | 0.2000 | -13.3333 |
| 71 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 71 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 2.7778 |
| 71 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 71 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 72 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 72 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 72 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 6.6667 |
| 72 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 72 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 72 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 72 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 73 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 73 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 73 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 6.6667 |
| 73 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 73 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 73 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 73 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 74 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 74 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 74 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -6.6667 |
| 74 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | 0.0000 |
| 74 | C5 | 12 | 30 | 0.5000 | 0.1667 | 0.9722 | 0.4722 | 8.3333 |
| 74 | C6 | 15 | 37 | 0.4333 | 0.0000 | 1.0000 | 0.5667 | -21.1111 |
| 74 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 75 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 75 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 75 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 75 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 75 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 75 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 75 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 76 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 76 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 76 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -6.6667 |
| 76 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | -16.6667 |
| 76 | C5 | 12 | 30 | 0.6250 | 0.2500 | 0.9722 | 0.3472 | 6.9444 |
| 76 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -28.8889 |
| 76 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 77 | C1 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 77 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 77 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.9333 | 0.5333 | -13.3333 |
| 77 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 77 | C5 | 12 | 30 | 0.6528 | 0.2500 | 0.9722 | 0.3194 | -4.1667 |
| 77 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -38.8889 |
| 77 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 78 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 78 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 78 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | -20.0000 |
| 78 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -16.6667 |
| 78 | C5 | 12 | 30 | 0.6806 | 0.2500 | 0.9722 | 0.2917 | -19.4444 |
| 78 | C6 | 15 | 37 | 0.5000 | 0.0000 | 1.0000 | 0.5000 | -47.7778 |
| 78 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 79 | C1 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -16.6667 |
| 79 | C2 | 16 | 16 | 0.8750 | 0.8750 | 1.0000 | 0.1250 | -12.5000 |
| 79 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.9333 | 0.3333 | -6.6667 |
| 79 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -16.6667 |
| 79 | C5 | 12 | 30 | 0.8472 | 0.5833 | 0.9722 | 0.1250 | -5.5556 |
| 79 | C6 | 15 | 37 | 0.7556 | 0.4667 | 1.0000 | 0.2444 | -24.4444 |
| 79 | C7 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | -8.3333 |
| 80 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 80 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 80 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.9333 | 0.1333 | -6.6667 |
| 80 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 80 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 2.7778 |
| 80 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 80 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 81 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 81 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 81 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 81 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 81 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 81 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 81 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 82 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 82 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 82 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.8667 | 0.5333 | -13.3333 |
| 82 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -25.0000 |
| 82 | C5 | 12 | 30 | 0.6528 | 0.2500 | 1.0000 | 0.3472 | 11.1111 |
| 82 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9778 | 0.5444 | -34.4444 |
| 82 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 83 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 83 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 83 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 83 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 83 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 83 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 83 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 84 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 84 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 84 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -20.0000 |
| 84 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | -25.0000 |
| 84 | C5 | 12 | 30 | 0.6806 | 0.2500 | 1.0000 | 0.3194 | -5.5556 |
| 84 | C6 | 15 | 37 | 0.5000 | 0.0000 | 0.9778 | 0.4778 | -41.1111 |
| 84 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 85 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 85 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 85 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -20.0000 |
| 85 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 85 | C5 | 12 | 30 | 0.7083 | 0.2500 | 1.0000 | 0.2917 | -8.3333 |
| 85 | C6 | 15 | 37 | 0.5000 | 0.0000 | 0.9778 | 0.4778 | -41.1111 |
| 85 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 86 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 86 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 86 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | -20.0000 |
| 86 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | -8.3333 |
| 86 | C5 | 12 | 30 | 0.7639 | 0.4167 | 1.0000 | 0.2361 | -16.6667 |
| 86 | C6 | 15 | 37 | 0.5444 | 0.0667 | 0.9778 | 0.4333 | -40.0000 |
| 86 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 87 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 87 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 87 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.8667 | 0.2000 | -13.3333 |
| 87 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 87 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | -4.1667 |
| 87 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 87 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 88 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 88 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 88 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 88 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 88 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 88 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 88 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 89 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 89 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 89 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 89 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 89 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 89 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 89 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 90 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 90 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 90 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.8667 | 0.5333 | -6.6667 |
| 90 | C4 | 12 | 12 | 0.3333 | 0.3333 | 1.0000 | 0.6667 | -16.6667 |
| 90 | C5 | 12 | 30 | 0.5139 | 0.1667 | 1.0000 | 0.4861 | 6.9444 |
| 90 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9778 | 0.5444 | -18.8889 |
| 90 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 91 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 91 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 91 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 91 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 91 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 91 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 91 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 92 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -16.6667 |
| 92 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -37.5000 |
| 92 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.8667 | 0.5333 | -13.3333 |
| 92 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -25.0000 |
| 92 | C5 | 12 | 30 | 0.6528 | 0.2500 | 1.0000 | 0.3472 | 11.1111 |
| 92 | C6 | 15 | 37 | 0.4333 | 0.0000 | 0.9778 | 0.5444 | -34.4444 |
| 92 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 93 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -25.0000 |
| 93 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 93 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -13.3333 |
| 93 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | -33.3333 |
| 93 | C5 | 12 | 30 | 0.6806 | 0.2500 | 1.0000 | 0.3194 | -1.3889 |
| 93 | C6 | 15 | 37 | 0.4667 | 0.0000 | 0.9778 | 0.5111 | -41.1111 |
| 93 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 94 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 94 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 94 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -20.0000 |
| 94 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 94 | C5 | 12 | 30 | 0.6806 | 0.2500 | 1.0000 | 0.3194 | -11.1111 |
| 94 | C6 | 15 | 37 | 0.5000 | 0.0000 | 0.9778 | 0.4778 | -41.1111 |
| 94 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 95 | C1 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 95 | C2 | 16 | 16 | 0.5625 | 0.5625 | 1.0000 | 0.4375 | -43.7500 |
| 95 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | -26.6667 |
| 95 | C4 | 12 | 12 | 0.5833 | 0.5833 | 1.0000 | 0.4167 | -25.0000 |
| 95 | C5 | 12 | 30 | 0.7083 | 0.2500 | 1.0000 | 0.2917 | -19.4444 |
| 95 | C6 | 15 | 37 | 0.5222 | 0.0000 | 0.9778 | 0.4556 | -38.8889 |
| 95 | C7 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | -33.3333 |
| 96 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 96 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 96 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.8667 | 0.2000 | -13.3333 |
| 96 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 96 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | -4.1667 |
| 96 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 96 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 97 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 97 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 97 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 97 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 97 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 97 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 97 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 98 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | 0.0000 |
| 98 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 98 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | -6.6667 |
| 98 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 98 | C5 | 12 | 30 | 0.5694 | 0.1667 | 0.9306 | 0.3611 | 4.1667 |
| 98 | C6 | 15 | 37 | 0.6333 | 0.3333 | 0.9111 | 0.2778 | -2.2222 |
| 98 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 99 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 99 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 99 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 99 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 99 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 99 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 99 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 100 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 100 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 100 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | 0.0000 |
| 100 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 100 | C5 | 12 | 30 | 0.7083 | 0.3333 | 0.9306 | 0.2222 | 0.0000 |
| 100 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | 0.0000 |
| 100 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 101 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 101 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 101 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | 0.0000 |
| 101 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 101 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 101 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | 0.0000 |
| 101 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 102 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 102 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 102 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 102 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 102 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 102 | C6 | 15 | 37 | 0.7556 | 0.6000 | 0.9111 | 0.1556 | 0.0000 |
| 102 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 103 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 103 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 103 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 103 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | -8.3333 |
| 103 | C5 | 12 | 30 | 0.7639 | 0.4167 | 0.9306 | 0.1667 | 0.0000 |
| 103 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | 0.0000 |
| 103 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 104 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 104 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 104 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 104 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 104 | C5 | 12 | 30 | 0.8611 | 0.6667 | 0.9306 | 0.0694 | 0.0000 |
| 104 | C6 | 15 | 37 | 0.8556 | 0.6667 | 0.9111 | 0.0556 | 0.0000 |
| 104 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 105 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 105 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 105 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 105 | C4 | 12 | 12 | 0.5833 | 0.5833 | 0.7500 | 0.1667 | 0.0000 |
| 105 | C5 | 12 | 30 | 0.8611 | 0.6667 | 0.9306 | 0.0694 | 0.0000 |
| 105 | C6 | 15 | 37 | 0.8556 | 0.6667 | 0.9111 | 0.0556 | 0.0000 |
| 105 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 106 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | 0.0000 |
| 106 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 106 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | 0.0000 |
| 106 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 8.3333 |
| 106 | C5 | 12 | 30 | 0.4583 | 0.0833 | 0.9306 | 0.4722 | 4.1667 |
| 106 | C6 | 15 | 37 | 0.4778 | 0.2000 | 0.9111 | 0.4333 | -6.6667 |
| 106 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 107 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 107 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 107 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 107 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 107 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 107 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 107 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 108 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | 0.0000 |
| 108 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 108 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | -6.6667 |
| 108 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 108 | C5 | 12 | 30 | 0.5972 | 0.1667 | 0.9306 | 0.3333 | 4.1667 |
| 108 | C6 | 15 | 37 | 0.6333 | 0.3333 | 0.9111 | 0.2778 | -2.2222 |
| 108 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 109 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 109 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 109 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | 6.6667 |
| 109 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 109 | C5 | 12 | 30 | 0.6667 | 0.2500 | 0.9306 | 0.2639 | 0.0000 |
| 109 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | 0.0000 |
| 109 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 110 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 110 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 110 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | 0.0000 |
| 110 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 110 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 110 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | 0.0000 |
| 110 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 111 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 111 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 111 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 111 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 111 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 111 | C6 | 15 | 37 | 0.7556 | 0.6000 | 0.9111 | 0.1556 | 0.0000 |
| 111 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 112 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 112 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 112 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 112 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | 0.0000 |
| 112 | C5 | 12 | 30 | 0.7639 | 0.4167 | 0.9306 | 0.1667 | 0.0000 |
| 112 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | 0.0000 |
| 112 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 113 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 113 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 113 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 114 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 114 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 114 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 114 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 114 | C5 | 12 | 30 | 0.6250 | 0.2500 | 0.9722 | 0.3472 | 6.9444 |
| 114 | C6 | 15 | 37 | 0.7889 | 0.6000 | 1.0000 | 0.2111 | 0.0000 |
| 114 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 115 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 115 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 115 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 116 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 116 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 116 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | 0.0000 |
| 116 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 116 | C5 | 12 | 30 | 0.7639 | 0.5000 | 0.9722 | 0.2083 | 0.0000 |
| 116 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | 3.3333 |
| 116 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 117 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 117 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 117 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 117 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 117 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | 0.0000 |
| 117 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | 0.0000 |
| 117 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 118 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 118 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 118 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 118 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 118 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | 0.0000 |
| 118 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 118 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 119 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 119 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 119 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 119 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 119 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | 0.0000 |
| 119 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 119 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 120 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 120 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 120 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 121 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 121 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 121 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 121 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 121 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 121 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 121 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 122 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 122 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 122 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 122 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | 0.0000 |
| 122 | C5 | 12 | 30 | 0.4583 | 0.0833 | 0.9722 | 0.5139 | 4.1667 |
| 122 | C6 | 15 | 37 | 0.6111 | 0.2000 | 1.0000 | 0.3889 | -3.3333 |
| 122 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 123 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 123 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 123 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 123 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 123 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 123 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 123 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 124 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 124 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 124 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 124 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 124 | C5 | 12 | 30 | 0.6250 | 0.2500 | 0.9722 | 0.3472 | 6.9444 |
| 124 | C6 | 15 | 37 | 0.7889 | 0.6000 | 1.0000 | 0.2111 | 0.0000 |
| 124 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 125 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 125 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 125 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | 0.0000 |
| 125 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 125 | C5 | 12 | 30 | 0.6944 | 0.4167 | 0.9722 | 0.2778 | 0.0000 |
| 125 | C6 | 15 | 37 | 0.8889 | 0.7333 | 1.0000 | 0.1111 | 0.0000 |
| 125 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 126 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 126 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 126 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 126 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 126 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | 0.0000 |
| 126 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | 0.0000 |
| 126 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 127 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 127 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 127 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 127 | C4 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 127 | C5 | 12 | 30 | 0.9028 | 0.7500 | 0.9722 | 0.0694 | 0.0000 |
| 127 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 127 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 128 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 128 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 128 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 128 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 128 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | 0.0000 |
| 128 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 128 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 129 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 129 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 129 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 129 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 129 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 129 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 129 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 130 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 130 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 130 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | 0.0000 |
| 130 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 130 | C5 | 12 | 30 | 0.6250 | 0.2500 | 1.0000 | 0.3750 | 8.3333 |
| 130 | C6 | 15 | 37 | 0.7778 | 0.6000 | 0.9778 | 0.2000 | 0.0000 |
| 130 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 131 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 131 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 131 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 131 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 131 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 131 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 131 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 132 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 132 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 132 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 0.0000 |
| 132 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 132 | C5 | 12 | 30 | 0.7361 | 0.4167 | 1.0000 | 0.2639 | 0.0000 |
| 132 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 132 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 133 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 133 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 133 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 0.0000 |
| 133 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 133 | C5 | 12 | 30 | 0.8333 | 0.5833 | 1.0000 | 0.1667 | 4.1667 |
| 133 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 133 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 134 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 134 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 134 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | 0.0000 |
| 134 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 134 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | 0.0000 |
| 134 | C6 | 15 | 37 | 0.9444 | 0.8667 | 0.9778 | 0.0333 | 0.0000 |
| 134 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 135 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 135 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 135 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 135 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 135 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | 0.0000 |
| 135 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 135 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 136 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 136 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 136 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 136 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 136 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 136 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 136 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 137 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 137 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 137 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 137 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 137 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 137 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 137 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 138 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 138 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 138 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | 0.0000 |
| 138 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | 0.0000 |
| 138 | C5 | 12 | 30 | 0.4444 | 0.0000 | 1.0000 | 0.5556 | 0.0000 |
| 138 | C6 | 15 | 37 | 0.5889 | 0.2000 | 0.9778 | 0.3889 | -3.3333 |
| 138 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 139 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 139 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 139 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 139 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 139 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 139 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 139 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 140 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 140 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 140 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | 0.0000 |
| 140 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 140 | C5 | 12 | 30 | 0.6250 | 0.2500 | 1.0000 | 0.3750 | 8.3333 |
| 140 | C6 | 15 | 37 | 0.7778 | 0.6000 | 0.9778 | 0.2000 | 0.0000 |
| 140 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 141 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 141 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 141 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | 0.0000 |
| 141 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 141 | C5 | 12 | 30 | 0.6944 | 0.3333 | 1.0000 | 0.3056 | 0.0000 |
| 141 | C6 | 15 | 37 | 0.8778 | 0.8000 | 0.9778 | 0.1000 | 0.0000 |
| 141 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 142 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 142 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 142 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 0.0000 |
| 142 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 142 | C5 | 12 | 30 | 0.8333 | 0.5833 | 1.0000 | 0.1667 | 4.1667 |
| 142 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 142 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 143 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 143 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 143 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.8667 | 0.2000 | 0.0000 |
| 143 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 143 | C5 | 12 | 30 | 0.9028 | 0.7500 | 1.0000 | 0.0972 | 0.0000 |
| 143 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 143 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 144 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 144 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 144 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 144 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 144 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | 0.0000 |
| 144 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 144 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 145 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | — |
| 145 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 145 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 145 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | — |
| 145 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | — |
| 145 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | — |
| 145 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 146 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 146 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 146 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | — |
| 146 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 146 | C5 | 12 | 30 | 0.5278 | 0.0833 | 0.9306 | 0.4028 | — |
| 146 | C6 | 15 | 37 | 0.6556 | 0.4000 | 0.9111 | 0.2556 | — |
| 146 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 147 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | — |
| 147 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 147 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 147 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | — |
| 147 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | — |
| 147 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | — |
| 147 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 148 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 148 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 148 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | — |
| 148 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 148 | C5 | 12 | 30 | 0.7083 | 0.3333 | 0.9306 | 0.2222 | — |
| 148 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | — |
| 148 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 149 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 149 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 149 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | — |
| 149 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 149 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 149 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | — |
| 149 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 150 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 150 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 150 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 150 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | — |
| 150 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 150 | C6 | 15 | 37 | 0.7556 | 0.6000 | 0.9111 | 0.1556 | — |
| 150 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 151 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 151 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 151 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 151 | C4 | 12 | 12 | 0.5833 | 0.5833 | 0.7500 | 0.1667 | — |
| 151 | C5 | 12 | 30 | 0.7639 | 0.4167 | 0.9306 | 0.1667 | — |
| 151 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | — |
| 151 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 152 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | — |
| 152 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 152 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 152 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | — |
| 152 | C5 | 12 | 30 | 0.8611 | 0.6667 | 0.9306 | 0.0694 | — |
| 152 | C6 | 15 | 37 | 0.8556 | 0.6667 | 0.9111 | 0.0556 | — |
| 152 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 153 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 153 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 153 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 153 | C4 | 12 | 12 | 0.5833 | 0.5833 | 0.7500 | 0.1667 | — |
| 153 | C5 | 12 | 30 | 0.8611 | 0.6667 | 0.9306 | 0.0694 | — |
| 153 | C6 | 15 | 37 | 0.8556 | 0.6667 | 0.9111 | 0.0556 | — |
| 153 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 154 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 154 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 154 | C3 | 15 | 15 | 0.2000 | 0.2000 | 0.6000 | 0.4000 | — |
| 154 | C4 | 12 | 12 | 0.2500 | 0.2500 | 0.7500 | 0.5000 | — |
| 154 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9306 | 0.5139 | — |
| 154 | C6 | 15 | 37 | 0.5444 | 0.2000 | 0.9111 | 0.3667 | — |
| 154 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 155 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | — |
| 155 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 155 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 155 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | — |
| 155 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | — |
| 155 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | — |
| 155 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 156 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | — |
| 156 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 156 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | — |
| 156 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 156 | C5 | 12 | 30 | 0.5556 | 0.0833 | 0.9306 | 0.3750 | — |
| 156 | C6 | 15 | 37 | 0.6556 | 0.4000 | 0.9111 | 0.2556 | — |
| 156 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 157 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 157 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 157 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.6000 | 0.2000 | — |
| 157 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 157 | C5 | 12 | 30 | 0.6667 | 0.2500 | 0.9306 | 0.2639 | — |
| 157 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | — |
| 157 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 158 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 158 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 158 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | — |
| 158 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | — |
| 158 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 158 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | — |
| 158 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 159 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 159 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 159 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 159 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | — |
| 159 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | — |
| 159 | C6 | 15 | 37 | 0.7556 | 0.6000 | 0.9111 | 0.1556 | — |
| 159 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 160 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | — |
| 160 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 160 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | — |
| 160 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | — |
| 160 | C5 | 12 | 30 | 0.7639 | 0.4167 | 0.9306 | 0.1667 | — |
| 160 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | — |
| 160 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 161 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 161 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 161 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | — |
| 161 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 161 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | — |
| 161 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 161 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 162 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 162 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 162 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 162 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 162 | C5 | 12 | 30 | 0.5556 | 0.1667 | 0.9722 | 0.4167 | — |
| 162 | C6 | 15 | 37 | 0.7889 | 0.6000 | 1.0000 | 0.2111 | — |
| 162 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 163 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 163 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 163 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | — |
| 163 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 163 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | — |
| 163 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 163 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 164 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 164 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 164 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | — |
| 164 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 164 | C5 | 12 | 30 | 0.7639 | 0.5000 | 0.9722 | 0.2083 | — |
| 164 | C6 | 15 | 37 | 0.9444 | 0.8667 | 1.0000 | 0.0556 | — |
| 164 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 165 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 165 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 165 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 165 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 165 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | — |
| 165 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | — |
| 165 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 166 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 166 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 166 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 166 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 166 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | — |
| 166 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 166 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 167 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 167 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 167 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | — |
| 167 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 167 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | — |
| 167 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 167 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 168 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 168 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 168 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | — |
| 168 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 168 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | — |
| 168 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 168 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 169 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 169 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 169 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | — |
| 169 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 169 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | — |
| 169 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 169 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 170 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 170 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 170 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 170 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | — |
| 170 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9722 | 0.5556 | — |
| 170 | C6 | 15 | 37 | 0.6444 | 0.2000 | 1.0000 | 0.3556 | — |
| 170 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 171 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 171 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 171 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | — |
| 171 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 171 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | — |
| 171 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 171 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 172 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 172 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 172 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | — |
| 172 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 172 | C5 | 12 | 30 | 0.5556 | 0.1667 | 0.9722 | 0.4167 | — |
| 172 | C6 | 15 | 37 | 0.7889 | 0.6000 | 1.0000 | 0.2111 | — |
| 172 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 173 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 173 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 173 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | — |
| 173 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 173 | C5 | 12 | 30 | 0.6944 | 0.4167 | 0.9722 | 0.2778 | — |
| 173 | C6 | 15 | 37 | 0.8889 | 0.7333 | 1.0000 | 0.1111 | — |
| 173 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 174 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 174 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 174 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 174 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 174 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | — |
| 174 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | — |
| 174 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 175 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 175 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 175 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | — |
| 175 | C4 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 175 | C5 | 12 | 30 | 0.9028 | 0.7500 | 0.9722 | 0.0694 | — |
| 175 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 175 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 176 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 176 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 176 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | — |
| 176 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 176 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | — |
| 176 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 176 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 177 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 177 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 177 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | — |
| 177 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 177 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 177 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 177 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 178 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 178 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 178 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | — |
| 178 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 178 | C5 | 12 | 30 | 0.5417 | 0.0833 | 1.0000 | 0.4583 | — |
| 178 | C6 | 15 | 37 | 0.7778 | 0.6000 | 0.9778 | 0.2000 | — |
| 178 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 179 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 179 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 179 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | — |
| 179 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 179 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 179 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 179 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 180 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 180 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 180 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | — |
| 180 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 180 | C5 | 12 | 30 | 0.7361 | 0.4167 | 1.0000 | 0.2639 | — |
| 180 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 180 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 181 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 181 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 181 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | — |
| 181 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 181 | C5 | 12 | 30 | 0.7917 | 0.5000 | 1.0000 | 0.2083 | — |
| 181 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 181 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 182 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 182 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 182 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | — |
| 182 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 182 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | — |
| 182 | C6 | 15 | 37 | 0.9444 | 0.8667 | 0.9778 | 0.0333 | — |
| 182 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 183 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 183 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 183 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | — |
| 183 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 183 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | — |
| 183 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 183 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 184 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 184 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 184 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | — |
| 184 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 184 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 184 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 184 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 185 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 185 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 185 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | — |
| 185 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 185 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 185 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 185 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 186 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 186 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 186 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | — |
| 186 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | — |
| 186 | C5 | 12 | 30 | 0.4444 | 0.0000 | 1.0000 | 0.5556 | — |
| 186 | C6 | 15 | 37 | 0.6222 | 0.2000 | 0.9778 | 0.3556 | — |
| 186 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 187 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 187 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 187 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | — |
| 187 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 187 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 187 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 187 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 188 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 188 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | — |
| 188 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | — |
| 188 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | — |
| 188 | C5 | 12 | 30 | 0.5417 | 0.0833 | 1.0000 | 0.4583 | — |
| 188 | C6 | 15 | 37 | 0.7778 | 0.6000 | 0.9778 | 0.2000 | — |
| 188 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 189 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | — |
| 189 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 189 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.8667 | 0.3333 | — |
| 189 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | — |
| 189 | C5 | 12 | 30 | 0.6944 | 0.3333 | 1.0000 | 0.3056 | — |
| 189 | C6 | 15 | 37 | 0.8778 | 0.8000 | 0.9778 | 0.1000 | — |
| 189 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 190 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 190 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 190 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | — |
| 190 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 190 | C5 | 12 | 30 | 0.7917 | 0.5000 | 1.0000 | 0.2083 | — |
| 190 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 190 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 191 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 191 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 191 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.8667 | 0.2000 | — |
| 191 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | — |
| 191 | C5 | 12 | 30 | 0.9028 | 0.7500 | 1.0000 | 0.0972 | — |
| 191 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | — |
| 191 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 192 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 192 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 192 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | — |
| 192 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 192 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | — |
| 192 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | — |
| 192 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | — |
| 193 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 193 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 193 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 193 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 193 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 193 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 193 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 194 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 8.3333 |
| 194 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 194 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | 0.0000 |
| 194 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 194 | C5 | 12 | 30 | 0.5972 | 0.1667 | 0.9306 | 0.3333 | 6.9444 |
| 194 | C6 | 15 | 37 | 0.6889 | 0.4667 | 0.9111 | 0.2222 | 3.3333 |
| 194 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 195 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 195 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 195 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 195 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 195 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 195 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 195 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 196 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 196 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 196 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | 0.0000 |
| 196 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 196 | C5 | 12 | 30 | 0.7083 | 0.3333 | 0.9306 | 0.2222 | 0.0000 |
| 196 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | 0.0000 |
| 196 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 197 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 197 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 197 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | 0.0000 |
| 197 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 8.3333 |
| 197 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 197 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | 0.0000 |
| 197 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 198 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 198 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 198 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 198 | C4 | 12 | 12 | 0.5000 | 0.5000 | 0.7500 | 0.2500 | 8.3333 |
| 198 | C5 | 12 | 30 | 0.7639 | 0.4167 | 0.9306 | 0.1667 | 2.7778 |
| 198 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | 3.3333 |
| 198 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 199 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 199 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 199 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 199 | C4 | 12 | 12 | 0.5833 | 0.5833 | 0.7500 | 0.1667 | 0.0000 |
| 199 | C5 | 12 | 30 | 0.8056 | 0.5000 | 0.9306 | 0.1250 | 4.1667 |
| 199 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | 0.0000 |
| 199 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 200 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 200 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 200 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 200 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 200 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 6.9444 |
| 200 | C6 | 15 | 37 | 0.8889 | 0.7333 | 0.9111 | 0.0222 | 3.3333 |
| 200 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 201 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 8.3333 |
| 201 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 201 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 201 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 16.6667 |
| 201 | C5 | 12 | 30 | 0.9028 | 0.7500 | 0.9306 | 0.0278 | 4.1667 |
| 201 | C6 | 15 | 37 | 0.8889 | 0.7333 | 0.9111 | 0.0222 | 3.3333 |
| 201 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 202 | C1 | 12 | 12 | 0.7500 | 0.7500 | 0.9167 | 0.1667 | 0.0000 |
| 202 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 202 | C3 | 15 | 15 | 0.2667 | 0.2667 | 0.6000 | 0.3333 | 6.6667 |
| 202 | C4 | 12 | 12 | 0.2500 | 0.2500 | 0.7500 | 0.5000 | 0.0000 |
| 202 | C5 | 12 | 30 | 0.4167 | 0.0000 | 0.9306 | 0.5139 | 0.0000 |
| 202 | C6 | 15 | 37 | 0.5667 | 0.2000 | 0.9111 | 0.3444 | 2.2222 |
| 202 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 203 | C1 | 12 | 12 | 0.9167 | 0.9167 | 0.9167 | 0.0000 | 0.0000 |
| 203 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 203 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 203 | C4 | 12 | 12 | 0.7500 | 0.7500 | 0.7500 | 0.0000 | 0.0000 |
| 203 | C5 | 12 | 30 | 0.9306 | 0.8333 | 0.9306 | 0.0000 | 0.0000 |
| 203 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9111 | 0.0000 | 0.0000 |
| 203 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 204 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 8.3333 |
| 204 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 204 | C3 | 15 | 15 | 0.3333 | 0.3333 | 0.6000 | 0.2667 | 6.6667 |
| 204 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 204 | C5 | 12 | 30 | 0.6250 | 0.1667 | 0.9306 | 0.3056 | 6.9444 |
| 204 | C6 | 15 | 37 | 0.6889 | 0.4667 | 0.9111 | 0.2222 | 3.3333 |
| 204 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 205 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 205 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 205 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.6000 | 0.1333 | 6.6667 |
| 205 | C4 | 12 | 12 | 0.3333 | 0.3333 | 0.7500 | 0.4167 | 0.0000 |
| 205 | C5 | 12 | 30 | 0.7083 | 0.3333 | 0.9306 | 0.2222 | 4.1667 |
| 205 | C6 | 15 | 37 | 0.7111 | 0.5333 | 0.9111 | 0.2000 | 0.0000 |
| 205 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 206 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 206 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 206 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.6000 | 0.0667 | 0.0000 |
| 206 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 8.3333 |
| 206 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 206 | C6 | 15 | 37 | 0.7333 | 0.5333 | 0.9111 | 0.1778 | 0.0000 |
| 206 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 207 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 207 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 207 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 207 | C4 | 12 | 12 | 0.4167 | 0.4167 | 0.7500 | 0.3333 | 0.0000 |
| 207 | C5 | 12 | 30 | 0.7361 | 0.4167 | 0.9306 | 0.1944 | 0.0000 |
| 207 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | 3.3333 |
| 207 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 208 | C1 | 12 | 12 | 0.8333 | 0.8333 | 0.9167 | 0.0833 | 0.0000 |
| 208 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 208 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.6000 | 0.0000 | 0.0000 |
| 208 | C4 | 12 | 12 | 0.5833 | 0.5833 | 0.7500 | 0.1667 | 8.3333 |
| 208 | C5 | 12 | 30 | 0.8333 | 0.5833 | 0.9306 | 0.0972 | 6.9444 |
| 208 | C6 | 15 | 37 | 0.7889 | 0.6667 | 0.9111 | 0.1222 | 0.0000 |
| 208 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 209 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 209 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 209 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 209 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 209 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 209 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 209 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 210 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 210 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 210 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 210 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 8.3333 |
| 210 | C5 | 12 | 30 | 0.7222 | 0.5000 | 0.9722 | 0.2500 | 16.6667 |
| 210 | C6 | 15 | 37 | 0.8222 | 0.6667 | 1.0000 | 0.1778 | 3.3333 |
| 210 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 211 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 211 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 211 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 211 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 211 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 211 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 211 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 212 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 212 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 212 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.9333 | 0.3333 | 6.6667 |
| 212 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 212 | C5 | 12 | 30 | 0.8333 | 0.5833 | 0.9722 | 0.1389 | 6.9444 |
| 212 | C6 | 15 | 37 | 0.9111 | 0.8000 | 1.0000 | 0.0889 | -3.3333 |
| 212 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 213 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 213 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 213 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 213 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 25.0000 |
| 213 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | 0.0000 |
| 213 | C6 | 15 | 37 | 0.9778 | 0.9333 | 1.0000 | 0.0222 | 0.0000 |
| 213 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 214 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 8.3333 |
| 214 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 214 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 214 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 214 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | 0.0000 |
| 214 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 214 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 215 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 215 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 215 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 215 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 215 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 2.7778 |
| 215 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 215 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 216 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 216 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 216 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 6.6667 |
| 216 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 216 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 216 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 216 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 217 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 217 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 217 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 217 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 217 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 217 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 217 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 218 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 218 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 218 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.9333 | 0.4667 | 0.0000 |
| 218 | C4 | 12 | 12 | 0.4167 | 0.4167 | 1.0000 | 0.5833 | 0.0000 |
| 218 | C5 | 12 | 30 | 0.4722 | 0.0833 | 0.9722 | 0.5000 | 5.5556 |
| 218 | C6 | 15 | 37 | 0.6778 | 0.2667 | 1.0000 | 0.3222 | 3.3333 |
| 218 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 219 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 219 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 219 | C3 | 15 | 15 | 0.9333 | 0.9333 | 0.9333 | 0.0000 | 0.0000 |
| 219 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 219 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 0.0000 |
| 219 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 219 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 220 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 220 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 220 | C3 | 15 | 15 | 0.5333 | 0.5333 | 0.9333 | 0.4000 | 6.6667 |
| 220 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 8.3333 |
| 220 | C5 | 12 | 30 | 0.6944 | 0.4167 | 0.9722 | 0.2778 | 13.8889 |
| 220 | C6 | 15 | 37 | 0.8222 | 0.6667 | 1.0000 | 0.1778 | 3.3333 |
| 220 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 221 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 221 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 221 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.9333 | 0.3333 | 6.6667 |
| 221 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 221 | C5 | 12 | 30 | 0.7639 | 0.5000 | 0.9722 | 0.2083 | 6.9444 |
| 221 | C6 | 15 | 37 | 0.9222 | 0.8000 | 1.0000 | 0.0778 | 3.3333 |
| 221 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 222 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 222 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 222 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 222 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 25.0000 |
| 222 | C5 | 12 | 30 | 0.8750 | 0.6667 | 0.9722 | 0.0972 | 0.0000 |
| 222 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 2.2222 |
| 222 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 223 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 223 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 223 | C3 | 15 | 15 | 0.6667 | 0.6667 | 0.9333 | 0.2667 | 0.0000 |
| 223 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 8.3333 |
| 223 | C5 | 12 | 30 | 0.9444 | 0.8333 | 0.9722 | 0.0278 | 4.1667 |
| 223 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 223 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 224 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 224 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 224 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.9333 | 0.0667 | 0.0000 |
| 224 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 224 | C5 | 12 | 30 | 0.9722 | 0.9167 | 0.9722 | 0.0000 | 2.7778 |
| 224 | C6 | 15 | 37 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 224 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 225 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 225 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 225 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 225 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 225 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 225 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 225 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 226 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 226 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 6.2500 |
| 226 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | 0.0000 |
| 226 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 226 | C5 | 12 | 30 | 0.6250 | 0.1667 | 1.0000 | 0.3750 | 8.3333 |
| 226 | C6 | 15 | 37 | 0.8444 | 0.7333 | 0.9778 | 0.1333 | 6.6667 |
| 226 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 227 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 227 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 227 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 227 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 227 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 227 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 227 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 228 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 8.3333 |
| 228 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 228 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 0.0000 |
| 228 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 8.3333 |
| 228 | C5 | 12 | 30 | 0.7361 | 0.4167 | 1.0000 | 0.2639 | 0.0000 |
| 228 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 228 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 229 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 229 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 229 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 0.0000 |
| 229 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 229 | C5 | 12 | 30 | 0.8611 | 0.6667 | 1.0000 | 0.1389 | 6.9444 |
| 229 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 229 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 230 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 230 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 230 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | 0.0000 |
| 230 | C4 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 8.3333 |
| 230 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | 4.1667 |
| 230 | C6 | 15 | 37 | 0.9444 | 0.8667 | 0.9778 | 0.0333 | 0.0000 |
| 230 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 231 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 231 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 231 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 231 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 231 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | 0.0000 |
| 231 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 231 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 232 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 232 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 232 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 232 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 232 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 232 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 232 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 233 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 233 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 233 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 233 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 233 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 233 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 233 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 234 | C1 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 234 | C2 | 16 | 16 | 0.9375 | 0.9375 | 1.0000 | 0.0625 | 0.0000 |
| 234 | C3 | 15 | 15 | 0.4000 | 0.4000 | 0.8667 | 0.4667 | 0.0000 |
| 234 | C4 | 12 | 12 | 0.5000 | 0.5000 | 1.0000 | 0.5000 | 0.0000 |
| 234 | C5 | 12 | 30 | 0.5139 | 0.0833 | 1.0000 | 0.4861 | 6.9444 |
| 234 | C6 | 15 | 37 | 0.6222 | 0.2000 | 0.9778 | 0.3556 | 0.0000 |
| 234 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 235 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 235 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 235 | C3 | 15 | 15 | 0.8667 | 0.8667 | 0.8667 | 0.0000 | 0.0000 |
| 235 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 235 | C5 | 12 | 30 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 235 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 235 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 236 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 8.3333 |
| 236 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 6.2500 |
| 236 | C3 | 15 | 15 | 0.4667 | 0.4667 | 0.8667 | 0.4000 | 0.0000 |
| 236 | C4 | 12 | 12 | 0.6667 | 0.6667 | 1.0000 | 0.3333 | 0.0000 |
| 236 | C5 | 12 | 30 | 0.6250 | 0.1667 | 1.0000 | 0.3750 | 8.3333 |
| 236 | C6 | 15 | 37 | 0.8444 | 0.7333 | 0.9778 | 0.1333 | 6.6667 |
| 236 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 237 | C1 | 12 | 12 | 0.9167 | 0.9167 | 1.0000 | 0.0833 | 0.0000 |
| 237 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 237 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 6.6667 |
| 237 | C4 | 12 | 12 | 0.7500 | 0.7500 | 1.0000 | 0.2500 | 0.0000 |
| 237 | C5 | 12 | 30 | 0.7361 | 0.4167 | 1.0000 | 0.2639 | 4.1667 |
| 237 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 3.3333 |
| 237 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 238 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 238 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 238 | C3 | 15 | 15 | 0.6000 | 0.6000 | 0.8667 | 0.2667 | 0.0000 |
| 238 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 238 | C5 | 12 | 30 | 0.8611 | 0.6667 | 1.0000 | 0.1389 | 6.9444 |
| 238 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 238 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 239 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 239 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 239 | C3 | 15 | 15 | 0.7333 | 0.7333 | 0.8667 | 0.1333 | 6.6667 |
| 239 | C4 | 12 | 12 | 0.8333 | 0.8333 | 1.0000 | 0.1667 | 0.0000 |
| 239 | C5 | 12 | 30 | 0.9306 | 0.8333 | 1.0000 | 0.0694 | 2.7778 |
| 239 | C6 | 15 | 37 | 0.9111 | 0.8000 | 0.9778 | 0.0667 | 0.0000 |
| 239 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 240 | C1 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 240 | C2 | 16 | 16 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 240 | C3 | 15 | 15 | 0.8000 | 0.8000 | 0.8667 | 0.0667 | 0.0000 |
| 240 | C4 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |
| 240 | C5 | 12 | 30 | 0.9722 | 0.9167 | 1.0000 | 0.0278 | 0.0000 |
| 240 | C6 | 15 | 37 | 0.9778 | 0.9333 | 0.9778 | 0.0000 | 0.0000 |
| 240 | C7 | 12 | 12 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 |

## Fidelity and language strata

Queries without matching groups are omitted; macros average represented categories. Category strata appear in the category table.

| Cell | Stratum | Queries | Groups | Represented categories | Coverage | All-required | Ceiling | Loss |
| ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 1 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 1 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 1 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 1 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 2 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 2 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 2 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 2 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 2 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 3 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 3 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 3 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 3 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 3 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 4 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 4 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 4 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 4 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 4 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 5 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7874 | 0.7696 | 0.8495 | 0.0621 |
| 5 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0408 | 0.0408 | 0.8901 | 0.8493 |
| 5 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5011 | 0.4137 | 0.8987 | 0.3976 |
| 5 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 0.6597 | 0.2083 |
| 5 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4778 | 0.2667 | 0.9778 | 0.5000 |
| 6 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 6 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.1025 | 0.1025 | 0.8901 | 0.7876 |
| 6 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5517 | 0.4494 | 0.8987 | 0.3470 |
| 6 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 6 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 7 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 7 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6668 | 0.6668 | 0.8901 | 0.2234 |
| 7 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7908 | 0.7396 | 0.8987 | 0.1080 |
| 7 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 7 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8556 | 0.8000 | 0.9778 | 0.1222 |
| 8 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 8 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8425 | 0.8378 | 0.8901 | 0.0476 |
| 8 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8944 | 0.8638 | 0.8987 | 0.0043 |
| 8 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 8 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9444 | 0.8667 | 0.9778 | 0.0333 |
| 9 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 9 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8330 | 0.8282 | 0.8901 | 0.0571 |
| 9 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8879 | 0.8638 | 0.8987 | 0.0108 |
| 9 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 9 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9444 | 0.8667 | 0.9778 | 0.0333 |
| 10 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 10 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 10 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 10 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 10 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3778 | 0.2000 | 0.9778 | 0.6000 |
| 11 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 11 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 11 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 11 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 11 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 12 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 12 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 12 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 12 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 12 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 13 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 13 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 13 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 13 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 13 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 14 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7815 | 0.8495 | 0.0561 |
| 14 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 14 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5070 | 0.4137 | 0.8987 | 0.3917 |
| 14 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 14 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4778 | 0.2667 | 0.9778 | 0.5000 |
| 15 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 15 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0456 | 0.0408 | 0.8901 | 0.8446 |
| 15 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5517 | 0.4494 | 0.8987 | 0.3470 |
| 15 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 15 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5667 | 0.3333 | 0.9778 | 0.4111 |
| 16 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 16 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6713 | 0.6713 | 0.8901 | 0.2188 |
| 16 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7997 | 0.7486 | 0.8987 | 0.0990 |
| 16 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 16 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8333 | 0.7333 | 0.9778 | 0.1444 |
| 17 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 17 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 17 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 17 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 17 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 18 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9286 | 0.9107 | 0.9762 | 0.0476 |
| 18 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 18 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5934 | 0.4812 | 1.0000 | 0.4066 |
| 18 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 18 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4333 | 0.2000 | 1.0000 | 0.5667 |
| 19 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 19 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 19 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 19 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 19 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 20 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9405 | 0.9762 | 0.0238 |
| 20 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 20 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5994 | 0.4812 | 1.0000 | 0.4006 |
| 20 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 20 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 1.0000 | 0.5000 |
| 21 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 21 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0252 | 0.0204 | 1.0000 | 0.9748 |
| 21 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6053 | 0.4812 | 1.0000 | 0.3947 |
| 21 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4931 | 0.3264 | 0.8889 | 0.3958 |
| 21 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5667 | 0.3333 | 1.0000 | 0.4333 |
| 22 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 22 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7281 | 0.7234 | 1.0000 | 0.2719 |
| 22 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8982 | 0.8538 | 1.0000 | 0.1018 |
| 22 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8472 | 0.7361 | 0.8889 | 0.0417 |
| 22 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7889 | 0.6667 | 1.0000 | 0.2111 |
| 23 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 23 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9184 | 0.9184 | 1.0000 | 0.0816 |
| 23 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 1.0000 | 0.0317 |
| 23 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 23 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.8667 | 1.0000 | 0.1333 |
| 24 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 24 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 24 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 24 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 24 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 25 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 25 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9796 | 0.9796 | 1.0000 | 0.0204 |
| 25 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 25 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 25 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9333 | 0.9333 | 1.0000 | 0.0667 |
| 26 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8376 | 0.8138 | 0.9762 | 0.1386 |
| 26 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 26 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5244 | 0.4276 | 1.0000 | 0.4756 |
| 26 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4167 | 0.3056 | 0.8889 | 0.4722 |
| 26 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4000 | 0.2000 | 1.0000 | 0.6000 |
| 27 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 27 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 27 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 27 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 27 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 28 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9082 | 0.8903 | 0.9762 | 0.0680 |
| 28 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 28 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5577 | 0.4454 | 1.0000 | 0.4423 |
| 28 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 28 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4333 | 0.2000 | 1.0000 | 0.5667 |
| 29 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 29 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 29 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5994 | 0.4812 | 1.0000 | 0.4006 |
| 29 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 29 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4333 | 0.2000 | 1.0000 | 0.5667 |
| 30 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 30 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 1.0000 | 0.9796 |
| 30 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6053 | 0.4812 | 1.0000 | 0.3947 |
| 30 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 30 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5667 | 0.3333 | 1.0000 | 0.4333 |
| 31 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 31 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4683 | 0.4635 | 1.0000 | 0.5317 |
| 31 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7765 | 0.6829 | 1.0000 | 0.2235 |
| 31 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 0.8889 | 0.2083 |
| 31 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6667 | 1.0000 | 0.2333 |
| 32 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 32 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9184 | 0.9184 | 1.0000 | 0.0816 |
| 32 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 1.0000 | 0.0317 |
| 32 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 32 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.8667 | 1.0000 | 0.1333 |
| 33 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 33 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 33 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 33 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 33 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 34 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8733 | 0.8614 | 0.9821 | 0.1088 |
| 34 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 34 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5189 | 0.4137 | 0.9683 | 0.4493 |
| 34 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4722 | 0.3611 | 1.0000 | 0.5278 |
| 34 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 35 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 35 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 35 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 35 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 35 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 36 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9379 | 0.9320 | 0.9821 | 0.0442 |
| 36 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 36 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5538 | 0.4296 | 0.9683 | 0.4145 |
| 36 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4931 | 0.3819 | 1.0000 | 0.5069 |
| 36 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 37 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 37 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 37 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5895 | 0.4653 | 0.9683 | 0.3788 |
| 37 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5486 | 0.3819 | 1.0000 | 0.4514 |
| 37 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 38 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 38 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.1392 | 0.1392 | 0.9748 | 0.8356 |
| 38 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6609 | 0.5367 | 0.9683 | 0.3074 |
| 38 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7708 | 0.7708 | 1.0000 | 0.2292 |
| 38 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5889 | 0.4000 | 0.9778 | 0.3889 |
| 39 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 39 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8615 | 0.8567 | 0.9748 | 0.1134 |
| 39 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8968 | 0.8760 | 0.9683 | 0.0714 |
| 39 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 39 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 40 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 40 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 40 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 40 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 40 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 41 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 41 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9544 | 0.9497 | 0.9748 | 0.0204 |
| 41 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 41 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 41 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 42 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8231 | 0.7934 | 0.9821 | 0.1590 |
| 42 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 42 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4951 | 0.3958 | 0.9683 | 0.4731 |
| 42 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 1.0000 | 0.5486 |
| 42 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4778 | 0.2667 | 0.9778 | 0.5000 |
| 43 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 43 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 43 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 43 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 43 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 44 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8733 | 0.8614 | 0.9821 | 0.1088 |
| 44 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 44 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5189 | 0.4137 | 0.9683 | 0.4493 |
| 44 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4722 | 0.3611 | 1.0000 | 0.5278 |
| 44 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 45 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9073 | 0.9014 | 0.9821 | 0.0748 |
| 45 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 45 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5473 | 0.4296 | 0.9683 | 0.4210 |
| 45 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4722 | 0.3611 | 1.0000 | 0.5278 |
| 45 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 46 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 46 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 46 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5895 | 0.4653 | 0.9683 | 0.3788 |
| 46 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4931 | 0.3819 | 1.0000 | 0.5069 |
| 46 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 47 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 47 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0048 | 0.0000 | 0.9748 | 0.9701 |
| 47 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5895 | 0.4653 | 0.9683 | 0.3788 |
| 47 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 1.0000 | 0.3958 |
| 47 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 48 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 48 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8819 | 0.8771 | 0.9748 | 0.0930 |
| 48 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9058 | 0.8849 | 0.9683 | 0.0625 |
| 48 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 48 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 49 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 49 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 49 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 49 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 49 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 50 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 50 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 50 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 50 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 50 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 51 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 51 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 51 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 51 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 51 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 52 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 52 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 52 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 52 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 52 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 53 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7874 | 0.7696 | 0.8495 | 0.0621 |
| 53 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0408 | 0.0408 | 0.8901 | 0.8493 |
| 53 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5011 | 0.4137 | 0.8987 | 0.3976 |
| 53 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 0.6597 | 0.2083 |
| 53 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4778 | 0.2667 | 0.9778 | 0.5000 |
| 54 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 54 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.1025 | 0.1025 | 0.8901 | 0.7876 |
| 54 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5517 | 0.4494 | 0.8987 | 0.3470 |
| 54 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 54 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 55 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 55 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6795 | 0.6795 | 0.8901 | 0.2107 |
| 55 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7908 | 0.7396 | 0.8987 | 0.1080 |
| 55 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 55 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8333 | 0.7333 | 0.9778 | 0.1444 |
| 56 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 56 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8711 | 0.8663 | 0.8901 | 0.0190 |
| 56 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8944 | 0.8638 | 0.8987 | 0.0043 |
| 56 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 56 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9444 | 0.8667 | 0.9778 | 0.0333 |
| 57 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 57 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8425 | 0.8378 | 0.8901 | 0.0476 |
| 57 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8944 | 0.8638 | 0.8987 | 0.0043 |
| 57 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 57 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9444 | 0.8667 | 0.9778 | 0.0333 |
| 58 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 58 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.8901 | 0.8901 |
| 58 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 58 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 58 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.3778 | 0.2000 | 0.9778 | 0.6000 |
| 59 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 59 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 59 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 59 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 59 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 60 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 60 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 60 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 60 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 60 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 61 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 61 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 61 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4862 | 0.3958 | 0.8987 | 0.4125 |
| 61 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 61 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4444 | 0.2667 | 0.9778 | 0.5333 |
| 62 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7815 | 0.8495 | 0.0561 |
| 62 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 0.8901 | 0.8697 |
| 62 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5070 | 0.4137 | 0.8987 | 0.3917 |
| 62 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 62 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4778 | 0.2667 | 0.9778 | 0.5000 |
| 63 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 63 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0660 | 0.0612 | 0.8901 | 0.8241 |
| 63 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5517 | 0.4494 | 0.8987 | 0.3470 |
| 63 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5069 | 0.3403 | 0.6597 | 0.1528 |
| 63 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6333 | 0.4000 | 0.9778 | 0.3444 |
| 64 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 64 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7205 | 0.7158 | 0.8901 | 0.1696 |
| 64 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7997 | 0.7486 | 0.8987 | 0.0990 |
| 64 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 64 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8778 | 0.8000 | 0.9778 | 0.1000 |
| 65 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 65 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 65 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 65 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 65 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 66 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9286 | 0.9107 | 0.9762 | 0.0476 |
| 66 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 66 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5934 | 0.4812 | 1.0000 | 0.4066 |
| 66 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 66 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4333 | 0.2000 | 1.0000 | 0.5667 |
| 67 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 67 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 67 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 67 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 67 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 68 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9405 | 0.9762 | 0.0238 |
| 68 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 68 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5994 | 0.4812 | 1.0000 | 0.4006 |
| 68 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 68 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 1.0000 | 0.5000 |
| 69 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 69 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0410 | 0.0363 | 1.0000 | 0.9590 |
| 69 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6053 | 0.4812 | 1.0000 | 0.3947 |
| 69 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5486 | 0.3264 | 0.8889 | 0.3403 |
| 69 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5667 | 0.3333 | 1.0000 | 0.4333 |
| 70 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 70 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7567 | 0.7519 | 1.0000 | 0.2433 |
| 70 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9339 | 0.8895 | 1.0000 | 0.0661 |
| 70 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8472 | 0.7361 | 0.8889 | 0.0417 |
| 70 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7889 | 0.6667 | 1.0000 | 0.2111 |
| 71 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 71 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 71 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 71 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 71 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.8667 | 1.0000 | 0.1333 |
| 72 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 72 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 72 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 72 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 72 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 73 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 73 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 73 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 73 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 73 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 74 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8376 | 0.8138 | 0.9762 | 0.1386 |
| 74 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 74 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5244 | 0.4276 | 1.0000 | 0.4756 |
| 74 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4167 | 0.3056 | 0.8889 | 0.4722 |
| 74 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4000 | 0.2000 | 1.0000 | 0.6000 |
| 75 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 75 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 75 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 75 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 75 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 76 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9082 | 0.8903 | 0.9762 | 0.0680 |
| 76 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 76 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5577 | 0.4454 | 1.0000 | 0.4423 |
| 76 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 76 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4333 | 0.2000 | 1.0000 | 0.5667 |
| 77 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 77 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 1.0000 | 1.0000 |
| 77 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5994 | 0.4812 | 1.0000 | 0.4006 |
| 77 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 77 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4333 | 0.2000 | 1.0000 | 0.5667 |
| 78 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 78 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0204 | 0.0204 | 1.0000 | 0.9796 |
| 78 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6053 | 0.4812 | 1.0000 | 0.3947 |
| 78 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4375 | 0.3264 | 0.8889 | 0.4514 |
| 78 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5667 | 0.3333 | 1.0000 | 0.4333 |
| 79 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 79 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4889 | 0.4889 | 1.0000 | 0.5111 |
| 79 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7919 | 0.7137 | 1.0000 | 0.2081 |
| 79 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 0.8889 | 0.2083 |
| 79 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6667 | 1.0000 | 0.2333 |
| 80 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 80 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9592 | 0.9592 | 1.0000 | 0.0408 |
| 80 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 80 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 80 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.8667 | 1.0000 | 0.1333 |
| 81 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 81 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 81 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 81 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 81 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 82 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8733 | 0.8614 | 0.9821 | 0.1088 |
| 82 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 82 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5189 | 0.4137 | 0.9683 | 0.4493 |
| 82 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4722 | 0.3611 | 1.0000 | 0.5278 |
| 82 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 83 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 83 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 83 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 83 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 83 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 84 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9379 | 0.9320 | 0.9821 | 0.0442 |
| 84 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 84 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5538 | 0.4296 | 0.9683 | 0.4145 |
| 84 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4931 | 0.3819 | 1.0000 | 0.5069 |
| 84 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 85 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 85 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 85 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5895 | 0.4653 | 0.9683 | 0.3788 |
| 85 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5486 | 0.3819 | 1.0000 | 0.4514 |
| 85 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 86 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 86 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.1392 | 0.1392 | 0.9748 | 0.8356 |
| 86 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6609 | 0.5367 | 0.9683 | 0.3074 |
| 86 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7708 | 0.7708 | 1.0000 | 0.2292 |
| 86 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5889 | 0.4000 | 0.9778 | 0.3889 |
| 87 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 87 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9023 | 0.8975 | 0.9748 | 0.0726 |
| 87 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9216 | 0.9008 | 0.9683 | 0.0466 |
| 87 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 87 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 88 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 88 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 88 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 88 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 88 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 89 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 89 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 89 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 89 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 89 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 90 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8231 | 0.7934 | 0.9821 | 0.1590 |
| 90 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 90 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.4951 | 0.3958 | 0.9683 | 0.4731 |
| 90 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4514 | 0.3403 | 1.0000 | 0.5486 |
| 90 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.4778 | 0.2667 | 0.9778 | 0.5000 |
| 91 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 91 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 91 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 91 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 91 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 92 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8733 | 0.8614 | 0.9821 | 0.1088 |
| 92 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 92 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5189 | 0.4137 | 0.9683 | 0.4493 |
| 92 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4722 | 0.3611 | 1.0000 | 0.5278 |
| 92 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 93 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9073 | 0.9014 | 0.9821 | 0.0748 |
| 93 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 93 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5473 | 0.4296 | 0.9683 | 0.4210 |
| 93 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4722 | 0.3611 | 1.0000 | 0.5278 |
| 93 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 94 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 94 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0000 | 0.0000 | 0.9748 | 0.9748 |
| 94 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5895 | 0.4653 | 0.9683 | 0.3788 |
| 94 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.4931 | 0.3819 | 1.0000 | 0.5069 |
| 94 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 95 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 95 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.0048 | 0.0000 | 0.9748 | 0.9701 |
| 95 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.5895 | 0.4653 | 0.9683 | 0.3788 |
| 95 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6042 | 0.3819 | 1.0000 | 0.3958 |
| 95 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5000 | 0.2667 | 0.9778 | 0.4778 |
| 96 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 96 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9023 | 0.8975 | 0.9748 | 0.0726 |
| 96 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9216 | 0.9008 | 0.9683 | 0.0466 |
| 96 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 96 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 97 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 97 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 97 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 97 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 97 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 98 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7117 | 0.6641 | 0.8495 | 0.1378 |
| 98 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5143 | 0.5095 | 0.8901 | 0.3759 |
| 98 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6427 | 0.5439 | 0.8987 | 0.2560 |
| 98 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 98 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5333 | 0.4000 | 0.9778 | 0.4444 |
| 99 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 99 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 99 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 99 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 99 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 100 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 100 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 100 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7253 | 0.6503 | 0.8987 | 0.1734 |
| 100 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 100 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 101 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 101 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6920 | 0.6872 | 0.8901 | 0.1982 |
| 101 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 101 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 101 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 102 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 102 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7505 | 0.7457 | 0.8901 | 0.1397 |
| 102 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7385 | 0.6723 | 0.8987 | 0.1602 |
| 102 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 102 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 103 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 103 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8044 | 0.7997 | 0.8901 | 0.0857 |
| 103 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7867 | 0.7210 | 0.8987 | 0.1120 |
| 103 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 103 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 104 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8316 | 0.8197 | 0.8495 | 0.0179 |
| 104 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8711 | 0.8663 | 0.8901 | 0.0190 |
| 104 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8855 | 0.8460 | 0.8987 | 0.0133 |
| 104 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 104 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9222 | 0.8000 | 0.9778 | 0.0556 |
| 105 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7815 | 0.8495 | 0.0561 |
| 105 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8425 | 0.8378 | 0.8901 | 0.0476 |
| 105 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8497 | 0.8102 | 0.8987 | 0.0490 |
| 105 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 105 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8556 | 0.7333 | 0.9778 | 0.1222 |
| 106 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6794 | 0.6216 | 0.8495 | 0.1701 |
| 106 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4794 | 0.4746 | 0.8901 | 0.4108 |
| 106 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6075 | 0.5261 | 0.8987 | 0.2912 |
| 106 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3958 | 0.2847 | 0.6597 | 0.2639 |
| 106 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.3333 | 0.9778 | 0.4667 |
| 107 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 107 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 107 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 107 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 107 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 108 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7177 | 0.6760 | 0.8495 | 0.1318 |
| 108 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5143 | 0.5095 | 0.8901 | 0.3759 |
| 108 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6427 | 0.5439 | 0.8987 | 0.2560 |
| 108 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 108 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5556 | 0.4000 | 0.9778 | 0.4222 |
| 109 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7594 | 0.7236 | 0.8495 | 0.0901 |
| 109 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 109 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7164 | 0.6325 | 0.8987 | 0.1824 |
| 109 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 109 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 110 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 110 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6920 | 0.6872 | 0.8901 | 0.1982 |
| 110 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 110 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 110 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 111 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 111 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7505 | 0.7457 | 0.8901 | 0.1397 |
| 111 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7385 | 0.6723 | 0.8987 | 0.1602 |
| 111 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 111 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 112 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 112 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8044 | 0.7997 | 0.8901 | 0.0857 |
| 112 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7867 | 0.7210 | 0.8987 | 0.1120 |
| 112 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 112 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 113 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 113 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 113 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 113 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 113 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 114 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7840 | 0.7423 | 0.9762 | 0.1922 |
| 114 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7557 | 0.7461 | 1.0000 | 0.2443 |
| 114 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7629 | 0.6901 | 1.0000 | 0.2371 |
| 114 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 0.8889 | 0.2083 |
| 114 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6667 | 0.5333 | 1.0000 | 0.3333 |
| 115 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 115 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 115 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 115 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 115 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 116 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8401 | 0.8163 | 0.9762 | 0.1361 |
| 116 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8334 | 0.8287 | 1.0000 | 0.1666 |
| 116 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8204 | 0.7758 | 1.0000 | 0.1796 |
| 116 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 116 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 117 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 117 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9054 | 0.9007 | 1.0000 | 0.0946 |
| 117 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8760 | 0.8433 | 1.0000 | 0.1240 |
| 117 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8681 | 0.7569 | 0.8889 | 0.0208 |
| 117 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 118 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 118 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 118 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9623 | 0.9504 | 1.0000 | 0.0377 |
| 118 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 118 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 119 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9405 | 0.9762 | 0.0238 |
| 119 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 119 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9782 | 0.9663 | 1.0000 | 0.0218 |
| 119 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 119 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 120 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 120 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 120 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 120 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 120 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 121 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 121 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 121 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 121 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 121 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 122 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7245 | 0.6777 | 0.9762 | 0.2517 |
| 122 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6398 | 0.6350 | 1.0000 | 0.3602 |
| 122 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6774 | 0.5846 | 1.0000 | 0.3226 |
| 122 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 0.8889 | 0.3611 |
| 122 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6222 | 0.4000 | 1.0000 | 0.3778 |
| 123 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 123 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 123 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 123 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 123 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 124 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7840 | 0.7423 | 0.9762 | 0.1922 |
| 124 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7557 | 0.7461 | 1.0000 | 0.2443 |
| 124 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7629 | 0.6901 | 1.0000 | 0.2371 |
| 124 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 0.8889 | 0.2083 |
| 124 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6667 | 0.5333 | 1.0000 | 0.3333 |
| 125 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 125 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8080 | 0.8033 | 1.0000 | 0.1920 |
| 125 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8007 | 0.7498 | 1.0000 | 0.1993 |
| 125 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 125 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7222 | 0.6000 | 1.0000 | 0.2778 |
| 126 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 126 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9054 | 0.9007 | 1.0000 | 0.0946 |
| 126 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8760 | 0.8433 | 1.0000 | 0.1240 |
| 126 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8681 | 0.7569 | 0.8889 | 0.0208 |
| 126 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 127 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9022 | 0.8903 | 0.9762 | 0.0740 |
| 127 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 127 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9177 | 0.8968 | 1.0000 | 0.0823 |
| 127 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 127 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 128 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9405 | 0.9762 | 0.0238 |
| 128 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 128 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9782 | 0.9663 | 1.0000 | 0.0218 |
| 128 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 128 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 129 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 129 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 129 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 129 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 129 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 130 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7534 | 0.7117 | 0.9821 | 0.2287 |
| 130 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7734 | 0.7638 | 0.9748 | 0.2015 |
| 130 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7652 | 0.7010 | 0.9683 | 0.2031 |
| 130 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 1.0000 | 0.3403 |
| 130 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6000 | 0.9778 | 0.2111 |
| 131 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 131 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 131 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 131 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 131 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 132 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8231 | 0.7934 | 0.9821 | 0.1590 |
| 132 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8666 | 0.8618 | 0.9748 | 0.1083 |
| 132 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8273 | 0.7697 | 0.9683 | 0.1410 |
| 132 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7361 | 0.6250 | 1.0000 | 0.2639 |
| 132 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8889 | 0.8000 | 0.9778 | 0.0889 |
| 133 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8554 | 0.8376 | 0.9821 | 0.1267 |
| 133 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 133 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8422 | 0.7875 | 0.9683 | 0.1261 |
| 133 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 133 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 134 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9073 | 0.9014 | 0.9821 | 0.0748 |
| 134 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 134 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9012 | 0.8858 | 0.9683 | 0.0670 |
| 134 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 134 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 135 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 135 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 135 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 135 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 135 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 136 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 136 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 136 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 136 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 136 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 137 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 137 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 137 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 137 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 137 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 138 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7194 | 0.6658 | 0.9821 | 0.2628 |
| 138 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6069 | 0.6069 | 0.9748 | 0.3679 |
| 138 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6788 | 0.5777 | 0.9683 | 0.2894 |
| 138 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 138 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6333 | 0.4000 | 0.9778 | 0.3444 |
| 139 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 139 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 139 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 139 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 139 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 140 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7534 | 0.7117 | 0.9821 | 0.2287 |
| 140 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7734 | 0.7638 | 0.9748 | 0.2015 |
| 140 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7652 | 0.7010 | 0.9683 | 0.2031 |
| 140 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 1.0000 | 0.3403 |
| 140 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6000 | 0.9778 | 0.2111 |
| 141 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8172 | 0.7815 | 0.9821 | 0.1650 |
| 141 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8366 | 0.8319 | 0.9748 | 0.1382 |
| 141 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7960 | 0.7359 | 0.9683 | 0.1723 |
| 141 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7361 | 0.6250 | 1.0000 | 0.2639 |
| 141 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8889 | 0.8000 | 0.9778 | 0.0889 |
| 142 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8554 | 0.8376 | 0.9821 | 0.1267 |
| 142 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 142 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8422 | 0.7875 | 0.9683 | 0.1261 |
| 142 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 142 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 143 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8733 | 0.8614 | 0.9821 | 0.1088 |
| 143 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 143 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8729 | 0.8391 | 0.9683 | 0.0953 |
| 143 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 143 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 144 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 144 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 144 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 144 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 144 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 145 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 145 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 145 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 145 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 145 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 146 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7058 | 0.6522 | 0.8495 | 0.1437 |
| 146 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5442 | 0.5395 | 0.8901 | 0.3459 |
| 146 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6381 | 0.5391 | 0.8987 | 0.2606 |
| 146 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 146 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6000 | 0.4667 | 0.9778 | 0.3778 |
| 147 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 147 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 147 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 147 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 147 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 148 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 148 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 148 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7253 | 0.6503 | 0.8987 | 0.1734 |
| 148 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 148 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 149 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 149 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6920 | 0.6872 | 0.8901 | 0.1982 |
| 149 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 149 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 149 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 150 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 150 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7505 | 0.7457 | 0.8901 | 0.1397 |
| 150 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7385 | 0.6723 | 0.8987 | 0.1602 |
| 150 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 150 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 151 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 151 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8330 | 0.8282 | 0.8901 | 0.0571 |
| 151 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8224 | 0.7567 | 0.8987 | 0.0763 |
| 151 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 151 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 152 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8316 | 0.8197 | 0.8495 | 0.0179 |
| 152 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8711 | 0.8663 | 0.8901 | 0.0190 |
| 152 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8855 | 0.8460 | 0.8987 | 0.0133 |
| 152 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 152 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9222 | 0.8000 | 0.9778 | 0.0556 |
| 153 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7934 | 0.7815 | 0.8495 | 0.0561 |
| 153 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8425 | 0.8378 | 0.8901 | 0.0476 |
| 153 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8497 | 0.8102 | 0.8987 | 0.0490 |
| 153 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 153 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8556 | 0.7333 | 0.9778 | 0.1222 |
| 154 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6471 | 0.5893 | 0.8495 | 0.2024 |
| 154 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4937 | 0.4841 | 0.8901 | 0.3965 |
| 154 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6116 | 0.5082 | 0.8987 | 0.2872 |
| 154 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3750 | 0.2639 | 0.6597 | 0.2847 |
| 154 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.3333 | 0.9778 | 0.4667 |
| 155 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 155 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 155 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 155 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 155 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 156 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7117 | 0.6641 | 0.8495 | 0.1378 |
| 156 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.5442 | 0.5395 | 0.8901 | 0.3459 |
| 156 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6381 | 0.5391 | 0.8987 | 0.2606 |
| 156 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 156 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6222 | 0.4667 | 0.9778 | 0.3556 |
| 157 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7415 | 0.7058 | 0.8495 | 0.1080 |
| 157 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 157 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7164 | 0.6325 | 0.8987 | 0.1824 |
| 157 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 157 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 158 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 158 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6920 | 0.6872 | 0.8901 | 0.1982 |
| 158 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 158 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 158 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 159 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 159 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7505 | 0.7457 | 0.8901 | 0.1397 |
| 159 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7385 | 0.6723 | 0.8987 | 0.1602 |
| 159 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 159 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 160 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 160 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8044 | 0.7997 | 0.8901 | 0.0857 |
| 160 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7867 | 0.7210 | 0.8987 | 0.1120 |
| 160 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 160 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 161 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 161 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 161 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 161 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 161 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 162 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7662 | 0.7304 | 0.9762 | 0.2100 |
| 162 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7557 | 0.7461 | 1.0000 | 0.2443 |
| 162 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7480 | 0.6723 | 1.0000 | 0.2520 |
| 162 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 0.8889 | 0.2083 |
| 162 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6667 | 0.5333 | 1.0000 | 0.3333 |
| 163 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 163 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 163 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 163 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 163 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 164 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8299 | 0.8061 | 0.9762 | 0.1463 |
| 164 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8334 | 0.8287 | 1.0000 | 0.1666 |
| 164 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8139 | 0.7628 | 1.0000 | 0.1861 |
| 164 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 164 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 165 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 165 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9054 | 0.9007 | 1.0000 | 0.0946 |
| 165 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8760 | 0.8433 | 1.0000 | 0.1240 |
| 165 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8681 | 0.7569 | 0.8889 | 0.0208 |
| 165 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 166 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 166 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 166 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9623 | 0.9504 | 1.0000 | 0.0377 |
| 166 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 166 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 167 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9405 | 0.9762 | 0.0238 |
| 167 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 167 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9782 | 0.9663 | 1.0000 | 0.0218 |
| 167 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 167 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 168 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 168 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 168 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 168 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 168 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 169 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 169 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 169 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 169 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 169 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 170 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7075 | 0.6556 | 0.9762 | 0.2687 |
| 170 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6541 | 0.6446 | 1.0000 | 0.3459 |
| 170 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6750 | 0.5667 | 1.0000 | 0.3250 |
| 170 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 0.8889 | 0.3611 |
| 170 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6222 | 0.4000 | 1.0000 | 0.3778 |
| 171 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 171 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 171 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 171 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 171 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 172 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7662 | 0.7304 | 0.9762 | 0.2100 |
| 172 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7557 | 0.7461 | 1.0000 | 0.2443 |
| 172 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7480 | 0.6723 | 1.0000 | 0.2520 |
| 172 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6806 | 0.5694 | 0.8889 | 0.2083 |
| 172 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6667 | 0.5333 | 1.0000 | 0.3333 |
| 173 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 173 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8080 | 0.8033 | 1.0000 | 0.1920 |
| 173 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8007 | 0.7498 | 1.0000 | 0.1993 |
| 173 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 173 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7222 | 0.6000 | 1.0000 | 0.2778 |
| 174 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8759 | 0.8580 | 0.9762 | 0.1003 |
| 174 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9054 | 0.9007 | 1.0000 | 0.0946 |
| 174 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8760 | 0.8433 | 1.0000 | 0.1240 |
| 174 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8681 | 0.7569 | 0.8889 | 0.0208 |
| 174 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 175 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9022 | 0.8903 | 0.9762 | 0.0740 |
| 175 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 175 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9177 | 0.8968 | 1.0000 | 0.0823 |
| 175 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 175 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 176 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9405 | 0.9762 | 0.0238 |
| 176 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 176 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9782 | 0.9663 | 1.0000 | 0.0218 |
| 176 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 176 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 177 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 177 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 177 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 177 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 177 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 178 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7355 | 0.6879 | 0.9821 | 0.2466 |
| 178 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7734 | 0.7638 | 0.9748 | 0.2015 |
| 178 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7473 | 0.6653 | 0.9683 | 0.2210 |
| 178 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 1.0000 | 0.3403 |
| 178 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6000 | 0.9778 | 0.2111 |
| 179 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 179 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 179 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 179 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 179 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 180 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8231 | 0.7934 | 0.9821 | 0.1590 |
| 180 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8666 | 0.8618 | 0.9748 | 0.1083 |
| 180 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8273 | 0.7697 | 0.9683 | 0.1410 |
| 180 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7361 | 0.6250 | 1.0000 | 0.2639 |
| 180 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8889 | 0.8000 | 0.9778 | 0.0889 |
| 181 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8257 | 0.9821 | 0.1327 |
| 181 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 181 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8332 | 0.7697 | 0.9683 | 0.1350 |
| 181 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 181 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 182 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9073 | 0.9014 | 0.9821 | 0.0748 |
| 182 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 182 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9012 | 0.8858 | 0.9683 | 0.0670 |
| 182 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 182 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 183 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 183 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 183 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 183 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 183 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 184 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 184 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 184 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 184 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 184 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 185 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 185 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 185 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 185 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 185 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 186 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7143 | 0.6556 | 0.9821 | 0.2679 |
| 186 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6212 | 0.6164 | 0.9748 | 0.3536 |
| 186 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6853 | 0.5777 | 0.9683 | 0.2829 |
| 186 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 186 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6333 | 0.4000 | 0.9778 | 0.3444 |
| 187 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 187 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 187 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 187 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 187 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 188 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7355 | 0.6879 | 0.9821 | 0.2466 |
| 188 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7734 | 0.7638 | 0.9748 | 0.2015 |
| 188 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7473 | 0.6653 | 0.9683 | 0.2210 |
| 188 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 1.0000 | 0.3403 |
| 188 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7667 | 0.6000 | 0.9778 | 0.2111 |
| 189 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8172 | 0.7815 | 0.9821 | 0.1650 |
| 189 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8366 | 0.8319 | 0.9748 | 0.1382 |
| 189 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7960 | 0.7359 | 0.9683 | 0.1723 |
| 189 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7361 | 0.6250 | 1.0000 | 0.2639 |
| 189 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8889 | 0.8000 | 0.9778 | 0.0889 |
| 190 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8257 | 0.9821 | 0.1327 |
| 190 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 190 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8332 | 0.7697 | 0.9683 | 0.1350 |
| 190 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 190 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 191 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8733 | 0.8614 | 0.9821 | 0.1088 |
| 191 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 191 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8729 | 0.8391 | 0.9683 | 0.0953 |
| 191 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 191 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 192 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 192 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 192 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 192 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 192 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 193 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 193 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 193 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 193 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 193 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 194 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7117 | 0.6641 | 0.8495 | 0.1378 |
| 194 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6006 | 0.6006 | 0.8901 | 0.2896 |
| 194 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6714 | 0.5699 | 0.8987 | 0.2274 |
| 194 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 194 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6222 | 0.5333 | 0.9778 | 0.3556 |
| 195 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 195 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 195 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 195 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 195 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 196 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 196 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 196 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7253 | 0.6503 | 0.8987 | 0.1734 |
| 196 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 196 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 197 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 197 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7205 | 0.7158 | 0.8901 | 0.1696 |
| 197 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 197 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 197 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 198 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 198 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8044 | 0.7997 | 0.8901 | 0.0857 |
| 198 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7867 | 0.7210 | 0.8987 | 0.1120 |
| 198 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 198 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 199 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7713 | 0.7474 | 0.8495 | 0.0782 |
| 199 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8330 | 0.8282 | 0.8901 | 0.0571 |
| 199 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8313 | 0.7745 | 0.8987 | 0.0674 |
| 199 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 199 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 200 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 200 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8806 | 0.8759 | 0.8901 | 0.0095 |
| 200 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8944 | 0.8638 | 0.8987 | 0.0043 |
| 200 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 200 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 201 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8435 | 0.8316 | 0.8495 | 0.0060 |
| 201 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8806 | 0.8759 | 0.8901 | 0.0095 |
| 201 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8944 | 0.8638 | 0.8987 | 0.0043 |
| 201 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 201 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9556 | 0.8667 | 0.9778 | 0.0222 |
| 202 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.6701 | 0.6173 | 0.8495 | 0.1794 |
| 202 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.4937 | 0.4841 | 0.8901 | 0.3965 |
| 202 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6318 | 0.5241 | 0.8987 | 0.2670 |
| 202 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.3750 | 0.2639 | 0.6597 | 0.2847 |
| 202 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.5111 | 0.3333 | 0.9778 | 0.4667 |
| 203 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8435 | 0.8495 | 0.0000 |
| 203 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8901 | 0.8854 | 0.8901 | 0.0000 |
| 203 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8987 | 0.8768 | 0.8987 | 0.0000 |
| 203 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 0.6597 | 0.0000 |
| 203 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 204 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7355 | 0.6939 | 0.8495 | 0.1139 |
| 204 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6006 | 0.6006 | 0.8901 | 0.2896 |
| 204 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6872 | 0.5858 | 0.8987 | 0.2115 |
| 204 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5625 | 0.4514 | 0.6597 | 0.0972 |
| 204 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 205 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 205 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6305 | 0.6305 | 0.8901 | 0.2596 |
| 205 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7253 | 0.6503 | 0.8987 | 0.1734 |
| 205 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6181 | 0.5069 | 0.6597 | 0.0417 |
| 205 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.5333 | 0.9778 | 0.3333 |
| 206 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 206 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7205 | 0.7158 | 0.8901 | 0.1696 |
| 206 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7342 | 0.6593 | 0.8987 | 0.1645 |
| 206 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 206 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7556 | 0.6667 | 0.9778 | 0.2222 |
| 207 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7653 | 0.7355 | 0.8495 | 0.0842 |
| 207 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7600 | 0.7552 | 0.8901 | 0.1302 |
| 207 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7450 | 0.6852 | 0.8987 | 0.1537 |
| 207 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 207 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 208 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7772 | 0.7594 | 0.8495 | 0.0723 |
| 208 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8330 | 0.8282 | 0.8901 | 0.0571 |
| 208 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8373 | 0.7924 | 0.8987 | 0.0614 |
| 208 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6389 | 0.5278 | 0.6597 | 0.0208 |
| 208 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8222 | 0.7333 | 0.9778 | 0.1556 |
| 209 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 209 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 209 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 209 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 209 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 210 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8019 | 0.7781 | 0.9762 | 0.1743 |
| 210 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7890 | 0.7842 | 1.0000 | 0.2110 |
| 210 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7783 | 0.7210 | 1.0000 | 0.2217 |
| 210 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 210 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7111 | 0.6667 | 1.0000 | 0.2889 |
| 211 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 211 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 211 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 211 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 211 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 212 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8495 | 0.8257 | 0.9762 | 0.1267 |
| 212 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8493 | 0.8446 | 1.0000 | 0.1507 |
| 212 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8447 | 0.7965 | 1.0000 | 0.1553 |
| 212 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 212 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7444 | 0.6667 | 1.0000 | 0.2556 |
| 213 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9167 | 0.8988 | 0.9762 | 0.0595 |
| 213 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9340 | 0.9293 | 1.0000 | 0.0660 |
| 213 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9474 | 0.9147 | 1.0000 | 0.0526 |
| 213 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 213 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7778 | 0.7333 | 1.0000 | 0.2222 |
| 214 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9405 | 0.9762 | 0.0238 |
| 214 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 214 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9623 | 0.9504 | 1.0000 | 0.0377 |
| 214 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 214 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.8667 | 1.0000 | 0.1333 |
| 215 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 215 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 215 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 215 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 215 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 216 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 216 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 216 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 216 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 216 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 217 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 217 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 217 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 217 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 217 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 218 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7134 | 0.6675 | 0.9762 | 0.2628 |
| 218 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6795 | 0.6700 | 1.0000 | 0.3205 |
| 218 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6815 | 0.5797 | 1.0000 | 0.3185 |
| 218 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5833 | 0.3611 | 0.8889 | 0.3056 |
| 218 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6444 | 0.4667 | 1.0000 | 0.3556 |
| 219 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9762 | 0.9702 | 0.9762 | 0.0000 |
| 219 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 219 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 219 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 219 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 220 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8138 | 0.7840 | 0.9762 | 0.1624 |
| 220 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7890 | 0.7842 | 1.0000 | 0.2110 |
| 220 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7942 | 0.7368 | 1.0000 | 0.2058 |
| 220 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 220 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6889 | 0.6000 | 1.0000 | 0.3111 |
| 221 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8478 | 0.8240 | 0.9762 | 0.1284 |
| 221 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8239 | 0.8192 | 1.0000 | 0.1761 |
| 221 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8320 | 0.7787 | 1.0000 | 0.1680 |
| 221 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7014 | 0.5903 | 0.8889 | 0.1875 |
| 221 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.7444 | 0.6667 | 1.0000 | 0.2556 |
| 222 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9167 | 0.8988 | 0.9762 | 0.0595 |
| 222 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 222 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9474 | 0.9147 | 1.0000 | 0.0526 |
| 222 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 222 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 223 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9345 | 0.9226 | 0.9762 | 0.0417 |
| 223 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9388 | 0.9388 | 1.0000 | 0.0612 |
| 223 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9623 | 0.9504 | 1.0000 | 0.0377 |
| 223 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 223 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.8000 | 1.0000 | 0.2000 |
| 224 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9762 | 0.0179 |
| 224 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 224 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9841 | 0.9841 | 1.0000 | 0.0159 |
| 224 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.8889 | 0.7778 | 0.8889 | 0.0000 |
| 224 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 225 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 225 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 225 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 225 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 225 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 226 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7696 | 0.7219 | 0.9821 | 0.2126 |
| 226 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7985 | 0.7938 | 0.9748 | 0.1763 |
| 226 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7806 | 0.7051 | 0.9683 | 0.1877 |
| 226 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 1.0000 | 0.3403 |
| 226 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8000 | 0.6667 | 0.9778 | 0.1778 |
| 227 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 227 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 227 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 227 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 227 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 228 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8435 | 0.8138 | 0.9821 | 0.1386 |
| 228 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9023 | 0.8975 | 0.9748 | 0.0726 |
| 228 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8273 | 0.7697 | 0.9683 | 0.1410 |
| 228 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 228 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8889 | 0.8000 | 0.9778 | 0.0889 |
| 229 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8614 | 0.8495 | 0.9821 | 0.1207 |
| 229 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 229 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8481 | 0.8054 | 0.9683 | 0.1201 |
| 229 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 229 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 230 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9277 | 0.9218 | 0.9821 | 0.0544 |
| 230 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9544 | 0.9497 | 0.9748 | 0.0204 |
| 230 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9102 | 0.9037 | 0.9683 | 0.0581 |
| 230 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 230 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 231 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 231 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 231 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 231 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 231 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 232 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 232 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 232 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 232 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 232 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 233 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9643 | 0.9643 | 0.9821 | 0.0179 |
| 233 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 233 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 233 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 233 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 234 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7202 | 0.6675 | 0.9821 | 0.2619 |
| 234 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.6371 | 0.6323 | 0.9748 | 0.3378 |
| 234 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.6943 | 0.5777 | 0.9683 | 0.2740 |
| 234 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.5278 | 0.3611 | 1.0000 | 0.4722 |
| 234 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.6556 | 0.4667 | 0.9778 | 0.3222 |
| 235 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9821 | 0.9821 | 0.9821 | 0.0000 |
| 235 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 235 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9683 | 0.9683 | 0.9683 | 0.0000 |
| 235 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 1.0000 | 1.0000 | 1.0000 | 0.0000 |
| 235 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |
| 236 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.7874 | 0.7398 | 0.9821 | 0.1947 |
| 236 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.7985 | 0.7938 | 0.9748 | 0.1763 |
| 236 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.7806 | 0.7051 | 0.9683 | 0.1877 |
| 236 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.6597 | 0.5486 | 1.0000 | 0.3403 |
| 236 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8667 | 0.7333 | 0.9778 | 0.1111 |
| 237 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8231 | 0.7934 | 0.9821 | 0.1590 |
| 237 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.8666 | 0.8618 | 0.9748 | 0.1083 |
| 237 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8273 | 0.7697 | 0.9683 | 0.1410 |
| 237 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.7361 | 0.6250 | 1.0000 | 0.2639 |
| 237 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.8889 | 0.8000 | 0.9778 | 0.0889 |
| 238 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8614 | 0.8495 | 0.9821 | 0.1207 |
| 238 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9181 | 0.9134 | 0.9748 | 0.0567 |
| 238 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8481 | 0.8054 | 0.9683 | 0.1201 |
| 238 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 238 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 239 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.8971 | 0.8912 | 0.9821 | 0.0850 |
| 239 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9385 | 0.9338 | 0.9748 | 0.0363 |
| 239 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.8948 | 0.8728 | 0.9683 | 0.0735 |
| 239 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9236 | 0.8125 | 1.0000 | 0.0764 |
| 239 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9111 | 0.8667 | 0.9778 | 0.0667 |
| 240 | fidelity:body-covered | 66 | 80 | C1,C2,C3,C4,C5,C6,C7 | 0.9583 | 0.9524 | 0.9821 | 0.0238 |
| 240 | fidelity:span-only | 51 | 54 | C1,C2,C3,C4,C5,C6,C7 | 0.9748 | 0.9701 | 0.9748 | 0.0000 |
| 240 | language:zh | 64 | 89 | C1,C2,C3,C4,C5,C6,C7 | 0.9524 | 0.9524 | 0.9683 | 0.0159 |
| 240 | language:en | 15 | 19 | C1,C3,C4,C5,C6,C7 | 0.9444 | 0.8333 | 1.0000 | 0.0556 |
| 240 | language:mixed | 15 | 26 | C1,C3,C5,C6,C7 | 0.9778 | 0.9333 | 0.9778 | 0.0000 |

The ceiling uses the complete ranking and all spans, including for s1 arms. JSON retains exhaustive per-query, stratum and provenance data.

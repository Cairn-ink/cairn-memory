# 2B synthetic real-model probe

Date: 2026-09-07. Developer-preview smoke evidence, **not a quality benchmark**.
Node 22.16.0; Ollama 0.5.11; local `deepseek-r1:14b`, Q4_K_M, 14.8B,
model digest `ea35dfe18182f635ee2b214ea30b7520fe1ada68da018f8b395b444b662d4f1a`.
Existing local weights were used; no download or cloud API key was required.
Host: RTX 3080 plus CPU; performance is specific to this environment.

Input: “Please remember my preference: I like concise explanations formatted as
bullet points.” The model extracted “The user prefers concise explanations
formatted as bullet points.” with kind `preference` and an exact source excerpt.
Its confidence of 1 is self-reported, not a calibrated quality score.

| Case | Direct engine run | Actual stdio MCP run |
| --- | --- | --- |
| Real extraction + exact input receipt | pass, 39,216 ms including cold loading | pass, 7,877 ms |
| Replay after reopening/restarting | duplicate, 2 ms | duplicate, 5 ms |
| “How should you format explanations for me?” | correct sourced memory, 3,791 ms | correct sourced memory, 6,433 ms |
| “What is the capital of Peru?” | no memories, 1,034 ms | no memories, 1,027 ms |
| Another owner | no memories, no model call | no memories, 3 ms |
| Another project | covered in deterministic tests | no memories, 3 ms |
| Explicit correction to detailed paragraphs | only corrected content, 3,709 ms | only corrected content, 3,968 ms |
| Forget then recall | no memories, no model call | no memories, 2 ms |

These initial two probe runs passed, but follow-up runs below failed. The
direct run's cold extraction exceeded the default 30-second model timeout; the
probe explicitly uses 120 seconds. Use an appropriate timeout or prewarm your
chosen model. No inference-provider billing was involved; electricity/hardware
cost was not measured. This is one English preference fixture across two paths,
not broad extraction accuracy, multilingual coverage, adversarial robustness,
or proof of superiority over another memory product. Model interpretation may
still be wrong despite a valid source reference. No OS-level outbound firewall
was installed during these probes.

Commands and synthetic fixtures are versioned in `examples/probe-local-model.mjs`
and `runtime/probe.mjs`; see [setup](../local-engine.md). CI runs deterministic
mock/real-SQLite/real-MCP transport tests without downloading models. The final
PR records candidate SHA, final checks and any follow-up probe results.

## Follow-up failures — release gate remains blocked

A clean-source archive of candidate `ee855e0`, installed only from the public
runtime lockfile and run with a cleared environment, failed the same actual MCP
probe. Extraction (11,319 ms), restart replay (4 ms), and relevant recall
(2,926 ms) passed. The unrelated factual query incorrectly returned the stored
formatting preference (2,653 ms). The probe exited 1 at that assertion; its later
steps were not executed. Deterministic tests in that clean archive passed.

The recall prompt was then clarified to require direct subject relevance and to
exclude formatting preferences from unrelated factual questions. Another fresh
MCP probe still failed: extraction 8,268 ms, replay 3 ms, relevant recall
3,085 ms, and the same false positive at 2,740 ms. It also exited 1 and did not
execute later steps. No query-specific filtering or fixture exceptions were
added, and the probe assertion has not been weakened.

Total observed end-to-end runs: **two passed, two failed**, across the original
and clarified prompts. This tiny, repeated fixture is not an accuracy estimate;
it establishes that the bundled model/configuration does not reliably satisfy
the unrelated-query requirement. Schema-valid IDs and real receipts do not
guarantee semantic relevance. The prompt change is not a demonstrated fix.

**Keep the delivery PR draft.** Before marking it ready, address this failure
and verify direct relevance across fresh positive/negative fixtures (including
non-formatting memories), retaining all outcomes. Deterministic safety gates
and a successful transport smoke test are not substitutes for that evidence.

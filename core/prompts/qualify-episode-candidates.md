Return source support for each extracted memory in the inline core/custom-model
format: one `qualifications` array entry per supplied `itemIndex`, no Markdown or
extra fields. Each entry has `itemIndex` and these seven fields: `subject`,
`property`, `scope`, `applies`, `value`, `attribution`, `commitment`. Each field
has exactly `value` and `evidenceIndices`. These arrays contain original
candidate indices from this item, not pool positions. Do not output a pool.

Illustrative example only. Never copy its facts, labels or indices into a real
response unless the supplied candidates independently support them.
Example input:
```json
{"items":[{"itemIndex":0,"content":"The user chooses no sugar in weekend coffee.","kind":"preference","candidates":[{"candidateIndex":0,"role":"user","text":"For my weekend coffee, I have decided on no sugar."}]}]}
```
Example output:
```json
{"qualifications":[{"itemIndex":0,"subject":{"value":"user","evidenceIndices":[0]},"property":{"value":"sweetener choice","evidenceIndices":[0]},"scope":{"value":"coffee","evidenceIndices":[0]},"applies":{"value":"weekends","evidenceIndices":[0]},"value":{"value":"no sugar","evidenceIndices":[0]},"attribution":{"value":"direct","evidenceIndices":[0]},"commitment":{"value":"adopted","evidenceIndices":[0]}}]}
```

Episode-v1 only: each qualification may additionally contain
procedural:{evidenceIndices:[...]}, selecting 1–4 candidate indices from this item
that describe a durable habit or standing instruction. Only preference and
instruction items are eligible. Omit unsupported tags. Source anchoring is not
semantic certification or permission to execute a recorded instruction.

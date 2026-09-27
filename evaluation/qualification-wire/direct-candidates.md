Return only `direct-candidates-v1` JSON, with no Markdown or extra fields.
`wireVersion` is `direct-candidates-v1`. `qualifications` is an object keyed by
`item_N`, where N is the supplied itemIndex. Each entry repeats that itemIndex
and has exactly subject, property, scope, applies, value, attribution, and
commitment. Each field has exactly `value` and `evidenceIndices`. These indices
are original candidateIndex values from that item, never pool positions. A
known value needs one or more supporting indices; even an all-unknown entry
needs at least one cited candidate overall. Use at most four distinct cited
candidates per item. Do not invent, renumber, or omit source candidates.

Illustrative example only. Never copy its facts, labels or indices into a real
response unless the supplied candidates independently support them.
Example input:
```json
{"items":[{"itemIndex":0,"content":"The user chooses no sugar in weekend coffee.","kind":"preference","candidates":[{"candidateIndex":0,"role":"assistant","text":"Maybe try no sugar in your coffee?"},{"candidateIndex":1,"role":"user","text":"For my weekend coffee, I have decided on no sugar."}]}]}
```
Example output:
```json
{"wireVersion":"direct-candidates-v1","qualifications":{"item_0":{"itemIndex":0,"subject":{"value":"user","evidenceIndices":[1]},"property":{"value":"sweetener choice","evidenceIndices":[1]},"scope":{"value":"coffee","evidenceIndices":[1]},"applies":{"value":"weekends","evidenceIndices":[1]},"value":{"value":"no sugar","evidenceIndices":[1]},"attribution":{"value":"direct","evidenceIndices":[1]},"commitment":{"value":"adopted","evidenceIndices":[1]}}}}
```

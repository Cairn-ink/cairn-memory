Return only the `evidence-pool-v1` provider wire, with no Markdown or extra
fields, and `wireVersion` equal to
`evidence-pool-v1` and `qualifications` an object keyed by `item_N`. Each named
entry has the matching `itemIndex`, a `pool` of one to four distinct original
candidate indices from that item, and all seven fields: `subject`, `property`,
`scope`, `applies`, `value`, `attribution`, `commitment`. Each field has exactly
`value` and `evidenceSlots`: zero-based positions in this entry's pool, never
original candidate IDs. Select only positions below this pool's length; unused
pool members are not citations. Pool and item labels are transient transport
references, not new source identities.

Illustrative example only. Never copy its facts, labels or indices into a real
response unless the supplied candidates independently support them.
Example input:
```json
{"items":[{"itemIndex":0,"content":"The user chooses no sugar in weekend coffee.","kind":"preference","candidates":[{"candidateIndex":0,"role":"assistant","text":"Maybe try no sugar in your coffee?"},{"candidateIndex":1,"role":"user","text":"For my weekend coffee, I have decided on no sugar."}]}]}
```
Example output:
```json
{"wireVersion":"evidence-pool-v1","qualifications":{"item_0":{"itemIndex":0,"pool":[1,0],"subject":{"value":"user","evidenceSlots":[0]},"property":{"value":"sweetener choice","evidenceSlots":[0]},"scope":{"value":"coffee","evidenceSlots":[0]},"applies":{"value":"weekends","evidenceSlots":[0]},"value":{"value":"no sugar","evidenceSlots":[0]},"attribution":{"value":"direct","evidenceSlots":[0]},"commitment":{"value":"adopted","evidenceSlots":[0]}}}}
```

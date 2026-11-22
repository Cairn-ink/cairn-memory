# Privacy vectors

`cases.json` contains 325 synthetic inputs. The generators called the shipped
hosted and engine exports on these inputs and recorded their outputs. Every
credential and key in the fixtures is synthetic.

`expected.json` projects the original output onto the fields used by these
tests. Text entries index a shared table of escaped UTF-16 code units and UTF-8
hex bytes. A refusal is stored as an error code. The hosted v1 digest comes
from the legacy hash when emitted and from the current hash when both agree.

For this corpus the union reference applies the shipped frozen redactor to
the hosted redaction output. Prepared text uses the hosted capture output
with that same extra pass, then collapses whitespace and trims. Its digest
oracles use the hosted hash and an independent HMAC with a fixed fake key.
The withholding cases also exercise the hosted exact, key mismatch,
containment, and memory policy helpers with synthetic fingerprints.

The input file is 162,153 bytes and the projected expected file is 1,799,177
bytes. The full expected output was 8,471,155 bytes. It also recorded
streaming and storage behavior for qualification.

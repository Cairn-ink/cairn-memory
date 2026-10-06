# Claude plugin skill transcript fixture

`claude-plugin-status.jsonl` is a synthetic reconstruction, not a recorded user
transcript. Its command-name/message/args envelope follows the observed Claude
Code 2.1.283 interactive fixture in this directory. Read-only inspection on
2026-10-06 also confirmed these shapes in existing interactive transcripts:
command envelopes without `promptSource`; assistant `tool_use` blocks named
`Skill` with `input.skill` (and optional `args`); and an `isMeta: true` user
expansion starting `Base directory for this skill:` without `promptSource`.
Only marker structure and flags were inspected; original bodies are not retained.
The installed Claude Code 2.1.289 binary also carries this skill-header literal.

Skill names, paths, IDs and all text here are synthetic substitutions. The
status invocation and assistant output reproduce the shape of chichi's 10/6
report. Additional assistant messages and a meta record check the whole-turn
boundary. The normal turns include a conversational mention of “cairn memory
status” and records without UUIDs to check legacy fallback identities.

This evidence covers these marker shapes; it does not establish that all Claude
Code versions write the same format.

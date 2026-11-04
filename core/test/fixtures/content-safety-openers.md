The adjacent archive freezes exact runtime sources for history-independent
compatibility and read-open cost tests. It contains root core modules, their
SQL and prompts, and the retained redactor, with deterministic entry metadata.

- `legacy/`: commit `40d5ddbb`, before the safety physical cells were accepted.
- `baseline/`: commit `d0d88512`, before review round 1 and opt-in creation.

The tests execute these unmodified implementations, including the old finite
version lists, against synthetic stores. No Git commands or historical objects
are needed at test execution time. The archive contains no store or user data.

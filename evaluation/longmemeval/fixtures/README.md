# Pinned upstream prompt parity fixtures

These expected prompt bytes were produced by executing only the AST-extracted
`get_anscheck_prompt` function from
[`src/evaluation/evaluate_qa.py`](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py)
at commit `9e0b455f4ef0e2ab8f2e582289761153549043fc` (Di Wu, MIT; full
license in `UPSTREAM-LICENSE`). The source was read through GitHub's content
API. Python's `ast.parse`, `ast.FunctionDef` selection, `compile`, and `exec`
were applied to that function alone in an isolated process; imports, SDK,
backoff decorator, and `__main__` were never executed. Inputs cover all six
task types, the abstention override, and braces/newlines in supplied strings.
The pinned complete `evaluate_qa.py` source has SHA-256
`ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251`.
`generate-upstream-prompts.py` checks this hash before extracting the function
and printing the fixture. Reproduce from this directory with:

```sh
gh api 'repos/xiaowu0162/LongMemEval/contents/src/evaluation/evaluate_qa.py?ref=9e0b455f4ef0e2ab8f2e582289761153549043fc' --jq '.content' \
  | base64 -d | python3 generate-upstream-prompts.py
```

The printed JSON should match `upstream-prompts.json` byte-for-byte.

The original `upstream-prompts.json` fixture remains string-only. For typed
references, `generate-upstream-prompts.py --typed-hashes` executes the same
hash-checked pinned function and prints six expected prompt SHA-256 values
in `upstream-typed-prompt-hashes.json`. These cover Python formatting of
integers, floats, negative zero, a beyond-JS-safe integer and a mixed array;
they do not establish provider behavior or public-corpus accuracy.

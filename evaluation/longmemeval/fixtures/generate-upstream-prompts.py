"""Print the checked-in fixtures from pinned evaluate_qa.py on stdin.

Only the pure get_anscheck_prompt AST node is executed. This script does not
import or execute upstream SDK, decorator, backoff, or main code.
"""

import ast
import hashlib
import json
import sys


EXPECTED_SHA256 = "ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251"
source = sys.stdin.read()
if hashlib.sha256(source.encode("utf-8")).hexdigest() != EXPECTED_SHA256:
    raise SystemExit("pinned upstream source hash mismatch")

module = ast.parse(source)
function = next(node for node in module.body
                if isinstance(node, ast.FunctionDef) and node.name == "get_anscheck_prompt")
namespace = {}
exec(compile(ast.Module(body=[function], type_ignores=[]),
             "<pinned-upstream-pure-function>", "exec"), namespace)

inputs = [
    ("single-session-user", "Where?", "Kyoto", "Kyoto", False),
    ("single-session-assistant", "What?", "blue", "blue", False),
    ("multi-session", "Which?", "first and second", "first and second", False),
    ("temporal-reasoning", "How many days?", "18 days", "19 days", False),
    ("knowledge-update", "What is current?", "new", "old, then new", False),
    ("single-session-preference", "What suits me?", "Use personal info", "I prefer hiking", False),
    ("single-session-user", "What secret?", "Not stated", "unknown", True),
    ("multi-session", "Curly {q}?", "brace {answer}", "line one\nline two", False),
]

if sys.argv[1:] == ["--typed-hashes"]:
    typed = [
        ("integer", 3), ("float", 3.0), ("large", 9007199254740993),
        ("negative-zero", -0.0), ("exponent", 1e2),
        ("array", [3.0, "a", "it's", 'quo"te']),
    ]
    print(json.dumps([{"id": case_id, "prompt_sha256": hashlib.sha256(
        namespace["get_anscheck_prompt"]("single-session-user", "What?", answer,
                                         "answer", False).encode("utf-8")).hexdigest()}
        for case_id, answer in typed], separators=(",", ":")))
    sys.exit(0)

print("[")
for index, (question_type, question, reference, response, abstention) in enumerate(inputs):
    case = {
        "questionType": question_type,
        "question": question,
        "reference": reference,
        "response": response,
        "abstention": abstention,
        "prompt": namespace["get_anscheck_prompt"](
            question_type, question, reference, response, abstention),
    }
    print("  " + json.dumps(case, ensure_ascii=False, separators=(",", ":"))
          + ("," if index < len(inputs) - 1 else ""))
print("]")

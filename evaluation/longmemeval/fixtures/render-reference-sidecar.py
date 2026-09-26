"""Offline, evaluator-only Python str(answer) rendering from pinned source bytes.

No upstream code, SDK, network, or model provider is imported or executed.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys


SCHEMA = "cairn-longmemeval-reference-rendering-v1"
PREPARATION_SCHEMA = "cairn-longmemeval-preparation-v2"
RENDERER = "python3-json-load-str-v1"
SHA256 = re.compile(r"^[a-f0-9]{64}$")


class RenderingError(Exception):
    pass


def fail(code):
    raise RenderingError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_file(filename, code):
    try:
        if not filename.is_file() or filename.is_symlink():
            fail(code)
        return filename.read_bytes()
    except OSError:
        fail(code)


def parse_json(data, code):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                fail(code)
            result[key] = value
        return result

    def invalid_constant(_value):
        fail(code)

    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique_pairs,
                          parse_constant=invalid_constant)
    except (UnicodeError, ValueError):
        fail(code)


def supported_scalar(value):
    return isinstance(value, str) or isinstance(value, int) and not isinstance(value, bool) or (
        isinstance(value, float) and math.isfinite(value)
    )


def supported_answer(value):
    return supported_scalar(value) or (isinstance(value, list) and len(value) > 0
                                       and all(supported_scalar(item) for item in value))


def same_js_projection(source, evaluator):
    """Compare the value visible after preparation's JSON.parse/JSON.stringify.

    Integer/float distinctions erased by JS are intentionally allowed; the
    authoritative rendering always comes from the source-side Python value.
    """
    if isinstance(source, str) or isinstance(evaluator, str):
        return isinstance(source, str) and isinstance(evaluator, str) and source == evaluator
    if isinstance(source, list) or isinstance(evaluator, list):
        return isinstance(source, list) and isinstance(evaluator, list) \
            and len(source) == len(evaluator) and all(
                same_js_projection(left, right) for left, right in zip(source, evaluator))
    if not supported_scalar(source) or not supported_scalar(evaluator):
        return False
    try:
        return math.isfinite(float(source)) and float(source) == float(evaluator)
    except (OverflowError, ValueError):
        return False


def build(source_path, prepared_path):
    source_bytes = read_file(source_path, "invalid_source")
    manifest_bytes = read_file(prepared_path / "manifest.json", "invalid_manifest")
    evaluator_bytes = read_file(prepared_path / "evaluator.jsonl", "invalid_evaluator")
    manifest = parse_json(manifest_bytes, "invalid_manifest")
    if not isinstance(manifest, dict) or manifest.get("schema_version") != PREPARATION_SCHEMA:
        fail("invalid_manifest")
    dataset = manifest.get("dataset")
    selection = manifest.get("selection")
    artifacts = manifest.get("artifacts")
    if not all(isinstance(value, dict) for value in (dataset, selection, artifacts)):
        fail("invalid_manifest")
    source_sha = dataset.get("input_sha256")
    evaluator_meta = artifacts.get("evaluator")
    if not isinstance(source_sha, str) or not SHA256.fullmatch(source_sha) or digest(source_bytes) != source_sha:
        fail("source_digest_mismatch")
    if not isinstance(evaluator_meta, dict) or evaluator_meta.get("filename") != "evaluator.jsonl" \
            or evaluator_meta.get("sha256") != digest(evaluator_bytes) \
            or evaluator_meta.get("byte_count") != len(evaluator_bytes):
        fail("evaluator_digest_mismatch")
    source_ids = selection.get("source_question_ids")
    opaque_ids = selection.get("question_ids")
    if not isinstance(source_ids, list) or not isinstance(opaque_ids, list) or not source_ids \
            or len(source_ids) != len(opaque_ids) or selection.get("count") != len(source_ids) \
            or not all(isinstance(item, str) for item in source_ids + opaque_ids) \
            or len(set(source_ids)) != len(source_ids) or len(set(opaque_ids)) != len(opaque_ids):
        fail("invalid_manifest")
    for source_id, opaque_id in zip(source_ids, opaque_ids):
        if not isinstance(source_id, str) or not isinstance(opaque_id, str) or \
                opaque_id != "lme-case-" + digest(source_id.encode("utf-8")):
            fail("invalid_manifest")
    source = parse_json(source_bytes, "invalid_source")
    if not isinstance(source, list):
        fail("invalid_source")
    by_id = {}
    for entry in source:
        if not isinstance(entry, dict) or not isinstance(entry.get("question_id"), str) \
                or entry["question_id"] in by_id:
            fail("invalid_source")
        by_id[entry["question_id"]] = entry
    if any(source_id not in by_id for source_id in source_ids):
        fail("selection_mismatch")
    if not evaluator_bytes.endswith(b"\n") or b"\r" in evaluator_bytes:
        fail("invalid_evaluator")
    evaluator_lines = evaluator_bytes[:-1].split(b"\n")
    if len(evaluator_lines) != len(source_ids) or evaluator_meta.get("record_count") != len(source_ids):
        fail("invalid_evaluator")
    cases = []
    for index, line in enumerate(evaluator_lines):
        evaluator = parse_json(line, "invalid_evaluator")
        source_id, opaque_id = source_ids[index], opaque_ids[index]
        if not isinstance(evaluator, dict) or evaluator.get("source_question_id") != source_id \
                or evaluator.get("question_id") != opaque_id or "reference_answer" not in evaluator \
                or evaluator.get("question_type") != by_id[source_id].get("question_type"):
            fail("evaluator_mismatch")
        answer = by_id[source_id].get("answer")
        if not supported_answer(answer) or not same_js_projection(answer, evaluator["reference_answer"]):
            fail("invalid_reference")
        cases.append({"question_id": opaque_id, "source_question_id": source_id,
                      "reference_text": str(answer)})
    return {"schema_version": SCHEMA, "renderer": RENDERER,
            "python_version": ".".join(str(part) for part in sys.version_info[:3]),
            "source_sha256": source_sha, "manifest_sha256": digest(manifest_bytes),
            "evaluator_sha256": digest(evaluator_bytes), "cases": cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--prepared", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        prepared = args.prepared.resolve()
        output = args.output.resolve(strict=False)
        if output == prepared or prepared in output.parents:
            fail("invalid_output")
        sidecar = build(args.source, args.prepared)
        content = (json.dumps(sidecar, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8")
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
    except RenderingError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1
    except OSError:
        print(json.dumps({"error": "invalid_output"}), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"error": "invalid_input"}), file=sys.stderr)
        return 1
    print(json.dumps({"sidecar_sha256": digest(content), "case_count": len(sidecar["cases"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

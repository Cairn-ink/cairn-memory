"""One bounded SDK exchange; invoked only by the provider, not a user CLI."""

import json
import logging
import os
import sys

import anyio
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

SDK_TIMEOUT_SECONDS = 30
HELPER_TIMEOUT_SECONDS = 35
CAPTURE_SDK_TIMEOUT_SECONDS = 120
CAPTURE_HELPER_TIMEOUT_SECONDS = 125


async def exchange(request):
    args = [request["executable_path"], "--db", request["database"], "--owner", request["owner"]]
    if "capture_qualification" in request:
        if request["capture_qualification"] != "source-bound-v2":
            raise ValueError("invalid_capture_configuration")
        args += ["--capture-qualification", "source-bound-v2"]
    if "capture_deadline_ms" in request:
        deadline = request["capture_deadline_ms"]
        if (request.get("capture_qualification") != "source-bound-v2" or not isinstance(deadline, str)
                or not deadline.isascii() or not deadline or deadline[0] not in "123456789"
                or not deadline.isdecimal() or len(deadline) > 6 or int(deadline) > 110000):
            raise ValueError("invalid_capture_configuration")
        args += ["--capture-deadline-ms", deadline]
    if "classification_recovery" in request:
        if request["classification_recovery"] != "guarded-v1":
            raise ValueError("invalid_recovery_configuration")
        args += ["--classification-recovery", "guarded-v1"]
    if "source_candidate_policy" in request:
        if request["source_candidate_policy"] != "bounded-keyset-v1":
            raise ValueError("invalid_source_candidate_configuration")
        args += ["--source-candidate-policy", "bounded-keyset-v1"]
    uses_extended_timeout = request["operation"] == "call" and request.get("name") in {"capture_memory", "classify_unfiled_memories"}
    parameters = StdioServerParameters(command=request["node_path"],
        args=args,
        env={"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", "")})
    with open(os.devnull, "w", encoding="utf-8") as errors:
        with anyio.fail_after(CAPTURE_HELPER_TIMEOUT_SECONDS if uses_extended_timeout else HELPER_TIMEOUT_SECONDS):
            async with stdio_client(parameters, errlog=errors) as streams:
                async with ClientSession(*streams,
                                         read_timeout_seconds=CAPTURE_SDK_TIMEOUT_SECONDS if uses_extended_timeout else SDK_TIMEOUT_SECONDS) as session:
                    await session.initialize()
                    if request["operation"] == "list":
                        result = await session.list_tools()
                        if result.next_cursor:
                            raise ValueError("unexpected_pagination")
                        return [tool.model_dump(by_alias=True) for tool in result.tools]
                    result = await session.call_tool(request["name"], request["arguments"])
                    if len(result.content) != 1 or result.content[0].type != "text":
                        raise ValueError("invalid_result")
                    value = json.loads(result.content[0].text)
                    if not isinstance(value, dict) or not isinstance(value.get("ok"), bool):
                        raise ValueError("invalid_result")
                    return value


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        request = json.loads(sys.stdin.buffer.read(65537))
        output = json.dumps(anyio.run(exchange, request))
        if len(output.encode()) > 262144:
            raise ValueError("oversized_result")
        print(output)
    except Exception:
        sys.exit(1)

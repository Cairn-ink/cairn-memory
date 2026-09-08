"""One bounded SDK exchange; invoked only by the provider, not a user CLI."""

import json
import logging
import os
import sys

import anyio
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


async def exchange(request):
    parameters = StdioServerParameters(command=request["node_path"],
        args=[request["executable_path"], "--db", request["database"], "--owner", request["owner"]],
        env={"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", "")})
    with open(os.devnull, "w", encoding="utf-8") as errors:
        with anyio.fail_after(35):
            async with stdio_client(parameters, errlog=errors) as streams:
                async with ClientSession(*streams, read_timeout_seconds=30) as session:
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

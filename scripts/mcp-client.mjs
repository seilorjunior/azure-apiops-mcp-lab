import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export async function verifyTool({ url, headers, toolName, args, expected }) {
  const client = new Client({ name: 'apiops-poc-verifier', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert(result.tools.some((tool) => tool.name === toolName), `${toolName} missing from tools/list`);
    const call = await client.callTool({ name: toolName, arguments: args });
    assert(!call.isError, `tools/call failed: ${JSON.stringify(call)}`);
    const text = call.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    assert(text, 'tools/call did not return text content');
    assert.match(text, expected);
    return { tools: result.tools.map((tool) => tool.name), text };
  } finally {
    await client.close();
  }
}

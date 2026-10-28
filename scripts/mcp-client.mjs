import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** @param {{url: string, headers?: Record<string,string>, toolName: string, args?: Record<string, unknown>, expected: RegExp, timeoutMs?: number, onPhase?: (event: any) => void}} options */
export async function verifyTool({ url, headers, toolName, args, expected, timeoutMs = 60_000, onPhase = () => {} }) {
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'MCP timeout must be a positive integer.');
  const client = new Client({ name: 'apiops-poc-verifier', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  });
  let phase;
  let started;
  let failure;
  /** @type {(name: string, action: () => Promise<any>) => Promise<any>} */
  const runPhase = async (name, action) => {
    phase = name;
    started = Date.now();
    onPhase({ phase, status: 'start' });
    let timer;
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('MCP request deadline exceeded.'), { code: -32001 })), timeoutMs);
    });
    try {
      const result = await Promise.race([action(), deadline]);
      onPhase({ phase, status: 'pass', elapsedMs: Date.now() - started });
      return result;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await runPhase('initialize', () => client.connect(transport, { timeout: timeoutMs }));
    const result = await runPhase('tools/list', async () => {
      const result = await client.listTools(undefined, { timeout: timeoutMs });
      assert(result.tools.some((tool) => tool.name === toolName), 'Expected tool missing from tools/list');
      return result;
    });
    /** @type {string} */
    const text = await runPhase('tools/call', async () => {
      const call = await client.callTool({ name: toolName, arguments: args }, undefined, { timeout: timeoutMs });
      assert(!call.isError, 'tools/call failed');
      const text = /** @type {any[]} */ (call.content ?? []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
      assert(text, 'tools/call did not return text content');
      assert.match(text, expected);
      return text;
    });
    return { tools: result.tools.map((tool) => tool.name), text };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const code = Number.isSafeInteger(error.code) ? error.code : undefined;
    failure = new Error(`MCP ${phase} failed after ${elapsedMs} ms (timeout ${timeoutMs} ms${code === undefined ? '' : `, code ${code}`}). Check readiness, authentication and transport configuration.`);
    Object.assign(failure, { phase, elapsedMs, timeoutMs, code });
    onPhase({ phase, status: 'fail', elapsedMs, ...(code === undefined ? {} : { code }) });
    throw failure;
  } finally {
    try {
      await client.close();
    } catch {
      // eslint-disable-next-line no-unsafe-finally
      if (!failure) throw new Error('MCP close failed. Check transport cleanup.');
      console.error('MCP cleanup also failed; preserving the original verification failure.');
    }
  }
}

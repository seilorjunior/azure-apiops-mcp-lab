import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** @param {{url: string, headers?: Record<string,string>, toolName: string, args?: Record<string, unknown>, expected: RegExp, timeoutMs?: number, requestTimeoutMs?: number, maxRetries?: number, retryDelayMs?: number, onPhase?: (event: any) => void}} options */
export async function verifyTool({
  url, headers, toolName, args, expected, timeoutMs = 60_000,
  requestTimeoutMs = 15_000, maxRetries = 2, retryDelayMs = 250, onPhase = () => {},
}) {
  for (const value of [timeoutMs, requestTimeoutMs, retryDelayMs]) {
    assert(Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647,
      'MCP timeouts and retry delay must be positive 32-bit integers.');
  }
  assert(Number.isSafeInteger(maxRetries) && maxRetries >= 0 && maxRetries <= 5,
    'MCP maxRetries must be an integer between 0 and 5.');
  let phase;
  let phaseController;
  const client = new Client({ name: 'apiops-poc-verifier', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
    fetch: async (input, init) => {
      const method = typeof init?.body === 'string' ? JSON.parse(init.body).method : undefined;
      // Replaying a tool call can duplicate side effects, even after an HTTP error.
      const retryable = ['initialize', 'notifications/initialized', 'tools/list'].includes(method);
      const signals = [phaseController.signal, ...(init?.signal ? [init.signal] : [])];
      const signal = AbortSignal.any(signals);
      for (let attempt = 0; ; attempt++) {
        let response;
        try {
          response = await fetch(input, {
            ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]),
          });
        } catch (error) {
          if (!retryable || signal.aborted || attempt >= maxRetries ||
            !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)) throw error;
        }
        if (response && (!retryable || ![408, 429, 502, 503, 504].includes(response.status) ||
          attempt >= maxRetries)) return response;
        await response?.body?.cancel();
        const delayMs = Math.round(Math.min(5000, retryDelayMs * 2 ** attempt * (0.5 + Math.random())));
        onPhase({ phase, status: 'start', attempt: attempt + 2, retryDelayMs: delayMs,
          ...(response ? { code: response.status } : {}) });
        await sleep(delayMs, undefined, { signal });
      }
    },
  });
  let started;
  let failure;
  /** @type {(name: string, action: () => Promise<any>) => Promise<any>} */
  const runPhase = async (name, action) => {
    phase = name;
    phaseController = new AbortController();
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
      phaseController.abort();
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

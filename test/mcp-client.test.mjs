import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { verifyTool } from '../scripts/mcp-client.mjs';

async function fixture(options, action) {
  const methods = [];
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    let text = '';
    for await (const chunk of req) text += chunk;
    const message = JSON.parse(text);
    methods.push(message.method);
    if (message.method === options.transientAt &&
      methods.filter((method) => method === message.method).length <= (options.failures ?? 1)) {
      res.writeHead(options.status ?? 503).end('fixture-private-key');
      return;
    }
    if (message.method === options.hangAt) return;
    if (message.method === options.failAt) {
      res.writeHead(401, { 'content-type': 'text/plain' }).end('fixture-private-key private-subscription-url');
      return;
    }
    if (!Object.hasOwn(message, 'id')) { res.writeHead(202).end(); return; }
    const results = {
      initialize: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } },
      'tools/list': { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] },
      'tools/call': { content: [{ type: 'text', text: options.toolError ? 'fixture-private-key' : 'echo-ok' }],
        ...(options.toolError ? { isError: true } : {}) },
    };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      jsonrpc: '2.0', id: message.id, result: results[message.method],
    }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await action({
      methods,
      options: { url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { 'x-fixture-key': 'fixture-private-key' },
        toolName: 'echo', args: {}, expected: /echo-ok/ },
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('MCP diagnostics identify all protocol phases without replaying calls', async () => {
  await fixture({}, async ({ options, methods }) => {
    const phases = [];
    await verifyTool({ ...options, onPhase: (event) => phases.push(`${event.phase}:${event.status}`) });
    assert.deepEqual(phases, [
      'initialize:start', 'initialize:pass', 'tools/list:start', 'tools/list:pass', 'tools/call:start', 'tools/call:pass',
    ]);
    assert.equal(methods.filter((method) => method === 'tools/call').length, 1);
  });
});

test('MCP failures preserve safe phase, timing and code without raw response or credential text', async () => {
  for (const phase of ['initialize', 'tools/list', 'tools/call']) {
    await fixture({ failAt: phase }, async ({ options, methods }) => {
      await assert.rejects(verifyTool(options), (error) => {
        assert.equal(error.phase, phase);
        assert.ok(error.elapsedMs >= 0);
        assert.equal(error.timeoutMs, 60000);
        assert.doesNotMatch(error.stack, /fixture-private-key|private-subscription-url|127\.0\.0\.1/);
        return true;
      });
      assert.equal(methods.filter((method) => method === phase).length, 1);
    });
  }
  await fixture({ toolError: true }, async ({ options }) => {
    await assert.rejects(verifyTool(options), (error) => {
      assert.equal(error.phase, 'tools/call');
      assert.doesNotMatch(error.stack, /fixture-private-key/);
      return true;
    });
  });
});

test('MCP phase deadlines bound initialization notifications and tool calls', async () => {
  for (const hangAt of ['notifications/initialized', 'tools/call']) {
    await fixture({ hangAt }, async ({ options, methods }) => {
      const start = Date.now();
      await assert.rejects(verifyTool({ ...options, timeoutMs: 250 }), (error) => {
        assert.equal(error.phase, hangAt === 'tools/call' ? 'tools/call' : 'initialize');
        assert.equal(error.code, -32001);
        assert.equal(error.timeoutMs, 250);
        assert.ok(Date.now() - start < 3000, 'Deadline did not bound the request.');
        return true;
      });
      assert.equal(methods.filter((method) => method === hangAt).length, 1);
    });
  }
});

test('transient discovery failures retry with bounded exponential backoff', async (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  for (const phase of ['initialize', 'notifications/initialized', 'tools/list']) {
    await fixture({ transientAt: phase, failures: 2 }, async ({ options, methods }) => {
      const phases = [];
      await verifyTool({ ...options, retryDelayMs: 10, onPhase: (event) => phases.push(event) });
      assert.equal(methods.filter((method) => method === phase).length, 3);
      assert.deepEqual(phases.filter((event) => event.attempt).map((event) => event.attempt), [2, 3]);
      assert.deepEqual(phases.filter((event) => event.attempt).map((event) => event.retryDelayMs), [10, 20]);
      assert.equal(methods.filter((method) => method === 'tools/call').length, 1);
    });
  }
});

test('phase deadline cancels backoff and maxRetries zero disables retrying', async () => {
  for (const [retryDelayMs, maxRetries] of [[5000, 5], [1, 0]]) {
    await fixture({ transientAt: 'initialize', failures: 10 }, async ({ options, methods }) => {
      const started = Date.now();
      await assert.rejects(verifyTool({ ...options, retryDelayMs, maxRetries, timeoutMs: 100 }));
      assert.equal(methods.filter((method) => method === 'initialize').length, 1);
      assert.ok(Date.now() - started < 1500);
    });
  }
});

test('transient failures stop at the retry limit and never replay tools/call', async () => {
  for (const [phase, count] of [['initialize', 3], ['tools/list', 3], ['tools/call', 1]]) {
    await fixture({ transientAt: phase, failures: 10, status: 429 }, async ({ options, methods }) => {
      await assert.rejects(verifyTool({ ...options, retryDelayMs: 1 }), (error) => {
        assert.equal(error.phase, phase);
        assert.doesNotMatch(error.stack, /fixture-private-key/);
        return true;
      });
      assert.equal(methods.filter((method) => method === phase).length, count);
    });
  }
});

test('request timeouts retry discovery but stay within the phase deadline', async () => {
  await fixture({ hangAt: 'initialize' }, async ({ options, methods }) => {
    const started = Date.now();
    await assert.rejects(verifyTool({ ...options, timeoutMs: 500, requestTimeoutMs: 40, retryDelayMs: 1 }));
    assert.equal(methods.filter((method) => method === 'initialize').length, 3);
    assert.ok(Date.now() - started < 1500);
  });
});

test('MCP retry options reject invalid bounds', async () => {
  for (const options of [{ timeoutMs: 0 }, { requestTimeoutMs: -1 }, { maxRetries: 6 }, { retryDelayMs: 0 }]) {
    await assert.rejects(verifyTool({ url: 'http://localhost', toolName: 'echo', expected: /ok/, ...options }));
  }
});

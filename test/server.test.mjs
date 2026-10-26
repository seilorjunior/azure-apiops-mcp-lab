import assert from 'node:assert/strict';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { createApp } from '../src/server.mjs';
import { verifyTool } from '../scripts/mcp-client.mjs';

const key = 'local-test-key-not-a-secret-1234567890';
let server;
let base;
before(async () => {
  server = createApp(key).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
test('refuses a missing or short backend key', () => {
  assert.throws(() => createApp(), /POC_BACKEND_KEY/);
  assert.throws(() => createApp('short'), /POC_BACKEND_KEY/);
});
test('health is accessible without a secret', async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
test('MCP rejects missing and incorrect credentials', async () => {
  for (const headers of [{}, { 'x-poc-backend-key': 'x'.repeat(key.length) }]) {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers });
    assert.equal(response.status, 401);
  }
});
test('official MCP client initializes, discovers and invokes echo', async () => {
  const result = await verifyTool({
    url: `${base}/mcp`,
    headers: { 'x-poc-backend-key': key },
    toolName: 'echo',
    args: { message: 'apiops-proxy-ok' },
    expected: /apiops-proxy-ok/,
  });
  assert.deepEqual(JSON.parse(result.text), { message: 'apiops-proxy-ok', source: 'external-mcp' });
});
test('stateless server rejects GET', async () => {
  const response = await fetch(`${base}/mcp`, { headers: { 'x-poc-backend-key': key } });
  assert.equal(response.status, 405);
});
test('invalid tool input returns an MCP error', async () => {
  await assert.rejects(verifyTool({
    url: `${base}/mcp`,
    headers: { 'x-poc-backend-key': key },
    toolName: 'echo',
    args: { message: '' },
    expected: /./,
  }), /tools\/call failed/);
});
test('compressed bodies are not decompressed', async () => {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'x-poc-backend-key': key,
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    },
    body: gzipSync('{}'),
  });
  assert.equal(response.status, 415);
});

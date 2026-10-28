import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { verifyTool } from '../scripts/mcp-client.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const key = randomBytes(32).toString('hex');
const image = `apiops-mcp-lab:test-${randomUUID()}`;
const docker = (...args) => {
  const result = spawnSync('docker', args, {
    cwd: root, encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, POC_BACKEND_KEY: key },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
};

docker('info');
let container;
let built = false;
try {
  docker('build', '--quiet', '--tag', image, '.');
  built = true;
  assert.equal(docker('image', 'inspect', image, '--format', '{{.Config.User}}'), 'node');
  container = docker('run', '--detach', '--publish', '127.0.0.1::8080',
    '--env', 'POC_BACKEND_KEY', '--health-interval=1s', '--health-start-period=0s', image);
  const port = JSON.parse(docker('inspect', container))[0].NetworkSettings.Ports['8080/tcp'][0].HostPort;
  const url = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = JSON.parse(docker('inspect', container))[0].State;
    if (!state.Running) assert.fail(`Container exited: ${docker('logs', container)}`);
    if (state.Health.Status === 'healthy') { healthy = true; break; }
    await sleep(1000);
  }
  assert.ok(healthy, 'Container did not become healthy within 30 seconds.');
  const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const unauthorized = await fetch(`${url}/mcp`, { method: 'POST', signal: AbortSignal.timeout(5000) });
  assert.equal(unauthorized.status, 401);
  await verifyTool({
    url: `${url}/mcp`, headers: { 'x-poc-backend-key': key },
    toolName: 'echo', args: { message: 'container-ok' }, expected: /container-ok/,
  });
  docker('stop', '--time', '15', container);
  assert.equal(JSON.parse(docker('inspect', container))[0].State.ExitCode, 0);
  const output = docker('logs', container);
  assert.doesNotMatch(output, new RegExp(key));
  const entries = output.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(entries.every((entry) => entry.timestamp && entry.level && entry.event));
  assert.ok(entries.some((entry) => entry.event === 'server_stopping' && entry.signal === 'SIGTERM'));
  console.log('PASS: non-root container, health check, authenticated MCP, JSON logs and graceful shutdown.');
} finally {
  if (container) docker('rm', '--force', container);
  if (built) docker('image', 'rm', image);
}

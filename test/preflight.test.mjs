import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPreflight, checkBackendHealth } from '../scripts/preflight.mjs';

const subscriptionId = '00000000-0000-4000-8000-000000000001';
const group = `/subscriptions/${subscriptionId}/resourceGroups/test-rg`;
const appId = `${group}/providers/Microsoft.Web/sites/test-backend`;
const planId = `${group}/providers/Microsoft.Web/serverfarms/test-plan`;
const key = 'fixture-backend-key-at-least-32-characters';

function fixture() {
  const resources = {
    [appId]: { properties: { state: 'Running', serverFarmId: planId, defaultHostName: 'test-backend.azurewebsites.net' } },
    [planId]: { sku: { name: 'B1', tier: 'Basic' } },
    [`${appId}/config/web`]: { properties: { alwaysOn: true, healthCheckPath: '/health' } },
    [`${appId}/config/appsettings/list`]: { properties: { POC_BACKEND_KEY: key } },
  };
  for (const name of ['src', 'dst']) {
    const service = `${group}/providers/Microsoft.ApiManagement/service/${name}`;
    resources[service] = { properties: { provisioningState: 'Succeeded' } };
    resources[`${service}/backends/poc-mcp-backend`] = { properties: {
      protocol: 'http', url: 'https://test-backend.azurewebsites.net/mcp',
      credentials: { header: { 'x-poc-backend-key': ['{{poc-backend-key}}'] } },
      tls: { validateCertificateChain: true, validateCertificateName: true },
    } };
    resources[`${service}/namedValues/poc-backend-key/listValue`] = { value: key };
    resources[`${service}/namedValues/poc-backend-key`] = { properties: { secret: true } };
    resources[`${service}/subscriptions/poc-test-client`] = { properties: { state: 'active', scope: `${service}/apis` } };
    for (const api of ['poc-rest', 'poc-native', 'poc-proxy']) {
      resources[`${service}/apis/${api}`] = { properties: { type: 'mcp', backendId: 'poc-mcp-backend' } };
    }
  }
  const calls = [];
  const events = [];
  let healthCalls = 0;
  return {
    resources, calls, events,
    options: {
      subscriptionId, resourceGroup: 'test-rg', sourceApimName: 'src', targetApimName: 'dst', webappName: 'test-backend',
      read: async (id, options) => {
        calls.push({ id, ...options });
        if (!Object.hasOwn(resources, id)) throw new Error('Fixture resource missing.');
        return resources[id];
      },
      health: async (url) => {
        healthCalls++;
        assert.equal(url, 'https://test-backend.azurewebsites.net/health');
      },
      report: (event) => events.push(event),
    },
    get healthCalls() { return healthCalls; },
  };
}

test('preflight checks both environments without writes or target API requirements', async () => {
  const f = fixture();
  await runPreflight(f.options);
  assert.equal(f.healthCalls, 1);
  assert.ok(f.calls.some((call) => call.label === 'target backend credential'));
  assert.ok(f.calls.every((call) => !call.method || call.method === 'post' &&
    /\/(listValue|appsettings\/list)$/.test(call.id)));
  assert.equal(f.calls.some((call) => call.id.includes('/service/dst/apis/')), false);
  assert.equal(f.events.at(-1).status, 'pass');
});

test('preflight accepts supported hosting tiers regardless of casing', async () => {
  for (const tier of ['Basic', 'Standard', 'Premium', 'PremiumV2', 'PremiumV3', 'PremiumV4', 'Isolated', 'IsolatedV2']) {
    for (const value of [tier, tier.toLowerCase(), tier.toUpperCase()]) {
      const f = fixture();
      f.resources[planId].sku.tier = value;
      await runPreflight(f.options);
      assert.equal(f.healthCalls, 1);
      assert.equal(f.events.at(-1).status, 'pass');
    }
  }
});

test('preflight rejects unsupported or malformed hosting tiers before readiness', async () => {
  for (const sku of [
    { name: 'F1', tier: 'Free' }, { name: 'F1', tier: 'FREE' },
    { name: 'D1', tier: 'Shared' }, { name: 'D1', tier: 'shared' },
    { name: 'B1', tier: 'Unknown' }, { name: 'B1' },
    { name: 'B1', tier: null }, { name: 'B1', tier: 1 }, undefined,
  ]) {
    const f = fixture();
    f.resources[planId].sku = sku;
    await assert.rejects(runPreflight(f.options), /B1 or higher/);
    assert.equal(f.healthCalls, 0);
    assert.equal(f.events.at(-1).status, 'fail');
  }
});

test('container preflight checks managed registry pulls and the expected port', async () => {
  const f = fixture();
  const config = f.resources[`${appId}/config/web`].properties;
  const settings = f.resources[`${appId}/config/appsettings/list`].properties;
  config.linuxFxVersion = 'DOCKER|fixture.azurecr.io/backend:example';
  await assert.rejects(runPreflight(f.options), /managed identity/);
  config.acrUseManagedIdentityCreds = true;
  await assert.rejects(runPreflight(f.options), /WEBSITES_PORT/);
  settings.WEBSITES_PORT = '8080';
  await runPreflight(f.options);
  assert.equal(f.healthCalls, 1);
});
test('preflight fails before readiness when hosting or either environment drifts', async () => {
  const dst = `${group}/providers/Microsoft.ApiManagement/service/dst`;
  const src = `${group}/providers/Microsoft.ApiManagement/service/src`;
  const cases = [
    [planId, (value) => { value.sku = { name: 'F1', tier: 'Free' }; }, /B1 or higher/],
    [`${appId}/config/web`, (value) => { value.properties.alwaysOn = false; }, /Always On/],
    [`${appId}/config/web`, (value) => { value.properties.healthCheckPath = '/wrong'; }, /health check path/],
    [appId, (value) => { value.properties.state = 'Stopped'; }, /not Running/],
    [dst, (value) => { value.properties.provisioningState = 'Failed'; }, /not successfully provisioned/],
    [`${dst}/namedValues/poc-backend-key/listValue`, (value) => { value.value = 'wrong-secret'; }, /does not match/],
    [`${dst}/namedValues/poc-backend-key`, (value) => { value.properties.secret = false; }, /marked secret/],
    [`${dst}/subscriptions/poc-test-client`, (value) => { value.properties.state = 'suspended'; }, /active and scoped/],
    [`${src}/backends/poc-mcp-backend`, (value) => { value.properties.url = 'https://wrong.example/mcp'; }, /HTTPS \/mcp/],
    [`${src}/backends/poc-mcp-backend`, (value) => { value.properties.credentials.header = {}; }, /secret named value/],
    [`${src}/backends/poc-mcp-backend`, (value) => { value.properties.tls.validateCertificateName = false; }, /TLS/],
    [`${src}/apis/poc-proxy`, (value) => { value.properties.backendId = 'wrong'; }, /backend binding/],
  ];
  for (const [id, mutate, message] of cases) {
    const f = fixture();
    mutate(f.resources[id]);
    await assert.rejects(runPreflight(f.options), message);
    assert.equal(f.healthCalls, 0);
    assert.equal(f.events.at(-1).status, 'fail');
    assert.doesNotMatch(JSON.stringify(f.events), /fixture-backend-key|wrong-secret|subscriptions\//);
  }
  const f = fixture();
  delete f.resources[`${src}/apis/poc-native`];
  await assert.rejects(runPreflight(f.options), /Fixture resource missing/);
  assert.equal(f.healthCalls, 0);
});

test('readiness retries only transient failures, with bounded attempts and timeouts', async () => {
  const events = [];
  let calls = 0;
  const delays = [];
  await checkBackendHealth('https://unused.example/health', {
    fetchImpl: async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      calls++;
      return new Response(calls < 3 ? '' : '{"status":"ok"}', { status: calls < 3 ? 503 : 200 });
    },
    sleep: async (ms) => delays.push(ms),
    report: (event) => events.push(event),
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(events.at(-1).status, 'pass');
  for (const status of [401, 403, 404]) {
    calls = 0;
    await assert.rejects(checkBackendHealth('https://unused.example/health', {
      fetchImpl: async () => { calls++; return new Response('', { status }); },
      report: () => {},
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
  calls = 0;
  await assert.rejects(checkBackendHealth('https://unused.example/health', {
    fetchImpl: async () => { calls++; throw new TypeError('private-url-and-credential'); },
    sleep: async () => {}, report: () => {},
  }), /three bounded attempts/);
  assert.equal(calls, 3);
});

test('readiness does not accept a generic 200 or malformed health payload', async () => {
  for (const body of ['not-json', '{"status":"unhealthy"}']) {
    await assert.rejects(checkBackendHealth('https://unused.example/health', {
      fetchImpl: async () => new Response(body, { status: 200 }), report: () => {},
    }), /Backend health/);
  }
});

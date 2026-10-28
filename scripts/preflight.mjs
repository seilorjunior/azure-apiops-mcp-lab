import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { record } from './report.mjs';

const apiVersion = '2024-05-01';
const webVersion = '2024-04-01';
const requireCheck = (condition, message) => {
  if (!condition) throw new Error(message);
};

/** @param {string} id @param {{method?: string, version?: string, label?: string}} [options] */
export function readAzureResource(id, { method = 'get', version = apiVersion, label } = {}) {
  requireCheck(/^\/subscriptions\/[a-f0-9-]+\/resourceGroups\/[^/?#]+\/providers\//i.test(id),
    'Preflight resource identifier is invalid.');
  const args = ['rest', '--method', method, '--url',
    `https://management.azure.com${id}?api-version=${version}`,
    '--headers', 'Accept=application/json', '--only-show-errors', '--output', 'json'];
  const windows = process.platform === 'win32';
  const result = windows
    ? spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference = "Stop"; $arguments = ($input -join "`n") | ConvertFrom-Json; & az @arguments; exit $LASTEXITCODE'],
    { input: JSON.stringify(args), encoding: 'utf8', timeout: 60_000 })
    : spawnSync('az', args, { encoding: 'utf8', timeout: 60_000 });
  requireCheck(!result.error && result.status === 0,
    `Preflight could not read ${label}. Check Azure sign-in and resource read permissions.`);
  try {
    return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`Preflight received invalid JSON for ${label}.`);
  }
}

export async function checkBackendHealth(url, {
  fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), report = record,
} = {}) {
  report({ stage: 'backend-health', status: 'start' });
  const started = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
    } catch (error) {
      if (!['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)) throw error;
      if (attempt === 3) {
        report({ stage: 'backend-health', status: 'fail', attempt, elapsedMs: Date.now() - started });
        throw new Error('Backend health is unreachable after three bounded attempts. Check App Service startup and networking.');
      }
      console.warn(`Backend health attempt ${attempt} failed; retrying readiness only.`);
      await sleep(attempt * 1000);
      continue;
    }
    if (response.status === 200) {
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error('Backend health returned invalid JSON.');
      }
      requireCheck(body?.status === 'ok', 'Backend health did not return status ok.');
      report({ stage: 'backend-health', status: 'pass', attempt, elapsedMs: Date.now() - started });
      return;
    }
    await response.body?.cancel();
    if (![502, 503, 504].includes(response.status) || attempt === 3) {
      report({ stage: 'backend-health', status: 'fail', attempt, code: response.status, elapsedMs: Date.now() - started });
      throw new Error(`Backend health returned HTTP ${response.status}. Check the deployed application.`);
    }
    console.warn(`Backend health attempt ${attempt} returned HTTP ${response.status}; retrying readiness only.`);
    await sleep(attempt * 1000);
  }
}

export async function runPreflight({
  subscriptionId, resourceGroup, sourceApimName, targetApimName, webappName,
  read = readAzureResource, health = checkBackendHealth, report = record,
}) {
  report({ stage: 'preflight', status: 'start' });
  const started = Date.now();
  try {
    requireCheck(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subscriptionId ?? ''),
      'Set AZURE_SUBSCRIPTION_ID before preflight.');
    for (const value of [resourceGroup, sourceApimName, targetApimName, webappName]) {
      requireCheck(typeof value === 'string' && /^[a-zA-Z0-9_.()-]+$/.test(value),
        'Preflight requires resource group, source/target APIM names and AZURE_WEBAPP_NAME.');
    }
    requireCheck(sourceApimName !== targetApimName, 'Preflight requires different source and target APIM instances.');
    const group = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
    const appId = `${group}/providers/Microsoft.Web/sites/${webappName}`;
    const app = await read(appId, { version: webVersion, label: 'backend application' });
    requireCheck(app.properties?.state === 'Running', 'Backend App Service is not Running.');
    requireCheck(typeof app.properties.serverFarmId === 'string', 'Backend App Service plan binding is missing.');
    const plan = await read(app.properties.serverFarmId, { version: webVersion, label: 'backend hosting plan' });
    requireCheck(['Basic', 'Standard', 'Premium', 'PremiumV2', 'PremiumV3', 'PremiumV4', 'Isolated', 'IsolatedV2']
      .includes(plan.sku?.tier), 'Backend hosting plan must support Always On (B1 or higher); Free/Shared plans are not supported. Review cost before changing the SKU.');
    const config = await read(`${appId}/config/web`, { version: webVersion, label: 'backend application configuration' });
    requireCheck(config.properties?.alwaysOn === true, 'Backend Always On is disabled. Restore the intended configuration before promotion.');
    requireCheck(config.properties.healthCheckPath === '/health', 'Backend health check path must be /health.');
    const host = app.properties.defaultHostName;
    requireCheck(typeof host === 'string' && /^[a-zA-Z0-9.-]+\.azurewebsites\.net$/.test(host),
      'Backend default hostname is missing or invalid.');
    const settings = await read(`${appId}/config/appsettings/list`, {
      method: 'post', version: webVersion, label: 'backend authentication configuration',
    });
    const appKey = settings.properties?.POC_BACKEND_KEY;
    requireCheck(typeof appKey === 'string' && appKey.length >= 32, 'Backend credential is missing or too short.');
    for (const [label, name] of [['source', sourceApimName], ['target', targetApimName]]) {
      const service = `${group}/providers/Microsoft.ApiManagement/service/${name}`;
      const apim = await read(service, { label: `${label} APIM` });
      requireCheck(apim.properties?.provisioningState === 'Succeeded', `${label} APIM is not successfully provisioned.`);
      const backend = await read(`${service}/backends/poc-mcp-backend`, { label: `${label} MCP backend` });
      requireCheck(backend.properties?.url === `https://${host}/mcp` &&
        backend.properties.protocol === 'http', `${label} MCP backend must point to the selected application's HTTPS /mcp endpoint.`);
      requireCheck(backend.properties.credentials?.header?.['x-poc-backend-key']?.includes('{{poc-backend-key}}'),
        `${label} MCP backend must reference the secret named value.`);
      requireCheck(backend.properties.tls?.validateCertificateChain === true &&
        backend.properties.tls?.validateCertificateName === true, `${label} MCP backend must validate TLS certificates.`);
      const namedValueInfo = await read(`${service}/namedValues/poc-backend-key`, { label: `${label} secret named value` });
      requireCheck(namedValueInfo.properties?.secret === true, `${label} backend named value must be marked secret.`);
      const namedValue = await read(`${service}/namedValues/poc-backend-key/listValue`, {
        method: 'post', label: `${label} backend credential`,
      });
      requireCheck(namedValue.value === appKey, `${label} backend credential does not match the application. Compare privately; do not print secret values.`);
      const subscription = await read(`${service}/subscriptions/poc-test-client`, { label: `${label} test subscription` });
      requireCheck(subscription.properties?.state === 'active' && subscription.properties.scope === `${service}/apis`,
        `${label} test subscription must be active and scoped to all APIs on that APIM.`);
      if (label === 'source') {
        for (const api of ['poc-rest', 'poc-native', 'poc-proxy']) {
          const definition = await read(`${service}/apis/${api}`, {
            version: '2025-09-01-preview', label: `source ${api} definition`,
          });
          requireCheck(definition.properties && (api === 'poc-rest' || definition.properties.type === 'mcp'),
            `Source ${api} definition is missing or has an unexpected type.`);
          if (api === 'poc-proxy') requireCheck(definition.properties.backendId === 'poc-mcp-backend',
            'Source proxy backend binding is incorrect.');
        }
      }
    }
    await health(`https://${host}/health`, { report });
    report({ stage: 'preflight', status: 'pass', elapsedMs: Date.now() - started });
    console.log('PASS preflight: hosting, dependencies, credentials and backend readiness.');
  } catch (error) {
    report({ stage: 'preflight', status: 'fail', elapsedMs: Date.now() - started });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: {
    'resource-group': { type: 'string' }, 'source-apim-name': { type: 'string' },
    'target-apim-name': { type: 'string' },
  } });
  try {
    await runPreflight({
      subscriptionId: process.env.AZURE_SUBSCRIPTION_ID, webappName: process.env.AZURE_WEBAPP_NAME,
      resourceGroup: values['resource-group'], sourceApimName: values['source-apim-name'],
      targetApimName: values['target-apim-name'],
    });
  } catch (error) {
    console.error(`FAIL preflight: ${error.message}`);
    process.exitCode = 1;
  }
}

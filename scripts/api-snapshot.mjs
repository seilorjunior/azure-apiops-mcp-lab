import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { readAzureResource, runPreflight } from './preflight.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = '2025-09-01-preview';
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const families = ['backends', 'products', 'namedValues', 'loggers', 'diagnostics', 'tags',
  'policyFragments', 'gateways', 'versionSets', 'groups', 'subscriptions', 'schemas',
  'policies', 'policyRestrictions', 'documentations', 'workspaces'];
function readJson(path) {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Configuration or exported JSON is invalid. Inspect the file privately.');
  }
}

export function apiAllowlist(value) {
  check(value && Object.keys(value).length === 1 && Array.isArray(value.apis)
    && value.apis.length > 0 && value.apis.every((id) => typeof id === 'string' && idPattern.test(id))
    && new Set(value.apis).size === value.apis.length,
  'Allowlist must contain only a nonempty, unique apis array of plain API IDs (no wildcards or revision suffixes).');
  return [...value.apis].sort();
}

export function extractionFilter(apis) {
  return { apis: apiAllowlist({ apis }), ...Object.fromEntries(families.map((family) => [family, []])) };
}

export function snapshotFiles(folder, apis) {
  const expected = apiAllowlist({ apis });
  check(!lstatSync(folder).isSymbolicLink(), 'Extraction root must not be a symbolic link.');
  check(isDeepStrictEqual(readdirSync(folder).sort(), ['apis']),
    'Extraction must contain only the apis resource family.');
  check(!lstatSync(join(folder, 'apis')).isSymbolicLink(), 'API root must not be a symbolic link.');
  check(isDeepStrictEqual(readdirSync(join(folder, 'apis')).sort(), expected),
    'Extracted APIs do not exactly match the allowlist.');
  const files = [];
  function walk(directory, relative) {
    for (const name of readdirSync(directory).sort()) {
      check(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) && name !== '..',
        'Extraction contains an unsupported file or resource name.');
      const path = join(directory, name);
      const stat = lstatSync(path);
      check(!stat.isSymbolicLink(), 'Extraction must not contain symbolic links.');
      if (stat.isDirectory()) walk(path, `${relative}/${name}`);
      else {
        check(stat.isFile() && /\.(json|xml|yaml|yml|graphql|wsdl|wadl)$/.test(name),
          'Extraction contains an unsupported file type.');
        files.push({ file: `${relative}/${name}`,
          sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
      }
    }
  }
  walk(join(folder, 'apis'), 'apis');
  for (const api of expected) {
    check(files.some((file) => file.file === `apis/${api}/apiInformation.json`),
      'Every selected API must have apiInformation.json.');
    const info = readJson(join(folder, 'apis', api, 'apiInformation.json'));
    check(info && typeof info.properties === 'object' && info.properties !== null,
      'Selected API information has no properties.');
  }
  return { schemaVersion: 1, apis: expected, files };
}

export function verifySnapshot(manifest, actual) {
  check(manifest && manifest.schemaVersion === 1
    && Object.keys(manifest).sort().join(',') === 'apis,files,schemaVersion'
    && Array.isArray(manifest.files), 'Reviewed snapshot format is invalid.');
  const known = apiAllowlist({ apis: manifest.apis });
  check(manifest.files.every((entry) => entry
    && Object.keys(entry).sort().join(',') === 'file,sha256'
    && typeof entry.file === 'string' && entry.file.startsWith('apis/')
    && entry.file.split('/').every((part) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part))
    && known.includes(entry.file.split('/')[1])
    && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256))
    && new Set(manifest.files.map((entry) => entry.file)).size === manifest.files.length,
  'Reviewed snapshot file entries are invalid.');
  check(actual.apis.every((api) => known.includes(api)),
    'Selected API is missing from the reviewed snapshot.');
  const selected = {
    schemaVersion: 1, apis: actual.apis,
    files: manifest.files.filter((entry) => actual.apis.includes(entry.file.split('/')[1])),
  };
  check(isDeepStrictEqual(selected, actual),
    'Private extraction does not match the reviewed snapshot. Capture and review a new snapshot before publishing.');
}

export function runApiops(args, log, env = process.env) {
  const cli = join(root, 'node_modules', '@azure-tools', 'apiops-cli', 'dist', 'cli', 'index.js');
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...env, AZURE_API_VERSION: version },
    timeout: 15 * 60_000, maxBuffer: 20 * 1024 * 1024,
  });
  writeFileSync(log, `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { mode: 0o600 });
  check(!result.error && result.status === 0,
    `APIops failed or timed out. Inspect the ignored private log locally: ${log}. Do not upload it.`);
}

export async function executeSnapshot({
  mode, apis, manifest, folder, context, serviceNames, read, cli,
}) {
  check(['capture', 'preview', 'apply'].includes(mode), 'Mode must be capture, preview or apply.');
  const selected = apiAllowlist({ apis });
  const filter = join(folder, 'filter.json');
  const extracted = join(folder, 'export');
  writeFileSync(filter, `${JSON.stringify(extractionFilter(selected), null, 2)}\n`);
  const apiContext = ['--subscription-id', context.subscriptionId, '--resource-group', context.resourceGroup];
  await cli(['extract', ...apiContext, '--service-name', serviceNames.source,
    '--output', extracted, '--filter', filter, '--no-transitive'], join(folder, 'extract.log'));
  const snapshot = snapshotFiles(extracted, selected);
  if (mode === 'capture') return snapshot;
  verifySnapshot(manifest, snapshot);

  // Version-set resources are deliberately excluded from this API-only flow.
  for (const api of selected) {
    const info = readJson(join(extracted, 'apis', api, 'apiInformation.json'));
    check(!info.properties.apiVersionSetId, 'Version-set APIs are not supported by this API-only snapshot flow.');
  }
  const service = `/subscriptions/${context.subscriptionId}/resourceGroups/${context.resourceGroup}/providers/Microsoft.ApiManagement/service/${serviceNames.target}`;
  for (const api of selected) {
    const info = readJson(join(extracted, 'apis', api, 'apiInformation.json'));
    const properties = info.properties;
    for (const [family, id] of [['backends', properties.backendId]]) {
      if (id) {
        check(idPattern.test(id), 'Backend reference must be a plain resource ID.');
        await read(`${service}/${family}/${id}`, { label: 'selected API target backend' });
      }
    }
    for (const tool of properties.mcpTools ?? []) {
      check(typeof tool.operationId === 'string', 'Native MCP tool has no operation binding.');
      const binding = tool.operationId.match(/\/apis\/([^/]+)\/operations\/([^/]+)$/);
      const sourceService = service.replace(`/service/${serviceNames.target}`, `/service/${serviceNames.source}`);
      check(binding && idPattern.test(binding[1]) && idPattern.test(binding[2])
        && tool.operationId === `${sourceService}${binding[0]}`,
        'Native MCP operation binding is unsupported.');
      if (!selected.includes(binding[1])) {
        await read(`${service}/apis/${binding[1]}/operations/${binding[2]}`,
          { label: 'selected MCP target REST operation', version });
      }
    }
  }
  const publish = ['publish', ...apiContext, '--service-name', serviceNames.target,
    '--source', extracted, '--filter', filter, '--no-transitive'];
  await cli([...publish, '--dry-run'], join(folder, 'preview.log'));
  if (mode === 'apply') {
    verifySnapshot(manifest, snapshotFiles(extracted, selected));
    await cli(publish, join(folder, 'publish.log'));
    for (const api of selected) {
      const info = readJson(join(extracted, 'apis', api, 'apiInformation.json')).properties;
      const target = await read(`${service}/apis/${api}`, { label: 'published API definition', version });
      check(target.properties?.path === info.path
        && (target.properties?.type ?? target.properties?.apiType ?? 'http')
          === (info.type ?? info.apiType ?? 'http'), 'Published API path or type differs from the snapshot.');
      if (info.backendId) check(target.properties.backendId === info.backendId,
        'Published API backend binding differs from the snapshot.');
      if (info.mcpProperties) check(isDeepStrictEqual(target.properties.mcpProperties, info.mcpProperties),
        'Published MCP configuration differs from the snapshot.');
      for (const tool of info.mcpTools ?? []) {
        const suffix = tool.operationId.match(/\/apis\/[^/]+\/operations\/[^/]+$/)[0];
        check(target.properties?.mcpTools?.some((candidate) => candidate.name === tool.name
          && candidate.operationId === `${service}${suffix}`),
        'Published native MCP tool does not reference the target REST operation.');
      }
    }
  }
  return snapshot;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    allowlist: { type: 'string' },
    snapshot: { type: 'string', default: 'api-snapshots/lab.json' },
  } });
  check(positionals.length === 1 && ['capture', 'preview', 'apply'].includes(positionals[0]),
    'Usage: npm run snapshot:apis -- capture|preview|apply [--allowlist FILE] [--snapshot FILE]');
  const mode = positionals[0];
  const allowlistPath = values.allowlist ?? (mode === 'capture'
    ? 'config/snapshot-apis.json' : 'config/publish-apis.json');
  const apis = apiAllowlist(readJson(resolve(allowlistPath)));
  const snapshotPath = resolve(values.snapshot);
  const manifest = mode === 'capture' ? undefined : readJson(snapshotPath);
  const context = {
    subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
    resourceGroup: process.env.AZURE_RESOURCE_GROUP,
  };
  const serviceNames = { source: process.env.SOURCE_APIM_NAME, target: process.env.TARGET_APIM_NAME };
  const account = process.platform === 'win32'
    ? spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
      '& az account show --query id --output tsv --only-show-errors; exit $LASTEXITCODE'], { encoding: 'utf8', timeout: 60_000 })
    : spawnSync('az', ['account', 'show', '--query', 'id', '--output', 'tsv', '--only-show-errors'],
      { encoding: 'utf8', timeout: 60_000 });
  check(!account.error && account.status === 0
    && account.stdout.trim().toLowerCase() === context.subscriptionId?.toLowerCase(),
  'Azure account must match AZURE_SUBSCRIPTION_ID.');
  await runPreflight({ ...context, sourceApimName: serviceNames.source,
    targetApimName: serviceNames.target, webappName: process.env.AZURE_WEBAPP_NAME });
  const folder = join(root, 'artifacts', `snapshot-${randomUUID()}`);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const result = await executeSnapshot({ mode, apis, manifest, folder, context,
    serviceNames, read: readAzureResource, cli: runApiops });
  if (mode === 'capture') {
    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log('Captured hash-only snapshot. Review the allowlist, file names and hashes before committing.');
  } else console.log(`PASS ${mode}: selected API configuration matched the reviewed snapshot.`);
  console.log('This command verifies configuration, not MCP tool behavior. Run scenario-specific MCP acceptance tests separately.');
  console.log(`Private exports and logs remain ignored at ${folder}. Do not commit or upload them.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`FAIL API snapshot: ${error.message}`);
    process.exitCode = 1;
  });
}

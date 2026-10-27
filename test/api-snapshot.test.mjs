import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { apiAllowlist, extractionFilter, snapshotFiles, verifySnapshot, executeSnapshot } from '../scripts/api-snapshot.mjs';
import { shouldIncludeResource } from '../node_modules/@azure-tools/apiops-cli/dist/services/filter-service.js';
import { ResourceType } from '../node_modules/@azure-tools/apiops-cli/dist/models/resource-types.js';

function fixture(t, properties = { type: 'mcp', path: 'new-mcp/mcp', backendId: 'poc-mcp-backend' }) {
  const folder = mkdtempSync(join(tmpdir(), 'api-snapshot-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const populate = (destination) => {
    mkdirSync(join(destination, 'apis', 'new-mcp'), { recursive: true });
    writeFileSync(join(destination, 'apis', 'new-mcp', 'apiInformation.json'),
      JSON.stringify({ properties }));
    writeFileSync(join(destination, 'apis', 'new-mcp', 'policy.xml'),
      '<policies><secret>private-fixture-key</secret></policies>');
  };
  populate(join(folder, 'original'));
  return { folder, populate, original: join(folder, 'original') };
}
const context = { subscriptionId: '00000000-0000-0000-0000-000000000001', resourceGroup: 'fixture' };
const serviceNames = { source: 'source', target: 'target' };
const service = (name) => `/subscriptions/${context.subscriptionId}/resourceGroups/fixture/providers/Microsoft.ApiManagement/service/${name}`;

test('snapshot allowlist is explicit, unique and cannot include wildcards or revision suffixes', () => {
  assert.deepEqual(apiAllowlist({ apis: ['second', 'first'] }), ['first', 'second']);
  for (const value of [{}, { apis: [] }, { apis: ['*'] }, { apis: ['x', 'x'] },
    { apis: ['../x'] }, { apis: ['x;rev=2'] }, { apis: ['x'], backends: ['*'] }]) {
    assert.throws(() => apiAllowlist(value));
  }
  const filter = extractionFilter(['new-mcp']);
  assert.equal(Object.keys(filter).length, 17);
  assert.equal(shouldIncludeResource({ type: ResourceType.Api, nameParts: ['new-mcp'] }, filter), true);
  assert.equal(shouldIncludeResource({ type: ResourceType.Api, nameParts: ['other'] }, filter), false);
  for (const family of Object.keys(filter).filter((key) => key !== 'apis')) assert.deepEqual(filter[family], []);
});

test('manifest contains only IDs, file paths and hashes; any byte or file change blocks comparison', (t) => {
  const { original } = fixture(t);
  const manifest = snapshotFiles(original, ['new-mcp']);
  assert.deepEqual(Object.keys(manifest), ['schemaVersion', 'apis', 'files']);
  assert.equal(manifest.files.length, 2);
  assert.doesNotMatch(JSON.stringify(manifest), /private-fixture-key|backendId|<policies>|poc-mcp-backend/);
  for (const file of manifest.files) assert.match(file.sha256, /^[a-f0-9]{64}$/);
  verifySnapshot(manifest, snapshotFiles(original, ['new-mcp']));
  const larger = structuredClone(manifest);
  larger.apis.push('unselected');
  larger.files.push({ file: 'apis/unselected/apiInformation.json', sha256: 'a'.repeat(64) });
  verifySnapshot(larger, snapshotFiles(original, ['new-mcp']));
  writeFileSync(join(original, 'apis', 'new-mcp', 'policy.xml'), 'changed');
  assert.throws(() => verifySnapshot(manifest, snapshotFiles(original, ['new-mcp'])), /does not match/);
  unlinkSync(join(original, 'apis', 'new-mcp', 'policy.xml'));
  assert.throws(() => verifySnapshot(manifest, snapshotFiles(original, ['new-mcp'])), /does not match/);
});

test('unexpected resource families, APIs, file types and missing definitions fail closed', (t) => {
  const { original } = fixture(t);
  assert.throws(() => snapshotFiles(original, ['other']), /exactly match/);
  writeFileSync(join(original, 'apis', 'new-mcp', 'credentials.env'), 'fixture');
  assert.throws(() => snapshotFiles(original, ['new-mcp']), /unsupported file type/);
  unlinkSync(join(original, 'apis', 'new-mcp', 'credentials.env'));
  unlinkSync(join(original, 'apis', 'new-mcp', 'apiInformation.json'));
  assert.throws(() => snapshotFiles(original, ['new-mcp']), /apiInformation/);
  mkdirSync(join(original, 'backends'));
  assert.throws(() => snapshotFiles(original, ['new-mcp']), /only the apis/);
});

test('capture never publishes; preview and apply use the exact allowlist with no deletion or transitive export', async (t) => {
  for (const mode of ['capture', 'preview', 'apply']) {
    const data = fixture(t);
    const manifest = snapshotFiles(data.original, ['new-mcp']);
    const calls = [];
    const reads = [];
    await executeSnapshot({
      mode, apis: ['new-mcp'], manifest, folder: data.folder, context, serviceNames,
      cli: async (args) => {
        calls.push(args);
        if (args[0] === 'extract') data.populate(args[args.indexOf('--output') + 1]);
      },
      read: async (id) => {
        reads.push(id);
        return { properties: { type: 'mcp', path: 'new-mcp/mcp', backendId: 'poc-mcp-backend' } };
      },
    });
    assert.deepEqual(JSON.parse(readFileSync(join(data.folder, 'filter.json'))), extractionFilter(['new-mcp']));
    assert.equal(calls.length, mode === 'capture' ? 1 : mode === 'preview' ? 2 : 3);
    assert.ok(calls.every((args) => args.includes('--no-transitive')));
    assert.doesNotMatch(JSON.stringify(calls), /--delete|--force|--all/);
    if (mode !== 'capture') {
      assert.equal(calls[1].at(-1), '--dry-run');
      assert.equal(calls[1][calls[1].indexOf('--service-name') + 1], 'target');
      assert.ok(reads.includes(`${service('target')}/backends/poc-mcp-backend`));
    }
  }
});

test('snapshot mismatch and extraction errors block publisher invocation', async (t) => {
  const data = fixture(t);
  let published = false;
  const options = {
    mode: 'apply', apis: ['new-mcp'], manifest: { schemaVersion: 1, apis: ['new-mcp'], files: [] },
    folder: data.folder, context, serviceNames,
    read: async () => { throw new Error('must not read target'); },
    cli: async (args) => {
      if (args[0] === 'extract') data.populate(args[args.indexOf('--output') + 1]);
      else published = true;
    },
  };
  await assert.rejects(executeSnapshot(options), /does not match/);
  assert.equal(published, false);
  await assert.rejects(executeSnapshot({ ...options, cli: async () => { throw new Error('extract failed'); } }), /extract failed/);
});

test('native binding checks target dependencies and validates remapping after apply', async (t) => {
  const properties = {
    type: 'mcp', path: 'new-mcp',
    mcpTools: [{ name: 'status', operationId: `${service('source')}/apis/rest/operations/status` }],
  };
  const data = fixture(t, properties);
  const reads = [];
  const options = {
    mode: 'apply', apis: ['new-mcp'], manifest: snapshotFiles(data.original, ['new-mcp']),
    folder: data.folder, context, serviceNames,
    cli: async (args) => {
      if (args[0] === 'extract') data.populate(args[args.indexOf('--output') + 1]);
    },
    read: async (id) => {
      reads.push(id);
      return { properties: { ...properties, mcpTools: [{
        name: 'status', operationId: `${service('target')}/apis/rest/operations/status`,
      }] } };
    },
  };
  await executeSnapshot(options);
  assert.ok(reads.includes(`${service('target')}/apis/rest/operations/status`));
  mkdirSync(join(data.folder, 'next'));
  await assert.rejects(executeSnapshot({ ...options, folder: join(data.folder, 'next'),
    read: async () => ({ properties }) }), /does not reference the target/);
});

test('new API selections absent from the reviewed snapshot are rejected', (t) => {
  const { original } = fixture(t);
  const actual = snapshotFiles(original, ['new-mcp']);
  assert.throws(() => verifySnapshot({ schemaVersion: 1, apis: ['other'], files: [] }, actual), /missing/);
  assert.throws(() => verifySnapshot({ ...actual, secret: 'fixture' }, actual), /format/);
  const invalid = structuredClone(actual);
  invalid.files[0].file = 'apis/new-mcp/../outside.json';
  assert.throws(() => verifySnapshot(invalid, actual), /invalid/);
});

test('private malformed JSON does not expose exported content in errors', (t) => {
  const { original } = fixture(t);
  writeFileSync(join(original, 'apis', 'new-mcp', 'apiInformation.json'), 'private-fixture-key');
  assert.throws(() => snapshotFiles(original, ['new-mcp']), (error) => {
    assert.match(error.message, /JSON is invalid/);
    assert.doesNotMatch(error.message, /private-fixture-key/);
    return true;
  });
});

test('preview artifact mutation blocks apply and missing dependencies block preview', async (t) => {
  const data = fixture(t);
  const calls = [];
  const options = {
    mode: 'apply', apis: ['new-mcp'], manifest: snapshotFiles(data.original, ['new-mcp']),
    folder: data.folder, context, serviceNames, read: async () => ({}),
    cli: async (args) => {
      calls.push(args);
      if (args[0] === 'extract') data.populate(args[args.indexOf('--output') + 1]);
      else if (args.includes('--dry-run')) {
        writeFileSync(join(data.folder, 'export', 'apis', 'new-mcp', 'policy.xml'), 'mutated');
      }
    },
  };
  await assert.rejects(executeSnapshot(options), /does not match/);
  assert.equal(calls.length, 2);
  calls.length = 0;
  await assert.rejects(executeSnapshot({ ...options, read: async () => { throw new Error('missing backend'); } }),
    /missing backend/);
  assert.equal(calls.length, 1);
});

test('version-set APIs fail before publisher preview', async (t) => {
  const data = fixture(t, { type: 'http', path: 'example', apiVersionSetId: 'fixture-version-set' });
  let published = false;
  await assert.rejects(executeSnapshot({
    mode: 'preview', apis: ['new-mcp'], manifest: snapshotFiles(data.original, ['new-mcp']),
    folder: data.folder, context, serviceNames,
    read: async () => { throw new Error('must not read target'); },
    cli: async (args) => {
      if (args[0] === 'extract') data.populate(args[args.indexOf('--output') + 1]);
      else published = true;
    },
  }), /Version-set APIs/);
  assert.equal(published, false);
});

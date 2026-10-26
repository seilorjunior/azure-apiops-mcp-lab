import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = process.argv[2];
const source = JSON.parse(readFileSync(0, 'utf8'));
const apis = readdirSync(join(root, 'apis'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert.deepEqual(apis, ['poc-native', 'poc-proxy', 'poc-rest'],
  'Extraction did not return exactly the three source APIs.');
const info = (name) => JSON.parse(readFileSync(join(root, 'apis', name, 'apiInformation.json'), 'utf8'));
assert.equal(info('poc-native').properties?.mcpTools?.[0]?.name, 'get_status',
  'Extraction lost REST-to-MCP tool bindings.');

const expected = source['poc-proxy'];
const actual = info('poc-proxy').properties;
assert.equal(expected?.type, 'mcp', 'Source proxy must be an MCP API.');
assert.ok(typeof expected.backendId === 'string' && expected.backendId.length > 0,
  'Source proxy backend binding is missing.');
assert.ok(expected.mcpProperties && typeof expected.mcpProperties === 'object' &&
  !Array.isArray(expected.mcpProperties), 'Source proxy MCP configuration is missing.');
assert.equal(actual?.type, expected.type, 'Extraction lost the proxy MCP API type.');
assert.equal(actual?.backendId, expected.backendId, 'Extraction changed the proxy backend binding.');
assert.ok(isDeepStrictEqual(actual?.mcpProperties, expected.mcpProperties),
  'Extraction lost or changed external MCP configuration.');

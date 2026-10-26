import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadFilterConfig } from '../node_modules/@azure-tools/apiops-cli/dist/lib/config-loader.js';
import { shouldIncludeResource } from '../node_modules/@azure-tools/apiops-cli/dist/services/filter-service.js';
import { ResourceType } from '../node_modules/@azure-tools/apiops-cli/dist/models/resource-types.js';

const filter = await loadFilterConfig(fileURLToPath(new URL('../config/source-filter.yaml', import.meta.url)));

test('APIops filter includes exactly the three PoC APIs and their operations/policies', () => {
  for (const name of ['poc-rest', 'poc-native', 'poc-proxy']) {
    assert.equal(shouldIncludeResource({ type: ResourceType.Api, nameParts: [name] }, filter), true);
    assert.equal(shouldIncludeResource({
      type: ResourceType.ApiOperationPolicy, nameParts: [name, 'get-status'],
    }, filter), true);
  }
  assert.equal(shouldIncludeResource({ type: ResourceType.Api, nameParts: ['unrelated'] }, filter), false);
});

test('APIops filter excludes all non-API resource families and their children', () => {
  const excluded = [
    'Backend', 'Product', 'NamedValue', 'Logger', 'Diagnostic', 'Tag', 'PolicyFragment',
    'Gateway', 'VersionSet', 'Group', 'Subscription', 'GlobalSchema', 'ServicePolicy',
    'PolicyRestriction', 'Documentation', 'Workspace', 'ProductPolicy', 'ProductApi',
    'ProductGroup', 'ProductTag', 'ProductWiki', 'GatewayApi',
  ];
  for (const type of excluded) {
    const nameParts = type === 'ServicePolicy' ? [] : ['sample', 'poc-rest'];
    assert.equal(shouldIncludeResource({ type: ResourceType[type], nameParts }, filter), false, type);
  }
});

test('omitted resource families are included by APIops, unlike explicit empty lists', () => {
  const descriptor = { type: ResourceType.NamedValue, nameParts: ['poc-backend-key'] };
  assert.equal(shouldIncludeResource(descriptor, { apis: ['poc-rest'] }), true);
  assert.equal(shouldIncludeResource(descriptor, filter), false);
});

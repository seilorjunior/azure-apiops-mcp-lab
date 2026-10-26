import { verifyTool } from './mcp-client.mjs';

const [gateway, environment = 'source'] = process.argv.slice(2);
if (!gateway || !['source', 'target'].includes(environment)) {
  throw new Error('Usage: npm run test:mcp -- <gateway-url> [source|target]; set POC_APIM_KEY.');
}
if (!process.env.POC_APIM_KEY) {
  throw new Error('POC_APIM_KEY is required. Do not put subscription keys on the command line.');
}
const base = new URL(gateway);
if (base.protocol !== 'https:') throw new Error('APIM gateway URL must use HTTPS.');
const headers = { 'Ocp-Apim-Subscription-Key': process.env.POC_APIM_KEY };
for (const scenario of [
  { path: 'poc-native/mcp', toolName: 'get_status', args: {}, expected: /apiops-rest-ok/ },
  { path: 'poc-proxy/mcp', toolName: 'echo', args: { message: 'apiops-proxy-ok' }, expected: /apiops-proxy-ok/ },
]) {
  const url = new URL(scenario.path, `${base.origin}/`).href;
  await verifyTool({ ...scenario, url, headers });
  console.log(`PASS ${environment} ${scenario.toolName}: initialize, tools/list, tools/call`);
}

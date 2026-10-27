import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const stages = [
  'preflight', 'backend-health', 'source-mcp', 'target-mcp',
  'source-native', 'source-proxy', 'target-native', 'target-proxy',
  'source-snapshot', 'extraction', 'artifact-validation', 'publisher-preview',
  'publication', 'target-validation', 'source-preservation',
];
const phases = ['initialize', 'tools/list', 'tools/call', 'close'];
const statuses = ['start', 'pass', 'fail'];
const outcomes = ['success', 'failure', 'cancelled', 'skipped'];

export function sanitizeEvent(event) {
  if (event.stage === 'cli-version') {
    if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(event.version)) {
      throw new Error('Invalid CLI version in run report.');
    }
    return { stage: 'cli-version', version: event.version };
  }
  if (!stages.includes(event.stage) || !statuses.includes(event.status)) {
    throw new Error('Invalid stage or status in run report.');
  }
  const safe = { stage: event.stage, status: event.status };
  if (event.phase !== undefined) {
    if (!phases.includes(event.phase)) throw new Error('Invalid MCP phase in run report.');
    safe.phase = event.phase;
  }
  for (const field of ['elapsedMs', 'apiCount', 'attempt']) {
    if (event[field] !== undefined) {
      if (!Number.isSafeInteger(event[field]) || event[field] < 0) {
        throw new Error('Invalid numeric field in run report.');
      }
      safe[field] = event[field];
    }
  }
  if (event.code !== undefined) {
    if (!Number.isSafeInteger(event.code)) throw new Error('Invalid error code in run report.');
    safe.code = event.code;
  }
  return safe;
}

export function record(event, path = process.env.APIOPS_REPORT_PATH) {
  const safe = sanitizeEvent(event);
  if (path) appendFileSync(path, `${JSON.stringify(safe)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function renderReport(events, { mode, steps = {} }) {
  if (!['dry-run', 'apply'].includes(mode)) throw new Error('Invalid promotion mode in run report.');
  const safe = events.map(sanitizeEvent);
  const version = safe.findLast((event) => event.stage === 'cli-version')?.version ?? 'not recorded';
  const lines = [
    '## APIM promotion', '', `Mode: **${mode}**`, `APIops CLI: **${version}**`, '',
    '| Workflow step | Outcome |', '| --- | --- |',
  ];
  for (const name of ['configuration', 'tests', 'cli', 'login', 'promotion']) {
    const outcome = steps[name] ?? 'skipped';
    if (!outcomes.includes(outcome)) throw new Error('Invalid workflow outcome in run report.');
    lines.push(`| ${name} | ${outcome} |`);
  }
  lines.push('', '| Check | Result | MCP phase | Elapsed (ms) |', '| --- | --- | --- | --- |');
  for (const stage of stages) {
    const event = safe.findLast((entry) => entry.stage === stage);
    if (!event) {
      lines.push(`| ${stage} | not run | - | - |`);
      continue;
    }
    const status = event.status === 'start' ? 'incomplete' : event.status;
    lines.push(`| ${stage} | ${status} | ${event.phase ?? '-'} | ${event.elapsedMs ?? '-'} |`);
  }
  const count = safe.findLast((event) => event.apiCount !== undefined)?.apiCount;
  lines.push('', `Validated API count: **${count ?? 'not reached'}**`);
  const failed = safe.findLast((event) => event.status === 'fail');
  const incomplete = safe.findLast((event) => event.status === 'start' &&
    safe.findLast((item) => item.stage === event.stage)?.status === 'start');
  const failure = failed ?? incomplete;
  if (failure) {
    lines.push(`Failure/incomplete stage: **${failure.stage}**${failure.phase ? ` (${failure.phase})` : ''}.`);
    if (failure.code !== undefined) lines.push(`Error code: **${failure.code}**.`);
  }
  lines.push('', 'No resource identifiers, endpoints, credentials, raw responses or APIM exports are included.', '');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, stage] = process.argv.slice(2);
  if (operation === 'render') {
    const path = process.env.APIOPS_REPORT_PATH;
    const events = path && existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      : [];
    const summary = renderReport(events, {
      mode: process.env.PROMOTION_MODE,
      steps: Object.fromEntries(['configuration', 'tests', 'cli', 'login', 'promotion']
        .map((name) => [name, process.env[`REPORT_${name.toUpperCase()}_OUTCOME`] ?? 'skipped'])),
    });
    if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('GITHUB_STEP_SUMMARY is required.');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } else if (operation === 'version') {
    const text = readFileSync(0, 'utf8').trim();
    const version = text.match(/^(?:apiops(?: version)?[: ]+|v)?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/)?.[1];
    record({ stage: 'cli-version', version });
  } else if (statuses.includes(operation)) {
    record({ stage, status: operation });
  } else {
    throw new Error('Usage: report.mjs start|pass|fail <stage>, version, or render.');
  }
}

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const packagePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const advisoryPattern = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function findingsFrom(report, label) {
  assert(isObject(report) && !report.error && report.auditReportVersion === 2,
    `${label} audit did not return a supported successful npm audit report.`);
  assert(isObject(report.vulnerabilities) && isObject(report.metadata?.vulnerabilities),
    `${label} audit is missing vulnerability data.`);
  for (const severity of [...severities, 'total']) {
    assert(Number.isSafeInteger(report.metadata.vulnerabilities[severity])
      && report.metadata.vulnerabilities[severity] >= 0, `${label} audit has invalid counts.`);
  }
  const findings = new Map();
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    assert(packagePattern.test(name) && isObject(vulnerability)
      && severities.includes(vulnerability.severity) && Array.isArray(vulnerability.via)
      && vulnerability.via.length > 0, `${label} audit has an invalid vulnerability entry.`);
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        assert(Object.hasOwn(report.vulnerabilities, via),
          `${label} audit has an unresolved transitive advisory.`);
        continue;
      }
      assert(isObject(via) && typeof via.url === 'string' && severities.includes(via.severity)
        && typeof via.range === 'string', `${label} audit has an invalid advisory.`);
      const advisory = via.url.match(/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/)?.[1];
      assert(advisory && advisoryPattern.test(advisory),
        `${label} audit contains an unsupported advisory identifier.`);
      const key = `${name}:${advisory}`;
      const previous = findings.get(key);
      if (!previous || severities.indexOf(via.severity) > severities.indexOf(previous.severity)) {
        findings.set(key, { package: name, advisory, severity: via.severity });
      }
    }
  }
  assert(report.metadata.vulnerabilities.total === Object.keys(report.vulnerabilities).length,
    `${label} audit vulnerability counts do not match its entries.`);
  assert(Object.keys(report.vulnerabilities).length === 0 || findings.size > 0,
    `${label} audit has vulnerabilities without advisory details.`);
  return findings;
}

function validateExceptions(policy) {
  assert(isObject(policy) && Object.keys(policy).length === 1 && Array.isArray(policy.exceptions),
    'Exception policy must contain only an exceptions array.');
  const keys = new Set();
  for (const exception of policy.exceptions) {
    assert(isObject(exception)
      && Object.keys(exception).sort().join(',') === 'advisory,expires,owner,package,reason,scope',
    'Each exception must contain advisory, package, scope, owner, reason and expires.');
    assert(typeof exception.package === 'string' && packagePattern.test(exception.package)
      && typeof exception.advisory === 'string' && advisoryPattern.test(exception.advisory)
      && ['production', 'development'].includes(exception.scope),
    'Exception advisory, package or scope is invalid.');
    assert(['owner', 'reason'].every((field) => typeof exception[field] === 'string'
      && exception[field].trim().length > 0), 'Exception owner and reason are required.');
    assert(typeof exception.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(exception.expires)
      && Number.isFinite(Date.parse(exception.expires))
      && new Date(exception.expires).toISOString().slice(0, 10) === exception.expires,
    'Exception expiry must be a valid YYYY-MM-DD UTC date.');
    const key = `${exception.package}:${exception.advisory}:${exception.scope}`;
    assert(!keys.has(key), 'Duplicate dependency exception.');
    keys.add(key);
  }
}

export function evaluateAudits(full, production, policy, now = new Date()) {
  const fullFindings = findingsFrom(full, 'Full-tree');
  const productionFindings = findingsFrom(production, 'Production');
  validateExceptions(policy);
  const today = now.toISOString().slice(0, 10);
  for (const [key, finding] of productionFindings) {
    assert(fullFindings.has(key) && fullFindings.get(key).severity === finding.severity,
      'Production and full-tree advisories are inconsistent.');
  }
  const expired = policy.exceptions.filter((exception) => exception.expires < today);
  const findings = [...fullFindings.entries()].map(([key, finding]) => {
    const scope = productionFindings.has(key) ? 'production' : 'development';
    const exception = policy.exceptions.find((entry) => entry.package === finding.package
      && entry.advisory === finding.advisory && entry.scope === scope && entry.expires >= today);
    return { ...finding, scope, expires: exception?.expires,
      blocked: ['high', 'critical'].includes(finding.severity) && !exception };
  }).sort((a, b) => severities.indexOf(b.severity) - severities.indexOf(a.severity)
    || a.package.localeCompare(b.package) || a.advisory.localeCompare(b.advisory));
  return {
    findings,
    expired,
    fullCounts: full.metadata.vulnerabilities,
    productionCounts: production.metadata.vulnerabilities,
    failed: expired.length > 0 || findings.some((finding) => finding.blocked),
  };
}

export function renderAudit(result) {
  const lines = [
    '## Dependency-risk audit', '',
    `Risk gate: **${result.failed ? 'FAILED' : 'PASSED'}**. Exceptions do not remediate dependencies.`,
    '', '| npm package counts | Critical | High | Moderate | Low | Info |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const [label, counts] of [['Production', result.productionCounts], ['Full tree', result.fullCounts]]) {
    lines.push(`| ${label} | ${counts.critical} | ${counts.high} | ${counts.moderate} | ${counts.low} | ${counts.info} |`);
  }
  lines.push('', 'Counts include affected parent packages; advisory rows below are deduplicated by package and advisory.',
    '', '| Package | Advisory | Severity | Scope | Disposition |', '| --- | --- | --- | --- | --- |');
  for (const finding of result.findings) {
    const disposition = finding.expires ? `Accepted through ${finding.expires} UTC`
      : finding.blocked ? 'Unaccepted; blocking' : 'Tracked; below threshold';
    lines.push(`| ${finding.package} | [${finding.advisory}](https://github.com/advisories/${finding.advisory}) | ${finding.severity} | ${finding.scope} | ${disposition} |`);
  }
  if (!result.findings.length) lines.push('| None reported | | | | |');
  if (result.expired.length) {
    lines.push('', 'Expired exceptions block the gate even if the advisory is no longer present:');
    for (const entry of result.expired) {
      lines.push(`- ${entry.package}: ${entry.advisory} (${entry.scope}), expired ${entry.expires} UTC.`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function parseAuditResult(result, label) {
  assert(!result.error && result.signal == null && [0, 1].includes(result.status),
    `${label} npm audit could not complete (process failure or timeout).`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} npm audit did not return valid JSON.`);
  }
  findingsFrom(report, label);
  const expectsFailure = severities.slice(1).some((severity) => report.metadata.vulnerabilities[severity] > 0);
  assert((result.status === 1) === expectsFailure,
    `${label} npm audit exit status does not match its report.`);
  return report;
}

function audit(production) {
  assert(typeof process.env.npm_execpath === 'string' && process.env.npm_execpath.length > 0,
    'Run this audit through npm run audit:dependencies.');
  const args = [process.env.npm_execpath, 'audit', '--json', '--audit-level=low',
    production ? '--omit=dev' : '--include=dev'];
  return parseAuditResult(spawnSync(process.execPath, args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
  }), production ? 'Production' : 'Full-tree');
}

function publishSummary(summary) {
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const policy = JSON.parse(readFileSync(new URL('../config/dependency-exceptions.json', import.meta.url), 'utf8'));
    validateExceptions(policy);
    const result = evaluateAudits(audit(false), audit(true), policy);
    publishSummary(renderAudit(result));
    process.exitCode = result.failed ? 1 : 0;
  } catch (error) {
    console.error(`Dependency audit failed: ${error.message}`);
    publishSummary('## Dependency-risk audit\n\n**ERROR:** The audit or exception policy could not be validated. No clean-risk result is available. See the audit step for diagnostics.\n');
    process.exitCode = 2;
  }
}

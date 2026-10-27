import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAudits, parseAuditResult, renderAudit } from '../scripts/audit-dependencies.mjs';

const advisory = 'GHSA-27r3-jxmh-p828';
const now = new Date('2026-10-27T12:00:00Z');
const empty = { exceptions: [] };
const exception = {
  advisory, package: 'example', scope: 'production', owner: 'lab-maintainer',
  reason: 'Reviewed fixture risk awaiting a compatible upstream fix.', expires: '2026-11-01',
};
function report(entries = []) {
  const vulnerabilities = {};
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: entries.length };
  for (const [name, severity] of entries) {
    counts[severity]++;
    vulnerabilities[name] = { severity, via: [{
      url: `https://github.com/advisories/${advisory}`, severity, range: '<2.4.0',
    }] };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
}
const high = () => report([['example', 'high']]);

test('dependency gate tracks production and development high/critical findings without automatic acceptance', () => {
  const result = evaluateAudits(report([['example', 'high'], ['toolchain', 'critical']]), high(), empty, now);
  assert.equal(result.failed, true);
  assert.deepEqual(result.findings.map(({ scope, blocked }) => ({ scope, blocked })), [
    { scope: 'development', blocked: true }, { scope: 'production', blocked: true },
  ]);
  assert.match(renderAudit(result), /Unaccepted; blocking/);
  assert.equal(result.productionCounts.high, 1);
  assert.equal(result.fullCounts.critical, 1);
});

test('exceptions match exact advisory, package and scope and remain valid through their UTC expiry date', () => {
  const policy = { exceptions: [{ ...exception, expires: '2026-10-27' }] };
  assert.equal(evaluateAudits(high(), high(), policy, now).failed, false);
  assert.match(renderAudit(evaluateAudits(high(), high(), policy, now)), /Accepted through 2026-10-27 UTC/);
  for (const change of [{ scope: 'development' }, { package: 'other' }, { advisory: 'GHSA-w74x-v6f9-j3xg' }]) {
    assert.equal(evaluateAudits(high(), high(), { exceptions: [{ ...exception, ...change }] }, now).failed, true);
  }
  const expired = { exceptions: [{ ...exception, expires: '2026-10-26' }] };
  assert.equal(evaluateAudits(high(), high(), expired, now).failed, true);
  const removedFinding = evaluateAudits(report(), report(), expired, now);
  assert.equal(removedFinding.failed, true);
  assert.match(renderAudit(removedFinding), /Expired exceptions/);
});

test('lower severity findings remain visible and empty audits pass', () => {
  const result = evaluateAudits(report([['example', 'moderate']]), report(), empty, now);
  assert.equal(result.failed, false);
  assert.match(renderAudit(result), /Tracked; below threshold/);
  assert.match(renderAudit(evaluateAudits(report(), report(), empty, now)), /None reported/);
});

test('invalid, indefinite, duplicate and malformed exceptions fail closed', () => {
  for (const change of [
    { owner: '' }, { reason: ' ' }, { expires: 'never' }, { expires: '2026-02-30' },
    { scope: 'all' }, { package: '*' }, { advisory: '*' }, { extra: 'unsupported' },
  ]) {
    assert.throws(() => evaluateAudits(high(), high(), { exceptions: [{ ...exception, ...change }] }, now));
  }
  assert.throws(() => evaluateAudits(high(), high(), { exceptions: [exception, exception] }, now), /Duplicate/);
  assert.throws(() => evaluateAudits(high(), high(), {}, now), /exceptions array/);
});

test('transitive parent findings do not duplicate advisories and unresolved references fail', () => {
  const full = high();
  full.vulnerabilities.parent = { severity: 'high', via: ['example'] };
  full.metadata.vulnerabilities.high++;
  full.metadata.vulnerabilities.total++;
  assert.equal(evaluateAudits(full, report(), empty, now).findings.length, 1);
  full.vulnerabilities.parent.via = ['missing'];
  assert.throws(() => evaluateAudits(full, report(), empty, now), /unresolved/);
});

test('audit errors, bad schemas and inconsistent reports cannot produce a clean result', () => {
  for (const bad of [null, {}, { ...report(), error: { code: 'registry error' } },
    { ...report(), auditReportVersion: 1 }, { ...report(), vulnerabilities: [] }]) {
    assert.throws(() => evaluateAudits(bad, report(), empty, now));
  }
  assert.throws(() => evaluateAudits(report(), high(), empty, now), /inconsistent/);
  const bad = high();
  bad.vulnerabilities.example.via[0].url = 'https://registry.invalid/unsupported';
  assert.throws(() => evaluateAudits(bad, report(), empty, now), /unsupported advisory/);
  const counts = report();
  counts.metadata.vulnerabilities.high = -1;
  assert.throws(() => evaluateAudits(counts, report(), empty, now), /invalid counts/);
});

test('npm audit exit 1 is parsed as findings while process, registry and JSON failures are explicit', () => {
  const result = (status, value) => ({ status, stdout: JSON.stringify(value), signal: null });
  assert.deepEqual(parseAuditResult(result(1, high()), 'Fixture'), high());
  assert.deepEqual(parseAuditResult(result(0, report()), 'Fixture'), report());
  assert.deepEqual(parseAuditResult(result(0, report([['example', 'info']])), 'Fixture'),
    report([['example', 'info']]));
  assert.throws(() => parseAuditResult(result(0, high()), 'Fixture'), /exit status/);
  assert.throws(() => parseAuditResult(result(1, report()), 'Fixture'), /exit status/);
  assert.throws(() => parseAuditResult(result(1, { error: { code: 'E503' } }), 'Fixture'), /supported successful/);
  for (const failure of [
    { status: 2 }, { status: null, error: new Error('timeout') },
    { status: null, signal: 'SIGTERM' },
  ]) assert.throws(() => parseAuditResult(failure, 'Fixture'), /process failure or timeout/);
  assert.throws(() => parseAuditResult({ status: 1, stdout: '<html>error</html>' }, 'Fixture'), /valid JSON/);
});

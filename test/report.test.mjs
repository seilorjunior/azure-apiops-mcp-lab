import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { record, renderReport, sanitizeEvent } from '../scripts/report.mjs';

test('report drops all non-allowlisted text and persists only safe fields', () => {
  const folder = mkdtempSync(join(tmpdir(), 'apiops-report-test-'));
  const path = join(folder, 'report.jsonl');
  try {
    record({ stage: 'source-proxy', status: 'fail', phase: 'initialize', code: -32001, elapsedMs: 60000,
      url: 'https://private.example', credential: 'fixture-secret', message: '<script>private</script>' }, path);
    const text = readFileSync(path, 'utf8');
    assert.doesNotMatch(text, /private|fixture-secret|https|script/);
    const summary = renderReport(text.trim().split('\n').map((line) => JSON.parse(line)), {
      mode: 'dry-run', steps: { promotion: 'failure' },
    });
    assert.match(summary, /source-proxy.*fail.*initialize/);
    assert.match(summary, /-32001/);
    assert.doesNotMatch(summary, /fixture-secret|private\.example|<script>/);
  } finally {
    rmSync(path, { force: true });
    rmdirSync(folder);
  }
});

test('report represents preview, apply, incomplete and skipped stages without false success', () => {
  const events = [
    { stage: 'cli-version', version: '1.0.5' },
    { stage: 'artifact-validation', status: 'pass', apiCount: 3 },
    { stage: 'publisher-preview', status: 'pass' },
  ];
  const preview = renderReport(events, { mode: 'dry-run', steps: { promotion: 'success' } });
  assert.match(preview, /APIops CLI: \*\*1\.0\.5/);
  assert.match(preview, /Validated API count: \*\*3/);
  assert.doesNotMatch(preview, /\| publication \| pass/);
  assert.match(preview, /\| target-proxy \| not run/);
  const apply = renderReport([...events, { stage: 'publication', status: 'start' }], {
    mode: 'apply', steps: { promotion: 'failure' },
  });
  assert.match(apply, /publication \| incomplete/);
  assert.match(apply, /Failure\/incomplete stage: \*\*publication/);
  assert.match(renderReport([], { mode: 'dry-run', steps: { login: 'failure' } }), /login \| failure/);
  assert.throws(() => sanitizeEvent({ stage: 'private-url', status: 'pass' }), /Invalid stage/);
  assert.throws(() => sanitizeEvent({ stage: 'cli-version', version: '1.0.5\nsecret' }), /Invalid CLI/);
  assert.throws(() => sanitizeEvent({ stage: 'source-proxy', status: 'fail', phase: 'secret' }), /Invalid MCP phase/);
});

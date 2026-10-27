import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const requireCli = createRequire(new URL('../node_modules/@azure-tools/apiops-cli/package.json', import.meta.url));
const { load } = requireCli('js-yaml');
const readWorkflow = (name) => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));

test('contributor CI has no Azure identity, secrets or privileged PR event', () => {
  const ci = readWorkflow('ci');
  assert.ok(Object.hasOwn(ci.on, 'pull_request'));
  assert.equal(Object.hasOwn(ci.on, 'pull_request_target'), false);
  assert.deepEqual(ci.permissions, { contents: 'read' });
  assert.deepEqual(ci.jobs.test.strategy.matrix.os, ['ubuntu-24.04', 'windows-2025']);
  const text = JSON.stringify(ci);
  assert.doesNotMatch(text, /azure\/login|id-token|secrets\.|github\.token|azd up|apiops publish/);
});

test('Azure promotion is manual and waits for a no-OIDC policy job', () => {
  const workflow = readWorkflow('promote');
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, 'dry-run');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.promote.needs, 'authorize');
  assert.equal(workflow.jobs.authorize.permissions['id-token'], undefined);
  assert.equal(workflow.jobs.promote.permissions['id-token'], 'write');
  assert.equal(workflow.jobs.authorize.env.PROMOTION_ENABLED, '${{ vars.ENABLE_AZURE_PROMOTION }}');
  assert.equal(workflow.jobs.authorize.env.ALLOWED_PROMOTION_ACTOR_ID, '${{ vars.APIM_PROMOTION_ALLOWED_ACTOR_ID }}');
  assert.equal(workflow.jobs.authorize.env.PROMOTION_ACTOR_ID, '${{ github.actor_id }}');
  assert.equal(workflow.jobs.authorize.env.PROMOTION_TRIGGERING_ACTOR, '${{ github.triggering_actor }}');
  const gate = workflow.jobs.authorize.steps[0].run;
  for (const required of ['PROMOTION_ENABLED', 'deployment_branch_policy', 'required_reviewers', 'prevent_self_review', 'apim-preview', 'apim-promotion']) {
    assert.ok(gate.includes(required), `Missing gate: ${required}`);
  }
  assert.equal(Object.hasOwn(workflow.on, 'pull_request_target'), false);
});

test('both promotion jobs authorize only the configured dispatcher and re-run user', () => {
  const workflow = readWorkflow('promote');
  const gate = workflow.jobs.authorize.steps[0].run;
  const recheck = workflow.jobs.promote.steps[0];
  assert.equal(recheck.env.PROMOTION_ENABLED, '${{ vars.ENABLE_AZURE_PROMOTION }}');
  assert.equal(recheck.env.ALLOWED_PROMOTION_ACTOR_ID, '${{ vars.APIM_PROMOTION_ALLOWED_ACTOR_ID }}');
  assert.equal(recheck.env.PROMOTION_ACTOR_ID, '${{ github.actor_id }}');
  assert.equal(recheck.env.PROMOTION_TRIGGERING_ACTOR, '${{ github.triggering_actor }}');
  const environmentGate = gate.indexOf('for environment in ');
  assert.ok(environmentGate > 0);
  const actorGate = gate.slice(0, environmentGate);
  const bash = process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
    : 'bash';
  const cases = [
    { name: 'allowed user', overrides: {}, status: 0 },
    { name: 'other dispatcher', overrides: { PROMOTION_ACTOR_ID: '202' }, status: 1, error: /may dispatch/ },
    { name: 'other re-run user', overrides: { MOCK_TRIGGERING_ID: '202' }, status: 1, error: /may re-run/ },
    { name: 'missing allowlist', overrides: { ALLOWED_PROMOTION_ACTOR_ID: '' }, status: 1, error: /numeric ID/ },
    { name: 'malformed allowlist', overrides: { ALLOWED_PROMOTION_ACTOR_ID: 'owner' }, status: 1, error: /numeric ID/ },
    { name: 'disabled', overrides: { PROMOTION_ENABLED: 'false' }, status: 1, error: /disabled/ },
    { name: 'identity lookup failure', overrides: { MOCK_LOOKUP_FAILURE: 'true' }, status: 7 },
    { name: 'non-default branch', overrides: { GITHUB_REF: 'refs/heads/other' }, status: 1, error: /default branch/ },
    { name: 'invalid mode', overrides: { PROMOTION_MODE: 'other' }, status: 1, error: /Unsupported/ },
  ];
  for (const script of [gate, recheck.run]) {
    for (const scenario of cases) {
      const result = spawnSync(bash, ['--noprofile', '--norc', '-c', `
        gh() {
          [[ "$1" == api && "$2" == users/example-owner && "$3" == --jq && "$4" == .id ]] || return 99
          [[ "$MOCK_LOOKUP_FAILURE" != true ]] || return 7
          printf '%s\\n' "$MOCK_TRIGGERING_ID"
        }
        ${script === gate && scenario.status === 0 ? actorGate : script}
      `], {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          PROMOTION_ENABLED: 'true',
          ALLOWED_PROMOTION_ACTOR_ID: '101',
          PROMOTION_ACTOR_ID: '101',
          PROMOTION_TRIGGERING_ACTOR: 'example-owner',
          MOCK_TRIGGERING_ID: '101',
          MOCK_LOOKUP_FAILURE: 'false',
          DEFAULT_BRANCH: 'main',
          GITHUB_REF: 'refs/heads/main',
          PROMOTION_MODE: 'dry-run',
          ...scenario.overrides,
        },
      });
      if (result.error) throw result.error;
      assert.equal(result.status, scenario.status, `${scenario.name}: ${result.stdout}${result.stderr}`);
      if (scenario.error) assert.match(result.stdout, scenario.error, scenario.name);
    }
  }
});

test('workflow actions are SHA pinned and never upload extracted artifacts', () => {
  for (const name of ['ci', 'promote', 'dependency-audit']) {
    const workflow = readWorkflow(name);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /^[^@]+@[a-f0-9]{40}$/);
        assert.doesNotMatch(step.uses ?? '', /upload-artifact/);
      }
    }
  }
});

test('dependency risk audit is scheduled/manual, unprivileged and separate from PR checks', () => {
  const workflow = readWorkflow('dependency-audit');
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(workflow.on.schedule[0].cron, '23 9 * * 1');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = workflow.jobs.audit;
  assert.equal(job['timeout-minutes'], 10);
  assert.equal(job.steps.find((step) => step.id === 'audit').run, 'npm run audit:dependencies');
  assert.ok(job.steps.some((step) => step.run === 'npm ci --ignore-scripts --no-audit'));
  assert.match(job.steps.at(-1).if, /failure\(\).*steps\.audit\.outcome == 'skipped'/);
  assert.doesNotMatch(JSON.stringify(workflow), /azure\/login|id-token|secrets\.|github\.token|continue-on-error|pull_request/);
  assert.doesNotMatch(JSON.stringify(readWorkflow('ci')), /audit:dependencies/);
});

test('promotion uses private identifiers and always renders an allowlisted summary', () => {
  const workflow = readWorkflow('promote');
  const job = workflow.jobs.promote;
  for (const name of ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID']) {
    assert.equal(job.env[name], `\${{ secrets.${name} }}`);
    assert.doesNotMatch(JSON.stringify(workflow), new RegExp(`vars\\.${name}`));
  }
  const login = job.steps.find((step) => step.id === 'login');
  assert.equal(login.with['client-id'], '${{ secrets.AZURE_CLIENT_ID }}');
  assert.equal(login.with['tenant-id'], '${{ secrets.AZURE_TENANT_ID }}');
  assert.equal(login.with['subscription-id'], '${{ secrets.AZURE_SUBSCRIPTION_ID }}');
  assert.equal(job.steps.at(-1).if, 'always()');
  assert.match(job.steps.at(-1).run, /node scripts\/report\.mjs render/);
  assert.equal(job.steps.find((step) => step.id === 'tests').env.APIOPS_REPORT_PATH, '');
});

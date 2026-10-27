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

test('promotion authorizes only the configured dispatcher and re-run user', () => {
  const gate = readWorkflow('promote').jobs.authorize.steps[0].run;
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
  for (const scenario of cases) {
    const result = spawnSync(bash, ['--noprofile', '--norc', '-c', `
      gh() {
        [[ "$1" == api && "$2" == users/example-owner && "$3" == --jq && "$4" == .id ]] || return 99
        [[ "$MOCK_LOOKUP_FAILURE" != true ]] || return 7
        printf '%s\\n' "$MOCK_TRIGGERING_ID"
      }
      ${scenario.status === 0 ? actorGate : gate}
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
});

test('workflow actions are SHA pinned and never upload extracted artifacts', () => {
  for (const name of ['ci', 'promote']) {
    const workflow = readWorkflow(name);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /^[^@]+@[a-f0-9]{40}$/);
        assert.doesNotMatch(step.uses ?? '', /upload-artifact/);
      }
    }
  }
});

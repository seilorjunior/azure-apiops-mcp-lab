import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

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
  const gate = workflow.jobs.authorize.steps[0].run;
  for (const required of ['PROMOTION_ENABLED', 'deployment_branch_policy', 'required_reviewers', 'prevent_self_review', 'apim-preview', 'apim-promotion']) {
    assert.ok(gate.includes(required), `Missing gate: ${required}`);
  }
  assert.equal(Object.hasOwn(workflow.on, 'pull_request_target'), false);
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

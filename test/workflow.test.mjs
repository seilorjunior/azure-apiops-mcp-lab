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
  for (const name of ['ci', 'promote', 'dependency-audit', 'release', 'dependabot-auto-merge']) {
    const workflow = readWorkflow(name);
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /^[^@]+@[a-f0-9]{40}$/);
        assert.doesNotMatch(step.uses ?? '', /upload-artifact/);
      }
    }
  }
});

test('tag releases validate before publishing and never deploy Azure resources', () => {
  const workflow = readWorkflow('release');
  assert.deepEqual(workflow.on, { push: { tags: ['v*.*.*'] } });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.jobs.publish.needs, 'verify');
  assert.deepEqual(workflow.jobs.publish.permissions, { contents: 'write' });
  assert.ok(workflow.jobs.verify.steps.some((step) => step.run === 'npm test'));
  assert.match(workflow.jobs.publish.steps.at(-1).run, /--verify-tag/);
  assert.doesNotMatch(JSON.stringify(workflow), /azure\/login|id-token|azd up/);
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

test('Dependabot auto-merge never executes PR code or bypasses approvals', () => {
  const workflow = readWorkflow('dependabot-auto-merge');
  assert.deepEqual(workflow.on, {
    pull_request_target: { types: ['opened', 'reopened', 'synchronize', 'edited', 'ready_for_review'] },
  });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const job = workflow.jobs.enable;
  assert.match(job.if, /pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.match(job.if, /head\.repo\.full_name == github\.repository/);
  assert.match(job.if, /base\.ref == github\.event\.repository\.default_branch/);
  assert.deepEqual(job.permissions, { contents: 'write', 'pull-requests': 'write' });
  assert.equal(job.steps.length, 3);
  assert.match(job.steps[1].uses, /^dependabot\/fetch-metadata@/);
  assert.equal(job.steps[1].with, undefined);
  assert.equal(job.steps[2].env.UPDATED_DEPENDENCIES, '${{ steps.metadata.outputs.updated-dependencies-json }}');
  assert.doesNotMatch(JSON.stringify(workflow), /actions\/checkout|npm ci|npm install|azure\/login|id-token|--admin|gh pr review/);
  assert.ok(job.steps.every((step) => !step.run));
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function autoMergeHarness() {
  const pull = {
    node_id: 'PR_test', state: 'open', draft: false, changed_files: 2,
    user: { login: 'dependabot[bot]' },
    head: { sha: 'verified-head', repo: { full_name: 'owner/repo' } },
    base: { ref: 'main' }, auto_merge: null,
  };
  const repository = { full_name: 'owner/repo', default_branch: 'main', allow_auto_merge: true };
  const rules = [
    { type: 'required_status_checks', parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [
        'Test (ubuntu-24.04)', 'Test (windows-2025)', 'Lint, types and coverage',
        'Validate infrastructure', 'Container smoke test',
      ].map((context) => ({ context, integration_id: 15368 })),
    } },
    { type: 'pull_request', parameters: {
      required_approving_review_count: 1, require_code_owner_review: true, dismiss_stale_reviews_on_push: true,
    } },
  ];
  const files = ['package.json', 'package-lock.json'].map((filename) => ({ filename, status: 'modified' }));
  const mutations = [];
  const merges = [];
  const notices = [];
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: pull }), listFiles: 'listFiles',
        merge: async (parameters) => { merges.push(parameters); return { data: { merged: true } }; },
      },
      repos: { get: async () => ({ data: repository }) },
    },
    paginate: async () => files,
    request: async () => ({ data: rules }),
    graphql: async (query, variables) => { mutations.push({ query, variables }); },
  };
  const context = {
    repo: { owner: 'owner', repo: 'repo' }, issue: { number: 42 },
    payload: { pull_request: { head: { sha: 'verified-head' } } },
  };
  const dependencies = [{ packageEcosystem: 'npm_and_yarn', updateType: 'version-update:semver-patch' }];
  const steps = readWorkflow('dependabot-auto-merge').jobs.enable.steps;
  const run = (index = 2) => new AsyncFunction('github', 'context', 'core', 'process', steps[index].with.script)(
    github, context, { notice: (message) => notices.push(message) },
    { env: { UPDATED_DEPENDENCIES: JSON.stringify(dependencies) } },
  );
  return { pull, repository, rules, files, mutations, merges, notices, github, context, dependencies, run };
}

test('eligible npm patch/minor updates queue a squash merge without approving', async () => {
  for (const ecosystem of ['npm', 'npm_and_yarn']) {
    for (const type of ['patch', 'minor']) {
      const harness = autoMergeHarness();
      harness.dependencies[0] = { packageEcosystem: ecosystem, updateType: `version-update:semver-${type}` };
      await harness.run();
      assert.equal(harness.mutations.length, 1);
      assert.match(harness.mutations[0].query, /enablePullRequestAutoMerge/);
      assert.match(harness.mutations[0].query, /mergeMethod: SQUASH/);
      assert.deepEqual(harness.mutations[0].variables, { id: 'PR_test' });
      assert.match(harness.notices[0], /still requires approval/);
      assert.deepEqual(harness.merges, []);
    }
  }
});

test('already-approved passing updates use a protected squash merge bound to the checked SHA', async () => {
  const harness = autoMergeHarness();
  harness.pull.mergeable_state = 'clean';
  await harness.run();
  assert.deepEqual(harness.mutations, []);
  assert.deepEqual(harness.merges, [{
    owner: 'owner', repo: 'repo', pull_number: 42, sha: 'verified-head', merge_method: 'squash',
  }]);
  assert.match(harness.notices[0], /GitHub enforced protected checks and approval/);
  harness.github.rest.pulls.merge = async () => ({ data: { merged: false, message: 'Approval required' } });
  await assert.rejects(harness.run(), /Protected merge failed: Approval required/);
});

test('auto-merge reports ineligible dependency types, authors, branches and changed files', async () => {
  const cases = [
    (h) => { h.dependencies.length = 0; },
    (h) => { h.dependencies[0].updateType = 'version-update:semver-major'; },
    (h) => { h.dependencies.push({ packageEcosystem: 'npm', updateType: 'version-update:semver-major' }); },
    (h) => { h.dependencies[0].packageEcosystem = 'github_actions'; },
    (h) => { h.dependencies[0].updateType = ''; },
    (h) => { h.pull.user.login = 'contributor'; },
    (h) => { h.pull.head.repo.full_name = 'fork/repo'; },
    (h) => { h.pull.base.ref = 'other'; },
    (h) => { h.pull.head.sha = 'new-head'; },
    (h) => { h.pull.draft = true; },
    (h) => { h.pull.state = 'closed'; },
    (h) => { h.files[0].filename = 'src/server.mjs'; },
    (h) => { h.files[0].filename = '.github/workflows/ci.yml'; },
    (h) => { h.files[0].filename = 'nested/package.json'; },
    (h) => { h.files[0].status = 'renamed'; },
    (h) => { h.files[0].status = 'removed'; },
    (h) => { h.files.length = 0; },
    (h) => { h.pull.changed_files = 3; },
  ];
  for (const change of cases) {
    const harness = autoMergeHarness();
    change(harness);
    await harness.run();
    assert.deepEqual(harness.mutations, []);
    assert.deepEqual(harness.merges, []);
    assert.match(harness.notices[0], /Manual review required/);
  }
});

test('auto-merge fails closed on disabled settings, missing protections and API errors', async () => {
  const cases = [
    (h) => { h.repository.allow_auto_merge = false; },
    (h) => { h.rules.length = 0; },
    (h) => { h.rules[0].parameters.strict_required_status_checks_policy = false; },
    (h) => { h.rules[0].parameters.required_status_checks.pop(); },
    (h) => { h.rules[0].parameters.required_status_checks[0].integration_id = null; },
    (h) => { h.rules[1].parameters.required_approving_review_count = 0; },
    (h) => { h.rules[1].parameters.require_code_owner_review = false; },
    (h) => { h.rules[1].parameters.dismiss_stale_reviews_on_push = false; },
    (h) => { h.github.request = async () => { throw new Error('API unavailable'); }; },
    (h) => { h.github.graphql = async () => { throw new Error('Mutation denied'); }; },
    (h) => {
      let calls = 0;
      h.github.rest.pulls.get = async () => ({
        data: ++calls === 1 ? h.pull : { ...h.pull, head: { ...h.pull.head, sha: 'changed-head' } },
      });
    },
  ];
  for (const change of cases) {
    const harness = autoMergeHarness();
    change(harness);
    await assert.rejects(harness.run());
    assert.deepEqual(harness.mutations, []);
    assert.deepEqual(harness.merges, []);
  }
});

test('auto-merge clears existing requests before metadata verification can fail', async () => {
  const harness = autoMergeHarness();
  await harness.run(0);
  assert.deepEqual(harness.mutations, []);
  harness.pull.auto_merge = { merge_method: 'squash' };
  await harness.run(0);
  assert.equal(harness.mutations.length, 1);
  assert.match(harness.mutations[0].query, /disablePullRequestAutoMerge/);
  assert.match(harness.notices[0], /eligibility must pass again/);
});

test('only root npm manifests are exempt from Code Owner review', () => {
  const owners = readFileSync(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8')
    .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(owners, ['* @seilorjunior', '/package.json', '/package-lock.json']);
});

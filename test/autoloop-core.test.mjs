import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateConfig } from '../src/config.mjs';
import { CLAIM_SCHEMA_VERSION, GitHubStateBranchAdapter } from '../src/claims.mjs';
import { DISPATCH_CODES, dispatchTask, validateDispatchPacket } from '../src/dispatch.mjs';
import {
  evaluateHumanReadiness,
  extractDependencyIssueNumbers,
  isAutoloopManagedPullRequest,
  selectCandidateIssue
} from '../src/selection.mjs';

const productionConfig = JSON.parse(readFileSync(new URL('../config/autoloop.json', import.meta.url), 'utf8'));
const repository = { owner: 'japiohopman', repo: 'Mijn-CV' };
const packet = {
  repository: 'japiohopman/Mijn-CV',
  claimId: 'unit-test-claim-123',
  issueNumber: 123,
  issueTitle: 'Controlled test task',
  issueBody: 'Scope\nTest only',
  startingBranch: 'master',
  prompt: 'This is a dry-run-only test packet.'
};
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (error) {
    failed++;
    console.error('FAIL ' + name + ': ' + (error?.stack || error));
  }
}
function httpError(status) {
  const error = new Error('mock HTTP error');
  error.status = status;
  return error;
}
function fakeOctokit(options = {}) {
  const state = {
    branchSha: options.branchSha || null,
    claimsContent: options.claimsJson === undefined ? null : options.claimsJson,
    blobs: new Map(),
    trees: new Map(),
    commits: new Map(),
    serial: 0,
    createdRefs: 0,
    writeCount: 0,
    defaultHead: 'b'.repeat(40),
    initialTree: 'tree-initial'
  };
  const octokit = {
    async request(route, params = {}) {
      if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}') {
        if (params.ref === 'heads/master') return { data: { object: { sha: state.defaultHead } } };
        if (params.ref === 'heads/autoloop-state') {
          if (!state.branchSha) throw httpError(404);
          return { data: { object: { sha: state.branchSha } } };
        }
      }
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
        if (params.path !== 'claims.json' || !state.branchSha || state.claimsContent === null) throw httpError(404);
        return { data: { encoding: 'base64', content: Buffer.from(state.claimsContent, 'utf8').toString('base64') } };
      }
      if (route === 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}') {
        if (params.commit_sha === state.branchSha) return { data: { tree: { sha: state.initialTree } } };
        const commit = state.commits.get(params.commit_sha);
        if (!commit) throw httpError(404);
        return { data: { tree: { sha: commit.treeSha } } };
      }
      if (route === 'POST /repos/{owner}/{repo}/git/blobs') {
        state.writeCount++;
        const sha = 'blob-' + (++state.serial);
        state.blobs.set(sha, params.content);
        return { data: { sha } };
      }
      if (route === 'POST /repos/{owner}/{repo}/git/trees') {
        state.writeCount++;
        const sha = 'tree-' + (++state.serial);
        state.trees.set(sha, { blobSha: params.tree?.[0]?.sha || null, baseTree: params.base_tree || null });
        return { data: { sha } };
      }
      if (route === 'POST /repos/{owner}/{repo}/git/commits') {
        state.writeCount++;
        const sha = 'commit-' + (++state.serial);
        const treeSha = params.tree;
        const tree = state.trees.get(treeSha);
        state.commits.set(sha, { parents: params.parents || [], treeSha, blobSha: tree?.blobSha || null });
        return { data: { sha } };
      }
      if (route === 'POST /repos/{owner}/{repo}/git/refs') {
        state.writeCount++;
        if (state.branchSha) throw httpError(422);
        const commit = state.commits.get(params.sha);
        if (!commit) throw httpError(500);
        state.branchSha = params.sha;
        state.claimsContent = state.blobs.get(commit.blobSha);
        state.createdRefs++;
        return { data: { ref: params.ref, object: { sha: params.sha } } };
      }
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}') {
        state.writeCount++;
        const commit = state.commits.get(params.sha);
        if (!commit || !state.branchSha || commit.parents[0] !== state.branchSha) throw httpError(422);
        state.branchSha = params.sha;
        state.claimsContent = state.blobs.get(commit.blobSha);
        return { data: { ref: params.ref, object: { sha: params.sha } } };
      }
      throw new Error('Unexpected mock GitHub route: ' + route);
    }
  };
  return { octokit, state };
}
function makeAdapter(octokit, options = {}) {
  return new GitHubStateBranchAdapter({
    octokit,
    repository,
    stateBranch: 'autoloop-state',
    defaultBranch: 'master',
    ...options
  });
}
function emptySnapshot() {
  return { snapshotComplete: true, repository, issues: [], pullRequests: [], sessions: [], claims: [], sequence: [] };
}

await test('production configuration stays disabled, dry-run and requires CI', () => {
  const result = validateConfig(productionConfig);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(productionConfig.enabled, false);
  assert.equal(productionConfig.runMode, 'dry-run');
  assert.equal(productionConfig.workProvider, 'none');
  assert.equal(productionConfig.automaticMerge, false);
  assert.deepEqual(productionConfig.requiredChecks, ['build-and-test']);
  assert.equal(typeof productionConfig.labels.humanReady, 'string');
});

await test('config schema rejects an empty requiredChecks list', () => {
  const result = validateConfig({ ...productionConfig, requiredChecks: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.path.includes('requiredChecks')));
});

await test('dispatch packet validates required fields', () => {
  assert.equal(validateDispatchPacket(packet).valid, true);
  assert.equal(validateDispatchPacket({ ...packet, issueNumber: 0 }).valid, false);
  assert.equal(validateDispatchPacket({ ...packet, repository: '' }).valid, false);
});

await test('disabled dispatch does not read claims or contact a provider', async () => {
  let reads = 0;
  let providerCalls = 0;
  const result = await dispatchTask({
    config: productionConfig,
    packet,
    confirmation: 'DISPATCH',
    stateAdapter: { async readState() { reads++; throw new Error('must not be called'); } },
    providerClient: {
      async findSourceForRepository() { providerCalls++; },
      async createSession() { providerCalls++; }
    },
    snapshot: emptySnapshot()
  });
  assert.equal(result.decisionCode, DISPATCH_CODES.DISPATCH_DISABLED);
  assert.equal(reads, 0);
  assert.equal(providerCalls, 0);
});

await test('dry-run dispatch cannot create a claim or session', async () => {
  let reads = 0;
  let providerCalls = 0;
  const dryRun = { ...productionConfig, enabled: true, runMode: 'dry-run', workProvider: 'jules' };
  const result = await dispatchTask({
    config: dryRun,
    packet,
    confirmation: 'DISPATCH',
    stateAdapter: { async readState() { reads++; throw new Error('must not be called'); } },
    providerClient: {
      async findSourceForRepository() { providerCalls++; },
      async createSession() { providerCalls++; }
    },
    snapshot: emptySnapshot()
  });
  assert.equal(result.decisionCode, DISPATCH_CODES.DISPATCH_DRY_RUN);
  assert.equal(reads, 0);
  assert.equal(providerCalls, 0);
});

await test('incorrect live confirmation fails before state/provider mutation', async () => {
  let reads = 0;
  let providerCalls = 0;
  const liveOnlyForTest = { ...productionConfig, enabled: true, runMode: 'live', workProvider: 'jules' };
  const result = await dispatchTask({
    config: liveOnlyForTest,
    packet,
    confirmation: 'NOT-DISPATCH',
    stateAdapter: { async readState() { reads++; throw new Error('must not be called'); } },
    providerClient: {
      async findSourceForRepository() { providerCalls++; },
      async createSession() { providerCalls++; }
    },
    snapshot: emptySnapshot()
  });
  assert.equal(result.decisionCode, DISPATCH_CODES.DISPATCH_CONFIRMATION_INVALID);
  assert.equal(reads, 0);
  assert.equal(providerCalls, 0);
});

await test('selection blocks an incomplete snapshot', () => {
  const result = selectCandidateIssue({ issues: [] }, productionConfig);
  assert.equal(result.decisionCode, 'BLOCK_INCOMPLETE_SNAPSHOT');
  assert.equal(result.safeToDispatch, false);
});

await test('empty complete snapshot selects no work', () => {
  const result = selectCandidateIssue(emptySnapshot(), productionConfig);
  assert.equal(result.decisionCode, 'NO_ELIGIBLE_CANDIDATE');
  assert.equal(result.selectedCandidate, null);
  assert.equal(result.safeToDispatch, false);
});

await test('human readiness accepts only the configured humanReady label', () => {
  const config = { humanReadinessRequired: true, labels: { humanReady: 'human-ready' } };
  assert.equal(evaluateHumanReadiness({ number: 1, labels: ['human-ready'] }, config).verified, true);
  assert.equal(evaluateHumanReadiness({ number: 1, labels: ['human-approved'] }, config).verified, false);
  assert.equal(evaluateHumanReadiness({ number: 1, labels: [], humanReadiness: true }, config).verified, false);
  assert.equal(evaluateHumanReadiness({ number: 1, labels: [] }, { humanReadinessRequired: true, labels: {} }).verified, false);
});

await test('local dependency references work but cross-repository references fail closed', () => {
  assert.deepEqual(extractDependencyIssueNumbers({ number: 2, body: '## Dependencies\n- #5\n' }, repository), { valid: true, numbers: [5] });
  assert.deepEqual(extractDependencyIssueNumbers({ number: 2, body: '## Dependencies\n- https://github.com/japiohopman/Mijn-CV/issues/5\n' }, repository), { valid: true, numbers: [5] });
  const otherURL = extractDependencyIssueNumbers({ number: 2, body: '## Dependencies\n- https://github.com/other-owner/other-repo/issues/5\n' }, repository);
  assert.equal(otherURL.valid, false);
  assert.match(otherURL.reason, /different repository/i);
  assert.equal(extractDependencyIssueNumbers({ number: 2, body: '## Dependencies\n- other-owner/other-repo#5\n' }, repository).valid, false);
});

await test('unrelated pull requests do not count as Autoloop work', () => {
  const managed = { number: 10, body: 'Closes #101', labels: [] };
  const unrelated = { number: 11, body: 'Closes #102', labels: [] };
  const issues = [
    { number: 101, labels: ['type:task', 'in-progress'] },
    { number: 102, labels: ['enhancement', 'documentation'] }
  ];
  assert.equal(isAutoloopManagedPullRequest(managed, issues, productionConfig, repository), true);
  assert.equal(isAutoloopManagedPullRequest(unrelated, issues, productionConfig, repository), false);
});

await test('missing state branch is a hard blocker, not an empty state', async () => {
  const fake = fakeOctokit();
  await assert.rejects(makeAdapter(fake.octokit).readState(), (error) => error.code === 'STATE_STORE_NOT_INITIALIZED');
});

await test('non-versioned or malformed claims file is rejected, never reset', async () => {
  const missingVersion = fakeOctokit({ branchSha: 'a'.repeat(40), claimsJson: '{"claims":[]}' });
  await assert.rejects(makeAdapter(missingVersion.octokit).readState(), (error) => error.code === 'INVALID_STATE_STORE');
  const malformed = fakeOctokit({ branchSha: 'a'.repeat(40), claimsJson: '{"schemaVersion":1,"claims":[{"claimId":"broken"}]}' });
  await assert.rejects(makeAdapter(malformed.octokit).readState(), (error) => error.code === 'INVALID_STATE_STORE');
  const noFile = fakeOctokit({ branchSha: 'a'.repeat(40), claimsJson: null });
  await assert.rejects(makeAdapter(noFile.octokit).readState(), (error) => error.code === 'INVALID_STATE_STORE');
});

await test('valid versioned empty state can be read exactly', async () => {
  const fake = fakeOctokit({ branchSha: 'a'.repeat(40), claimsJson: JSON.stringify({ schemaVersion: CLAIM_SCHEMA_VERSION, claims: [] }) });
  const result = await makeAdapter(fake.octokit).readState();
  assert.equal(result.head, 'a'.repeat(40));
  assert.deepEqual(result.claims, []);
});

await test('ordinary adapter cannot initialize a missing store implicitly', async () => {
  const fake = fakeOctokit();
  const result = await makeAdapter(fake.octokit).commitStateChange(null, []);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'STATE_STORE_NOT_INITIALIZED');
  assert.equal(fake.state.writeCount, 0);
});

await test('only explicit initialization can create a versioned empty ledger', async () => {
  const fake = fakeOctokit();
  const stateAdapter = makeAdapter(fake.octokit, { allowInitialize: true });
  const created = await stateAdapter.commitStateChange(null, []);
  assert.equal(created.success, true);
  const after = await stateAdapter.readState();
  assert.equal(after.head, created.head);
  assert.deepEqual(after.claims, []);
  assert.equal(JSON.parse(fake.state.claimsContent).schemaVersion, CLAIM_SCHEMA_VERSION);
});

await test('concurrent first-time initializers cannot create duplicate state branches', async () => {
  const fake = fakeOctokit();
  const first = makeAdapter(fake.octokit, { allowInitialize: true });
  const second = makeAdapter(fake.octokit, { allowInitialize: true });
  const results = await Promise.all([first.commitStateChange(null, []), second.commitStateChange(null, [])]);
  assert.equal(results.filter((result) => result.success).length, 1);
  assert.equal(results.filter((result) => result.reason === 'CAS_CONFLICT').length, 1);
  assert.equal(fake.state.createdRefs, 1);
  assert.deepEqual((await first.readState()).claims, []);
});

await test('concurrent claim-state writes use compare-and-swap and only one wins', async () => {
  const fake = fakeOctokit({ branchSha: 'a'.repeat(40), claimsJson: JSON.stringify({ schemaVersion: CLAIM_SCHEMA_VERSION, claims: [] }) });
  const stateAdapter = makeAdapter(fake.octokit);
  const before = await stateAdapter.readState();
  const results = await Promise.all([
    stateAdapter.commitStateChange(before.head, []),
    stateAdapter.commitStateChange(before.head, [])
  ]);
  assert.equal(results.filter((result) => result.success).length, 1);
  assert.equal(results.filter((result) => result.reason === 'CAS_CONFLICT').length, 1);
});

await test('runner stops before API access if repository credentials are missing', () => {
  const result = spawnSync(process.execPath, ['scripts/autoloop-runner.mjs'], {
    cwd: process.cwd(), env: { PATH: process.env.PATH || '' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCK_CONFIGURATION_ERROR/);
});

await test('state bootstrap stops before API access if credentials are missing', () => {
  const result = spawnSync(process.execPath, ['scripts/bootstrap-autoloop-state.mjs'], {
    cwd: process.cwd(), env: { PATH: process.env.PATH || '' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BLOCK_CONFIGURATION/);
  assert.doesNotMatch(result.stdout, /JULES_API_KEY/);
});

if (failed > 0) {
  console.error('Autoloop core tests failed: ' + failed);
  process.exitCode = 1;
} else {
  console.log('Autoloop core tests passed.');
}

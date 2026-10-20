import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { shouldExposeProviderAccess } from '../scripts/provider-access.mjs';
import { validateConfig } from '../src/config.mjs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const gateWorkflow = read('.github/workflows/pr-contract-gate.yml');
const relayWorkflow = read('.github/workflows/review-relay.yml');
const config = JSON.parse(read('config/autoloop.json'));

function assertPreflightIsFailClosed(workflow, label, expectedFiles) {
  const preflight = workflow.indexOf('Verify trusted ' + label + ' implementation is installed');
  assert.notEqual(preflight, -1, label + ' must have an explicit trusted-code preflight');
  const firstExecution = workflow.indexOf(label === 'gate'
    ? 'node scripts/pr-contract-gate.mjs'
    : 'node scripts/review-relay.mjs');
  assert.ok(firstExecution > preflight, label + ' preflight must happen before its implementation executes');

  const preflightBody = workflow.slice(preflight, firstExecution);
  assert.match(preflightBody, /set -euo pipefail/);
  assert.match(preflightBody, /::error title=Trusted .* bootstrap pending::/);
  assert.match(preflightBody, /exit 1/);
  assert.doesNotMatch(preflightBody, /skip(ping)? .*success|echo .*skipping/i);
  for (const file of expectedFiles) {
    assert.ok(preflightBody.includes('"' + file + '"'), label + ' preflight must check ' + file);
  }
}

assertPreflightIsFailClosed(gateWorkflow, 'gate', [
  'scripts/pr-contract-gate.mjs',
  'src/pr-gate.mjs',
  'src/contracts.mjs',
  'src/config.mjs',
  'config/autoloop.schema.v1.json'
]);
assertPreflightIsFailClosed(relayWorkflow, 'review-relay', [
  'config/autoloop.json',
  'scripts/provider-access.mjs',
  'scripts/review-relay.mjs',
  'src/claims.mjs',
  'src/reconciliation.mjs',
  'src/review-relay.mjs'
]);

assert.match(gateWorkflow, /github\.event\.pull_request\.base\.sha/);
assert.match(relayWorkflow, /github\.event\.repository\.default_branch/);
assert.doesNotMatch(gateWorkflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.ref/);
assert.doesNotMatch(relayWorkflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.ref/);

const configValidation = validateConfig(config);
assert.equal(configValidation.valid, true, JSON.stringify(configValidation.errors));
assert.equal(config.enabled, false, 'Bootstrap must not enable live dispatch');
assert.equal(config.runMode, 'dry-run', 'Bootstrap must remain plan-only');
assert.equal(config.repairDispatchEnabled, false);
assert.equal(config.repairPilotApproved, false);
assert.equal(config.automaticMerge, false);
assert.equal(config.scheduleEnabled, false);
assert.deepEqual(config.requiredChecks, ['build-and-test']);

const sha = '0123456789abcdef0123456789abcdef01234567';
const liveButNotApproved = { ...config, enabled: true, runMode: 'live' };
const repairReadyConfig = {
  ...liveButNotApproved,
  repairDispatchEnabled: true,
  repairPilotApproved: true,
  humanReadinessRequired: true,
  automaticMerge: false,
  scheduleEnabled: false,
  trustedReviewers: ['trusted-maintainer']
};
const trustedReviewEvent = {
  comment: {
    body: '[autoloop:relay-review]',
    user: { login: 'trusted-maintainer' }
  },
  issue: { pull_request: { url: 'https://api.github.com/repos/example/repo/pulls/1' } }
};
const openPR = { state: 'open', merged: false, head: { sha } };
const trustedChangesRequested = [{
  id: 42,
  state: 'CHANGES_REQUESTED',
  commit_id: sha,
  submitted_at: '2026-10-20T10:00:00Z',
  user: { login: 'trusted-maintainer' }
}];

assert.equal(shouldExposeProviderAccess({
  eventName: 'issue_comment', event: trustedReviewEvent, config,
  pullRequest: openPR, reviews: trustedChangesRequested
}), false, 'Disabled configuration must never expose provider access');
assert.equal(shouldExposeProviderAccess({
  eventName: 'issue_comment', event: trustedReviewEvent, config: liveButNotApproved,
  pullRequest: openPR, reviews: trustedChangesRequested
}), false, 'Repair must remain blocked until separate pilot approval is set');
assert.equal(shouldExposeProviderAccess({
  eventName: 'issue_comment', event: trustedReviewEvent, config: repairReadyConfig,
  pullRequest: openPR, reviews: trustedChangesRequested
}), true, 'Only a trusted current-head changes-requested review and explicit repair-pilot authorization may expose provider access');
assert.equal(shouldExposeProviderAccess({
  eventName: 'issue_comment',
  event: { ...trustedReviewEvent, comment: { ...trustedReviewEvent.comment, user: { login: 'untrusted-user' } } },
  config: repairReadyConfig, pullRequest: openPR, reviews: trustedChangesRequested
}), false, 'An untrusted retry actor must not expose provider access');

const syntaxFiles = [
  'scripts/pr-contract-gate.mjs',
  'scripts/provider-access.mjs',
  'scripts/review-relay.mjs',
  'scripts/reconcile-readonly.mjs',
  'src/claims.mjs',
  'src/config.mjs',
  'src/contracts.mjs',
  'src/jules.mjs',
  'src/pagination.mjs',
  'src/preflight.mjs',
  'src/pr-gate.mjs',
  'src/reconciliation.mjs',
  'src/review-relay.mjs'
];
for (const file of syntaxFiles) {
  assert.ok(existsSync(new URL('../' + file, import.meta.url)), 'Trusted dependency missing from bootstrap PR: ' + file);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

console.log('Autoloop trusted-code bootstrap regressions passed.');


// Exercise the actual PR-gate decision module with deterministic trusted metadata.
const { evaluatePullRequestGate } = await import('../src/pr-gate.mjs');
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const parentSha = 'c'.repeat(40);
const headTreeSha = 'd'.repeat(40);
const parentTreeSha = 'e'.repeat(40);
const governingIssue = {
  number: 99,
  state: 'open',
  body: [
    '## Scope', 'Bootstrap unit-test fixture.',
    '## Acceptance criteria', 'Contains a complete, reviewable contract.',
    '## Dependencies', 'None.',
    '## Out of scope', 'No live dispatch or repository writes.',
    '## Validation plan', 'Run deterministic unit tests.'
  ].join('\n\n')
};
const prBody = [
  '## Governing Issue',
  'Closes #99',
  '## Summary',
  'Exercise the trusted PR gate using a complete metadata fixture.',
  '## Scope boundary',
  'This unit test does not change runtime workflow behavior.',
  '## Acceptance criteria evidence',
  '- [x] Criterion: A complete current-head evidence packet passes.',
  '  - Evidence: This fixture supplies the governing issue, exact paths, commit trees, and successful checks.',
  '## Verification',
  '- Changed paths:',
  '  - test/autoloop-bootstrap.test.mjs',
  '- Commands/checks run: node test/autoloop-bootstrap.test.mjs — passed',
  '- Exact head SHA verified: ' + headSha,
  '- Check results for that SHA: build-and-test completed successfully for the exact current head.',
  '## Risks and blockers',
  '- Security/permissions impact: none; deterministic metadata only.',
  '- Known blockers: none for this fixture.',
  '- Recovery or rollback: revert this test-only addition.',
  '## Handoff',
  '- Latest reviewer instructions addressed: first review.',
  '- Next action and owner: maintainer inspects the current head.',
  '- [x] No-op commit check completed'
].join('\n\n');
const completeEvidence = {
  repositoryFullName: 'japiohopman/Mijn-CV',
  pullRequest: {
    number: 101,
    state: 'open',
    merged: false,
    body: prBody,
    head: { sha: headSha },
    base: { sha: baseSha }
  },
  eventHeadSha: headSha,
  confirmedCurrentHeadSha: headSha,
  issue: governingIssue,
  requiredIssueSections: ['Scope', 'Acceptance criteria', 'Dependencies', 'Out of scope', 'Validation plan'],
  requiredChecks: ['build-and-test'],
  changedFiles: [{ filename: 'test/autoloop-bootstrap.test.mjs' }],
  checkRuns: [{
    name: 'build-and-test',
    head_sha: headSha,
    status: 'completed',
    conclusion: 'success',
    completed_at: '2026-10-20T10:00:00Z'
  }],
  headCommit: {
    sha: headSha,
    parents: [{ sha: parentSha }],
    commit: { tree: { sha: headTreeSha } }
  },
  parentCommit: {
    sha: parentSha,
    commit: { tree: { sha: parentTreeSha } }
  }
};
const accepted = evaluatePullRequestGate(completeEvidence);
assert.equal(accepted.success, true, JSON.stringify(accepted.blockers));
assert.equal(accepted.humanApproval.approved, false, 'Passing the gate must not approve the PR');

const staleHead = evaluatePullRequestGate({ ...completeEvidence, eventHeadSha: parentSha });
assert.equal(staleHead.success, false, 'An event from an older head must not pass');
assert.ok(staleHead.blockers.some(blocker => blocker.code === 'EVENT_HEAD_SHA_STALE'));

const missingCheck = evaluatePullRequestGate({ ...completeEvidence, checkRuns: [] });
assert.equal(missingCheck.success, false, 'Missing required checks must not pass');
assert.ok(missingCheck.blockers.some(blocker => blocker.code === 'REQUIRED_CHECK_MISSING_FOR_HEAD'));

const noOp = evaluatePullRequestGate({
  ...completeEvidence,
  headCommit: { ...completeEvidence.headCommit, commit: { tree: { sha: parentTreeSha } } }
});
assert.equal(noOp.success, false, 'A no-op head commit must not pass');
assert.ok(noOp.blockers.some(blocker => blocker.code === 'NO_OP_HEAD_COMMIT'));

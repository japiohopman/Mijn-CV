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

/**
 * Read-only GitHub Actions adapter for the PR contract gate.
 *
 * It reads the trusted event and repository configuration, gathers current
 * PR/Issue/file/commit/check data with GET requests, asks src/pr-gate.mjs to
 * evaluate it, then prints a readable report. Missing or ambiguous evidence
 * blocks the check instead of being treated as success.
 *
 * It never runs PR-head code, writes GitHub state, creates a Jules session,
 * reserves a claim, changes labels, approves, or merges a pull request.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { evaluatePullRequestGate, extractGoverningIssueNumber } from '../src/pr-gate.mjs';

function stop(code, message, nextAction) {
  const report = { success: false, status: 'blocked', mutated: false, blockers: [{ code, message, nextAction }], nextAction };
  console.error('PR contract gate blocked: ' + message);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
function readJson(path, description) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(description + ' could not be read as valid JSON.'); }
}

const repositoryFullName = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';
const eventPath = process.env.GITHUB_EVENT_PATH || '';
const eventName = process.env.GITHUB_EVENT_NAME || '';
const configPath = resolve(process.env.AUTOLOOP_CONFIG_PATH || 'config/autoloop.json');
let owner = '';
let repo = '';
let config = null;
let eventPayload = null;

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryFullName)) {
  stop('TARGET_REPOSITORY_INVALID', 'GITHUB_REPOSITORY is missing or malformed.', 'Run this workflow in the intended consuming repository.');
} else if (!token || !eventPath) {
  stop('REQUIRED_ENVIRONMENT_MISSING', 'GITHUB_TOKEN or the trusted GitHub event-payload path is missing.', 'Check the workflow environment; missing inputs must never count as a pass.');
} else {
  [owner, repo] = repositoryFullName.split('/');
  try {
    config = readJson(configPath, 'Autoloop configuration');
    const validation = validateConfig(config);
    if (!validation.valid) {
      stop('CONFIG_INVALID', 'Configuration failed schema validation: ' + validation.errors.map(error => error.code + ' at ' + error.path).join(', '), 'Fix config/autoloop.json using config/autoloop.example.json as a guide, then rerun.');
      config = null;
    }
    eventPayload = readJson(eventPath, 'GitHub event payload');
  } catch (error) {
    config = null;
    stop('INPUT_READ_FAILED', error.message, 'Restore the required configuration/event file and rerun; missing data must never count as a pass.');
  }

  if (config && eventPayload) {
    const api = async path => {
      // There is deliberately no write helper: every GitHub API request is GET-only.
      const response = await fetch('https://api.github.com' + path, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!response.ok) {
        const error = new Error('GitHub API returned HTTP ' + response.status + ' for a read-only request.');
        error.status = response.status;
        throw error;
      }
      return response.json();
    };
    const fetchAll = async (path, propertyName) => {
      const all = [];
      for (let page = 1; page <= 20; page += 1) {
        const response = await api(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
        const items = Array.isArray(response) ? response : response?.[propertyName];
        if (!Array.isArray(items)) throw new Error('GitHub returned an incomplete paginated list.');
        all.push(...items);
        if (items.length < 100) return all;
      }
      throw new Error('GitHub pagination exceeded the safe page limit; the snapshot is not complete.');
    };

    const run = async () => {
      let pullNumber = Number(process.env.PR_NUMBER || eventPayload.pull_request?.number || 0);
      let eventHeadSha = String(process.env.EVENT_HEAD_SHA || eventPayload.pull_request?.head?.sha || '');

      if (eventName === 'check_suite') {
        const suite = eventPayload.check_suite;
        if (!suite || !Number.isInteger(Number(suite.id)) || !suite.head_sha) {
          stop('CHECK_SUITE_EVENT_INVALID', 'The completed-check event did not include identifying metadata.', 'Inspect the workflow event and confirm it came from GitHub.');
          return;
        }
        const suiteRuns = await api('/repos/' + owner + '/' + repo + '/check-suites/' + Number(suite.id) + '/check-runs?per_page=100');
        const names = Array.isArray(suiteRuns?.check_runs) ? suiteRuns.check_runs.map(item => String(item.name || '')) : [];
        if (names.some(name => name.startsWith('Autoloop PR contract gate /'))) {
          console.log('Skipped the gate’s own check suite to avoid a self-trigger loop.');
          console.log(JSON.stringify({ status: 'skipped_self_check_suite', mutated: false }, null, 2));
          return;
        }
        const associated = (Array.isArray(suite.pull_requests) ? suite.pull_requests : [])
          .filter(pr => Number.isInteger(Number(pr.number)) && String(pr.head?.sha || '').toLowerCase() === String(suite.head_sha).toLowerCase());
        if (associated.length === 0) {
          console.log('No PR is attached to this completed check suite; no PR contract check is needed.');
          console.log(JSON.stringify({ status: 'skipped_no_associated_pr', mutated: false }, null, 2));
          return;
        }
        if (associated.length !== 1) {
          stop('CHECK_SUITE_PR_AMBIGUOUS', 'The completed check suite is associated with multiple PRs at the same head SHA.', 'Run the gate independently for each PR; this workflow refuses to guess.');
          return;
        }
        pullNumber = Number(associated[0].number);
        eventHeadSha = String(suite.head_sha);
      }

      if (!Number.isInteger(pullNumber) || pullNumber < 1 || !/^[0-9a-f]{40}$/i.test(eventHeadSha)) {
        stop('PR_EVENT_INPUT_INVALID', 'The event did not identify a valid PR number and 40-character head SHA.', 'Trigger the gate from a PR or associated completed-check event.');
        return;
      }

      const prPath = '/repos/' + owner + '/' + repo + '/pulls/' + pullNumber;
      const pullRequest = await api(prPath);
      const headSha = String(pullRequest?.head?.sha || '');
      const issueRef = extractGoverningIssueNumber(pullRequest?.body || '', repositoryFullName);
      let issue = null;
      let issueFetchError = null;
      if (issueRef.number !== null) {
        try {
          issue = await api('/repos/' + owner + '/' + repo + '/issues/' + issueRef.number);
        } catch (error) {
          issueFetchError = String(error.status || 'request failed');
        }
      }

      const changedFiles = await fetchAll('/repos/' + owner + '/' + repo + '/pulls/' + pullNumber + '/files', 'files');
      const checkRuns = await fetchAll('/repos/' + owner + '/' + repo + '/commits/' + encodeURIComponent(headSha) + '/check-runs', 'check_runs');
      const headCommit = await api('/repos/' + owner + '/' + repo + '/commits/' + encodeURIComponent(headSha));
      const parentSha = String(headCommit?.parents?.[0]?.sha || '');
      const parentCommit = parentSha
        ? await api('/repos/' + owner + '/' + repo + '/commits/' + encodeURIComponent(parentSha))
        : null;

      // Re-read the PR after gathering evidence to detect a push racing with the gate.
      const confirmedPr = await api(prPath);
      const report = evaluatePullRequestGate({
        repositoryFullName,
        pullRequest,
        eventHeadSha,
        confirmedCurrentHeadSha: String(confirmedPr?.head?.sha || ''),
        issue,
        issueFetchError,
        requiredIssueSections: config.requiredIssueSections,
        requiredChecks: config.requiredChecks,
        changedFiles,
        checkRuns,
        headCommit,
        parentCommit
      });
      console.log('PR contract gate report — read-only; this check does not approve or merge the PR.');
      console.log(JSON.stringify(report, null, 2));
      if (!report.success) process.exitCode = 1;
    };

    run().catch(() => {
      stop('GITHUB_READ_FAILED', 'The gate could not complete its read-only GitHub snapshot. No result has been treated as successful.', 'Check repository token permissions and workflow logs, then rerun; never treat a failed read as an empty result.');
    });
  }
}

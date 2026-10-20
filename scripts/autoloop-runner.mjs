import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig } from '../src/config.mjs';
import { GitHubStateBranchAdapter, normalizeRepositoryIdentity } from '../src/claims.mjs';
import { isAutoloopManagedPullRequest, selectCandidateIssue } from '../src/selection.mjs';
import { dispatchTask } from '../src/dispatch.mjs';
import { reconcileSessionLifecycle } from '../src/reconciliation.mjs';
import { JulesClient } from '../src/jules.mjs';

const repositoryValue = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const confirmation = process.env.CONFIRM_REPOSITORY;
const julesApiKey = process.env.JULES_API_KEY;
const dispatchAuthorization = process.env.DISPATCH_AUTHORIZATION;
const liveDispatchRequested = process.env.AUTOLOOP_LIVE_DISPATCH === 'true';
const stateBranch = process.env.AUTOLOOP_STATE_BRANCH || 'autoloop-state';
const configPath = resolve(process.env.AUTOLOOP_CONFIG_PATH || 'config/autoloop.json');
const currentRef = process.env.GITHUB_REF || '';

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

function buildReport({
  success = false,
  selectedCandidate = null,
  decisionCode = 'UNKNOWN',
  reason = '',
  blockers = [],
  evaluatedCandidates = [],
  nextAction = '',
  runMode = 'plan-only'
} = {}) {
  return {
    success,
    mutated: false,
    runMode,
    selectedCandidate,
    decisionCode,
    reason,
    blockers,
    evaluatedCandidates,
    nextAction
  };
}

async function run() {
  if (!repositoryValue || !token) {
    const report = buildReport({
      success: false,
      decisionCode: 'BLOCK_CONFIGURATION_ERROR',
      reason: 'Required environment variables GITHUB_REPOSITORY and GITHUB_TOKEN must be configured.',
      nextAction: 'Configure GITHUB_REPOSITORY and GITHUB_TOKEN in workflow environment.'
    });
    printReport(report);
    process.exitCode = 1;
    return;
  }

  const repoCheck = normalizeRepositoryIdentity(repositoryValue);
  if (!repoCheck.valid || confirmation !== repositoryValue) {
    const report = buildReport({
      success: false,
      decisionCode: 'BLOCK_REPOSITORY_UNCONFIRMED',
      reason: 'Repository confirmation did not exactly match GITHUB_REPOSITORY. No API requests were made.',
      nextAction: 'Supply exact repository name in confirm_repository input before running autoloop dispatch.'
    });
    printReport(report);
    process.exitCode = 1;
    return;
  }

  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    const report = buildReport({
      success: false,
      decisionCode: 'BLOCK_INVALID_CONFIG',
      reason: 'Failed to read or parse configuration file at ' + configPath + ': ' + (err?.message || String(err)),
      nextAction: 'Ensure config/autoloop.json exists and contains valid JSON formatted according to autoloop.schema.v1.json.'
    });
    printReport(report);
    process.exitCode = 1;
    return;
  }

  const configValidation = validateConfig(rawConfig);
  if (!configValidation.valid) {
    const report = buildReport({
      success: false,
      decisionCode: 'BLOCK_INVALID_CONFIG',
      reason: 'Configuration failed schema validation.',
      blockers: configValidation.errors.map(e => ({ path: e.path, code: e.code, message: e.message })),
      nextAction: 'Fix config/autoloop.json using config/autoloop.example.json as a guide, then rerun.'
    });
    printReport(report);
    process.exitCode = 1;
    return;
  }
  const config = configValidation.config;

  const defaultBranch = config.defaultBranch || 'main';
  if (currentRef && currentRef !== 'refs/heads/' + defaultBranch) {
    const report = buildReport({
      success: false,
      decisionCode: 'BLOCK_UNTRUSTED_REF',
      reason: 'Autoloop dispatch runner executed on ref \'' + currentRef + '\' which does not match configured default branch \'' + defaultBranch + '\'.',
      nextAction: 'Trigger autoloop dispatch from the repository default branch only.'
    });
    printReport(report);
    process.exitCode = 1;
    return;
  }

  const repo = repoCheck.repository;

  const api = async (path, options = {}) => {
    const method = options.method || 'GET';
    if (method !== 'GET') {
      throw new Error('Only GET requests are permitted in the snapshot reader.');
    }
    const response = await fetch('https://api.github.com' + path, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const error = new Error('GitHub API HTTP ' + response.status + ' for ' + path);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };

  // Mutating GitHub requests are available only to the separate live workflow.
  // The ordinary plan workflow keeps read-only token permissions.
  const stateOctokit = {
    async request(route, params = {}) {
      const match = /^(GET|POST|PATCH) (\/.*)$/.exec(route);
      if (!match) throw new Error('Unsupported GitHub state-store route.');
      const method = match[1];
      let path = match[2].replace(/\{([^}]+)\}/g, (_, key) => {
        if (!(key in params) || params[key] === undefined || params[key] === null) {
          throw new Error('Missing route parameter: ' + key);
        }
        const value = String(params[key]);
        if (key === 'ref') return value.split('/').map(encodeURIComponent).join('/');
        if (key === 'path') return value.split('/').map(encodeURIComponent).join('/');
        return encodeURIComponent(value);
      });
      const body = { ...params };
      for (const [, key] of match[2].matchAll(/\{([^}]+)\}/g)) delete body[key];
      if (method === 'GET' && Object.keys(body).length > 0) {
        path += '?' + new URLSearchParams(body).toString();
      }
      const response = await fetch('https://api.github.com' + path, {
        method,
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' })
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        const error = new Error('GitHub API HTTP ' + response.status + ' for state-store operation.');
        error.status = response.status;
        throw error;
      }
      return { data: await response.json() };
    }
  };

  const fetchAllGithubPages = async (basePath) => {
    const items = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const separator = basePath.includes('?') ? '&' : '?';
      const path = `${basePath}${separator}per_page=${perPage}&page=${page}`;
      const data = await api(path);
      if (!Array.isArray(data)) {
        throw new Error('Expected array response from GitHub API at ' + path);
      }
      items.push(...data);
      if (data.length < perPage) break;
      page++;
    }
    return items;
  };

  let snapshot = null;
  let reconciliationReport = null;
  try {
    const defaultBranchData = await api('/repos/' + repo.owner + '/' + repo.repo + '/branches/' + encodeURIComponent(defaultBranch));
    if (!defaultBranchData || typeof defaultBranchData.name !== 'string' || defaultBranchData.name !== defaultBranch) {
      throw new Error('Default branch ' + defaultBranch + ' was not found or returned an invalid response.');
    }

    const rawIssuesAndPRs = await fetchAllGithubPages('/repos/' + repo.owner + '/' + repo.repo + '/issues?state=all');
    const rawOpenPRs = await fetchAllGithubPages('/repos/' + repo.owner + '/' + repo.repo + '/pulls?state=open');

    const issues = rawIssuesAndPRs.filter(item => !item.pull_request);

    const stateAdapter = new GitHubStateBranchAdapter({
      octokit: stateOctokit,
      repository: repo,
      stateBranch,
      defaultBranch
    });
    const persistedState = await stateAdapter.readState();
    if (!persistedState || typeof persistedState.head !== 'string' || !persistedState.head.trim()) {
      throw new Error('Claim state branch ' + stateBranch + ' is not initialized with a versioned claims.json file.');
    }
    const headSha = persistedState.head;
    const rawClaims = persistedState.claims;
    const claims = rawClaims.map(c => ({
      ...c,
      reconciled: c.reconciliationStatus === 'RECONCILED'
    }));

    if (!julesApiKey) {
      throw new Error('JULES_API_KEY environment variable is required to collect provider session inventory.');
    }
    const providerClient = new JulesClient({ apiKey: julesApiKey });
    const sessions = await providerClient.listSessions();

    const fetchBranch = async (name) => api('/repos/' + repo.owner + '/' + repo.repo + '/branches/' + encodeURIComponent(name));
    const fetchIssue = async (number) => api('/repos/' + repo.owner + '/' + repo.repo + '/issues/' + number);
    const fetchPullRequest = async (number) => api('/repos/' + repo.owner + '/' + repo.repo + '/pulls/' + number);
    const stateSnapshotAdapter = {
      async readState() {
        return { head: headSha, claims: rawClaims };
      }
    };

    reconciliationReport = await reconcileSessionLifecycle({
      config,
      repository: repo,
      providerClient,
      fetchPullRequest,
      fetchIssue,
      fetchBranch,
      stateAdapter: stateSnapshotAdapter
    });

    if (!reconciliationReport || (!reconciliationReport.success && reconciliationReport.decisionCode !== 'RECONCILIATION_CLEAR' && reconciliationReport.decisionCode !== 'RECONCILIATION_BLOCKED')) {
      throw new Error('Session lifecycle reconciliation failed (' + (reconciliationReport?.decisionCode || 'UNKNOWN') + '): ' + (reconciliationReport?.summary || 'unverified state'));
    }

    snapshot = {
      snapshotComplete: true,
      repository: repo,
      issues,
      pullRequests: rawOpenPRs.filter((pr) => isAutoloopManagedPullRequest(pr, issues, config, repo)),
      claims,
      sessions,
      sequence: Array.isArray(rawConfig.sequence) ? rawConfig.sequence : []
    };
  } catch (err) {
    const report = buildReport({
      success: false,
      decisionCode: 'BLOCK_INCOMPLETE_SNAPSHOT',
      reason: 'Failed to assemble complete API snapshot: ' + (err?.message || String(err)),
      blockers: [{ code: 'INCOMPLETE_SNAPSHOT', message: err?.message || String(err) }],
      nextAction: 'Re-run snapshot collection after checking GitHub and provider API permissions.'
    });
    printReport(report);
    process.exitCode = 1;
    return;
  }

  const selectionResult = selectCandidateIssue(snapshot, config);

  const combinedBlockers = [
    ...(reconciliationReport?.blockers || []),
    ...(selectionResult.blockers || [])
  ];

  const isCleanOutcome = selectionResult.decisionCode === 'CANDIDATE_SELECTED' || selectionResult.decisionCode === 'NO_ELIGIBLE_CANDIDATE';
  const isReconciliationClear = reconciliationReport?.success === true;

  const finalSuccess = isCleanOutcome && isReconciliationClear;

  if (liveDispatchRequested) {
    if (config.enabled !== true || config.runMode !== 'live') {
      const report = buildReport({
        success: false,
        runMode: 'live',
        decisionCode: 'BLOCK_LIVE_DISPATCH_DISABLED',
        reason: 'Live dispatch was requested, but config must explicitly set enabled=true and runMode=live.',
        blockers: [{ code: 'LIVE_DISPATCH_NOT_ENABLED', message: 'The default configuration is plan-only and non-dispatchable.' }],
        nextAction: 'Keep plan-only mode unless a maintainer has reviewed the safety plan and deliberately enabled live dispatch.'
      });
      printReport(report);
      process.exitCode = 1;
      return;
    }
    if (dispatchAuthorization !== config.requiredConfirmation) {
      const report = buildReport({
        success: false,
        runMode: 'live',
        decisionCode: 'BLOCK_DISPATCH_AUTHORIZATION',
        reason: 'The explicit dispatch authorization did not exactly match the configured confirmation phrase.',
        blockers: [{ code: 'DISPATCH_AUTHORIZATION_MISMATCH', message: 'No claim or provider session was created.' }],
        nextAction: 'Rerun only after entering the exact configured dispatch authorization in the manual workflow.'
      });
      printReport(report);
      process.exitCode = 1;
      return;
    }
  } else if (config.runMode === 'live' && config.enabled === true) {
    const report = buildReport({
      success: false,
      runMode: 'live',
      decisionCode: 'BLOCK_LIVE_WORKFLOW_REQUIRED',
      reason: 'Live configuration is enabled, but this run came through the read-only plan workflow.',
      blockers: [{ code: 'LIVE_PATH_NOT_REQUESTED', message: 'The read-only workflow never mutates state or creates provider sessions.' }],
      nextAction: 'Use the separately permissioned live-dispatch workflow with explicit authorization.'
    });
    printReport(report);
    process.exitCode = 1;
    return;
  }

  if (liveDispatchRequested && finalSuccess && selectionResult.selectedCandidate) {
    const issue = issues.find(item => item.number === selectionResult.selectedCandidate.number);
    if (!issue || typeof issue.title !== 'string' || typeof issue.body !== 'string') {
      const report = buildReport({
        success: false,
        decisionCode: 'BLOCK_SELECTED_ISSUE_INCOMPLETE',
        reason: 'The selected Issue could not be bound to its exact title and body from the complete snapshot.',
        nextAction: 'Fix the incomplete Issue data and rerun preflight before dispatch.'
      });
      printReport(report);
      process.exitCode = 1;
      return;
    }
    const runId = process.env.GITHUB_RUN_ID;
    if (!runId) {
      const report = buildReport({
        success: false,
        decisionCode: 'BLOCK_RUN_ID_MISSING',
        reason: 'GitHub Actions did not provide a run ID, so a unique durable claim ID cannot be constructed safely.',
        nextAction: 'Run this workflow from GitHub Actions and retry after confirming the run context.'
      });
      printReport(report);
      process.exitCode = 1;
      return;
    }

    const packet = {
      repository: repositoryValue,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body,
      startingBranch: defaultBranch,
      claimId: 'autoloop-' + runId + '-issue-' + issue.number,
      prompt: [
        'Implement the repository task described by Issue #' + issue.number + ': ' + issue.title + '.',
        'Follow the repository instructions and the Issue contract exactly. Work only on this task; report blockers or uncertainty in the pull request body.',
        '',
        'Exact governing Issue body:',
        issue.body
      ].join('\n')
    };
    const dispatchResult = await dispatchTask({
      config,
      packet,
      confirmation: dispatchAuthorization,
      stateAdapter,
      snapshot,
      owner: 'github-actions:' + (process.env.GITHUB_ACTOR || 'unknown'),
      providerClient: new JulesClient({ apiKey: julesApiKey })
    });
    const report = {
      ...buildReport({
        success: dispatchResult.success,
        selectedCandidate: selectionResult.selectedCandidate,
        decisionCode: dispatchResult.decisionCode,
        reason: dispatchResult.reason,
        blockers: dispatchResult.blockers || [],
        evaluatedCandidates: selectionResult.evaluatedCandidates || [],
        nextAction: dispatchResult.success
          ? 'Track this exact provider session and reconcile its state before considering the task complete.'
          : 'Do not start another task. Inspect the structured blocker and reconcile the claim/session state first.'
      }),
      mutated: Boolean(dispatchResult.claim),
      runMode: 'live',
      providerSessionId: dispatchResult.session?.id || null,
      claimId: dispatchResult.claim?.claimId || packet.claimId
    };
    printReport(report);
    if (!dispatchResult.success) process.exitCode = 1;
    return;
  }

  const report = buildReport({
    success: finalSuccess,
    selectedCandidate: finalSuccess ? selectionResult.selectedCandidate : null,
    decisionCode: !isReconciliationClear
      ? 'RECONCILIATION_BLOCKED'
      : selectionResult.decisionCode,
    reason: !isReconciliationClear
      ? (reconciliationReport.summary || 'Lifecycle reconciliation detected active work or evidence gaps.')
      : selectionResult.reason,
    blockers: combinedBlockers,
    evaluatedCandidates: selectionResult.evaluatedCandidates || [],
    nextAction: finalSuccess
      ? selectionResult.nextAction
      : 'Resolve lifecycle reconciliation and candidate blockers before re-running autoloop dispatch.',
    runMode: liveDispatchRequested ? 'live' : 'plan-only'
  });

  printReport(report);

  if (!finalSuccess) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  const report = buildReport({
    success: false,
    decisionCode: 'BLOCK_UNHANDLED_ERROR',
    reason: 'Unhandled exception during autoloop runner execution: ' + (err?.message || String(err)),
    nextAction: 'Inspect runner logs and fix unhandled exception.'
  });
  printReport(report);
  process.exitCode = 1;
});

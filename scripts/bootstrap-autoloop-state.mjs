import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GitHubStateBranchAdapter } from '../src/claims.mjs';
import { validateConfig } from '../src/config.mjs';

const REQUIRED_CONFIRMATION = 'INITIALIZE_EMPTY_AUTOLOOP_STATE';

function report(values) {
  console.log(JSON.stringify({
    mutated: false,
    stateBranch: process.env.AUTOLOOP_STATE_BRANCH || 'autoloop-state',
    ...values
  }, null, 2));
}

function makeOctokitRequest({ token, apiBase }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28'
  };
  return async (route, params = {}) => {
    const match = /^(GET|POST|PATCH) (\/.*)$/.exec(route);
    if (!match) throw new Error('Unsupported GitHub API route for state bootstrap.');
    const method = match[1];
    const template = match[2];
    const placeholders = new Set(Array.from(template.matchAll(/\{([^}]+)\}/g), (entry) => entry[1]));
    let path = template.replace(/\{([^}]+)\}/g, (_, key) => {
      if (!(key in params) || params[key] === undefined || params[key] === null) throw new Error('Missing required GitHub route parameter: ' + key);
      const value = String(params[key]);
      if (key === 'ref' || key === 'path') return value.split('/').map(encodeURIComponent).join('/');
      return encodeURIComponent(value);
    });
    const remaining = { ...params };
    delete remaining.owner;
    delete remaining.repo;
    for (const key of placeholders) delete remaining[key];
    const options = { method, redirect: 'error', headers: { ...headers } };
    if (method === 'GET') {
      if (Object.keys(remaining).length > 0) path += '?' + new URLSearchParams(remaining).toString();
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(remaining);
    }
    const response = await fetch(apiBase + path, options);
    if (!response.ok) {
      const error = new Error('GitHub API HTTP ' + response.status + ' during state bootstrap.');
      error.status = response.status;
      throw error;
    }
    return { data: await response.json() };
  };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY || '';
  const token = process.env.GITHUB_TOKEN || '';
  const confirmationRepository = process.env.CONFIRM_REPOSITORY || '';
  const confirmation = process.env.STATE_BOOTSTRAP_CONFIRMATION || '';
  const configPath = resolve(process.env.AUTOLOOP_CONFIG_PATH || 'config/autoloop.json');
  const stateBranch = (process.env.AUTOLOOP_STATE_BRANCH || 'autoloop-state').trim();
  const apiBase = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

  if (!repository || !token) {
    report({ success: false, decisionCode: 'BLOCK_CONFIGURATION', reason: 'GITHUB_REPOSITORY and GITHUB_TOKEN are required.' });
    process.exitCode = 1;
    return;
  }
  if (confirmationRepository !== repository) {
    report({ success: false, decisionCode: 'BLOCK_REPOSITORY_CONFIRMATION', reason: 'Repository confirmation must exactly match GITHUB_REPOSITORY.' });
    process.exitCode = 1;
    return;
  }
  if (confirmation !== REQUIRED_CONFIRMATION) {
    report({ success: false, decisionCode: 'BLOCK_BOOTSTRAP_CONFIRMATION', reason: 'The exact state-bootstrap confirmation phrase is required.' });
    process.exitCode = 1;
    return;
  }

  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    report({ success: false, decisionCode: 'BLOCK_INVALID_CONFIG', reason: 'The production Autoloop configuration could not be read as JSON.' });
    process.exitCode = 1;
    return;
  }
  const checked = validateConfig(rawConfig);
  if (!checked.valid || checked.config.enabled !== false || checked.config.runMode !== 'dry-run'
    || checked.config.workProvider !== 'none' || checked.config.automaticMerge !== false
    || !checked.config.requiredChecks.includes('build-and-test')) {
    report({ success: false, decisionCode: 'BLOCK_UNSAFE_CONFIG', reason: 'Bootstrap requires disabled/dry-run configuration, provider none, automatic merge off, and build-and-test required.' });
    process.exitCode = 1;
    return;
  }
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts.every((part) => part.trim())) {
    report({ success: false, decisionCode: 'BLOCK_REPOSITORY_IDENTITY', reason: 'GITHUB_REPOSITORY must use owner/repository format.' });
    process.exitCode = 1;
    return;
  }
  const defaultBranch = checked.config.defaultBranch;
  if ((process.env.GITHUB_REF || '') !== 'refs/heads/' + defaultBranch) {
    report({ success: false, decisionCode: 'BLOCK_UNTRUSTED_REF', reason: 'Bootstrap may run only from the configured default branch.' });
    process.exitCode = 1;
    return;
  }
  if (!stateBranch || stateBranch === defaultBranch || stateBranch.startsWith('/') || stateBranch.includes('..') || /\s/.test(stateBranch)) {
    report({ success: false, decisionCode: 'BLOCK_STATE_BRANCH_NAME', reason: 'The state branch must be a safe separate branch name.' });
    process.exitCode = 1;
    return;
  }

  const stateAdapter = new GitHubStateBranchAdapter({
    octokit: { request: makeOctokitRequest({ token, apiBase }) },
    repository,
    stateBranch,
    defaultBranch,
    allowInitialize: true
  });
  let current;
  try {
    current = await stateAdapter.readState();
  } catch (error) {
    if (error?.code !== 'STATE_STORE_NOT_INITIALIZED') {
      report({ success: false, decisionCode: 'BLOCK_INVALID_STATE_STORE', reason: error?.message || 'Existing state is malformed or unreadable; it will not be overwritten.' });
      process.exitCode = 1;
      return;
    }
    const created = await stateAdapter.commitStateChange(null, []);
    if (created.success) {
      current = await stateAdapter.readState();
      if (current.claims.length !== 0) {
        report({ success: false, decisionCode: 'BLOCK_NONEMPTY_BOOTSTRAP', reason: 'New state was not empty; stop and inspect it.' });
        process.exitCode = 1;
        return;
      }
      report({ success: true, mutated: true, decisionCode: 'EMPTY_STATE_STORE_INITIALIZED', head: current.head, claimsCount: 0, reason: 'Created versioned empty claims on a separate branch. No Jules API calls or sessions were made.' });
      return;
    }
    if (created.reason !== 'CAS_CONFLICT') {
      report({ success: false, decisionCode: 'BLOCK_STATE_STORE_WRITE', reason: 'State initialization failed safely (' + created.reason + ').' });
      process.exitCode = 1;
      return;
    }
    current = await stateAdapter.readState();
    if (current.claims.length !== 0) {
      report({ success: false, decisionCode: 'BLOCK_CONCURRENT_NONEMPTY_STATE', reason: 'A concurrent initializer created non-empty state; this run made no changes.' });
      process.exitCode = 1;
      return;
    }
    report({ success: true, mutated: false, decisionCode: 'EMPTY_STATE_STORE_ALREADY_INITIALIZED', head: current.head, claimsCount: 0, reason: 'Another initializer won the atomic branch-creation race; this run verified the empty state without overwriting it.' });
    return;
  }

  if (current.claims.length !== 0) {
    report({ success: false, decisionCode: 'BLOCK_NONEMPTY_STATE_STORE', head: current.head, claimsCount: current.claims.length, reason: 'State already contains claims; bootstrap never resets or overwrites it.' });
    process.exitCode = 1;
    return;
  }
  report({ success: true, mutated: false, decisionCode: 'EMPTY_STATE_STORE_ALREADY_INITIALIZED', head: current.head, claimsCount: 0, reason: 'A valid versioned empty state already exists; no write was needed.' });
}

main().catch((error) => {
  report({ success: false, decisionCode: 'BLOCK_BOOTSTRAP_ERROR', reason: error?.message || 'Unexpected bootstrap failure.' });
  process.exitCode = 1;
});

import { JulesClient } from '../src/jules.mjs';
import { normalizeRepositoryIdentity } from '../src/claims.mjs';
import { reconcileSessionLifecycle } from '../src/reconciliation.mjs';

const repositoryValue = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const julesApiKey = process.env.JULES_API_KEY;
const stateBranch = process.env.AUTOLOOP_STATE_BRANCH || 'autoloop-state';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!repositoryValue || !token || !julesApiKey) {
  fail('Required environment is missing: GITHUB_REPOSITORY, GITHUB_TOKEN, and JULES_API_KEY must be configured.');
} else {
  const repoCheck = normalizeRepositoryIdentity(repositoryValue);
  const confirmation = process.env.CONFIRM_REPOSITORY;
  if (!repoCheck.valid || confirmation !== repositoryValue) {
    fail('Repository confirmation did not exactly match GITHUB_REPOSITORY. No API requests were made.');
  } else {
    const repo = repoCheck.repository;
    const api = async path => {
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
        const error = new Error('GitHub API HTTP ' + response.status + ' for read-only endpoint.');
        error.status = response.status;
        throw error;
      }
      return response.json();
    };

    const stateAdapter = {
      async readState() {
        const ref = await api('/repos/' + repo.owner + '/' + repo.repo
          + '/git/ref/heads/' + encodeURIComponent(stateBranch));
        const head = ref?.object?.sha;
        if (typeof head !== 'string' || !head.trim()) {
          throw new Error('Claim state branch has no authoritative commit SHA.');
        }
        const file = await api('/repos/' + repo.owner + '/' + repo.repo
          + '/contents/claims.json?ref=' + encodeURIComponent(head));
        if (file?.encoding !== 'base64' || typeof file.content !== 'string') {
          throw new Error('Claim state file is missing or not base64-encoded.');
        }
        let parsed;
        try { parsed = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')); }
        catch { throw new Error('Claim state file is not valid JSON.'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.claims)) {
          throw new Error('Claim state file must contain a claims array.');
        }
        return { head, claims: parsed.claims };
      }
    };

    const providerClient = new JulesClient({ apiKey: julesApiKey });
    const fetchIssue = async number => api('/repos/' + repo.owner + '/' + repo.repo + '/issues/' + number);
    const fetchPullRequest = async number => api('/repos/' + repo.owner + '/' + repo.repo + '/pulls/' + number);
    const fetchBranch = async name => api('/repos/' + repo.owner + '/' + repo.repo + '/branches/' + encodeURIComponent(name));

    try {
      const result = await reconcileSessionLifecycle({
        repository: repo,
        providerClient,
        stateAdapter,
        fetchIssue,
        fetchPullRequest,
        fetchBranch
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) process.exitCode = 1;
    } catch {
      fail('Read-only reconciliation failed unexpectedly. No writes or dispatches are performed by this command.');
    }
  }
}

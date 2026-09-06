import assert from 'node:assert';
import { resolveDefaultBranch } from './jules-orchestrator.mjs';

async function runDefaultBranchTests() {
  console.log('Testing default branch resolution logic...');

  // Scenario 1: GitHub API returns 'main'
  {
    const mockFetch = async () => ({ default_branch: 'main' });
    const mockExec = () => { throw new Error('git error'); };
    const branch = await resolveDefaultBranch('org/repo-main', mockFetch, mockExec);
    assert.strictEqual(branch, 'main', 'Scenario 1 failed: Expected main');
    console.log('✓ Scenario 1 passed: Repository with default branch "main" resolved');
  }

  // Scenario 2: GitHub API fails, git ls-remote returns 'master' (e.g. japiohopman/Mijn-CV)
  {
    const mockFetch = async () => { throw new Error('API unavailable'); };
    const mockExec = () => 'ref: refs/heads/master\tHEAD\n80bed6baa4c04e1e355a51464fbb2b435a8ed74c\tHEAD\n';
    const branch = await resolveDefaultBranch('japiohopman/Mijn-CV', mockFetch, mockExec);
    assert.strictEqual(branch, 'master', 'Scenario 2 failed: Expected master');
    console.log('✓ Scenario 2 passed: Repository with default branch "master" resolved via git ls-remote fallback');
  }

  // Scenario 3: GitHub API returns custom branch 'develop'
  {
    const mockFetch = async () => ({ default_branch: 'develop' });
    const mockExec = () => { throw new Error('git error'); };
    const branch = await resolveDefaultBranch('org/repo-dev', mockFetch, mockExec);
    assert.strictEqual(branch, 'develop', 'Scenario 3 failed: Expected develop');
    console.log('✓ Scenario 3 passed: Repository with default branch "develop" resolved');
  }

  // Scenario 4: Live git ls-remote against japiohopman/Mijn-CV
  {
    const mockFetch = async () => { throw new Error('Simulating API failure'); };
    // Pass undefined for execFn so it uses real child_process.execSync
    const branch = await resolveDefaultBranch('japiohopman/Mijn-CV', mockFetch);
    assert.strictEqual(branch, 'master', 'Scenario 4 failed: Real japiohopman/Mijn-CV live resolution failed');
    console.log('✓ Scenario 4 passed: Live japiohopman/Mijn-CV resolved to "master"');
  }

  // Scenario 5: Diagnostic error handling when both resolution methods fail
  {
    const mockFetch = async () => { throw new Error('HTTP 404 Not Found'); };
    const mockExec = () => { throw new Error('fatal: repository not found'); };
    let caughtError = null;

    try {
      await resolveDefaultBranch('nonexistent/invalid-repo', mockFetch, mockExec);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Scenario 5 failed: Expected error to be thrown');
    assert.ok(caughtError.message.includes('nonexistent/invalid-repo'), 'Diagnostic error missing repo name');
    assert.ok(caughtError.message.includes('GitHub API metadata resolution failed'), 'Diagnostic error missing API error');
    assert.ok(caughtError.message.includes('git ls-remote resolution failed'), 'Diagnostic error missing git error');
    console.log('✓ Scenario 5 passed: Useful diagnostic error generated when branch resolution fails');
  }

  console.log('All default branch resolution tests passed successfully!');
}

runDefaultBranchTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

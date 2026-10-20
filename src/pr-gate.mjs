/**
 * PR contract gate: read-only decisions based on trusted GitHub metadata.
 *
 * In everyday language: this is the checklist inspector. It does not change
 * Issues, PRs, labels, claims, or provider sessions. The Actions workflow
 * collects facts; this module decides whether the handoff has current,
 * verifiable evidence before a human review.
 */
import { extractMarkdownSections, validateIssueContract, validatePullRequestContract } from './contracts.mjs';

const SHA1_PATTERN = /^[0-9a-f]{40}$/i;
const PLACEHOLDER_PATTERN = /(?:what changed and why\??|describe one criterion|fill this in|replace this|\btbd\b|\btodo\b|\[owner\]|\[insert\b|<40[- ]character sha>|<path\/?name>)/i;

function makeBlocker(code, message, nextAction, category = 'contract') {
  return { code, message, nextAction, category };
}
function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function sortBlockers(blockers) {
  return blockers.slice().sort((a, b) =>
    compareText(a.category, b.category) || compareText(a.code, b.code) || compareText(a.message, b.message));
}
function hasUsefulText(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !PLACEHOLDER_PATTERN.test(trimmed);
}
function readSectionValue(section, label) {
  if (typeof section !== 'string') return null;
  const escaped = label.replace(/[.*+?^|()[\]\\]/g, '\\$&').replace(/\//g, '\\/');
  const match = section.match(new RegExp('^[ \t]*(?:[-*][ \t]*)?' + escaped + ':[ \t]*(.*?)[ \t]*$', 'im'));
  return match ? match[1].trim() : null;
}

/**
 * Identify one governing Issue. Full GitHub URLs must target this repository;
 * a number-only reference is resolved against this repo by the trusted adapter.
 */
export function extractGoverningIssueNumber(prBody, repositoryFullName) {
  const section = extractMarkdownSections(prBody).get('governing issue') || '';
  const expectedRepo = String(repositoryFullName || '').toLowerCase();
  const numbers = new Set();
  const wrongRepository = [];

  // Match full GitHub issue URLs
  for (const match of section.matchAll(/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/([1-9]\d*)/gi)) {
    const linkedRepo = (match[1] + '/' + match[2]).replace(/[),.]+$/g, '').toLowerCase();
    if (linkedRepo !== expectedRepo) {
      wrongRepository.push(linkedRepo);
    } else {
      numbers.add(Number(match[3]));
    }
  }

  // Match shorthand cross-repo references like owner/repo#123
  for (const match of section.matchAll(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)\b/g)) {
    const linkedRepo = match[1].toLowerCase();
    if (linkedRepo !== expectedRepo) {
      wrongRepository.push(linkedRepo);
    } else {
      numbers.add(Number(match[2]));
    }
  }

  // Match standalone local issue numbers #123 (excluding shorthand owner/repo#123)
  for (const match of section.matchAll(/(^|[^\w/.-])#([1-9]\d*)\b/g)) {
    numbers.add(Number(match[2]));
  }

  if (wrongRepository.length > 0) {
    return { number: null, error: 'GOVERNING_ISSUE_WRONG_REPOSITORY', details: Array.from(new Set(wrongRepository)).sort(compareText) };
  }
  if (numbers.size !== 1) {
    return {
      number: null,
      error: numbers.size === 0 ? 'GOVERNING_ISSUE_REFERENCE_MISSING' : 'GOVERNING_ISSUE_REFERENCE_AMBIGUOUS',
      details: Array.from(numbers).sort((a, b) => a - b)
    };
  }
  return { number: Array.from(numbers)[0], error: null, details: [] };
}

function extractChangedPathEvidence(section) {
  if (typeof section !== 'string') return { paths: [], invalid: true };
  const lines = section.split(/\r?\n/);
  const marker = lines.findIndex(line => /^\s*(?:[-*]\s*)?Changed paths:\s*$/i.test(line));
  if (marker < 0) return { paths: [], invalid: true };
  const paths = [];
  let invalid = false;
  for (let i = marker + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(?:[-*]\s*)?(?:Commands\/checks run|Exact head SHA verified|Check results for that SHA):/i.test(line)) break;
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!bullet) { invalid = true; continue; }
    const path = bullet[1].trim().replace(/^["']|["']$/g, '');
    if (!path || path.startsWith('/') || path.split('/').includes('..')) { invalid = true; continue; }
    paths.push(path);
  }
  if (new Set(paths).size !== paths.length) invalid = true;
  return { paths: paths.sort(compareText), invalid };
}

function checkAcceptanceEvidence(section, addBlocker) {
  if (typeof section !== 'string') {
    addBlocker('ACCEPTANCE_EVIDENCE_MISSING', 'The Acceptance criteria evidence section is missing.', 'Add each completed criterion and the concrete evidence that proves it.');
    return;
  }
  const lines = section.split(/\r?\n/);
  const criteria = [];
  let current = null;
  for (const line of lines) {
    const checked = line.match(/^\s*[-*]\s*\[([ xX])\]\s*Criterion:\s*(.*?)\s*$/i);
    const plain = line.match(/^\s*[-*]\s*Criterion:\s*(.*?)\s*$/i);
    if (checked || plain) {
      if (current) criteria.push(current);
      current = checked
        ? { checked: checked[1].toLowerCase() === 'x', text: checked[2].trim(), evidence: null }
        : { checked: false, text: plain[1].trim(), evidence: null };
      continue;
    }
    if (current) {
      const evidence = line.match(/^\s*[-*]\s*Evidence:\s*(.*?)\s*$/i);
      if (evidence) current.evidence = evidence[1].trim();
    }
  }
  if (current) criteria.push(current);
  if (criteria.length === 0) {
    addBlocker('ACCEPTANCE_EVIDENCE_MISSING', 'No completed acceptance criterion with evidence was found.', 'List the criteria that are actually satisfied; mark each [x] and add an Evidence line pointing to a test, file, check, or observed behavior.');
    return;
  }
  criteria.forEach((criterion, index) => {
    const label = 'Acceptance criterion ' + (index + 1);
    if (!criterion.checked) {
      addBlocker('ACCEPTANCE_CRITERION_NOT_CONFIRMED', label + ' is not marked complete.', 'Confirm it is satisfied and mark [x], or leave it unchecked and explain the blocker in Risks and blockers.');
    }
    if (!hasUsefulText(criterion.text) || !hasUsefulText(criterion.evidence)) {
      addBlocker('ACCEPTANCE_CRITERION_EVIDENCE_EMPTY', label + ' has empty or placeholder text.', 'Write the criterion in plain language and add specific evidence showing how it was verified.');
    }
  });
}

function evaluateChecks(requiredChecks, checkRuns, headSha, addBlocker) {
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) {
    addBlocker('REQUIRED_CHECKS_NOT_CONFIGURED', 'No required checks are configured, so CI cannot be called successful.', 'Set config/autoloop.json requiredChecks to the exact check-run names required by this repository.', 'checks');
    return 'not_configured';
  }
  if (!Array.isArray(checkRuns)) {
    addBlocker('CHECK_RUNS_UNAVAILABLE', 'GitHub did not return a complete check-run list.', 'Check the Actions/checks API response and rerun the gate; do not treat missing data as success.', 'checks');
    return 'blocked';
  }
  let failed = false;
  for (const name of Array.from(new Set(requiredChecks))) {
    const matching = checkRuns.filter(run => run && run.name === name && String(run.head_sha || '').toLowerCase() === headSha)
      .sort((a, b) => {
        const dateOrder = compareText(String(b.completed_at || b.started_at || b.created_at || ''), String(a.completed_at || a.started_at || a.created_at || ''));
        return dateOrder || (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    if (!matching.length) {
      failed = true;
      addBlocker('REQUIRED_CHECK_MISSING_FOR_HEAD', 'Required check "' + name + '" has no result for the current PR head SHA.', 'Wait for that check to run on the current commit, then rerun the gate.', 'checks');
    } else if (String(matching[0].status || '').toLowerCase() !== 'completed') {
      failed = true;
      addBlocker('REQUIRED_CHECK_NOT_COMPLETED', 'Required check "' + name + '" has not completed for the current PR head SHA.', 'Wait for the check to finish and rerun the gate.', 'checks');
    } else if (String(matching[0].conclusion || '').toLowerCase() !== 'success') {
      failed = true;
      addBlocker('REQUIRED_CHECK_FAILED', 'Required check "' + name + '" did not conclude successfully for the current PR head SHA.', 'Open the check logs, fix the failure, and push a new commit before rerunning the gate.', 'checks');
    }
  }
  return failed ? 'blocked' : 'passed';
}

/**
 * Evaluate a PR from API evidence only. This function is deterministic and read-only.
 * The gate can make a handoff reviewable; it cannot approve or merge a PR.
 */
export function evaluatePullRequestGate({
  repositoryFullName, pullRequest, eventHeadSha, confirmedCurrentHeadSha, issue,
  issueFetchError = null, requiredIssueSections = [], requiredChecks = [],
  changedFiles = [], checkRuns = [], headCommit = null, parentCommit = null
} = {}) {
  const blockers = [];
  const contractBlockers = [];
  const safetyBlockers = [];
  const addBlocker = (code, message, nextAction, category = 'contract') => {
    const blocker = makeBlocker(code, message, nextAction, category);
    blockers.push(blocker);
    if (category === 'checks') return;
    if (category === 'safety') safetyBlockers.push(blocker);
    else contractBlockers.push(blocker);
  };

  const headSha = String(pullRequest?.head?.sha || '').toLowerCase();
  const baseSha = String(pullRequest?.base?.sha || '').toLowerCase();
  const targetRepo = String(repositoryFullName || '').toLowerCase();

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(targetRepo)) {
    addBlocker('TARGET_REPOSITORY_INVALID', 'The target repository identity is missing or malformed.', 'Run this workflow in the intended owner/repository context.', 'safety');
  }
  if (!pullRequest || !Number.isInteger(Number(pullRequest.number)) || Number(pullRequest.number) < 1) {
    addBlocker('PULL_REQUEST_METADATA_INVALID', 'GitHub did not return a valid pull request record.', 'Verify the PR number and GitHub API permissions.', 'safety');
  } else if (String(pullRequest.state || '').toLowerCase() !== 'open' || pullRequest.merged === true) {
    addBlocker('PULL_REQUEST_NOT_OPEN', 'The pull request is no longer open and unmerged.', 'Inspect the current PR state; do not advance this handoff automatically.');
  }
  if (!SHA1_PATTERN.test(headSha) || !SHA1_PATTERN.test(baseSha)) {
    addBlocker('PULL_REQUEST_SHA_INVALID', 'GitHub did not return valid 40-character base and head commit SHAs.', 'Refresh the PR metadata; a missing commit identity cannot count as verified.', 'safety');
  }
  if (!SHA1_PATTERN.test(String(eventHeadSha || '')) || String(eventHeadSha).toLowerCase() !== headSha) {
    addBlocker('EVENT_HEAD_SHA_STALE', 'The PR changed after this workflow event was created, or the event did not identify its head SHA.', 'Rerun the gate from the latest PR event; evidence for an older commit cannot pass.', 'safety');
  }
  if (!SHA1_PATTERN.test(String(confirmedCurrentHeadSha || '')) || String(confirmedCurrentHeadSha).toLowerCase() !== headSha) {
    addBlocker('HEAD_CHANGED_DURING_GATE', 'The PR head changed while the gate was collecting evidence.', 'Wait for the latest commit checks and rerun the gate against the new head SHA.', 'safety');
  }

  const parsedIssue = extractGoverningIssueNumber(pullRequest?.body || '', targetRepo);
  if (parsedIssue.error) {
    const messages = {
      GOVERNING_ISSUE_WRONG_REPOSITORY: 'The PR links a governing Issue in a different repository.',
      GOVERNING_ISSUE_REFERENCE_AMBIGUOUS: 'The Governing Issue section refers to more than one Issue.',
      GOVERNING_ISSUE_REFERENCE_MISSING: 'The Governing Issue section does not identify one Issue.'
    };
    addBlocker(parsedIssue.error, messages[parsedIssue.error] || 'The governing Issue reference is invalid.', 'Link exactly one governing Issue in this repository.');
  }
  if (issueFetchError) {
    addBlocker('GOVERNING_ISSUE_LOOKUP_FAILED', 'GitHub could not verify the governing Issue (' + String(issueFetchError) + ').', 'Confirm the Issue exists and the workflow can read Issues; do not assume a failed lookup means no Issue.', 'safety');
  } else if (parsedIssue.number !== null) {
    if (!issue || Number(issue.number) !== parsedIssue.number) {
      addBlocker('GOVERNING_ISSUE_NOT_FOUND', 'The governing Issue could not be verified as the referenced Issue in this repository.', 'Open the linked Issue and verify its number and repository.');
    } else if (issue.pull_request) {
      addBlocker('GOVERNING_REFERENCE_IS_A_PULL_REQUEST', 'The governing reference points to another pull request rather than an Issue.', 'Choose the actual Issue that defines the acceptance criteria.');
    } else if (String(issue.state || '').toLowerCase() !== 'open') {
      addBlocker('GOVERNING_ISSUE_NOT_OPEN', 'The governing Issue is not open.', 'Check whether the Issue was closed prematurely or whether this PR is genuinely still in scope.');
    } else {
      const issueResult = validateIssueContract(issue, { requiredIssueSections });
      for (const error of issueResult.errors) {
        addBlocker('ISSUE_' + error.code, 'Governing Issue contract: ' + error.message, 'Complete the missing Issue information before this PR is treated as a valid handoff.');
      }
    }
  }

  const body = pullRequest?.body;
  const prContract = validatePullRequestContract(typeof body === 'string' ? body : '');
  for (const error of prContract.errors) {
    addBlocker('PR_' + error.code, error.message, 'Complete the pull-request template fields with real, reviewable information.');
  }
  const sections = extractMarkdownSections(typeof body === 'string' ? body : '');
  const summary = sections.get('summary') || '';
  const scopeBoundary = sections.get('scope boundary') || '';
  const verification = sections.get('verification') || '';
  const risks = sections.get('risks and blockers') || '';
  const handoff = sections.get('handoff') || '';
  if (!hasUsefulText(summary)) addBlocker('PR_SUMMARY_EMPTY', 'The Summary is empty or still contains placeholder text.', 'Explain what changed and why in plain language.');
  if (!hasUsefulText(scopeBoundary)) addBlocker('PR_SCOPE_BOUNDARY_EMPTY', 'The Scope boundary is empty or still contains placeholder text.', 'State what the PR deliberately does not change.');

  const reportedSha = verification.match(/Exact head SHA verified:\s*([0-9a-f]{40})/i)?.[1]?.toLowerCase() || null;
  if (!reportedSha || reportedSha !== headSha) {
    addBlocker('VERIFICATION_SHA_MISMATCH', 'The Verification section must name the exact current PR head SHA.', 'Copy the current 40-character head SHA from GitHub and refresh evidence for that commit.');
  }

  const pathEvidence = extractChangedPathEvidence(verification);
  const apiPaths = Array.isArray(changedFiles)
    ? changedFiles.map(file => typeof file === 'string' ? file : file?.filename).filter(path => typeof path === 'string' && path.length > 0).sort(compareText)
    : [];
  if (!Array.isArray(changedFiles) || apiPaths.length !== changedFiles.length || apiPaths.length === 0) {
    addBlocker('CHANGED_FILES_UNAVAILABLE_OR_EMPTY', 'GitHub did not provide a complete, non-empty list of changed files for this PR.', 'Check the PR files API. An empty or partial result is not proof of a valid change.', 'safety');
  }
  if (apiPaths.length >= 2000) {
    addBlocker('CHANGED_FILE_API_LIMIT_REACHED', 'The PR file list reached the maximum pagination limit (2000 files), so an exact comparison cannot be proven.', 'Split the change into smaller pull requests so every changed path can be verified.');
  }
  if (pathEvidence.invalid || pathEvidence.paths.length === 0) {
    addBlocker('CHANGED_PATH_EVIDENCE_MISSING', 'The Verification section does not contain a usable list under “Changed paths”.', 'List every changed repository-relative path in the PR description.');
  } else if (new Set(apiPaths).size !== apiPaths.length || pathEvidence.paths.length !== apiPaths.length || pathEvidence.paths.some((path, index) => path !== apiPaths[index])) {
    addBlocker('CHANGED_PATH_EVIDENCE_MISMATCH', 'The paths stated in the PR description do not exactly match GitHub’s changed-file list.', 'Refresh the path list from the Files changed tab; do not omit or add paths.');
  }
  if (!hasUsefulText(readSectionValue(verification, 'Commands/checks run'))) {
    addBlocker('VERIFICATION_COMMANDS_MISSING', 'The Verification section does not say which commands ran and what happened.', 'Record the actual commands and their outcomes for this PR head.');
  }
  if (!hasUsefulText(readSectionValue(verification, 'Check results for that SHA'))) {
    addBlocker('VERIFICATION_CHECK_EVIDENCE_MISSING', 'The Verification section does not describe checks for the exact head SHA.', 'Record check names and outcomes; this gate independently verifies results with GitHub’s API.');
  }

  checkAcceptanceEvidence(sections.get('acceptance criteria evidence'), addBlocker);
  if (!hasUsefulText(readSectionValue(risks, 'Security/permissions impact'))) {
    addBlocker('SECURITY_IMPACT_MISSING', 'Security/permissions impact is missing or still a placeholder.', 'State which trust boundary or permission changed, or explicitly say none changed and why.');
  }
  if (!hasUsefulText(readSectionValue(risks, 'Known blockers'))) {
    addBlocker('KNOWN_BLOCKERS_MISSING', 'Known blockers are missing or still a placeholder.', 'List blockers, or explicitly state that none are known.');
  }
  if (!hasUsefulText(readSectionValue(risks, 'Recovery or rollback'))) {
    addBlocker('RECOVERY_PLAN_MISSING', 'Recovery or rollback guidance is missing or still a placeholder.', 'Explain how to disable or back out the change if it behaves unexpectedly.');
  }
  if (!hasUsefulText(readSectionValue(handoff, 'Latest reviewer instructions addressed'))) {
    addBlocker('REVIEW_HANDOFF_MISSING', 'The Handoff section does not say whether review instructions were addressed.', 'Summarize the latest review feedback, or state that this is the first review.');
  }
  if (!hasUsefulText(readSectionValue(handoff, 'Next action and owner'))) {
    addBlocker('NEXT_ACTION_OWNER_MISSING', 'The Handoff section does not identify a next action and owner.', 'State who should do what next, such as “maintainer: review this exact head”.');
  }
  if (!/\[\s*x\s*\]\s*No-op commit check completed/i.test(handoff)) {
    addBlocker('NO_OP_CHECK_NOT_ACKNOWLEDGED', 'The Handoff section has not marked the no-op commit check as completed.', 'Confirm that the current head adds a real tree change, then mark the checklist item complete.');
  }

  if (!headCommit || String(headCommit.sha || '').toLowerCase() !== headSha || !SHA1_PATTERN.test(String(headCommit.commit?.tree?.sha || ''))) {
    addBlocker('HEAD_COMMIT_UNVERIFIED', 'GitHub did not return verifiable tree information for the current head commit.', 'Retry after the commit metadata can be read; do not infer that a commit changed files.', 'safety');
  } else {
    const parentSha = String(headCommit.parents?.[0]?.sha || '').toLowerCase();
    if (!SHA1_PATTERN.test(parentSha) || !parentCommit || String(parentCommit.sha || '').toLowerCase() !== parentSha || !SHA1_PATTERN.test(String(parentCommit.commit?.tree?.sha || ''))) {
      addBlocker('HEAD_PARENT_UNVERIFIED', 'The current head commit’s first parent and tree could not be verified.', 'Refresh the head and parent commit metadata; no-op status must be known.', 'safety');
    } else if (String(headCommit.commit.tree.sha).toLowerCase() === String(parentCommit.commit.tree.sha).toLowerCase()) {
      addBlocker('NO_OP_HEAD_COMMIT', 'The latest commit has the same file tree as its parent and therefore adds no code/content change.', 'Do not treat a message-only commit as successful work. Make the required change or explain why no change is necessary in a separate review decision.');
    }
  }

  const ciStatus = evaluateChecks(requiredChecks, checkRuns, headSha, addBlocker);
  const canonicalBlockers = sortBlockers(blockers);
  const contractStatus = contractBlockers.length || safetyBlockers.length ? 'blocked' : 'passed';
  const success = canonicalBlockers.length === 0;
  return {
    success,
    status: success ? 'passed' : 'blocked',
    repository: repositoryFullName || null,
    pullRequestNumber: Number.isInteger(Number(pullRequest?.number)) ? Number(pullRequest.number) : null,
    headSha: headSha || null,
    baseSha: baseSha || null,
    contractStatus,
    ciStatus,
    humanApproval: {
      status: 'separate_human_step',
      evaluated: false,
      approved: false,
      explanation: 'This gate checks evidence and CI only. A human must still review the current head; this workflow never approves or merges a pull request.'
    },
    blockerCount: canonicalBlockers.length,
    blockers: canonicalBlockers,
    mutated: false,
    nextAction: success
      ? 'Ask the maintainer to review this exact head SHA. Human approval and merging remain separate decisions.'
      : 'Resolve the listed blockers, then rerun the gate against the latest PR head SHA. This gate makes no changes to GitHub state.'
  };
}

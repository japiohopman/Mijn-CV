/**
 * Read-only, fail-closed reconciliation of Jules sessions against GitHub and
 * the durable claim ledger. This module never mutates GitHub or provider state.
 */
import { validateConfig } from './config.mjs';
import { normalizeRepositoryIdentity, validateClaimRecord } from './claims.mjs';
import {
  sessionDisposition,
  isOpenPullRequest,
  isMergedPullRequest,
  extractPullRequestNumber
} from './preflight.mjs';

const report = (decisionCode, repository, blockers, details = {}) => ({
  success: blockers.length === 0 && decisionCode === 'RECONCILIATION_CLEAR',
  decisionCode,
  timestamp: details.timestamp,
  repository,
  mutated: false,
  summary: blockers.length
    ? blockers.length + ' lifecycle reconciliation blocker(s) detected.'
    : 'Session, Issue, claim, branch, and PR lifecycle reconciliation is clear.',
  sessionsInspected: details.sessionsInspected ?? 0,
  claimsInspected: details.claimsInspected ?? 0,
  blockers,
  nextSafeAction: blockers.length
    ? 'Resolve the reported evidence gaps manually; do not dispatch or create replacement work.'
    : 'Read-only evidence is consistent. This report does not authorize dispatch or mutate claims.'
});

function safeErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const status = Number.isInteger(error?.status) ? 'HTTP_' + error.status : '';
  return code || status || 'READ_FAILED';
}

function parseRepositoryUrl(repositoryUrl) {
  let parsed;
  try { parsed = new URL(repositoryUrl); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  let segments;
  try { segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return null; }
  if (segments.length !== 2 || segments.some(segment => !segment)) return null;
  return {
    origin: parsed.origin.toLowerCase(),
    owner: segments[0].toLowerCase(),
    repository: segments[1].toLowerCase()
  };
}

function pullRequestUrlMatchesRepository(pullRequestUrl, expectedRepository) {
  let parsed;
  try { parsed = new URL(pullRequestUrl); } catch { return false; }
  if (parsed.protocol !== 'https:' || parsed.origin.toLowerCase() !== expectedRepository.origin) return false;
  let segments;
  try { segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return false; }
  return segments.length >= 4
    && segments[0].toLowerCase() === expectedRepository.owner
    && segments[1].toLowerCase() === expectedRepository.repository
    && segments[2].toLowerCase() === 'pull'
    && /^\d+$/.test(segments[3]);
}

function repositoryMatches(left, right) {
  const a = normalizeRepositoryIdentity(left);
  const b = normalizeRepositoryIdentity(right);
  return a.valid && b.valid
    && a.repository.owner === b.repository.owner
    && a.repository.repo === b.repository.repo;
}

function sessionIdOf(session) {
  if (typeof session?.id === 'string' && session.id.trim()) return session.id.trim();
  if (typeof session?.name === 'string' && session.name.trim()) {
    const parts = session.name.split('/');
    return parts[parts.length - 1] || null;
  }
  return null;
}

export function extractSessionClaimId(session) {
  const text = String(session?.prompt ?? '') + ' ' + String(session?.title ?? '');
  const matches = [...text.matchAll(/\[claimId:\s*([^\s\]]+)\]/ig)].map(match => match[1].trim());
  const distinctMatches = [...new Set(matches)];
  if (distinctMatches.length !== 1) return null;
  return distinctMatches[0] || null;
}

function issueIsLinkedToPullRequest(pullRequest, issueNumber) {
  const searchable = String(pullRequest?.title ?? '') + '\n' + String(pullRequest?.body ?? '');
  const explicitIssueReference = new RegExp(
    '\\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved|issue)\\s+#' + issueNumber + '\\b',
    'i'
  );
  return explicitIssueReference.test(searchable)
    || new RegExp('/issues/' + issueNumber + '(?:\\b|$)', 'i').test(searchable);
}

function sessionPullRequestRefs(session) {
  if (session?.outputs !== undefined && session?.outputs !== null && !Array.isArray(session.outputs)) {
    return { invalid: true, refs: [] };
  }
  const outputs = Array.isArray(session?.outputs) ? session.outputs : [];
  const refs = [];
  for (const output of outputs) {
    if (!output || typeof output !== 'object' || !Object.prototype.hasOwnProperty.call(output, 'pullRequest')) continue;
    const ref = output.pullRequest;
    if (!ref || typeof ref.url !== 'string' || !ref.url.trim()) {
      return { invalid: true, refs: [] };
    }
    refs.push(ref);
  }
  return { invalid: false, refs };
}

export async function reconcileSessionLifecycle({
  config = null,
  repository,
  providerClient,
  fetchPullRequest,
  fetchIssue,
  fetchBranch,
  stateAdapter,
  now = new Date()
} = {}) {
  const date = new Date(now);
  const timestamp = Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  const repoCheck = normalizeRepositoryIdentity(repository);
  if (!repoCheck.valid) {
    return report('RECONCILIATION_INVALID_REPOSITORY', null, [{
      code: 'INVALID_REPOSITORY',
      reason: 'Repository identity is missing or invalid.'
    }], { timestamp });
  }
  const targetRepo = repoCheck.repository;
  const expectedRepoUrl = 'https://github.com/' + targetRepo.owner + '/' + targetRepo.repo;
  const expectedRepo = parseRepositoryUrl(expectedRepoUrl);

  if (config) {
    const configCheck = validateConfig(config);
    if (!configCheck.valid) {
      return report('RECONCILIATION_INVALID_CONFIG', targetRepo,
        configCheck.errors.map(error => ({ code: error.code, path: error.path, reason: error.message })),
        { timestamp });
    }
  }

  const missingAdapters = [];
  if (!providerClient || typeof providerClient.listSessions !== 'function') missingAdapters.push('providerClient.listSessions');
  if (!providerClient || typeof providerClient.findSourceForRepository !== 'function') missingAdapters.push('providerClient.findSourceForRepository');
  if (typeof fetchIssue !== 'function') missingAdapters.push('fetchIssue');
  if (typeof fetchBranch !== 'function') missingAdapters.push('fetchBranch');
  if (typeof fetchPullRequest !== 'function') missingAdapters.push('fetchPullRequest');
  if (!stateAdapter || typeof stateAdapter.readState !== 'function') missingAdapters.push('stateAdapter.readState');
  if (missingAdapters.length) {
    return report('RECONCILIATION_ADAPTERS_REQUIRED', targetRepo, [{
      code: 'BLOCK_REQUIRED_EVIDENCE_ADAPTER_MISSING',
      reason: 'Read-only reconciliation requires all authoritative evidence adapters: ' + missingAdapters.join(', ') + '.'
    }], { timestamp });
  }

  let source;
  try {
    source = await providerClient.findSourceForRepository(targetRepo);
  } catch (error) {
    return report('RECONCILIATION_SOURCE_LOOKUP_FAILED', targetRepo, [{
      code: 'BLOCK_SOURCE_LOOKUP_FAILED',
      reason: 'Could not verify the authoritative Jules source (' + safeErrorCode(error) + ').'
    }], { timestamp });
  }
  const sourceOwner = source?.githubRepo?.owner;
  const sourceRepo = source?.githubRepo?.repo;
  if (!source || typeof source.name !== 'string' || !source.name.trim()
    || typeof sourceOwner !== 'string' || typeof sourceRepo !== 'string'
    || sourceOwner.trim().toLowerCase() !== targetRepo.owner
    || sourceRepo.trim().toLowerCase() !== targetRepo.repo) {
    return report('RECONCILIATION_SOURCE_UNVERIFIED', targetRepo, [{
      code: 'BLOCK_SOURCE_IDENTITY_UNVERIFIED',
      reason: 'Jules did not return a source whose authoritative owner/repository exactly matches the target repository.'
    }], { timestamp });
  }
  const expectedSourceName = source.name;

  let sessions;
  try {
    sessions = await providerClient.listSessions();
  } catch (error) {
    return report('RECONCILIATION_PAGINATION_FAILED', targetRepo, [{
      code: 'BLOCK_PROVIDER_INVENTORY_FAILED',
      reason: 'The complete Jules session inventory could not be verified (' + safeErrorCode(error) + ').'
    }], { timestamp });
  }
  if (!Array.isArray(sessions)) {
    return report('RECONCILIATION_PAGINATION_FAILED', targetRepo, [{
      code: 'BLOCK_PROVIDER_INVENTORY_MALFORMED',
      reason: 'Jules session inventory was not a complete array.'
    }], { timestamp });
  }

  let snapshot;
  try {
    snapshot = await stateAdapter.readState();
  } catch (error) {
    return report('RECONCILIATION_STATE_READ_FAILED', targetRepo, [{
      code: 'BLOCK_CLAIM_STATE_READ_FAILED',
      reason: 'The authoritative claim ledger could not be read (' + safeErrorCode(error) + ').'
    }], { timestamp, sessionsInspected: sessions.length });
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || typeof snapshot.head !== 'string' || !/^[0-9a-f]{40}$/i.test(snapshot.head)
    || !Array.isArray(snapshot.claims)) {
    return report('RECONCILIATION_STATE_INVALID', targetRepo, [{
      code: 'BLOCK_CLAIM_STATE_INVALID',
      reason: 'Claim ledger is missing, uninitialized, or malformed; it cannot be treated as an empty claim list.'
    }], { timestamp, sessionsInspected: sessions.length });
  }

  const claims = snapshot.claims;
  const blockers = [];
  const claimsById = new Map();
  for (const claim of claims) {
    const validation = validateClaimRecord(claim);
    if (!validation.valid) {
      blockers.push({
        claimId: claim?.claimId ?? null,
        code: 'BLOCK_MALFORMED_CLAIM',
        reason: 'Claim ledger contains a malformed claim record; reconciliation cannot safely continue for that record.'
      });
      continue;
    }
    if (!repositoryMatches(claim.repository, targetRepo)) {
      blockers.push({
        claimId: claim.claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_CLAIM_REPOSITORY_MISMATCH',
        reason: 'Claim ' + claim.claimId + ' belongs to a different repository than the configured target.'
      });
      continue;
    }
    const expectedProvider = String(config?.workProvider ?? 'jules').trim().toLowerCase();
    if (claim.provider.trim().toLowerCase() !== expectedProvider) {
      blockers.push({
        claimId: claim.claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_CLAIM_PROVIDER_MISMATCH',
        reason: 'Claim ' + claim.claimId + ' uses provider ' + claim.provider + ', not the configured provider.'
      });
      continue;
    }
    if (!claimsById.has(claim.claimId)) claimsById.set(claim.claimId, []);
    claimsById.get(claim.claimId).push(claim);
  }
  for (const [claimId, entries] of claimsById.entries()) {
    if (entries.length !== 1) {
      blockers.push({
        claimId,
        code: 'BLOCK_DUPLICATE_CLAIM_ID',
        reason: 'The claim ledger contains more than one record for claimId ' + claimId + '.'
      });
    }
  }
  if (blockers.length) {
    return report('RECONCILIATION_STATE_INVALID', targetRepo, blockers, {
      timestamp, sessionsInspected: sessions.length, claimsInspected: claims.length
    });
  }

  const seenClaimIds = new Set();
  const seenSessionIds = new Set();
  for (const session of sessions) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      blockers.push({
        session: 'unknown',
        code: 'BLOCK_MALFORMED_SESSION',
        reason: 'Jules inventory contains a non-object session record.'
      });
      continue;
    }

    const sessionSource = session.sourceContext?.source ?? session.source?.name ?? session.source ?? null;
    if (typeof sessionSource !== 'string' || !sessionSource.trim() || sessionSource !== sessionSource.trim()) {
      blockers.push({
        session: session.name ?? session.id ?? 'unknown',
        code: 'BLOCK_MISSING_SESSION_SOURCE',
        reason: 'Session source metadata is missing or malformed; this session cannot be safely assigned to a repository.'
      });
      continue;
    }
    if (sessionSource !== expectedSourceName) {
      if (/^sources\/github\/[^/]+\/[^/]+$/.test(sessionSource)) continue;
      blockers.push({
        session: session.name ?? session.id ?? 'unknown',
        code: 'BLOCK_UNRECOGNIZED_SESSION_SOURCE',
        reason: 'Session source does not match the target and is not a recognizable GitHub repository source; ownership cannot be proven.'
      });
      continue;
    }

    const id = sessionIdOf(session);
    if (!id) {
      blockers.push({
        session: session.name ?? 'unknown',
        code: 'BLOCK_MISSING_SESSION_ID',
        reason: 'Target-repository session has no authoritative session ID.'
      });
      continue;
    }
    if (seenSessionIds.has(id)) {
      blockers.push({
        session: id,
        code: 'BLOCK_DUPLICATE_SESSION_ID',
        reason: 'The provider inventory contains duplicate session IDs.'
      });
      continue;
    }
    seenSessionIds.add(id);

    const disposition = sessionDisposition(session);
    const claimId = extractSessionClaimId(session);
    if (!claimId) {
      blockers.push({
        session: id,
        state: disposition.state,
        code: 'BLOCK_MISSING_CLAIM_ID',
        reason: 'Session title/prompt must contain exactly one durable [claimId: ...] correlation marker.'
      });
      continue;
    }
    const matchedClaims = claimsById.get(claimId) ?? [];
    if (matchedClaims.length !== 1) {
      blockers.push({
        session: id,
        claimId,
        code: 'BLOCK_SESSION_CLAIM_NOT_FOUND',
        reason: 'Session references a claimId that is missing or ambiguous in the authoritative claim ledger.'
      });
      continue;
    }
    const claim = matchedClaims[0];
    seenClaimIds.add(claimId);

    if (claim.sessionId !== id || (claim.metadata?.providerSessionId && claim.metadata.providerSessionId !== id)) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_SESSION_CLAIM_SESSION_MISMATCH',
        reason: 'The claim session ID does not exactly match the provider session ID.'
      });
      continue;
    }

    const branch = session.sourceContext?.githubRepoContext?.startingBranch ?? session.startingBranch ?? null;
    if (typeof branch !== 'string' || !branch.trim()) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_MISSING_STARTING_BRANCH',
        reason: 'Session is missing its authoritative starting branch.'
      });
      continue;
    }
    let branchRecord;
    try {
      branchRecord = await fetchBranch(branch);
    } catch (error) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        branch,
        code: 'BLOCK_BRANCH_LOOKUP_FAILED',
        reason: 'GitHub could not verify the session starting branch (' + safeErrorCode(error) + ').'
      });
      continue;
    }
    if (!branchRecord || typeof branchRecord.name !== 'string' || branchRecord.name !== branch) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        branch,
        code: 'BLOCK_BRANCH_NOT_FOUND',
        reason: 'The exact starting branch referenced by the session could not be verified.'
      });
      continue;
    }

    let issue;
    try {
      issue = await fetchIssue(claim.issueNumber);
    } catch (error) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_ISSUE_LOOKUP_FAILED',
        reason: 'GitHub could not verify governing Issue #' + claim.issueNumber + ' (' + safeErrorCode(error) + ').'
      });
      continue;
    }
    if (!issue || Number(issue.number) !== claim.issueNumber || !['open', 'closed'].includes(String(issue.state).toLowerCase())) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_ISSUE_IDENTITY_UNVERIFIED',
        reason: 'The exact governing Issue could not be verified against the claim.'
      });
      continue;
    }
    const sessionIssue = session.issueNumber ?? session.issue_number;
    if (sessionIssue !== undefined && sessionIssue !== null
      && (!Number.isInteger(Number(sessionIssue)) || Number(sessionIssue) !== claim.issueNumber)) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_SESSION_ISSUE_MISMATCH',
        reason: 'Session issue metadata conflicts with the Issue number stored in its claim.'
      });
      continue;
    }

    const prEvidence = sessionPullRequestRefs(session);
    if (prEvidence.invalid) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_MALFORMED_PR_OUTPUT',
        reason: 'Session contains malformed pull request output; linked PR evidence cannot be trusted.'
      });
      continue;
    }
    if (prEvidence.refs.length === 0) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        state: disposition.state,
        code: 'BLOCK_SESSION_PR_MISSING',
        reason: 'No linked pull request is available to verify; session/claim remains unresolved.'
      });
      continue;
    }
    if (prEvidence.refs.length !== 1) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_MULTIPLE_LINKED_PRS',
        reason: 'Session references multiple pull requests; a human must classify the work before reconciliation can clear.'
      });
      continue;
    }
    const prRef = prEvidence.refs[0];
    if (!pullRequestUrlMatchesRepository(prRef.url, expectedRepo)) {
      blockers.push({
        session: id,
        claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_INVALID_PR_URL',
        reason: 'Associated PR URL is malformed or belongs to a different repository.'
      });
      continue;
    }
    const prNumber = extractPullRequestNumber(prRef.url);
    if (!Number.isInteger(prNumber) || prNumber < 1) {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber,
        code: 'BLOCK_INVALID_PR_NUMBER',
        reason: 'Associated PR URL has no valid pull request number.'
      });
      continue;
    }

    let pullRequest;
    try {
      pullRequest = await fetchPullRequest(prNumber);
    } catch (error) {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
        code: 'BLOCK_PR_LOOKUP_FAILED',
        reason: 'GitHub could not verify PR #' + prNumber + ' (' + safeErrorCode(error) + ').'
      });
      continue;
    }
    if (!pullRequest || Number(pullRequest.number) !== prNumber) {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
        code: 'BLOCK_PR_IDENTITY_UNVERIFIED',
        reason: 'The PR response does not prove the identity of the linked PR.'
      });
      continue;
    }
    if (!issueIsLinkedToPullRequest(pullRequest, claim.issueNumber)) {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
        code: 'BLOCK_PR_ISSUE_LINK_MISSING',
        reason: 'The linked PR title/body does not identify governing Issue #' + claim.issueNumber + '.'
      });
      continue;
    }

    if (isMergedPullRequest(pullRequest)) {
      if (String(issue.state).toLowerCase() !== 'closed'
        || String(issue.state_reason ?? '').toLowerCase() !== 'completed') {
        blockers.push({
          session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
          code: 'BLOCK_MERGED_PR_ISSUE_NOT_COMPLETED',
          reason: 'PR is merged, but its governing Issue is not verified closed as completed.'
        });
      }
      if (claim.reconciliationStatus !== 'RECONCILED'
        || !['RELEASED', 'RECLAIMED'].includes(claim.status)) {
        blockers.push({
          session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
          code: 'BLOCK_CLAIM_REQUIRES_RECONCILIATION',
          reason: 'PR/Issue appear complete, but the durable claim has not been explicitly reconciled and released.'
        });
      }
      continue;
    }

    if (isOpenPullRequest(pullRequest)) {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
        code: 'BLOCK_OPEN_PR',
        reason: 'Associated PR #' + prNumber + ' is open; existing work must be resolved before another task can start.'
      });
    } else if (String(pullRequest.state ?? '').toLowerCase() === 'closed') {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
        code: 'BLOCK_CLOSED_UNMERGED_PR',
        reason: 'Associated PR #' + prNumber + ' is closed but unmerged; human classification is required.'
      });
    } else {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
        code: 'BLOCK_UNKNOWN_PR_STATE',
        reason: 'Associated PR state is missing or unknown.'
      });
    }

    if (disposition.disposition === 'blocking') {
      blockers.push({
        session: id, claimId, issueNumber: claim.issueNumber, pullRequest: prNumber,
        code: 'BLOCK_ACTIVE_PROVIDER_SESSION',
        reason: disposition.reason
      });
    }
  }

  for (const claim of claims) {
    if (claim.reconciliationStatus === 'RECONCILED') continue;
    if (!seenClaimIds.has(claim.claimId)) {
      blockers.push({
        claimId: claim.claimId,
        issueNumber: claim.issueNumber,
        code: 'BLOCK_CLAIM_SESSION_NOT_FOUND',
        reason: 'Unreconciled claim has no matching provider session in the complete inventory; absence is not proof the session was never created.'
      });
    }
  }

  return report(blockers.length ? 'RECONCILIATION_BLOCKED' : 'RECONCILIATION_CLEAR',
    targetRepo, blockers, {
      timestamp,
      sessionsInspected: sessions.length,
      claimsInspected: claims.length
    });
}

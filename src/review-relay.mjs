/**
 * Deterministic, fail-closed decisions for trusted PR review events.
 * This module never calls GitHub/Jules and never creates sessions.
 */
const SHA1_PATTERN = /^[0-9a-f]{40}$/i;
const REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function lower(value) { return text(value).toLowerCase(); }
function safeIdentifier(value) {
  const normalized = text(value);
  return normalized && /^[A-Za-z0-9._:/-]+$/.test(normalized) ? normalized : '';
}
function validRepository(value) { return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text(value)); }
function trusted(login, trustedReviewers) {
  return Boolean(text(login) && Array.isArray(trustedReviewers) && trustedReviewers.some(item => lower(item) === lower(login)));
}
function result(decisionCode, reason, nextAction, extra = {}) {
  return {
    decisionCode, reason, nextAction,
    success: decisionCode === 'APPROVED_CURRENT_HEAD' || decisionCode === 'ESCALATION_RECORDED',
    mutated: false, requiresWrite: false, commentBody: null,
    repositoryFullName: null, pullRequestNumber: null, headSha: null,
    ...extra
  };
}
export function parseEscalationDirective(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/^\s*(?:\[autoloop:escalate\]|@autoloop\s+escalate)\s*:?\s*([\s\S]*)$/i);
  if (!match) return null;
  const reason = match[1].replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  return reason ? { reason } : null;
}
export function isAcknowledgementComment(body) {
  const normalized = lower(body);
  return Boolean(normalized && /^(?:👀|👍|✅|ack(?:nowledged)?[.!]?|looks good[.!]?|read[.!]?|thanks[.!]?|seen[.!]?)$/i.test(normalized));
}
export function makeReviewEventKey({ repositoryFullName, pullRequestNumber, headSha, reviewId, updatedAt, state } = {}) {
  const repository = lower(repositoryFullName);
  const head = lower(headSha);
  if (!validRepository(repository) || !Number.isInteger(Number(pullRequestNumber)) || Number(pullRequestNumber) < 1 || !SHA1_PATTERN.test(head)) return null;
  const review = safeIdentifier(String(reviewId ?? ''));
  const version = safeIdentifier(updatedAt) || safeIdentifier(state);
  if (!review || !version) return null;
  return 'review-relay:v1:' + repository + ':pr:' + Number(pullRequestNumber) + ':head:' + head + ':review:' + review + ':version:' + version;
}
function latestTrustedReviews(reviews, trustedReviewers, headSha) {
  const byReviewer = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = text(review?.user?.login);
    const state = text(review?.state).toUpperCase();
    const commitId = lower(review?.commit_id);
    if (!trusted(login, trustedReviewers) || !SHA1_PATTERN.test(commitId) || commitId !== lower(headSha) || !REVIEW_STATES.has(state)) continue;
    const key = lower(login);
    const current = byReviewer.get(key);
    const timestamp = text(review?.submitted_at || review?.updated_at || review?.created_at);
    const currentTimestamp = text(current?.submitted_at || current?.updated_at || current?.created_at);
    const newId = Number(review?.id) || 0;
    const oldId = Number(current?.id) || 0;
    if (!current || timestamp > currentTimestamp || (timestamp === currentTimestamp && newId > oldId)) byReviewer.set(key, review);
  }
  return [...byReviewer.values()];
}
function checkEvidence(requiredChecks, checkRuns, headSha) {
  if (!Array.isArray(requiredChecks) || requiredChecks.length === 0) {
    return { passed: false, status: 'not_configured', reason: 'Required checks are not configured; review approval cannot advance.',
      nextAction: 'Configure the exact required check-run names before trusting approval outcomes.', checks: [] };
  }
  if (!Array.isArray(checkRuns)) return { passed: false, status: 'unavailable',
    reason: 'GitHub did not provide a complete check-run inventory.',
    nextAction: 'Retry after check-run evidence is available; missing checks are not success.', checks: [] };
  const uniqueNames = [...new Set(requiredChecks.map(text).filter(Boolean))].sort();
  if (uniqueNames.length !== requiredChecks.length) return { passed: false, status: 'invalid_config',
    reason: 'Required check names contain blanks or duplicates.',
    nextAction: 'Fix config/autoloop.json requiredChecks so every check name is unique and non-empty.', checks: [] };
  const checks = uniqueNames.map(name => {
    const matching = checkRuns.filter(run => run && run.name === name && lower(run.head_sha) === lower(headSha))
      .sort((a, b) => {
        const aTime = text(a.completed_at || a.started_at || a.created_at);
        const bTime = text(b.completed_at || b.started_at || b.created_at);
        return bTime.localeCompare(aTime) || (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    const latest = matching[0];
    const status = lower(latest?.status) || 'missing';
    const conclusion = lower(latest?.conclusion) || null;
    return { name, headSha: lower(headSha), status, conclusion, passed: Boolean(latest && status === 'completed' && conclusion === 'success') };
  });
  const passed = checks.every(item => item.passed);
  return { passed, status: passed ? 'passed' : 'blocked',
    reason: passed ? 'Every configured required check passed for the exact current PR head.' :
      'One or more required checks are missing, incomplete, or unsuccessful for the exact current PR head.',
    nextAction: passed ? 'Continue only with the explicit downstream readiness policy.' :
      'Wait for or fix required checks on the current head before treating approval as ready.', checks };
}
function parseFindingDisposition(body, label) {
  if (typeof body !== 'string') return null;
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?([^:]+)\s*:\s*(.*?)\s*$/);
    if (match && match[1].trim().toLowerCase() === label.toLowerCase() && match[2].trim()) {
      return match[2].trim().slice(0, 1000);
    }
  }
  return null;
}
function safeMarkdown(value) { return text(value).replace(/[<>]/g, '').replace(/@/g, '@\u200b').slice(0, 600); }
function makeAuditComment({ eventKey, decisionCode, repositoryFullName, pullRequestNumber, headSha, governingIssueNumber, review, existingWork, escalationReason }) {
  const lines = [
    '<!-- ' + eventKey + ' -->',
    '## Development Autoloop review relay',
    '',
    '**Outcome:** ' + (decisionCode === 'REPAIR_HANDOFF_BLOCKED' ? 'Repair handoff recorded; dispatch remains blocked.' : 'Trusted reviewer escalation recorded.'),
    '',
    '- Repository: ' + repositoryFullName,
    '- Pull request: #' + pullRequestNumber,
    '- Current head SHA: ' + lower(headSha)
  ];
  if (review?.id !== undefined && review?.id !== null) lines.push('- Trusted review ID: ' + String(review.id));
  if (governingIssueNumber) lines.push('- Governing Issue: #' + Number(governingIssueNumber));
  if (existingWork) {
    lines.push('- Existing claim ID: ' + safeMarkdown(existingWork.claimId));
    lines.push('- Existing Jules session ID: ' + safeMarkdown(existingWork.sessionId));
  }
  if (escalationReason) lines.push('', '**Escalation reason:** ' + safeMarkdown(escalationReason));
  lines.push('', '**Safety status: BLOCKED.** The relay never creates a Jules session, changes claims, or starts replacement work.',
    '', existingWork
      ? 'Next action: reconcile the outcome of this existing session and continue only when the reviewed readiness policy permits live dispatch. Do not create a duplicate task.'
      : 'Next action: an authorized maintainer must resolve the missing or ambiguous task context before any repair is considered.');
  return lines.join('\n');
}
export function evaluateReviewRelay({
  repositoryFullName, pullRequest, eventName, eventAction, eventReview = null, eventComment = null,
  reviews = [], trustedReviewers = [], requiredChecks = [], checkRuns = [], governingIssueNumber = null,
  existingWork = null, existingEventKeys = []
} = {}) {
  const repository = lower(repositoryFullName);
  const prNumber = Number(pullRequest?.number);
  const headSha = lower(pullRequest?.head?.sha);
  const common = { repositoryFullName: repository || null, pullRequestNumber: Number.isInteger(prNumber) ? prNumber : null, headSha: headSha || null };
  if (!validRepository(repository) || !Number.isInteger(prNumber) || prNumber < 1 || !SHA1_PATTERN.test(headSha)
    || String(pullRequest?.state || '').toLowerCase() !== 'open' || pullRequest?.merged === true) {
    return result('BLOCK_INVALID_PR_CONTEXT', 'A valid, open pull request and exact current head SHA are required.',
      'Refresh GitHub pull-request metadata; never infer a review target from incomplete data.', common);
  }
  if (pullRequest?.draft === true) return result('WAIT_DRAFT_PR', 'Draft pull requests do not advance the trusted review relay.',
    'Mark the PR ready for review when its handoff evidence is complete.', common);

  const kind = text(eventName);
  const action = text(eventAction).toLowerCase();
  if (kind === 'pull_request_target' || kind === 'pull_request') {
    return result(action === 'synchronize' ? 'HEAD_CHANGED_REVIEW_REQUIRED' : 'WAITING_FOR_TRUSTED_REVIEW',
      action === 'synchronize'
        ? 'The pull-request head changed; approval and check evidence from older SHAs are not carried forward.'
        : 'Pull-request metadata changed; no review verdict was accepted from this event.',
      'Verify the contract and checks for this exact head and obtain a trusted review on the new SHA.',
      { ...common, previousHeadInvalidated: action === 'synchronize' });
  }

  if (kind === 'issue_comment') {
    const comment = eventComment || {};
    const actor = text(comment?.user?.login);
    const directive = parseEscalationDirective(comment?.body);
    if (!directive) return result('ACKNOWLEDGEMENT_IGNORED',
      'A generic PR comment or acknowledgement is not a reviewer verdict and cannot advance the repair lifecycle.',
      'Use a submitted review for approval/changes requested, or an explicit [autoloop:escalate] directive from a configured trusted reviewer.', common);
    if (!trusted(actor, trustedReviewers)) return result('IGNORED_UNTRUSTED_ACTOR',
      'The escalation directive was written by an actor who is not configured as a trusted reviewer.',
      'Configure the exact trusted reviewer identity or ask a trusted reviewer to submit the escalation.', common);
    const key = makeReviewEventKey({ repositoryFullName: repository, pullRequestNumber: prNumber, headSha,
      reviewId: 'comment-' + comment.id, updatedAt: text(comment.updated_at || comment.created_at) || 'created' });
    if (!key) return result('BLOCK_EVENT_ID_INVALID', 'The comment event cannot be given a stable deduplication key.',
      'Refresh the comment metadata and retry.', common);
    if ((existingEventKeys || []).includes(key)) return result('DUPLICATE_EVENT_IGNORED',
      'This escalation event already has an audit record.', 'No further action is needed for this duplicate delivery.', { ...common, eventKey: key });
    return result('ESCALATION_RECORDED', 'A trusted reviewer requested explicit escalation.',
      'Keep the PR blocked for the designated human owner. No repair task is dispatched.', {
        ...common, actor, eventKey: key, escalationReason: directive.reason, requiresWrite: true,
        commentBody: makeAuditComment({ eventKey: key, decisionCode: 'ESCALATION_RECORDED', repositoryFullName: repository,
          pullRequestNumber: prNumber, headSha, escalationReason: directive.reason })
      });
  }

  if (kind !== 'pull_request_review') return result('IGNORED_UNSUPPORTED_EVENT',
    'This event type is not a supported trusted review decision.', 'Use a submitted PR review or the explicit trusted escalation directive.', common);

  const incomingReview = eventReview || {};
  const actor = text(incomingReview?.user?.login);
  if (!trusted(actor, trustedReviewers)) return result('IGNORED_UNTRUSTED_REVIEWER',
    'The review author is not in the configured trusted reviewer list.', 'Only configured trusted reviewer identities may advance review state.', common);
  const eventHead = lower(incomingReview.commit_id);
  if (!SHA1_PATTERN.test(eventHead) || eventHead !== headSha) return result('STALE_REVIEW_IGNORED',
    'This review refers to a different commit than the current PR head.',
    'Request a new review on the latest head SHA; stale approval cannot carry forward.',
    { ...common, reviewId: incomingReview.id ?? null, reviewedHeadSha: eventHead || null });

  const state = text(incomingReview.state).toUpperCase();
  if (state === 'COMMENTED') {
    const directive = parseEscalationDirective(incomingReview.body);
    if (!directive) return result('ACKNOWLEDGEMENT_IGNORED',
      'A COMMENTED review without an explicit escalation directive is discussion/acknowledgement only.',
      'Submit APPROVED or CHANGES_REQUESTED for a verdict, or use [autoloop:escalate] with a reason.', common);
    const key = makeReviewEventKey({ repositoryFullName: repository, pullRequestNumber: prNumber, headSha,
      reviewId: incomingReview.id, updatedAt: text(incomingReview.submitted_at || incomingReview.updated_at) || state });
    if (!key) return result('BLOCK_EVENT_ID_INVALID', 'The escalation review has no stable event identity.', 'Refresh the review metadata and retry.', common);
    if ((existingEventKeys || []).includes(key)) return result('DUPLICATE_EVENT_IGNORED',
      'This escalation review already has an audit record.', 'No further action is needed for this duplicate delivery.', { ...common, eventKey: key });
    return result('ESCALATION_RECORDED', 'A trusted reviewer requested explicit escalation.',
      'Keep the PR blocked for the designated human owner. No repair task is dispatched.', {
        ...common, actor, eventKey: key, escalationReason: directive.reason, requiresWrite: true,
        commentBody: makeAuditComment({ eventKey: key, decisionCode: 'ESCALATION_RECORDED', repositoryFullName: repository,
          pullRequestNumber: prNumber, headSha, review: incomingReview, escalationReason: directive.reason })
      });
  }
  if (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED' && state !== 'DISMISSED') return result('IGNORED_NON_VERDICT_REVIEW',
    'This review state is not an approval or a request for changes.', 'No repair or approval transition was created.', common);

  const combined = [...(Array.isArray(reviews) ? reviews : [])];
  if (!combined.some(item => String(item?.id) === String(incomingReview.id))) combined.push(incomingReview);
  const latest = latestTrustedReviews(combined, trustedReviewers, headSha);
  const changes = latest.filter(item => text(item.state).toUpperCase() === 'CHANGES_REQUESTED')
    .sort((a, b) => text(a.submitted_at || a.updated_at).localeCompare(text(b.submitted_at || b.updated_at)));
  if (changes.length > 0) {
    const chosen = changes[changes.length - 1];
    const key = makeReviewEventKey({ repositoryFullName: repository, pullRequestNumber: prNumber, headSha,
      reviewId: chosen.id, updatedAt: text(chosen.submitted_at || chosen.updated_at) || chosen.state });
    if (!key) return result('BLOCK_EVENT_ID_INVALID', 'The changes-requested review has no stable event identity.', 'Refresh review metadata and retry.', common);
    if ((existingEventKeys || []).includes(key)) return result('DUPLICATE_EVENT_IGNORED',
      'A repair attempt already exists for this trusted review event; inspect its existing session without resending.',
      'Reconcile the existing provider session and never resend this event automatically.', {
        ...common, eventKey: key, reviewId: chosen.id, governingIssueNumber: Number(governingIssueNumber),
        claimId: existingWork.claimId, sessionId: existingWork.sessionId,
        existingWorkVerified: true, repairAttemptExists: true
      });
    if (!Number.isInteger(Number(governingIssueNumber)) || Number(governingIssueNumber) < 1) return result('BLOCK_GOVERNING_ISSUE_MISSING',
      'The PR does not identify one verifiable governing Issue in this repository.',
      'Correct the PR template Governing Issue reference before routing review feedback.', { ...common, eventKey: key, reviewId: chosen.id });
    if (!existingWork || existingWork.verified !== true || Number(existingWork.issueNumber) !== Number(governingIssueNumber)
      || Number(existingWork.pullRequestNumber) !== prNumber || !text(existingWork.claimId) || !text(existingWork.sessionId)) {
      return result('BLOCK_REPAIR_CONTEXT_MISSING',
        'The existing Issue/PR/claim/provider-session relationship could not be uniquely verified.',
        'Run read-only lifecycle reconciliation and resolve missing or conflicting evidence. Do not create a new task or session.',
        { ...common, eventKey: key, reviewId: chosen.id, governingIssueNumber: Number(governingIssueNumber) });
    }
    return result('REPAIR_HANDOFF_BLOCKED',
      'A trusted changes-requested verdict was linked to the verified existing task, but live repair dispatch remains disabled.',
      'Reconcile the existing session outcome and continue only after the disposable pilot/readiness gate permits live dispatch.', {
        ...common, eventKey: key, reviewId: chosen.id, governingIssueNumber: Number(governingIssueNumber),
        claimId: existingWork.claimId, sessionId: existingWork.sessionId, requiresWrite: true, existingWorkVerified: true,
        commentBody: makeAuditComment({ eventKey: key, decisionCode: 'REPAIR_HANDOFF_BLOCKED', repositoryFullName: repository,
          pullRequestNumber: prNumber, headSha, governingIssueNumber: Number(governingIssueNumber), review: chosen, existingWork })
      });
  }

  const approvals = latest.filter(item => text(item.state).toUpperCase() === 'APPROVED');
  if (approvals.length === 0) {
    if (state === 'DISMISSED') return result('ACKNOWLEDGEMENT_IGNORED',
      'No active trusted approval or changes-requested verdict exists on the current head.',
      'Comments and dismissed reviews are not verdicts. Wait for a current-head trusted review.', common);
    const stale = (Array.isArray(reviews) ? reviews : []).some(item => trusted(item?.user?.login, trustedReviewers)
      && SHA1_PATTERN.test(lower(item?.commit_id)) && lower(item.commit_id) !== headSha
      && ['APPROVED', 'CHANGES_REQUESTED'].includes(text(item?.state).toUpperCase()));
    return result(stale ? 'STALE_REVIEW_IGNORED' : 'WAITING_FOR_TRUSTED_REVIEW',
      stale ? 'Trusted review evidence exists only for an older head SHA.' : 'No active trusted approval exists on the current head SHA.',
      'Obtain a trusted review on the exact current head SHA.', common);
  }

  const checks = checkEvidence(requiredChecks, checkRuns, headSha);
  if (!checks.passed) return result('BLOCK_REQUIRED_CHECKS', checks.reason, checks.nextAction,
    { ...common, checksStatus: checks.status, checkEvidence: checks.checks });

  const priorChangeRequests = (Array.isArray(reviews) ? reviews : []).filter(item =>
    trusted(item?.user?.login, trustedReviewers)
    && text(item?.state).toUpperCase() === 'CHANGES_REQUESTED'
    && SHA1_PATTERN.test(lower(item?.commit_id)) && lower(item.commit_id) !== headSha);
  let repairDisposition = null;
  if (priorChangeRequests.length > 0) {
    const candidates = approvals.map(item => ({
      reviewId: item.id ?? null,
      findingsAddressed: parseFindingDisposition(item.body, 'Findings addressed'),
      findingsRemaining: parseFindingDisposition(item.body, 'Findings remaining')
    }));
    repairDisposition = candidates.find(item => item.findingsAddressed && item.findingsRemaining) || null;
    if (!repairDisposition) {
      return result('BLOCK_REPAIR_DISPOSITION_MISSING',
        'A trusted changes-requested review exists for an older head, but the current-head approval does not explicitly state which findings were addressed and which remain.',
        'In the trusted approval review body, add non-empty “Findings addressed:” and “Findings remaining:” lines. Use “None” when no findings remain; the relay will not infer fixes from a green check or approval alone.',
        { ...common, checkEvidence: checks.checks, reviewedHeadSha: headSha,
          priorChangeRequestedReviewIds: priorChangeRequests.map(item => item.id ?? null) });
    }
    repairDisposition.priorChangeRequestedReviewIds = priorChangeRequests.map(item => item.id ?? null);
  }

  return result('APPROVED_CURRENT_HEAD',
    'A trusted reviewer approved the exact current head, and every configured required check passed on that same SHA.',
    'Approval evidence is recorded only; any merge or live-dispatch action requires separate readiness policy.', {
      ...common, actor: approvals.map(item => text(item.user?.login)).sort(),
      checkEvidence: checks.checks, reviewedHeadSha: headSha,
      ...(repairDisposition ? { repairDisposition } : {})
    });
}


/**
 * Decide whether a trusted changes-requested review may be sent to the already
 * correlated Jules session. This is a pure gate; it never calls a provider.
 */
export function evaluateRepairContinuationGate({
  config,
  repositoryFullName,
  pullRequest,
  governingIssueNumber,
  existingWork,
  session
} = {}) {
  const repository = lower(repositoryFullName);
  const parts = repository.split('/');
  const expectedSource = parts.length === 2 ? 'sources/github/' + parts[0] + '/' + parts[1] : '';
  const headSha = lower(pullRequest?.head?.sha);
  const gates = [
    ['enabled', config?.enabled === true],
    ['live_mode', config?.runMode === 'live'],
    ['repair_dispatch_enabled', config?.repairDispatchEnabled === true],
    ['repair_pilot_approved', config?.repairPilotApproved === true],
    ['human_readiness_required', config?.humanReadinessRequired === true],
    ['automatic_merge_disabled', config?.automaticMerge === false],
    ['schedule_disabled', config?.scheduleEnabled === false]
  ];
  const failedGates = gates.filter(([, passed]) => !passed).map(([name]) => name);
  if (failedGates.length) {
    return {
      allowed: false, decisionCode: 'BLOCK_REPAIR_CONTINUATION_CONFIG',
      failedGates,
      reason: 'Repair continuation is not explicitly enabled by every required safety setting.',
      nextAction: 'Keep repair dispatch blocked; review the configuration and pilot approval before enabling it.'
    };
  }
  if (!validRepository(repository) || !Number.isInteger(Number(governingIssueNumber)) || Number(governingIssueNumber) < 1
    || !Number.isInteger(Number(pullRequest?.number)) || Number(pullRequest.number) < 1
    || String(pullRequest?.state || '').toLowerCase() !== 'open' || pullRequest?.merged === true
    || pullRequest?.draft === true || !SHA1_PATTERN.test(headSha)) {
    return {
      allowed: false, decisionCode: 'BLOCK_REPAIR_CONTINUATION_PR_CONTEXT',
      reason: 'The repository, governing Issue, open PR, or exact current head could not be verified.',
      nextAction: 'Refresh the PR and governing Issue evidence; do not send a repair message from incomplete context.'
    };
  }
  if (!existingWork || existingWork.verified !== true
    || lower(existingWork.repositoryFullName) !== repository
    || Number(existingWork.issueNumber) !== Number(governingIssueNumber)
    || Number(existingWork.pullRequestNumber) !== Number(pullRequest.number)
    || !text(existingWork.claimId) || !text(existingWork.sessionId)) {
    return {
      allowed: false, decisionCode: 'BLOCK_REPAIR_CONTINUATION_CORRELATION',
      reason: 'The existing claim, provider session, governing Issue, and PR are not uniquely correlated.',
      nextAction: 'Run read-only reconciliation and resolve the exact existing-work identity. Never create a replacement session.'
    };
  }
  const sessionId = text(session?.id);
  const sourceName = text(session?.sourceContext?.source);
  const sessionState = normalizeJulesStateSafe(session?.state);
  const sessionText = [session?.title, session?.prompt].filter(value => typeof value === 'string').join('\n');
  const claimMarker = '[claimId: ' + text(existingWork.claimId) + ']';
  if (sessionId !== text(existingWork.sessionId) || sourceName.toLowerCase() !== expectedSource.toLowerCase()
    || sessionState !== 'ACTIVE' || !sessionText.includes(claimMarker)) {
    return {
      allowed: false, decisionCode: 'BLOCK_REPAIR_CONTINUATION_SESSION',
      reason: 'The existing Jules session is not proven active or its ID, repository source, or claim marker does not match.',
      nextAction: 'Inspect the existing session and claim manually. Do not send a message or start replacement work.'
    };
  }
  return {
    allowed: true, decisionCode: 'REPAIR_CONTINUATION_READY',
    reason: 'Every explicit readiness gate and existing-session identity check passed.',
    nextAction: 'Send one guarded follow-up to the verified existing session, then wait for observable reconciliation.',
    repositoryFullName: repository, pullRequestNumber: Number(pullRequest.number),
    headSha, governingIssueNumber: Number(governingIssueNumber),
    claimId: text(existingWork.claimId), sessionId
  };
}

function normalizeJulesStateSafe(value) {
  const state = text(value).toUpperCase();
  if (state === 'PLANNING' || state === 'IN_PROGRESS' || state === 'ACTIVE') return 'ACTIVE';
  if (state === 'QUEUED') return 'QUEUED';
  if (state === 'AWAITING_PLAN_APPROVAL' || state === 'AWAITING_USER_FEEDBACK') return 'AWAITING_INPUT';
  if (state === 'PAUSED') return 'PAUSED';
  if (state === 'COMPLETED') return 'COMPLETED';
  if (state === 'FAILED') return 'FAILED';
  return 'UNKNOWN';
}

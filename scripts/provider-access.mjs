const SHA1 = /^[0-9a-f]{40}$/i;

function lower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function repairPilotReady(config = {}) {
  return config.enabled === true
    && config.runMode === 'live'
    && config.repairDispatchEnabled === true
    && config.repairPilotApproved === true
    && config.humanReadinessRequired === true
    && config.automaticMerge === false
    && config.scheduleEnabled === false;
}

function isTrustedReview(review, trusted) {
  return trusted.has(lower(review?.user?.login));
}

function currentHeadChangesRequested(reviews, trusted, currentHead) {
  const latest = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = lower(review?.user?.login);
    const state = String(review?.state || '').toUpperCase();
    if (!trusted.has(login) || lower(review?.commit_id) !== lower(currentHead)
      || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(state)) continue;
    const time = Date.parse(review?.submitted_at || '') || 0;
    const previous = latest.get(login);
    if (!previous || time > previous.time) latest.set(login, { state, time });
  }
  return [...latest.values()].some(review => review.state === 'CHANGES_REQUESTED');
}

function hasPriorRepairAttempt({ reviews, comments, trusted, currentHead }) {
  if (!SHA1.test(String(currentHead || ''))) return false;
  for (const comment of Array.isArray(comments) ? comments : []) {
    const body = String(comment?.body || '');
    if (!body.includes('**Repair continuation attempt:**')) continue;
    const marker = body.match(/<!-- (review-relay:v1:[^\s]+) -->/);
    if (!marker) continue;
    const parsed = marker[1].match(/:head:([0-9a-f]{40}):review:([^:]+):version:/i);
    if (!parsed) continue;
    const reviewedHead = lower(parsed[1]);
    const reviewId = parsed[2];
    if (reviewedHead === lower(currentHead)) continue;
    const matchingReview = (Array.isArray(reviews) ? reviews : []).some(review =>
      String(review?.id) === reviewId
      && String(review?.state || '').toUpperCase() === 'CHANGES_REQUESTED'
      && lower(review?.commit_id) === reviewedHead
      && isTrustedReview(review, trusted));
    if (matchingReview) return true;
  }
  return false;
}

/**
 * Pure allow-list decision for making JULES_API_KEY available to the relay.
 * Missing/partial evidence always returns false.
 */
function currentHeadApproved(reviews, trusted, currentHead) {
  const latest = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const login = lower(review?.user?.login);
    const state = String(review?.state || '').toUpperCase();
    if (!trusted.has(login) || lower(review?.commit_id) !== lower(currentHead)
      || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(state)) continue;
    const time = Date.parse(review?.submitted_at || '') || 0;
    const previous = latest.get(login);
    if (!previous || time > previous.time) latest.set(login, { state, time });
  }
  return [...latest.values()].some(review => review.state === 'APPROVED');
}

export function shouldExposeProviderAccess({
  eventName, event = {}, config = {}, pullRequest = null, reviews = [], comments = []
} = {}) {
  if (!repairPilotReady(config)) return false;
  const trusted = new Set((Array.isArray(config.trustedReviewers) ? config.trustedReviewers : []).map(lower).filter(Boolean));
  const currentHead = pullRequest?.head?.sha;
  if (!pullRequest || String(pullRequest.state || '').toLowerCase() !== 'open'
    || pullRequest.merged === true || !SHA1.test(String(currentHead || ''))) return false;

  if (eventName === 'issue_comment') {
    const exactRetry = /^\s*(?:\[autoloop:relay-review\]|@autoloop\s+relay-review)\s*$/i.test(String(event.comment?.body || ''));
    if (!event.issue?.pull_request || !exactRetry || !trusted.has(lower(event.comment?.user?.login))) return false;
    return currentHeadChangesRequested(reviews, trusted, currentHead);
  }

  if (eventName === 'workflow_run') {
    if (event.workflow_run?.name !== 'Observe PR review event (unprivileged)') return false;
    if (currentHeadChangesRequested(reviews, trusted, currentHead)) return true;
    return currentHeadApproved(reviews, trusted, currentHead)
      && hasPriorRepairAttempt({ reviews, comments, trusted, currentHead });
  }

  if (eventName === 'pull_request_target' && String(event.action || '').toLowerCase() === 'synchronize') {
    return hasPriorRepairAttempt({ reviews, comments, trusted, currentHead });
  }

  return false;
}

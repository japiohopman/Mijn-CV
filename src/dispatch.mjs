/**
 * Provider-neutral dispatch orchestration.
 * Enforces fail-closed gating (confirmation, dry-run, provider type, claims, preflight/selection)
 * before any mutating provider session creation.
 */

import { acquireClaim, attachSessionToClaim, normalizeRepositoryIdentity, CLAIM_CODES } from './claims.mjs';
import { JulesClient, sanitizeJulesErrorMessage, JULES_STATE_NORMALIZED } from './jules.mjs';
import { selectCandidateIssue } from './selection.mjs';
import { validateConfig } from './config.mjs';

export const DISPATCH_CODES = Object.freeze({
  DISPATCH_SUCCESS: 'DISPATCH_SUCCESS',
  DISPATCH_DRY_RUN: 'DISPATCH_DRY_RUN',
  DISPATCH_DISABLED: 'DISPATCH_DISABLED',
  DISPATCH_UNSUPPORTED_PROVIDER: 'DISPATCH_UNSUPPORTED_PROVIDER',
  DISPATCH_CONFIRMATION_INVALID: 'DISPATCH_CONFIRMATION_INVALID',
  DISPATCH_PREFLIGHT_BLOCKED: 'DISPATCH_PREFLIGHT_BLOCKED',
  DISPATCH_CLAIM_FAILED: 'DISPATCH_CLAIM_FAILED',
  DISPATCH_PROVIDER_FAILED: 'DISPATCH_PROVIDER_FAILED',
  DISPATCH_AMBIGUOUS_RECONCILED: 'DISPATCH_AMBIGUOUS_RECONCILED',
  DISPATCH_AMBIGUOUS_BLOCKED: 'DISPATCH_AMBIGUOUS_BLOCKED',
  DISPATCH_INVALID_PACKET: 'DISPATCH_INVALID_PACKET'
});

/**
 * Validate a dispatch packet structure.
 * @param {*} packet
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateDispatchPacket(packet) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { valid: false, reason: 'Dispatch packet must be a non-null object.' };
  }

  const repoCheck = normalizeRepositoryIdentity(packet.repository);
  if (!repoCheck.valid) {
    return { valid: false, reason: 'Dispatch packet must contain a valid repository identity.' };
  }

  if (typeof packet.claimId !== 'string' || !packet.claimId.trim()) {
    return { valid: false, reason: 'Dispatch packet must contain a stable, non-empty claimId.' };
  }

  if (typeof packet.issueBody !== 'string') {
    return { valid: false, reason: 'Dispatch packet must contain the exact Issue body as a string.' };
  }

  if (typeof packet.issueNumber !== 'number' || !Number.isInteger(packet.issueNumber) || packet.issueNumber < 1) {
    return { valid: false, reason: 'Dispatch packet must contain a positive integer issueNumber.' };
  }

  if (typeof packet.issueTitle !== 'string' || !packet.issueTitle.trim()) {
    return { valid: false, reason: 'Dispatch packet must contain a non-empty issueTitle.' };
  }

  if (typeof packet.startingBranch !== 'string' || !packet.startingBranch.trim()) {
    return { valid: false, reason: 'Dispatch packet must contain a non-empty startingBranch.' };
  }

  if (typeof packet.prompt !== 'string' || !packet.prompt.trim()) {
    return { valid: false, reason: 'Dispatch packet must contain a non-empty prompt.' };
  }

  return { valid: true };
}

/**
 * Perform provider-neutral dispatch for an issue execution packet.
 *
 * @param {object} options
 * @param {object} options.config Autoloop configuration object
 * @param {object} options.packet Dispatch packet
 * @param {string} options.confirmation Confirmation string passed at invocation boundary
 * @param {object} options.stateAdapter Durable claim state store adapter
 * @param {string} [options.owner='autoloop-dispatch'] Owner string acquiring the claim
 * @param {object} [options.providerClient] Injected JulesClient (or created if apiKey provided)
 * @param {string} [options.apiKey] Jules API key (if providerClient not provided)
 * @param {Function} [options.fetchImpl] Fetch implementation for provider calls
 * @param {Date|string|number} [options.now=new Date()] Current timestamp
 * @returns {Promise<object>} Dispatch result
 */
export async function dispatchTask({
  config,
  packet,
  confirmation,
  stateAdapter,
  snapshot = null,
  owner = 'autoloop-dispatch',
  providerClient = null,
  apiKey = null,
  fetchImpl = globalThis.fetch,
  now = new Date()
}) {
  const packetCheck = validateDispatchPacket(packet);
  if (!packetCheck.valid) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_INVALID_PACKET,
      reason: packetCheck.reason,
      session: null,
      claim: null
    };
  }

  const configCheck = validateConfig(config);
  if (!configCheck.valid) {
    const confirmationConfigInvalid = configCheck.errors.some(
      (diagnostic) => diagnostic.path === '/requiredConfirmation'
    );
    return {
      success: false,
      decisionCode: confirmationConfigInvalid
        ? DISPATCH_CODES.DISPATCH_CONFIRMATION_INVALID
        : DISPATCH_CODES.DISPATCH_PREFLIGHT_BLOCKED,
      reason: confirmationConfigInvalid
        ? 'Required dispatch confirmation is missing or invalid in configuration.'
        : 'Configuration failed schema validation.',
      blockers: configCheck.errors,
      session: null,
      claim: null
    };
  }
  config = configCheck.config;

  if (config.enabled !== true) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_DISABLED,
      reason: 'Autoloop is disabled in configuration.',
      session: null,
      claim: null
    };
  }

  if (config.runMode !== 'live') {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_DRY_RUN,
      reason: 'Autoloop runMode is dry-run.',
      session: null,
      claim: null
    };
  }

  // Read schema-canonical field names with fallback for options/backwards-compat
  const configuredProvider = String(config.workProvider ?? config.provider ?? '').trim().toLowerCase();
  if (configuredProvider !== 'jules') {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_UNSUPPORTED_PROVIDER,
      reason: `Unsupported or unconfigured provider: '${config.workProvider ?? config.provider}'.`,
      session: null,
      claim: null
    };
  }

  // Exact confirmation check at both workflow and adapter boundary (must be non-empty string)
  const expectedConfirmation = config.requiredConfirmation ?? config.confirmation;
  if (typeof expectedConfirmation !== 'string' || expectedConfirmation.trim().length === 0 || typeof confirmation !== 'string' || confirmation !== expectedConfirmation) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_CONFIRMATION_INVALID,
      reason: 'Dispatch confirmation does not match non-empty configured confirmation exactly.',
      session: null,
      claim: null
    };
  }

  // The snapshot identity is part of the dispatch contract. A complete-looking snapshot
  // for another or unknown repository must never authorize provider work.
  const packetRepo = normalizeRepositoryIdentity(packet.repository).repository;
  const snapshotRepoCheck = normalizeRepositoryIdentity(snapshot?.repository);
  if (!snapshotRepoCheck.valid
    || snapshotRepoCheck.repository.owner !== packetRepo.owner
    || snapshotRepoCheck.repository.repo !== packetRepo.repo) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_PREFLIGHT_BLOCKED,
      reason: 'Authoritative snapshot repository identity is missing or does not match the dispatch packet repository.',
      session: null,
      claim: null
    };
  }

  // Mandatory Preflight and Issue Selection Gate recomputed from snapshot (never trust caller selectionResult)
  if (!snapshot) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_PREFLIGHT_BLOCKED,
      reason: 'Preflight/selection gate evidence (authoritative snapshot) is required but missing.',
      session: null,
      claim: null
    };
  }

  const evalSelection = selectCandidateIssue(snapshot, config);
  if (evalSelection.decisionCode !== 'CANDIDATE_SELECTED' || evalSelection.selectedCandidate?.number !== packet.issueNumber) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_PREFLIGHT_BLOCKED,
      reason: `Preflight/selection gate blocked dispatch for Issue #${packet.issueNumber} (${evalSelection.decisionCode}): ${evalSelection.reason}`,
      session: null,
      claim: null,
      selectionResult: evalSelection
    };
  }

  const selectedIssue = snapshot.issues.find((issue) => issue && issue.number === packet.issueNumber);
  if (!selectedIssue
    || typeof selectedIssue.title !== 'string'
    || typeof selectedIssue.body !== 'string'
    || packet.issueTitle !== selectedIssue.title
    || packet.issueBody !== selectedIssue.body) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_INVALID_PACKET,
      reason: 'Dispatch packet Issue title/body do not exactly match the selected Issue in the authoritative snapshot.',
      session: null,
      claim: null,
      selectionResult: evalSelection
    };
  }

  const currentDate = new Date(now);
  const targetRepo = normalizeRepositoryIdentity(packet.repository).repository;

  // Read-only Setup Step A: Initialize provider client
  let client = providerClient;
  if (!client) {
    const key = apiKey || process.env.JULES_API_KEY;
    if (!key) {
      return {
        success: false,
        decisionCode: DISPATCH_CODES.DISPATCH_PROVIDER_FAILED,
        reason: 'Jules API key is missing from secrets or environment.',
        session: null,
        claim: null
      };
    }
    client = new JulesClient({ apiKey: key, fetchImpl });
  }

  // Read-only Setup Step B: Resolve repository source and starting branch on Jules API BEFORE claim write
  let source;
  try {
    source = await client.findSourceForRepository(targetRepo, packet.startingBranch);
  } catch (err) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_PROVIDER_FAILED,
      reason: 'Failed to resolve Jules repository source: ' + sanitizeJulesErrorMessage(err, client.apiKey),
      session: null,
      claim: null
    };
  }

  if (!source) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_PROVIDER_FAILED,
      reason: `No matching Jules source found for repository ${targetRepo.owner}/${targetRepo.repo} with startingBranch '${packet.startingBranch}'.`,
      session: null,
      claim: null
    };
  }

  // Step 1: Acquire durable claim BEFORE calling provider session creation
  const claimId = packet.claimId.trim();
  const claimRes = await acquireClaim({
    stateAdapter,
    repository: targetRepo,
    issueNumber: packet.issueNumber,
    owner,
    provider: configuredProvider,
    claimId,
    now: currentDate
  });

  if (!claimRes.safeToDispatch || claimRes.decisionCode !== CLAIM_CODES.CLAIM_ACQUIRED) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_CLAIM_FAILED,
      reason: `Durable claim acquisition failed (${claimRes.decisionCode}): ${claimRes.reason}`,
      session: null,
      claim: claimRes.claim
    };
  }

  const activeClaim = claimRes.claim;

  // Step 4: Construct safe task prompt with correlation marker
  const correlationMarker = `[claimId: ${activeClaim.claimId}]`;
  const fullPrompt = `${packet.prompt.trim()}\n\nCorrelation: ${correlationMarker}`;
  const sessionTitle = packet.issueTitle.includes(correlationMarker)
    ? packet.issueTitle
    : `${packet.issueTitle} ${correlationMarker}`;

  // Step 5: Attempt Jules session creation
  let createdSession = null;
  let createError = null;

  try {
    createdSession = await client.createSession({
      sourceName: source.name,
      startingBranch: packet.startingBranch,
      prompt: fullPrompt,
      title: sessionTitle
    });
  } catch (err) {
    createError = err;
  }

  // Step 6: Handle successful session creation vs timeouts / ambiguities
  if (createdSession && createdSession.id) {
    const sessionObservedAt = new Date().toISOString();
    const sessionWithObserved = { ...createdSession, observedAt: sessionObservedAt };

    const sessionMetadata = {
      providerSessionId: createdSession.id,
      rawProviderState: createdSession.state ?? null,
      normalizedProviderStatus: createdSession.normalizedState,
      lastObservedAt: sessionObservedAt,
      providerLifecycleReason: createdSession.normalizedState === JULES_STATE_NORMALIZED.UNKNOWN
        ? 'Blocked: Jules returned an unknown session state. Inspect the exact session and confirm its status before resuming; do not create a replacement session.'
        : 'Session creation response received. Continue only through the configured plan-approval and session monitoring workflow.'
    };

    // Attach session ID and lifecycle metadata to claim
    const attachRes = await attachSessionToClaim({
      stateAdapter,
      claimId: activeClaim.claimId,
      sessionId: createdSession.id,
      metadata: sessionMetadata,
      now: new Date(sessionObservedAt)
    });

    const finalClaim = attachRes.claim || activeClaim;

    if (createdSession.normalizedState === JULES_STATE_NORMALIZED.UNKNOWN) {
      return {
        success: false,
        decisionCode: DISPATCH_CODES.DISPATCH_PROVIDER_FAILED,
        reason: `Created session ${createdSession.id} returned an unknown or unparseable state ('${createdSession.state}'). Blocking progress.`,
        session: sessionWithObserved,
        claim: finalClaim
      };
    }

    if (attachRes.decisionCode !== CLAIM_CODES.CLAIM_SESSION_ASSOCIATED) {
      return {
        success: false,
        decisionCode: DISPATCH_CODES.DISPATCH_AMBIGUOUS_BLOCKED,
        reason: `Session created (${createdSession.id}) but persisting session ID to claim failed: ${attachRes.reason}`,
        session: sessionWithObserved,
        claim: finalClaim
      };
    }

    return {
      success: true,
      decisionCode: DISPATCH_CODES.DISPATCH_SUCCESS,
      reason: `Successfully dispatched task and created Jules session ${createdSession.id}.`,
      session: sessionWithObserved,
      claim: attachRes.claim
    };
  }

  // Session creation failed or was ambiguous / timed out.
  // Reconcile by listing sessions and searching for correlationMarker.
  let existingSessions = [];
  try {
    existingSessions = await client.listSessions();
  } catch (reconErr) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_AMBIGUOUS_BLOCKED,
      reason: `Session creation failed/timed out (${sanitizeJulesErrorMessage(createError, client.apiKey)}) and session list reconciliation also failed (${sanitizeJulesErrorMessage(reconErr, client.apiKey)}).`,
      session: null,
      claim: activeClaim
    };
  }

  const exactMarker = `[claimId: ${activeClaim.claimId}]`;
  const candidateMatches = existingSessions.filter((s) => {
    const promptMatch = typeof s.prompt === 'string' && s.prompt.includes(exactMarker);
    const titleMatch = typeof s.title === 'string' && s.title.includes(exactMarker);
    return promptMatch || titleMatch;
  });

  const verifiedMatchingSessions = [];
  for (const cand of candidateMatches) {
    let fullSession = cand;
    try {
      fullSession = await client.getSession(cand.id);
    } catch {
      // If fetching full details fails, skip unverified candidate
      continue;
    }

    const fullPromptMatch = typeof fullSession.prompt === 'string' && fullSession.prompt.includes(exactMarker);
    const fullTitleMatch = typeof fullSession.title === 'string' && fullSession.title.includes(exactMarker);
    if (!fullPromptMatch && !fullTitleMatch) continue;

    const sSource = fullSession.sourceContext?.source;
    if (!sSource || sSource !== source.name) continue;

    const sBranch = fullSession.sourceContext?.githubRepoContext?.startingBranch;
    if (!sBranch || sBranch !== packet.startingBranch) continue;

    verifiedMatchingSessions.push(fullSession);
  }

  if (verifiedMatchingSessions.length === 1) {
    const reconObservedAt = new Date().toISOString();
    const reconciledSession = {
      ...verifiedMatchingSessions[0],
      observedAt: reconObservedAt
    };

    const sessionMetadata = {
      providerSessionId: reconciledSession.id,
      rawProviderState: reconciledSession.state ?? null,
      normalizedProviderStatus: reconciledSession.normalizedState,
      lastObservedAt: reconObservedAt,
      providerLifecycleReason: reconciledSession.normalizedState === JULES_STATE_NORMALIZED.UNKNOWN
        ? 'Blocked: reconciled Jules session has an unknown state. Inspect this exact session before proceeding; do not create another session.'
        : 'Creation response was ambiguous; this exact existing session was verified by read-only reconciliation. Do not retry session creation.'
    };

    const attachRes = await attachSessionToClaim({
      stateAdapter,
      claimId: activeClaim.claimId,
      sessionId: reconciledSession.id,
      metadata: sessionMetadata,
      now: new Date(reconObservedAt)
    });

    const finalClaim = attachRes.claim || activeClaim;

    if (reconciledSession.normalizedState === JULES_STATE_NORMALIZED.UNKNOWN) {
      return {
        success: false,
        decisionCode: DISPATCH_CODES.DISPATCH_AMBIGUOUS_BLOCKED,
        reason: `Reconciled session (${reconciledSession.id}) returned unknown state ('${reconciledSession.state}'). Blocking progress.`,
        session: reconciledSession,
        claim: finalClaim
      };
    }

    if (attachRes.decisionCode !== CLAIM_CODES.CLAIM_SESSION_ASSOCIATED) {
      return {
        success: false,
        decisionCode: DISPATCH_CODES.DISPATCH_AMBIGUOUS_BLOCKED,
        reason: `Reconciled single matching session (${reconciledSession.id}) after create timeout, but attaching session ID failed: ${attachRes.reason}`,
        session: reconciledSession,
        claim: finalClaim
      };
    }

    return {
      success: true,
      decisionCode: DISPATCH_CODES.DISPATCH_AMBIGUOUS_RECONCILED,
      reason: `Session creation response was ambiguous/failed, but reconciliation confirmed existing session ${reconciledSession.id}.`,
      session: reconciledSession,
      claim: attachRes.claim
    };
  }

  if (verifiedMatchingSessions.length > 1) {
    return {
      success: false,
      decisionCode: DISPATCH_CODES.DISPATCH_AMBIGUOUS_BLOCKED,
      reason: `Session creation was ambiguous and reconciliation found multiple (${verifiedMatchingSessions.length}) matching sessions for claim ${activeClaim.claimId}. Blocking to prevent duplicate work.`,
      session: null,
      claim: activeClaim
    };
  }

  // verifiedMatchingSessions.length === 0
  return {
    success: false,
    decisionCode: DISPATCH_CODES.DISPATCH_AMBIGUOUS_BLOCKED,
    reason: `Session creation failed/timed out (${sanitizeJulesErrorMessage(createError, client.apiKey)}) and no matching session was found on read-back. Preserving blocked state to avoid duplicate dispatch.`,
    session: null,
    claim: activeClaim
  };
}

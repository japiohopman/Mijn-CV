/**
 * Durable claims, compare-and-swap (CAS) state store transitions,
 * and stale-claim recovery.
 */

export const CLAIM_SCHEMA_VERSION = 1;

export const CLAIM_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED',
  RECLAIMED: 'RECLAIMED',
  EXPIRED: 'EXPIRED'
});

export const RECONCILIATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RECONCILED: 'RECONCILED',
  BLOCKED: 'BLOCKED'
});

export const CLAIM_CODES = Object.freeze({
  CLAIM_ACQUIRED: 'CLAIM_ACQUIRED',
  CLAIM_ALREADY_EXISTS: 'CLAIM_ALREADY_EXISTS',
  CLAIM_BLOCKED_STALE_UNRECONCILED: 'CLAIM_BLOCKED_STALE_UNRECONCILED',
  CAS_CONFLICT_EXHAUSTED: 'CAS_CONFLICT_EXHAUSTED',
  CLAIM_INVALID_STATE: 'CLAIM_INVALID_STATE',
  CLAIM_PERSISTENCE_FAILED: 'CLAIM_PERSISTENCE_FAILED',
  CLAIM_RECOVERY_BLOCKED: 'CLAIM_RECOVERY_BLOCKED',
  CLAIM_RECOVERED: 'CLAIM_RECOVERED',
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  CLAIM_SESSION_ASSOCIATED: 'CLAIM_SESSION_ASSOCIATED',
  CLAIM_SESSION_CONFLICT: 'CLAIM_SESSION_CONFLICT'
});

const VALID_STATUSES = new Set(Object.values(CLAIM_STATUS));
const VALID_RECONCILIATION_STATUSES = new Set(Object.values(RECONCILIATION_STATUS));
const MAX_CAS_RETRIES = 5;

function invalidStateStoreError(message) {
  const error = new Error(message);
  error.code = 'INVALID_STATE_STORE';
  return error;
}

function stateStoreNotInitializedError(message) {
  const error = new Error(message);
  error.code = 'STATE_STORE_NOT_INITIALIZED';
  return error;
}

function validateStateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { valid: false, reason: 'State snapshot must be an object.' };
  }
  if (snapshot.head !== null && (typeof snapshot.head !== 'string' || !snapshot.head.trim())) {
    return { valid: false, reason: 'State snapshot must include a valid head SHA or null for an uninitialized store.' };
  }
  if (!Array.isArray(snapshot.claims)) {
    return { valid: false, reason: 'State snapshot must include a claims array; refusing to treat malformed state as empty.' };
  }
  if (snapshot.head === null && snapshot.claims.length > 0) {
    return { valid: false, reason: 'Uninitialized state store cannot contain claim records without an authoritative head.' };
  }
  const seenIds = new Set();
  for (const claim of snapshot.claims) {
    const checked = validateClaimRecord(claim);
    if (!checked.valid) {
      return { valid: false, reason: 'State snapshot contains a malformed claim record (' + (claim?.claimId ?? 'unknown') + ').' };
    }
    if (seenIds.has(claim.claimId)) {
      return { valid: false, reason: 'State snapshot contains duplicate claimId ' + claim.claimId + '.' };
    }
    seenIds.add(claim.claimId);
  }
  return { valid: true };
}

function sameClaimIntent(actual, expected) {
  if (!actual || !expected) return false;
  const fields = ['schemaVersion', 'claimId', 'issueNumber', 'owner', 'provider', 'sessionId',
    'createdAt', 'expiresAt', 'status', 'reconciliationStatus', 'updatedAt'];
  if (!fields.every((field) => actual[field] === expected[field])) return false;
  const actualRepo = normalizeRepositoryIdentity(actual.repository).repository;
  const expectedRepo = normalizeRepositoryIdentity(expected.repository).repository;
  return Boolean(actualRepo && expectedRepo &&
    actualRepo.owner === expectedRepo.owner && actualRepo.repo === expectedRepo.repo);
}

function pointer(segments) {
  if (!segments || segments.length === 0) return '/';
  return '/' + segments.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function diagnostic(path, code, message) {
  return { path: pointer(path), code, message };
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortDiagnostics(errors) {
  return errors.sort((a, b) =>
    compareText(a.path, b.path) ||
    compareText(a.code, b.code) ||
    compareText(a.message, b.message)
  );
}

function isValidIsoTimestamp(str) {
  if (typeof str !== 'string') return false;
  const match = str.match(/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,9}))?(?<zone>Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/);
  if (!match) return false;

  const parts = match.groups;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;

  if (parts.zone !== 'Z') {
    const offsetHour = Number(parts.offsetHour);
    const offsetMinute = Number(parts.offsetMinute);
    if (offsetMinute > 59 || offsetHour > 14 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }
  return Number.isFinite(Date.parse(str));
}

/**
 * Validate repository identity structure.
 * Accepts { owner: string, repo: string } or string 'owner/repo'.
 * @param {*} repoInput
 * @returns {{ valid: boolean, repository: { owner: string, repo: string }|null, error?: object }}
 */
export function normalizeRepositoryIdentity(repoInput) {
  if (typeof repoInput === 'string' && repoInput.trim()) {
    const parts = repoInput.trim().split('/');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      return {
        valid: true,
        repository: { owner: parts[0].trim().toLowerCase(), repo: parts[1].trim().toLowerCase() }
      };
    }
  } else if (repoInput && typeof repoInput === 'object' && !Array.isArray(repoInput)) {
    const owner = typeof repoInput.owner === 'string' ? repoInput.owner.trim().toLowerCase() : '';
    const repo = typeof repoInput.repo === 'string' ? repoInput.repo.trim().toLowerCase() : '';
    if (owner && repo && !owner.includes('/') && !repo.includes('/')
      && !/\s/.test(owner) && !/\s/.test(repo)) {
      return { valid: true, repository: { owner, repo } };
    }
  }
  return { valid: false, repository: null };
}

/**
 * Validate a versioned Claim record.
 * Fails closed on missing fields, invalid types, invalid timestamps, or unknown enum values.
 *
 * @param {*} record
 * @returns {{ valid: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateClaimRecord(record) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {
      valid: false,
      errors: [diagnostic([], 'INVALID_CLAIM_RECORD', 'Claim record must be a non-null object.')]
    };
  }

  if (record.schemaVersion !== CLAIM_SCHEMA_VERSION) {
    errors.push(diagnostic(['schemaVersion'], 'INVALID_SCHEMA_VERSION', 'schemaVersion must be ' + CLAIM_SCHEMA_VERSION + '.'));
  }

  if (typeof record.claimId !== 'string' || !record.claimId.trim()) {
    errors.push(diagnostic(['claimId'], 'INVALID_CLAIM_ID', 'claimId must be a non-empty string.'));
  }

  const repoCheck = normalizeRepositoryIdentity(record.repository);
  if (!repoCheck.valid) {
    errors.push(diagnostic(['repository'], 'INVALID_REPOSITORY_IDENTITY', 'repository must specify valid owner and repo strings.'));
  }

  if (typeof record.issueNumber !== 'number' || !Number.isInteger(record.issueNumber) || record.issueNumber < 1) {
    errors.push(diagnostic(['issueNumber'], 'INVALID_ISSUE_NUMBER', 'issueNumber must be a positive integer number.'));
  }

  if (typeof record.owner !== 'string' || !record.owner.trim()) {
    errors.push(diagnostic(['owner'], 'INVALID_OWNER', 'owner must be a non-empty string.'));
  }

  if (typeof record.provider !== 'string' || !record.provider.trim()) {
    errors.push(diagnostic(['provider'], 'INVALID_PROVIDER', 'provider must be a non-empty string.'));
  }

  if (record.sessionId !== null && (typeof record.sessionId !== 'string' || !record.sessionId.trim())) {
    errors.push(diagnostic(['sessionId'], 'INVALID_SESSION_ID', 'sessionId must be explicitly null or a non-empty string.'));
  }

  if (!isValidIsoTimestamp(record.createdAt)) {
    errors.push(diagnostic(['createdAt'], 'INVALID_TIMESTAMP', 'createdAt must be a valid ISO timestamp string.'));
  }

  if (!isValidIsoTimestamp(record.expiresAt)) {
    errors.push(diagnostic(['expiresAt'], 'INVALID_TIMESTAMP', 'expiresAt must be a valid ISO timestamp string.'));
  }

  if (isValidIsoTimestamp(record.createdAt) && isValidIsoTimestamp(record.expiresAt)) {
    if (Date.parse(record.expiresAt) < Date.parse(record.createdAt)) {
      errors.push(diagnostic(['expiresAt'], 'EXPIRES_BEFORE_CREATED', 'expiresAt cannot be earlier than createdAt.'));
    }
  }

  if (!VALID_STATUSES.has(record.status)) {
    errors.push(diagnostic(['status'], 'UNKNOWN_STATUS', 'status must be one of: ' + Array.from(VALID_STATUSES).join(', ') + '.'));
  }

  if (!VALID_RECONCILIATION_STATUSES.has(record.reconciliationStatus)) {
    errors.push(diagnostic(['reconciliationStatus'], 'UNKNOWN_RECONCILIATION_STATUS', 'reconciliationStatus must be one of: ' + Array.from(VALID_RECONCILIATION_STATUSES).join(', ') + '.'));
  }

  if (VALID_STATUSES.has(record.status) && VALID_RECONCILIATION_STATUSES.has(record.reconciliationStatus)) {
    if (record.status === CLAIM_STATUS.ACTIVE && record.reconciliationStatus === RECONCILIATION_STATUS.RECONCILED) {
      errors.push(diagnostic(['status'], 'INCONSISTENT_CLAIM_LIFECYCLE', 'An ACTIVE claim cannot already be marked RECONCILED.'));
    }
    if ((record.status === CLAIM_STATUS.RELEASED || record.status === CLAIM_STATUS.RECLAIMED)
      && record.reconciliationStatus !== RECONCILIATION_STATUS.RECONCILED) {
      errors.push(diagnostic(['reconciliationStatus'], 'INCONSISTENT_CLAIM_LIFECYCLE', 'A RELEASED or RECLAIMED claim must have verified RECONCILED status.'));
    }
    if (record.status === CLAIM_STATUS.EXPIRED && record.reconciliationStatus === RECONCILIATION_STATUS.RECONCILED) {
      errors.push(diagnostic(['status'], 'INCONSISTENT_CLAIM_LIFECYCLE', 'EXPIRED is a stale-claim state, not a reconciled release outcome.'));
    }
  }

  if (!isValidIsoTimestamp(record.updatedAt)) {
    errors.push(diagnostic(['updatedAt'], 'INVALID_TIMESTAMP', 'updatedAt must be a valid ISO timestamp string.'));
  }

  if (record.metadata !== undefined && record.metadata !== null && (typeof record.metadata !== 'object' || Array.isArray(record.metadata))) {
    errors.push(diagnostic(['metadata'], 'INVALID_METADATA', 'metadata must be an object if provided.'));
  }
  if (record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)) {
    const lifecycleKeys = ['providerSessionId', 'rawProviderState', 'normalizedProviderStatus', 'lastObservedAt', 'providerLifecycleReason'];
    if (lifecycleKeys.some((key) => Object.prototype.hasOwnProperty.call(record.metadata, key))) {
      if (typeof record.metadata.providerSessionId !== 'string' || !record.metadata.providerSessionId.trim()
        || record.metadata.providerSessionId !== record.sessionId) {
        errors.push(diagnostic(['metadata', 'providerSessionId'], 'INVALID_PROVIDER_LIFECYCLE_METADATA', 'providerSessionId must match the claim sessionId.'));
      }
      if (!(record.metadata.rawProviderState === null
        || (typeof record.metadata.rawProviderState === 'string' && record.metadata.rawProviderState.trim()))) {
        errors.push(diagnostic(['metadata', 'rawProviderState'], 'INVALID_PROVIDER_LIFECYCLE_METADATA', 'rawProviderState must be null or a non-empty string.'));
      }
      const allowedNormalizedStates = ['QUEUED', 'ACTIVE', 'AWAITING_INPUT', 'PAUSED', 'COMPLETED', 'FAILED', 'UNKNOWN'];
      if (!allowedNormalizedStates.includes(record.metadata.normalizedProviderStatus)) {
        errors.push(diagnostic(['metadata', 'normalizedProviderStatus'], 'INVALID_PROVIDER_LIFECYCLE_METADATA', 'normalizedProviderStatus must be a recognized normalized provider status.'));
      }
      if (!isValidIsoTimestamp(record.metadata.lastObservedAt)) {
        errors.push(diagnostic(['metadata', 'lastObservedAt'], 'INVALID_TIMESTAMP', 'lastObservedAt must be a valid ISO timestamp.'));
      }
      if (typeof record.metadata.providerLifecycleReason !== 'string' || !record.metadata.providerLifecycleReason.trim()) {
        errors.push(diagnostic(['metadata', 'providerLifecycleReason'], 'INVALID_PROVIDER_LIFECYCLE_METADATA', 'providerLifecycleReason must contain an actionable status or block reason.'));
      }
    }
  }

  const sorted = sortDiagnostics(errors);
  return { valid: sorted.length === 0, errors: sorted };
}

/**
 * Check if a claim record represents an active lock for an issue at a given time.
 * A claim is active if status === ACTIVE and reconciliationStatus !== RECONCILED.
 *
 * @param {object} claim
 * @param {Date|string|number} [now]
 * @returns {{ active: boolean, expired: boolean, reason?: string }}
 */
export function isClaimActive(claim, now = new Date()) {
  const check = validateClaimRecord(claim);
  if (!check.valid) {
    return { active: true, expired: false, reason: 'Claim record is invalid/malformed.' };
  }

  // Reconciliation is the only release boundary. An EXPIRED, RELEASED, or
  // RECLAIMED record that remains unreconciled must still block new work.
  if (claim.reconciliationStatus === RECONCILIATION_STATUS.RECONCILED) {
    return { active: false, expired: false };
  }

  const nowMs = new Date(now).getTime();
  const expiresAtMs = Date.parse(claim.expiresAt);
  const expired = claim.status === CLAIM_STATUS.EXPIRED || nowMs >= expiresAtMs;

  return {
    active: true,
    expired,
    reason: expired
      ? 'Claim expired at ' + claim.expiresAt + ' but has not been reconciled.'
      : 'Claim is active until ' + claim.expiresAt + ' and has not been reconciled.'
  };
}

/**
 * In-memory Compare-And-Swap State Store Adapter for testing.
 * Implements atomic compare-and-swap state store operations.
 */
export class InMemoryStateAdapter {
  constructor({ claims = [], head = 'v0' } = {}) {
    this.claims = [...claims];
    this.head = head;
    this.readCount = 0;
    this.commitCount = 0;
    this.injectedConflictOnce = false;
    this.injectedAmbiguousWriteOnce = false;
    this.injectedWriteFailureOnce = false;
  }

  async readState() {
    this.readCount++;
    return {
      head: this.head,
      claims: this.claims.map((c) => JSON.parse(JSON.stringify(c)))
    };
  }

  async commitStateChange(expectedHead, newClaims) {
    this.commitCount++;

    if (this.injectedConflictOnce) {
      this.injectedConflictOnce = false;
      return {
        success: false,
        head: this.head,
        reason: 'CAS_CONFLICT',
        ambiguous: false
      };
    }

    if (this.injectedWriteFailureOnce) {
      this.injectedWriteFailureOnce = false;
      return {
        success: false,
        head: this.head,
        reason: 'STORAGE_WRITE_ERROR',
        ambiguous: false
      };
    }

    if (expectedHead !== this.head) {
      return {
        success: false,
        head: this.head,
        reason: 'CAS_CONFLICT',
        ambiguous: false
      };
    }

    if (this.injectedAmbiguousWriteOnce) {
      this.injectedAmbiguousWriteOnce = false;
      // Write actually succeeded in the backing store, but caller receives an ambiguous error
      this.claims = newClaims.map((c) => JSON.parse(JSON.stringify(c)));
      this.head = 'v' + (parseInt(this.head.replace(/\D/g, '') || '0', 10) + 1);
      return {
        success: false,
        head: null,
        reason: 'AMBIGUOUS_WRITE_TIMEOUT',
        ambiguous: true
      };
    }

    this.claims = newClaims.map((c) => JSON.parse(JSON.stringify(c)));
    const versionNum = parseInt(this.head.replace(/\D/g, '') || '0', 10) + 1;
    this.head = 'v' + versionNum;

    return {
      success: true,
      head: this.head,
      ambiguous: false
    };
  }
}

/**
 * Concrete GitHub State Branch Adapter using Git Ref CAS semantics.
 * Stores state on a dedicated, non-default state branch.
 */
export class GitHubStateBranchAdapter {
  constructor({ octokit, repository, stateBranch = 'autoloop-state', defaultBranch = 'main', allowInitialize = false }) {
    if (!octokit) throw new TypeError('octokit instance is required.');
    const repoCheck = normalizeRepositoryIdentity(repository);
    if (!repoCheck.valid) throw new TypeError('repository owner and repo are required.');

    this.octokit = octokit;
    this.owner = repoCheck.repository.owner;
    this.repo = repoCheck.repository.repo;
    this.stateBranch = stateBranch.trim();
    this.defaultBranch = defaultBranch.trim();
    this.allowInitialize = allowInitialize === true;

    if (!this.stateBranch || !this.defaultBranch) {
      throw new Error('State and default branch names must be non-empty.');
    }
    if (this.stateBranch === this.defaultBranch) {
      throw new Error('State branch ("' + this.stateBranch + '") cannot be the protected default branch ("' + this.defaultBranch + '").');
    }
  }

  async readState() {
    let refRes;
    try {
      refRes = await this.octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner: this.owner,
        repo: this.repo,
        ref: 'heads/' + this.stateBranch
      });
    } catch (err) {
      // A missing branch is a setup blocker, not an empty ledger.
      // Only the explicit one-time bootstrap may initialize it.
      if (err.status === 404) {
        throw stateStoreNotInitializedError(
          'State branch ' + this.stateBranch + ' is missing. Run the explicit one-time Autoloop state bootstrap workflow; refusing to treat missing state as empty.'
        );
      }
      throw err;
    }

    const headSha = refRes?.data?.object?.sha;
    if (typeof headSha !== 'string' || !headSha.trim()) {
      throw invalidStateStoreError('State branch ref returned no commit SHA.');
    }

    let contentRes;
    try {
      contentRes = await this.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: this.owner,
        repo: this.repo,
        path: 'claims.json',
        ref: this.stateBranch
      });
    } catch (err) {
      if (err.status === 404) {
        throw invalidStateStoreError('State branch exists but claims.json is missing.');
      }
      throw err;
    }

    let parsed;
    try {
      const encodedContent = contentRes?.data?.content;
      if (typeof encodedContent !== 'string') {
        throw invalidStateStoreError('Persisted claims.json has no encoded content.');
      }
      const content = Buffer.from(encodedContent, 'base64').toString('utf8');
      parsed = JSON.parse(content);
    } catch (err) {
      if (err.code === 'INVALID_STATE_STORE') throw err;
      throw invalidStateStoreError('Persisted claims.json is not valid JSON.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || parsed.schemaVersion !== CLAIM_SCHEMA_VERSION || !Array.isArray(parsed.claims)) {
      throw invalidStateStoreError(
        'Persisted claims.json must contain schemaVersion ' + CLAIM_SCHEMA_VERSION + ' and a claims array.'
      );
    }
    const snapshotCheck = validateStateSnapshot({ head: headSha, claims: parsed.claims });
    if (!snapshotCheck.valid) throw invalidStateStoreError(snapshotCheck.reason);
    return { head: headSha, claims: parsed.claims };
  }

  async commitStateChange(expectedHead, newClaims) {
    try {
      if (!Array.isArray(newClaims)) {
        return { success: false, head: null, reason: 'INVALID_STATE_STORE', ambiguous: false };
      }
      if (!expectedHead && !this.allowInitialize) {
        return { success: false, head: null, reason: 'STATE_STORE_NOT_INITIALIZED', ambiguous: false };
      }
      if (!expectedHead && newClaims.length !== 0) {
        return { success: false, head: null, reason: 'BOOTSTRAP_MUST_START_EMPTY', ambiguous: false };
      }
      const snapshotCheck = validateStateSnapshot({ head: expectedHead || 'initializing', claims: newClaims });
      if (!snapshotCheck.valid) return { success: false, head: null, reason: snapshotCheck.reason, ambiguous: false };
      const contentStr = JSON.stringify({ schemaVersion: CLAIM_SCHEMA_VERSION, claims: newClaims }, null, 2) + '\n';
      const contentBase64 = Buffer.from(contentStr, 'utf8').toString('base64');

      if (!expectedHead) {
        // First creation of state branch
        const defaultBranchRef = await this.octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
          owner: this.owner,
          repo: this.repo,
          ref: 'heads/' + this.defaultBranch
        });
        const parentSha = defaultBranchRef.data.object.sha;

        const blobRes = await this.octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
          owner: this.owner,
          repo: this.repo,
          content: contentStr,
          encoding: 'utf-8'
        });

        const treeRes = await this.octokit.request('POST /repos/{owner}/{repo}/git/trees', {
          owner: this.owner,
          repo: this.repo,
          tree: [{ path: 'claims.json', mode: '100644', type: 'blob', sha: blobRes.data.sha }]
        });

        const commitRes = await this.octokit.request('POST /repos/{owner}/{repo}/git/commits', {
          owner: this.owner,
          repo: this.repo,
          message: 'Initialize autoloop claims state',
          tree: treeRes.data.sha,
          parents: [parentSha]
        });

        await this.octokit.request('POST /repos/{owner}/{repo}/git/refs', {
          owner: this.owner,
          repo: this.repo,
          ref: 'refs/heads/' + this.stateBranch,
          sha: commitRes.data.sha
        });

        return { success: true, head: commitRes.data.sha, ambiguous: false };
      }

      // Updating existing state branch using CAS commit
      const currentRef = await this.octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner: this.owner,
        repo: this.repo,
        ref: 'heads/' + this.stateBranch
      });

      if (currentRef.data.object.sha !== expectedHead) {
        return { success: false, head: currentRef.data.object.sha, reason: 'CAS_CONFLICT', ambiguous: false };
      }

      const parentCommit = await this.octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        owner: this.owner,
        repo: this.repo,
        commit_sha: expectedHead
      });
      const baseTreeSha = parentCommit?.data?.tree?.sha;
      if (typeof baseTreeSha !== 'string' || !baseTreeSha.trim()) {
        throw invalidStateStoreError('Expected state head did not resolve to a Git tree SHA.');
      }

      const blobRes = await this.octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
        owner: this.owner,
        repo: this.repo,
        content: contentStr,
        encoding: 'utf-8'
      });

      const treeRes = await this.octokit.request('POST /repos/{owner}/{repo}/git/trees', {
        owner: this.owner,
        repo: this.repo,
        base_tree: baseTreeSha,
        tree: [{ path: 'claims.json', mode: '100644', type: 'blob', sha: blobRes.data.sha }]
      });

      const commitRes = await this.octokit.request('POST /repos/{owner}/{repo}/git/commits', {
        owner: this.owner,
        repo: this.repo,
        message: 'Update autoloop claims state',
        tree: treeRes.data.sha,
        parents: [expectedHead]
      });

      await this.octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        owner: this.owner,
        repo: this.repo,
        ref: 'heads/' + this.stateBranch,
        sha: commitRes.data.sha,
        force: false
      });

      return { success: true, head: commitRes.data.sha, ambiguous: false };
    } catch (err) {
      if (err.status === 422 || err.status === 409) {
        return { success: false, head: null, reason: 'CAS_CONFLICT', ambiguous: false };
      }
      return { success: false, head: null, reason: 'STORAGE_WRITE_ERROR', ambiguous: true };
    }
  }
}

/**
 * Acquire a durable claim for an Issue using a bounded read -> validate -> compare-and-swap loop.
 *
 * @param {object} options
 * @param {object} options.stateAdapter
 * @param {*} options.repository
 * @param {number} options.issueNumber
 * @param {string} options.owner
 * @param {string} options.provider
 * @param {string} [options.sessionId=null]
 * @param {number} [options.ttlMinutes=45]
 * @param {string} [options.claimId]
 * @param {number} [options.maxRetries=3]
 * @param {Date|string|number} [options.now=new Date()]
 * @returns {Promise<object>} Outcome report
 */
export async function acquireClaim({
  stateAdapter,
  repository,
  issueNumber,
  owner,
  provider,
  sessionId = null,
  ttlMinutes = 45,
  claimId = null,
  maxRetries = 3,
  now = new Date()
}) {
  if (!stateAdapter || typeof stateAdapter.readState !== 'function' || typeof stateAdapter.commitStateChange !== 'function') {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'A valid stateAdapter with readState and commitStateChange methods is required.',
      nextAction: 'Provide a valid state store adapter.'
    };
  }

  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_CAS_RETRIES) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'maxRetries must be an integer between 0 and ' + MAX_CAS_RETRIES + '.',
      nextAction: 'Use a finite retry limit within the documented hard cap.'
    };
  }

  const repoCheck = normalizeRepositoryIdentity(repository);
  if (!repoCheck.valid) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'Repository identity is missing or invalid.',
      nextAction: 'Fix repository identity options.'
    };
  }

  const targetIssueNum = Number(issueNumber);
  if (!Number.isInteger(targetIssueNum) || targetIssueNum < 1) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'Issue number must be a positive integer.',
      nextAction: 'Provide a valid Issue number.'
    };
  }

  if (typeof owner !== 'string' || !owner.trim() || typeof provider !== 'string' || !provider.trim()) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'Owner and provider strings are required.',
      nextAction: 'Provide valid owner and provider identity strings.'
    };
  }

  const currentDate = new Date(now);
  const requestedTtlMinutes = Number(ttlMinutes);
  if (!Number.isFinite(currentDate.getTime())) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'now must be a valid timestamp.',
      nextAction: 'Provide a valid timestamp and retry.'
    };
  }
  if (!Number.isFinite(requestedTtlMinutes) || requestedTtlMinutes <= 0) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'ttlMinutes must be a finite positive number.',
      nextAction: 'Provide a valid positive claim lease duration.'
    };
  }
  const ttlMs = Math.max(1, requestedTtlMinutes) * 60 * 1000;
  const expiresAtDate = new Date(currentDate.getTime() + ttlMs);
  if (!Number.isFinite(expiresAtDate.getTime())) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'ttlMinutes produces a lease expiry outside the supported timestamp range.',
      nextAction: 'Use a smaller, finite positive lease duration.'
    };
  }

  const targetClaimId = typeof claimId === 'string' && claimId.trim()
    ? claimId.trim()
    : 'claim-' + targetIssueNum + '-' + currentDate.getTime() + '-' + Math.random().toString(36).substring(2, 8);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let snapshot;
    try {
      snapshot = await stateAdapter.readState();
    } catch (err) {
      const invalid = err?.code === 'INVALID_STATE_STORE' || err?.code === 'STATE_STORE_NOT_INITIALIZED';
      return {
        claim: null,
        decisionCode: invalid ? CLAIM_CODES.CLAIM_INVALID_STATE : CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'Could not read authoritative claim state: ' + String(err?.message || err),
        nextAction: invalid ? 'Repair the malformed state store before retrying.' : 'Restore state-store access and retry after read-only reconciliation.'
      };
    }
    const snapshotCheck = validateStateSnapshot(snapshot);
    if (!snapshotCheck.valid) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: snapshotCheck.reason,
        nextAction: 'Repair or reconcile invalid state records before retrying.'
      };
    }
    const { head, claims: existingClaims } = snapshot;

    // Search for active/unreconciled claim for target Issue
    const targetRepo = repoCheck.repository;
    const matchingIssueClaims = existingClaims.filter((c) => {
      const cRepo = normalizeRepositoryIdentity(c.repository).repository;
      return cRepo && cRepo.owner === targetRepo.owner && cRepo.repo === targetRepo.repo && Number(c.issueNumber) === targetIssueNum;
    });

    for (const c of matchingIssueClaims) {
      const activeCheck = isClaimActive(c, currentDate);
      if (activeCheck.active) {
        if (activeCheck.expired) {
          return {
            claim: c,
            decisionCode: CLAIM_CODES.CLAIM_BLOCKED_STALE_UNRECONCILED,
            persistenceConfirmed: false,
            safeToDispatch: false,
            reason: 'Issue #' + targetIssueNum + ' has an expired claim ' + c.claimId + ' that has not been reconciled.',
            nextAction: 'Reconcile stale claim ' + c.claimId + ' before attempting a new claim.'
          };
        }
        return {
          claim: c,
          decisionCode: CLAIM_CODES.CLAIM_ALREADY_EXISTS,
          persistenceConfirmed: false,
          safeToDispatch: false,
          reason: 'Issue #' + targetIssueNum + ' is already claimed by active claim ' + c.claimId + '.',
          nextAction: 'Wait for active claim ' + c.claimId + ' to complete or be reconciled.'
        };
      }
    }

    const collidingClaimId = existingClaims.find((c) => c.claimId === targetClaimId);
    if (collidingClaimId) {
      return {
        claim: collidingClaimId,
        decisionCode: CLAIM_CODES.CLAIM_ALREADY_EXISTS,
        persistenceConfirmed: true,
        safeToDispatch: false,
        reason: 'claimId ' + targetClaimId + ' already exists in claim history and cannot be reused.',
        nextAction: 'Choose a new stable claim ID; do not reuse historical IDs.'
      };
    }

    const newClaim = {
      schemaVersion: CLAIM_SCHEMA_VERSION,
      claimId: targetClaimId,
      repository: targetRepo,
      issueNumber: targetIssueNum,
      owner: owner.trim(),
      provider: provider.trim(),
      sessionId: typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null,
      createdAt: currentDate.toISOString(),
      expiresAt: expiresAtDate.toISOString(),
      status: CLAIM_STATUS.ACTIVE,
      reconciliationStatus: RECONCILIATION_STATUS.PENDING,
      updatedAt: currentDate.toISOString(),
      metadata: {}
    };

    const newClaimCheck = validateClaimRecord(newClaim);
    if (!newClaimCheck.valid) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'Constructed claim record failed schema validation.',
        nextAction: 'Fix claim parameters.'
      };
    }

    const updatedClaims = [...existingClaims, newClaim];
    const commitResult = await stateAdapter.commitStateChange(head, updatedClaims);

    if (commitResult.success) {
      return {
        claim: newClaim,
        decisionCode: CLAIM_CODES.CLAIM_ACQUIRED,
        persistenceConfirmed: true,
        safeToDispatch: true,
        reason: 'Claim ' + targetClaimId + ' successfully acquired and persisted for Issue #' + targetIssueNum + '.',
        nextAction: 'Proceed with provider session creation.'
      };
    }

    if (commitResult.ambiguous || commitResult.reason === 'STORAGE_WRITE_ERROR') {
      // Ambiguous write or write error: reconcile by exact claimId and immutable intent.
      let freshSnapshot;
      try {
        freshSnapshot = await stateAdapter.readState();
      } catch (err) {
        return {
          claim: null,
          decisionCode: CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
          persistenceConfirmed: false,
          safeToDispatch: false,
          reason: 'Ambiguous claim write could not be reconciled because the state read failed: ' + String(err?.message || err),
          nextAction: 'Do not create provider work; restore state access and reconcile this exact claim ID.'
        };
      }
      const freshCheck = validateStateSnapshot(freshSnapshot);
      if (!freshCheck.valid) {
        return {
          claim: null,
          decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
          persistenceConfirmed: false,
          safeToDispatch: false,
          reason: 'Ambiguous claim write read-back returned invalid state: ' + freshCheck.reason,
          nextAction: 'Stop and repair the authoritative state store before retrying.'
        };
      }
      const found = freshSnapshot.claims.find((c) => c.claimId === targetClaimId);
      if (found && sameClaimIntent(found, newClaim)) {
        return {
          claim: found,
          decisionCode: CLAIM_CODES.CLAIM_ACQUIRED,
          persistenceConfirmed: true,
          safeToDispatch: true,
          reason: 'Claim ' + targetClaimId + ' was confirmed in state store following write response.',
          nextAction: 'Proceed with provider session creation.'
        };
      }

      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'State write failed or was ambiguous and claim ' + targetClaimId + ' was not found on read-back.',
        nextAction: 'Re-evaluate state and retry claim acquisition.'
      };
    }

    // CAS conflict: loop will retry next attempt
  }

  return {
    claim: null,
    decisionCode: CLAIM_CODES.CAS_CONFLICT_EXHAUSTED,
    persistenceConfirmed: false,
    safeToDispatch: false,
    reason: 'Exhausted max CAS retries (' + maxRetries + ') due to concurrent state updates.',
    nextAction: 'Retry claim acquisition after concurrent updates settle.'
  };
}

/**
 * Inspect state for an exact claim ID.
 *
 * @param {object} options
 * @param {object} options.stateAdapter
 * @param {string} options.claimId
 * @param {Date|string|number} [options.now=new Date()]
 * @returns {Promise<object>}
 */
export async function inspectClaim({ stateAdapter, claimId, now = new Date() }) {
  if (!stateAdapter || typeof stateAdapter.readState !== 'function') {
    return { found: false, valid: false, claim: null, decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE, reason: 'Invalid state adapter.' };
  }

  if (typeof claimId !== 'string' || !claimId.trim()) {
    return { found: false, valid: false, claim: null, decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE, reason: 'claimId must be a non-empty string.' };
  }

  const targetId = claimId.trim();
  let snapshot;
  try {
    snapshot = await stateAdapter.readState();
  } catch (err) {
    return { found: false, valid: false, claim: null,
      decisionCode: err?.code === 'INVALID_STATE_STORE' ? CLAIM_CODES.CLAIM_INVALID_STATE : CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
      reason: 'Could not read authoritative claim state: ' + String(err?.message || err) };
  }
  const snapshotCheck = validateStateSnapshot(snapshot);
  if (!snapshotCheck.valid) {
    return { found: false, valid: false, claim: null, decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE, reason: snapshotCheck.reason };
  }
  const existingClaims = snapshot.claims;

  const found = existingClaims.find((c) => c.claimId === targetId);
  if (!found) {
    return {
      found: false,
      valid: false,
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_NOT_FOUND,
      reason: 'Claim ID ' + targetId + ' was not found in state store.'
    };
  }

  const check = validateClaimRecord(found);
  if (!check.valid) {
    return {
      found: true,
      valid: false,
      claim: found,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      errors: check.errors,
      reason: 'Claim ID ' + targetId + ' is malformed in state store.'
    };
  }

  const activeState = isClaimActive(found, now);
  return {
    found: true,
    valid: true,
    claim: found,
    activeState
  };
}

/**
 * Validate reconciliation evidence for provider sessions, branches, and PRs.
 * Missing, partial, failed, or unverified evidence fails closed.
 *
 * @param {*} evidence
 * @returns {{ verified: boolean, reason?: string }}
 */
export function validateReconciliationEvidence(evidence, expectedClaim = null, now = null) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { verified: false, reason: 'Reconciliation evidence must be a non-null object.' };
  }

  if (evidence.verified !== true) {
    return { verified: false, reason: 'Reconciliation evidence verified property must be explicitly true.' };
  }

  if (typeof evidence.claimId !== 'string' || !evidence.claimId.trim()) {
    return { verified: false, reason: 'Reconciliation evidence must bind to an exact claimId.' };
  }

  const repoCheck = normalizeRepositoryIdentity(evidence.repository);
  if (!repoCheck.valid) {
    return { verified: false, reason: 'Reconciliation evidence must identify the repository it inspected.' };
  }
  if (!Number.isInteger(evidence.issueNumber) || evidence.issueNumber < 1) {
    return { verified: false, reason: 'Reconciliation evidence must identify a positive Issue number.' };
  }
  if (typeof evidence.verifiedBy !== 'string' || !evidence.verifiedBy.trim()) {
    return { verified: false, reason: 'Reconciliation evidence must identify who/what verified it.' };
  }
  if (!isValidIsoTimestamp(evidence.verifiedAt)) {
    return { verified: false, reason: 'Reconciliation evidence must include a valid ISO verifiedAt timestamp.' };
  }

  const domains = [
    { key: 'sessions', valid: new Set(['terminal', 'none', 'completed', 'failed', 'cancelled', 'canceled', 'expired', 'reconciled']), label: 'provider session' },
    { key: 'branches', valid: new Set(['clean', 'deleted', 'merged', 'none', 'reconciled']), label: 'branch' },
    { key: 'pullRequests', valid: new Set(['merged', 'closed_classified', 'none', 'reconciled']), label: 'pull request' }
  ];
  const verifiedAtMs = Date.parse(evidence.verifiedAt);
  for (const domain of domains) {
    const item = evidence[domain.key];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' is missing or malformed.' };
    }
    if (item.verified !== true) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' must be explicitly verified.' };
    }
    const domainRepo = normalizeRepositoryIdentity(item.repository).repository;
    if (!domainRepo
      || domainRepo.owner !== repoCheck.repository.owner
      || domainRepo.repo !== repoCheck.repository.repo) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' must identify the same repository as the top-level evidence.' };
    }
    if (item.issueNumber !== evidence.issueNumber) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' must identify the same Issue as the top-level evidence.' };
    }
    const status = String(item.status ?? '').toLowerCase().trim();
    if (!domain.valid.has(status)) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' has an unknown/unsafe status (' + (status || 'unspecified') + ').' };
    }
    if (domain.key === 'sessions' && status !== 'none'
      && (typeof item.sessionId !== 'string' || !item.sessionId.trim())) {
      return { verified: false, reason: 'Terminal provider-session evidence must identify the exact session inspected.' };
    }
    if (typeof item.source !== 'string' || !item.source.trim()) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' must identify the source inspected.' };
    }
    if (!isValidIsoTimestamp(item.observedAt)) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' must include a valid ISO observedAt timestamp.' };
    }
    if (Date.parse(item.observedAt) > verifiedAtMs) {
      return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' cannot be observed after verifiedAt.' };
    }
  }

  if (expectedClaim) {
    if (evidence.claimId !== expectedClaim.claimId) {
      return { verified: false, reason: 'Reconciliation evidence claimId does not match the target claim.' };
    }
    const expectedRepo = normalizeRepositoryIdentity(expectedClaim.repository).repository;
    if (!expectedRepo || repoCheck.repository.owner !== expectedRepo.owner || repoCheck.repository.repo !== expectedRepo.repo) {
      return { verified: false, reason: 'Reconciliation evidence repository does not match the target claim.' };
    }
    if (evidence.issueNumber !== expectedClaim.issueNumber) {
      return { verified: false, reason: 'Reconciliation evidence Issue number does not match the target claim.' };
    }
    if (expectedClaim.sessionId && evidence.sessions.sessionId !== expectedClaim.sessionId) {
      return { verified: false, reason: 'Reconciliation evidence must reference the exact provider session recorded on the claim.' };
    }
    if (evidence.sessions.status !== 'none' && (!Object.hasOwn(evidence.sessions, 'sessionId')
      || typeof evidence.sessions.sessionId !== 'string' || !evidence.sessions.sessionId.trim())) {
      return { verified: false, reason: 'Terminal provider-session evidence must identify the exact session inspected.' };
    }
    const claimCreatedAt = Date.parse(expectedClaim.createdAt);
    if (verifiedAtMs < claimCreatedAt) {
      return { verified: false, reason: 'Reconciliation evidence predates the claim being recovered.' };
    }
    for (const domain of domains) {
      if (Date.parse(evidence[domain.key].observedAt) < claimCreatedAt) {
        return { verified: false, reason: 'Reconciliation evidence for ' + domain.label + ' predates the claim being recovered.' };
      }
    }
    if (now !== null) {
      const nowMs = new Date(now).getTime();
      if (!Number.isFinite(nowMs) || verifiedAtMs > nowMs) {
        return { verified: false, reason: 'Reconciliation verifiedAt must be valid and cannot be in the future.' };
      }
      const maxAgeMs = 5 * 60 * 1000;
      if (nowMs - verifiedAtMs > maxAgeMs) {
        return { verified: false, reason: 'Reconciliation evidence is older than the five-minute freshness limit.' };
      }
    }
  }

  return { verified: true };
}

/**
 * Perform exact-ID claim reconciliation and recovery state transition using Compare-And-Swap.
 * Expiry alone never authorizes recovery; explicit verified evidence is required.
 *
 * @param {object} options
 * @param {object} options.stateAdapter
 * @param {string} options.claimId
 * @param {object} options.evidence
 * @param {string} [options.targetStatus=CLAIM_STATUS.RECLAIMED]
 * @param {number} [options.maxRetries=3]
 * @param {Date|string|number} [options.now=new Date()]
 * @returns {Promise<object>} Outcome report
 */
export async function reconcileAndRecoverClaim({
  stateAdapter,
  claimId,
  evidence,
  targetStatus = CLAIM_STATUS.RECLAIMED,
  maxRetries = 3,
  now = new Date()
}) {
  if (!stateAdapter || typeof stateAdapter.readState !== 'function' || typeof stateAdapter.commitStateChange !== 'function') {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'A valid stateAdapter with readState and commitStateChange methods is required.',
      nextAction: 'Provide a valid state store adapter.'
    };
  }

  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_CAS_RETRIES) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'maxRetries must be an integer between 0 and ' + MAX_CAS_RETRIES + '.',
      nextAction: 'Use a finite retry limit within the documented hard cap.'
    };
  }

  if (typeof claimId !== 'string' || !claimId.trim()) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'claimId must be a non-empty string.',
      nextAction: 'Provide a valid claim ID.'
    };
  }

  const targetId = claimId.trim();

  const evidenceCheck = validateReconciliationEvidence(evidence);
  if (!evidenceCheck.verified) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_RECOVERY_BLOCKED,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: evidenceCheck.reason,
      nextAction: 'Obtain complete verified reconciliation evidence for sessions, branches, and PRs before retrying recovery.'
    };
  }

  if (targetStatus !== CLAIM_STATUS.RELEASED && targetStatus !== CLAIM_STATUS.RECLAIMED) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'Target recovery status must be RELEASED or RECLAIMED.',
      nextAction: 'Specify RELEASED or RECLAIMED after successful reconciliation.'
    };
  }

  const currentDate = new Date(now);
  if (!Number.isFinite(currentDate.getTime())) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      safeToDispatch: false,
      reason: 'now must be a valid timestamp.',
      nextAction: 'Provide a valid timestamp and retry recovery.'
    };
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let snapshot;
    try {
      snapshot = await stateAdapter.readState();
    } catch (err) {
      const invalid = err?.code === 'INVALID_STATE_STORE';
      return {
        claim: null,
        decisionCode: invalid ? CLAIM_CODES.CLAIM_INVALID_STATE : CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'Could not read authoritative claim state: ' + String(err?.message || err),
        nextAction: invalid ? 'Repair the malformed state store before retrying.' : 'Restore state-store access and retry after read-only reconciliation.'
      };
    }
    const snapshotCheck = validateStateSnapshot(snapshot);
    if (!snapshotCheck.valid) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: snapshotCheck.reason,
        nextAction: 'Repair or reconcile invalid state records before retrying.'
      };
    }
    const { head, claims: existingClaims } = snapshot;

    const foundIndex = existingClaims.findIndex((c) => c.claimId === targetId);
    if (foundIndex === -1) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_NOT_FOUND,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'Claim ID ' + targetId + ' was not found in state store.',
        nextAction: 'Verify claim ID.'
      };
    }

    const currentClaim = existingClaims[foundIndex];
    const check = validateClaimRecord(currentClaim);
    if (!check.valid) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'Claim ID ' + targetId + ' is malformed in state store.',
        nextAction: 'Repair malformed claim record.'
      };
    }

    const scopedEvidenceCheck = validateReconciliationEvidence(evidence, currentClaim, currentDate);
    if (!scopedEvidenceCheck.verified) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_RECOVERY_BLOCKED,
        persistenceConfirmed: true,
        safeToDispatch: false,
        reason: scopedEvidenceCheck.reason,
        nextAction: 'Collect fresh, claim-scoped verification evidence for the exact repository, Issue, sessions, branches, and pull requests.'
      };
    }

    if (currentClaim.reconciliationStatus === RECONCILIATION_STATUS.RECONCILED) {
      if (currentClaim.status === targetStatus) {
        return {
          claim: currentClaim,
          decisionCode: CLAIM_CODES.CLAIM_RECOVERED,
          persistenceConfirmed: true,
          safeToDispatch: false,
          reason: 'Claim ID ' + targetId + ' was already reconciled and updated to ' + targetStatus + '.',
          nextAction: 'Claim is reconciled.'
        };
      }
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_RECOVERY_BLOCKED,
        persistenceConfirmed: true,
        safeToDispatch: false,
        reason: 'Claim ID ' + targetId + ' is already reconciled; its terminal outcome cannot be rewritten.',
        nextAction: 'Preserve the existing audit record and inspect the claim history.'
      };
    }

    if (currentDate.getTime() < Date.parse(currentClaim.expiresAt)) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_RECOVERY_BLOCKED,
        persistenceConfirmed: true,
        safeToDispatch: false,
        reason: 'Claim ID ' + targetId + ' has not expired; recovery cannot release an unexpired claim.',
        nextAction: 'Do not reclaim this Issue while its claim lease is still valid.'
      };
    }
    if (currentClaim.status !== CLAIM_STATUS.ACTIVE && currentClaim.status !== CLAIM_STATUS.EXPIRED) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_RECOVERY_BLOCKED,
        persistenceConfirmed: true,
        safeToDispatch: false,
        reason: 'Claim ID ' + targetId + ' has an inconsistent status and cannot be safely recovered.',
        nextAction: 'Inspect and manually reconcile this exact claim before recovery.'
      };
    }

    const updatedClaim = {
      ...currentClaim,
      status: targetStatus,
      reconciliationStatus: RECONCILIATION_STATUS.RECONCILED,
      updatedAt: currentDate.toISOString(),
      metadata: {
        ...(currentClaim.metadata || {}),
        reconciledAt: currentDate.toISOString(),
        reconciliationSummary: evidence?.summary || 'verified',
        reconciliationEvidence: JSON.parse(JSON.stringify(evidence))
      }
    };

    const updatedCheck = validateClaimRecord(updatedClaim);
    if (!updatedCheck.valid) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'Reconciled claim record failed schema validation.',
        nextAction: 'Fix claim parameters.'
      };
    }

    const updatedClaims = [...existingClaims];
    updatedClaims[foundIndex] = updatedClaim;

    const commitResult = await stateAdapter.commitStateChange(head, updatedClaims);

    if (commitResult.success) {
      return {
        claim: updatedClaim,
        decisionCode: CLAIM_CODES.CLAIM_RECOVERED,
        persistenceConfirmed: true,
        safeToDispatch: false,
        reason: 'Claim ' + targetId + ' successfully reconciled and set to ' + targetStatus + '.',
        nextAction: 'Issue is un-claimed and safe for future candidate selection.'
      };
    }

    if (commitResult.ambiguous || commitResult.reason === 'STORAGE_WRITE_ERROR') {
      let freshSnapshot;
      try {
        freshSnapshot = await stateAdapter.readState();
      } catch (err) {
        return {
          claim: null,
          decisionCode: CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
          persistenceConfirmed: false,
          safeToDispatch: false,
          reason: 'Reconciliation write was ambiguous and read-back failed: ' + String(err?.message || err),
          nextAction: 'Do not assume recovery succeeded; restore state access and inspect this exact claim ID.'
        };
      }
      const freshCheck = validateStateSnapshot(freshSnapshot);
      if (!freshCheck.valid) {
        return {
          claim: null,
          decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
          persistenceConfirmed: false,
          safeToDispatch: false,
          reason: 'Reconciliation read-back returned invalid state: ' + freshCheck.reason,
          nextAction: 'Stop and repair the authoritative state store before retrying.'
        };
      }
      const confirmed = freshSnapshot.claims.find((c) => c.claimId === targetId);
      const evidenceMatches = confirmed?.metadata?.reconciliationEvidence
        && JSON.stringify(confirmed.metadata.reconciliationEvidence) === JSON.stringify(evidence);
      if (confirmed
        && confirmed.reconciliationStatus === RECONCILIATION_STATUS.RECONCILED
        && confirmed.status === targetStatus
        && confirmed.updatedAt === currentDate.toISOString()
        && confirmed.metadata?.reconciledAt === currentDate.toISOString()
        && evidenceMatches) {
        return {
          claim: confirmed,
          decisionCode: CLAIM_CODES.CLAIM_RECOVERED,
          persistenceConfirmed: true,
          safeToDispatch: false,
          reason: 'Claim ' + targetId + ' reconciliation and structured evidence were confirmed in state store following write response.',
          nextAction: 'Issue is un-claimed and safe for future candidate selection.'
        };
      }

      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
        persistenceConfirmed: false,
        safeToDispatch: false,
        reason: 'Reconciliation write failed or was ambiguous and the expected claim outcome/evidence was not confirmed on read-back.',
        nextAction: 'Do not assume recovery succeeded; inspect and retry reconciliation only after authoritative state is re-read.'
      };
    }

    // CAS conflict retry
  }

  return {
    claim: null,
    decisionCode: CLAIM_CODES.CAS_CONFLICT_EXHAUSTED,
    persistenceConfirmed: false,
    safeToDispatch: false,
    reason: 'Exhausted max CAS retries (' + maxRetries + ') during claim reconciliation.',
    nextAction: 'Retry claim reconciliation after concurrent state updates settle.'
  };
}

/**
 * Safely attach a provider session ID to an existing active claim using CAS.
 * If the claim already has the exact same session ID, returns success without duplicating work.
 * If the claim already has a DIFFERENT non-null session ID, blocks with CLAIM_SESSION_CONFLICT.
 *
 * @param {object} options
 * @param {object} options.stateAdapter
 * @param {string} options.claimId
 * @param {string} options.sessionId
 * @param {number} [options.maxRetries=3]
 * @param {Date|string|number} [options.now=new Date()]
 * @returns {Promise<object>} Outcome report
 */
export async function attachSessionToClaim({
  stateAdapter,
  claimId,
  sessionId,
  metadata = null,
  maxRetries = 3,
  now = new Date()
}) {
  if (!stateAdapter || typeof stateAdapter.readState !== 'function' || typeof stateAdapter.commitStateChange !== 'function') {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      reason: 'A valid stateAdapter with readState and commitStateChange methods is required.',
      nextAction: 'Provide a valid state store adapter.'
    };
  }

  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_CAS_RETRIES) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      reason: 'maxRetries must be an integer between 0 and ' + MAX_CAS_RETRIES + '.',
      nextAction: 'Use a finite retry limit within the documented hard cap.'
    };
  }

  if (typeof claimId !== 'string' || !claimId.trim()) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      reason: 'claimId must be a non-empty string.',
      nextAction: 'Provide a valid claim ID.'
    };
  }

  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      reason: 'sessionId must be a non-empty string.',
      nextAction: 'Provide a valid provider session ID.'
    };
  }
  if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      reason: 'metadata must be an object when supplied.',
      nextAction: 'Provide validated metadata fields or omit metadata.'
    };
  }

  const targetId = claimId.trim();
  const targetSessionId = sessionId.trim();

  const currentDate = new Date(now);
  if (!Number.isFinite(currentDate.getTime())) {
    return {
      claim: null,
      decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
      persistenceConfirmed: false,
      reason: 'now must be a valid timestamp.',
      nextAction: 'Provide a valid timestamp and retry.'
    };
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let snapshot;
    try {
      snapshot = await stateAdapter.readState();
    } catch (err) {
      const invalid = err?.code === 'INVALID_STATE_STORE';
      return {
        claim: null,
        decisionCode: invalid ? CLAIM_CODES.CLAIM_INVALID_STATE : CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
        persistenceConfirmed: false,
        reason: 'Could not read authoritative claim state: ' + String(err?.message || err),
        nextAction: invalid ? 'Repair the malformed state store before retrying.' : 'Restore state-store access and retry after read-only reconciliation.'
      };
    }

    const snapshotCheck = validateStateSnapshot(snapshot);
    if (!snapshotCheck.valid) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        reason: snapshotCheck.reason,
        nextAction: 'Repair or reconcile invalid state records before retrying.'
      };
    }
    const { head, claims: existingClaims } = snapshot;

    const foundIndex = existingClaims.findIndex((c) => c.claimId === targetId);
    if (foundIndex === -1) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_NOT_FOUND,
        persistenceConfirmed: false,
        reason: 'Claim ID ' + targetId + ' was not found in state store.',
        nextAction: 'Verify claim ID.'
      };
    }

    const currentClaim = existingClaims[foundIndex];
    const check = validateClaimRecord(currentClaim);
    if (!check.valid) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        reason: 'Claim ID ' + targetId + ' is malformed in state store.',
        nextAction: 'Repair malformed claim record.'
      };
    }

    const activeCheck = isClaimActive(currentClaim, currentDate);
    if (!activeCheck.active || activeCheck.expired || currentClaim.status !== CLAIM_STATUS.ACTIVE || currentClaim.reconciliationStatus !== RECONCILIATION_STATUS.PENDING) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        reason: 'Claim ID ' + targetId + ' is not an unexpired active claim (' + (activeCheck.reason || 'inactive state') + '). Refusing to attach session.',
        nextAction: 'Ensure claim is active and unexpired before attaching provider session.'
      };
    }

    if (currentClaim.sessionId !== null && currentClaim.sessionId !== targetSessionId) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_SESSION_CONFLICT,
        persistenceConfirmed: true,
        reason: 'Claim ' + targetId + ' is already associated with a different session ID (' + currentClaim.sessionId + '). Refusing to overwrite.',
        nextAction: 'Investigate potential duplicate session creation for claim ' + targetId + '.'
      };
    }

    const mergedMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(currentClaim.metadata || {}), ...metadata }
      : (currentClaim.metadata || {});

    const updatedClaim = {
      ...currentClaim,
      sessionId: targetSessionId,
      updatedAt: currentDate.toISOString(),
      metadata: mergedMetadata
    };

    const updatedCheck = validateClaimRecord(updatedClaim);
    if (!updatedCheck.valid) {
      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
        persistenceConfirmed: false,
        reason: 'Updated claim record with session ID or lifecycle metadata failed schema validation.',
        nextAction: 'Fix claim parameters.'
      };
    }

    if (currentClaim.sessionId === targetSessionId
      && JSON.stringify(currentClaim.metadata || {}) === JSON.stringify(mergedMetadata)) {
      return {
        claim: currentClaim,
        decisionCode: CLAIM_CODES.CLAIM_SESSION_ASSOCIATED,
        persistenceConfirmed: true,
        reason: 'Claim ' + targetId + ' is already associated with session ' + targetSessionId + ' and metadata is up to date.',
        nextAction: 'Session association and lifecycle metadata are already recorded.'
      };
    }

    const updatedClaims = [...existingClaims];
    updatedClaims[foundIndex] = updatedClaim;

    let commitResult;
    try {
      commitResult = await stateAdapter.commitStateChange(head, updatedClaims);
    } catch (err) {
      commitResult = {
        success: false,
        head: null,
        reason: 'STORAGE_WRITE_EXCEPTION: ' + String(err?.message || err),
        ambiguous: true
      };
    }

    if (commitResult.success) {
      return {
        claim: updatedClaim,
        decisionCode: CLAIM_CODES.CLAIM_SESSION_ASSOCIATED,
        persistenceConfirmed: true,
        reason: 'Successfully attached session ' + targetSessionId + ' to claim ' + targetId + '.',
        nextAction: 'Proceed with session execution loop.'
      };
    }

    if (commitResult.ambiguous || commitResult.reason === 'STORAGE_WRITE_ERROR' || String(commitResult.reason).startsWith('STORAGE_WRITE_EXCEPTION')) {
      let freshSnapshot;
      try {
        freshSnapshot = await stateAdapter.readState();
      } catch (err) {
        return {
          claim: null,
          decisionCode: CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
          persistenceConfirmed: false,
          reason: 'Session attachment write was ambiguous/rejected and read-back failed: ' + String(err?.message || err),
          nextAction: 'Restore state access and verify session association for claim ' + targetId + '.'
        };
      }
      const freshCheck = validateStateSnapshot(freshSnapshot);
      if (!freshCheck.valid) {
        return {
          claim: null,
          decisionCode: CLAIM_CODES.CLAIM_INVALID_STATE,
          persistenceConfirmed: false,
          reason: 'Session attachment read-back returned invalid state: ' + freshCheck.reason,
          nextAction: 'Stop and repair the authoritative state store before retrying.'
        };
      }

      const confirmed = freshSnapshot.claims.find((c) => c.claimId === targetId);
      if (confirmed && confirmed.sessionId === targetSessionId
        && JSON.stringify(confirmed.metadata || {}) === JSON.stringify(mergedMetadata)) {
        return {
          claim: confirmed,
          decisionCode: CLAIM_CODES.CLAIM_SESSION_ASSOCIATED,
          persistenceConfirmed: true,
          reason: 'Session ' + targetSessionId + ' attachment to claim ' + targetId + ' was confirmed in state store following write response.',
          nextAction: 'Proceed with session execution loop.'
        };
      }

      return {
        claim: null,
        decisionCode: CLAIM_CODES.CLAIM_PERSISTENCE_FAILED,
        persistenceConfirmed: false,
        reason: 'Session attachment write failed or was ambiguous and the session ID was not confirmed on read-back.',
        nextAction: 'Inspect state store and retry session association if appropriate.'
      };
    }

    // CAS conflict retry
  }

  return {
    claim: null,
    decisionCode: CLAIM_CODES.CAS_CONFLICT_EXHAUSTED,
    persistenceConfirmed: false,
    reason: 'Exhausted max CAS retries (' + maxRetries + ') during session ID attachment.',
    nextAction: 'Retry session ID attachment after concurrent state updates settle.'
  };
}

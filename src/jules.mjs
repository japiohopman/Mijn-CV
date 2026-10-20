/**
 * Jules REST API adapter.
 * Communicates with the experimental Jules REST API (v1alpha) using injectable fetch.
 * Secrets/API keys are sent via X-Goog-Api-Key header and sanitized from all logs and diagnostics.
 */

import { normalizeRepositoryIdentity } from './claims.mjs';
import { fetchAllTokenPages } from './pagination.mjs';

export const JULES_DEFAULT_BASE_URL = 'https://jules.googleapis.com';

export const JULES_STATE_NORMALIZED = Object.freeze({
  QUEUED: 'QUEUED',
  ACTIVE: 'ACTIVE',
  AWAITING_INPUT: 'AWAITING_INPUT',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Normalize documented Jules session state.
 * Documented states: QUEUED, PLANNING, AWAITING_PLAN_APPROVAL, AWAITING_USER_FEEDBACK, IN_PROGRESS, PAUSED, COMPLETED, FAILED.
 *
 * @param {string} rawState
 * @returns {string} Normalized status string
 */
export function normalizeJulesState(rawState) {
  if (typeof rawState !== 'string' || !rawState.trim()) {
    return JULES_STATE_NORMALIZED.UNKNOWN;
  }
  const upper = rawState.trim().toUpperCase();
  switch (upper) {
    case 'QUEUED':
      return JULES_STATE_NORMALIZED.QUEUED;
    case 'PLANNING':
    case 'IN_PROGRESS':
      return JULES_STATE_NORMALIZED.ACTIVE;
    case 'AWAITING_PLAN_APPROVAL':
    case 'AWAITING_USER_FEEDBACK':
      return JULES_STATE_NORMALIZED.AWAITING_INPUT;
    case 'PAUSED':
      return JULES_STATE_NORMALIZED.PAUSED;
    case 'COMPLETED':
      return JULES_STATE_NORMALIZED.COMPLETED;
    case 'FAILED':
      return JULES_STATE_NORMALIZED.FAILED;
    default:
      return JULES_STATE_NORMALIZED.UNKNOWN;
  }
}

/**
 * Sanitize error message to ensure no API key or authorization header is exposed.
 * @param {Error|string} err
 * @param {string} apiKey
 * @returns {string} Safe error string
 */
export function sanitizeJulesErrorMessage(err, apiKey = '') {
  let msg = typeof err === 'string' ? err : String(err?.message || err);
  if (apiKey && apiKey.length > 3) {
    msg = msg.replaceAll(apiKey, '[REDACTED]');
  }
  msg = msg.replace(/X-Goog-Api-Key:\s*[^\s\r\n]+/gi, 'X-Goog-Api-Key: [REDACTED]');
  msg = msg.replace(/x-goog-api-key=[^&\s]+/gi, 'x-goog-api-key=[REDACTED]');
  return msg;
}

export class JulesClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey API key for Jules REST API
   * @param {Function} [options.fetchImpl] Injectable fetch implementation
   * @param {string} [options.baseUrl] Base URL for Jules REST API
   */
  constructor({ apiKey, fetchImpl = globalThis.fetch, baseUrl = JULES_DEFAULT_BASE_URL } = {}) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Jules API key is required and must be a non-empty string.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('A valid fetch implementation function is required.');
    }

    this.apiKey = apiKey.trim();
    this.fetchImpl = fetchImpl;
    this.baseUrl = (baseUrl || JULES_DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async _request(pathAndQuery, options = {}) {
    const url = this.baseUrl + (pathAndQuery.startsWith('/') ? pathAndQuery : '/' + pathAndQuery);
    const headers = {
      'Accept': 'application/json',
      'X-Goog-Api-Key': this.apiKey,
      ...(options.headers || {})
    };

    if (options.body && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
    }

    const timeoutMs = options.timeoutMs ?? 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', () => controller.abort());
    }

    let response;
    try {
      response = await this.fetchImpl(url, {
        ...options,
        headers,
        body: options.body && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body,
        redirect: 'error',
        signal: controller.signal
      });
    } catch (err) {
      const safeMsg = sanitizeJulesErrorMessage(err, this.apiKey);
      const networkError = new Error('Jules API network error: ' + safeMsg);
      networkError.isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.code === 'UND_ERR_CONNECT_TIMEOUT';
      networkError.code = networkError.isTimeout ? 'JULES_REQUEST_TIMEOUT' : 'JULES_NETWORK_ERROR';
      throw networkError;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorBodyText = '';
      try {
        errorBodyText = await response.text();
      } catch {
        // ignore body read error
      }
      const safeBody = sanitizeJulesErrorMessage(errorBodyText, this.apiKey);
      const err = new Error(`Jules API HTTP error ${response.status}: ${safeBody || response.statusText}`);
      err.code = 'JULES_HTTP_ERROR';
      err.status = response.status;
      throw err;
    }

    // SendMessageResponse and other successful Jules actions may have an empty body.
    // Treat an empty 2xx body as accepted, but never swallow malformed non-empty JSON.
    if (response.status === 204) return null;
    if (typeof response.text === 'function') {
      let bodyText;
      try {
        bodyText = await response.text();
      } catch {
        bodyText = null;
      }
      if (typeof bodyText === 'string') {
        if (!bodyText.trim()) return null;
        try {
          return JSON.parse(bodyText);
        } catch (err) {
          const errRes = new Error('Failed to parse Jules API JSON response: ' + sanitizeJulesErrorMessage(err, this.apiKey));
          errRes.code = 'JULES_MALFORMED_RESPONSE';
          throw errRes;
        }
      }
    }
    try {
      return await response.json();
    } catch (err) {
      const errRes = new Error('Failed to parse Jules API JSON response: ' + sanitizeJulesErrorMessage(err, this.apiKey));
      errRes.code = 'JULES_MALFORMED_RESPONSE';
      throw errRes;
    }
  }

  /**
   * List all available sources following pagination nextPageToken.
   * @returns {Promise<Array<object>>} List of source records
   */
  async listSources() {
    const sources = await fetchAllTokenPages(
      (path) => this._request(path, { method: 'GET' }),
      {
        firstPath: '/v1alpha/sources',
        collectionKey: 'sources',
        pageSize: 50
      }
    );
    if (!sources.every((source) => source && typeof source === 'object' && !Array.isArray(source)
      && typeof source.name === 'string' && source.name.trim())) {
      const err = new Error('Jules source list contains an incomplete source record.');
      err.code = 'JULES_MALFORMED_RESPONSE';
      throw err;
    }
    return sources;
  }

  /**
   * Get full details for a single source by name or ID.
   * GET /v1alpha/sources/{sourceId}
   * @param {string} sourceNameOrId Resource name (e.g. 'sources/github/owner/repo') or ID
   * @returns {Promise<object>} Full source record
   */
  async getSource(sourceNameOrId) {
    if (typeof sourceNameOrId !== 'string' || !sourceNameOrId.trim()) {
      throw new Error('sourceNameOrId is required.');
    }
    const path = sourceNameOrId.startsWith('sources/')
      ? '/v1alpha/' + sourceNameOrId.trim()
      : '/v1alpha/sources/' + encodeURIComponent(sourceNameOrId.trim());

    const res = await this._request(path, { method: 'GET' });
    if (!res || typeof res !== 'object' || Array.isArray(res)) {
      const err = new Error('Jules getSource returned non-object response.');
      err.code = 'JULES_MALFORMED_RESPONSE';
      throw err;
    }
    return res;
  }

  /**
   * Find source for exact repository identity (owner/repo) and verify starting branch exists.
   * If branch information is missing on summary list item, fetches full source details using `getSource`.
   * @param {*} repository
   * @param {string} [startingBranch] Optional starting branch to verify
   * @returns {Promise<object|null>} Matched source object or null
   */
  async findSourceForRepository(repository, startingBranch = null) {
    const repoCheck = normalizeRepositoryIdentity(repository);
    if (!repoCheck.valid) {
      throw new Error('Invalid repository identity provided for source lookup.');
    }
    const target = repoCheck.repository;
    const sources = await this.listSources();

    for (const srcSummary of sources) {
      const srcOwner = srcSummary?.githubRepo?.owner;
      const srcRepo = srcSummary?.githubRepo?.repo;
      if (typeof srcOwner === 'string' && typeof srcRepo === 'string') {
        if (srcOwner.trim().toLowerCase() === target.owner && srcRepo.trim().toLowerCase() === target.repo) {
          if (!srcSummary.name) return null;

          let fullSource;
          try {
            fullSource = await this.getSource(srcSummary.name);
          } catch {
            return null;
          }

          const fullOwner = fullSource?.githubRepo?.owner;
          const fullRepo = fullSource?.githubRepo?.repo;
          if (fullSource?.name !== srcSummary.name
            || typeof fullOwner !== 'string'
            || typeof fullRepo !== 'string'
            || fullOwner.trim().toLowerCase() !== target.owner
            || fullRepo.trim().toLowerCase() !== target.repo) {
            return null;
          }

          if (startingBranch) {
            const targetBranch = startingBranch.trim();
            const branches = Array.isArray(fullSource?.githubRepo?.branches)
              ? fullSource.githubRepo.branches
              : (Array.isArray(fullSource?.branches) ? fullSource.branches : null);

            if (!branches || branches.length === 0) {
              return null;
            }

            const hasBranch = branches.some((b) => {
              const bName = typeof b === 'string' ? b : (b?.displayName || b?.name || '');
              return bName.trim() === targetBranch;
            });

            if (!hasBranch) {
              return null;
            }
          }
          return fullSource;
        }
      }
    }
    return null;
  }

  /**
   * Create a new session on Jules API.
   *
   * @param {object} options
   * @param {string} options.sourceName Resource name of source (e.g., 'sources/github/owner/repo')
   * @param {string} options.startingBranch Starting branch name
   * @param {string} options.prompt Safe task prompt (must contain correlation marker)
   * @param {string} options.title Session title
   * @returns {Promise<object>} Created session object
   */
  async createSession({ sourceName, startingBranch, prompt, title }) {
    if (typeof sourceName !== 'string' || !sourceName.trim()) {
      throw new Error('sourceName is required to create a Jules session.');
    }
    if (typeof startingBranch !== 'string' || !startingBranch.trim()) {
      throw new Error('startingBranch is required to create a Jules session.');
    }
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('prompt is required to create a Jules session.');
    }

    const payload = {
      prompt: prompt.trim(),
      title: typeof title === 'string' && title.trim() ? title.trim() : undefined,
      sourceContext: {
        source: sourceName.trim(),
        githubRepoContext: {
          startingBranch: startingBranch.trim()
        }
      },
      requirePlanApproval: true
    };

    const res = await this._request('/v1alpha/sessions', {
      method: 'POST',
      body: payload
    });

    if (!res || typeof res !== 'object' || Array.isArray(res)) {
      const err = new Error('Jules session creation returned an invalid non-object response.');
      err.code = 'JULES_MALFORMED_RESPONSE';
      throw err;
    }

    const sessionId = typeof res.id === 'string' && res.id.trim() ? res.id.trim()
      : (typeof res.name === 'string' && res.name.includes('/') ? res.name.split('/').pop().trim() : null);

    if (!sessionId) {
      const err = new Error('Jules session creation response did not contain a valid session ID.');
      err.code = 'JULES_MALFORMED_RESPONSE';
      throw err;
    }

    return {
      ...res,
      id: sessionId,
      normalizedState: normalizeJulesState(res.state)
    };
  }

  /**
   * List sessions with optional pageSize and pageToken, handling pagination.
   * @param {object} [options]
   * @param {number} [options.maxPages=20]
   * @returns {Promise<Array<object>>} List of session objects
   */
  async listSessions() {
    const sessions = await fetchAllTokenPages(
      (path) => this._request(path, { method: 'GET' }),
      {
        firstPath: '/v1alpha/sessions',
        collectionKey: 'sessions',
        pageSize: 50
      }
    );

    return sessions.map((s) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        const err = new Error('Jules session list contains a malformed session record.');
        err.code = 'JULES_MALFORMED_RESPONSE';
        throw err;
      }
      const id = typeof s.id === 'string' && s.id.trim() ? s.id.trim()
        : (typeof s.name === 'string' && s.name.includes('/') ? s.name.split('/').pop().trim() : null);
      if (!id || typeof s.state !== 'string' || !s.state.trim()
        || (typeof s.prompt !== 'string' && typeof s.title !== 'string')) {
        const err = new Error('Jules session list contains an incomplete session record.');
        err.code = 'JULES_MALFORMED_RESPONSE';
        throw err;
      }
      return { ...s, id, normalizedState: normalizeJulesState(s.state) };
    });
  }

  /**
   * Get a single session by ID.
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  /**
   * Send a follow-up to an existing active session. Callers must first verify
   * repository/source, claim/session correlation, lifecycle state, and explicit
   * pilot/config gates. This method never creates a session.
   *
   * Jules API: POST /v1alpha/sessions/{sessionId}:sendMessage
   */
  async sendMessage(sessionId, prompt) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('sessionId is required to send a Jules message.');
    }
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('prompt is required to send a Jules message.');
    }
    const cleanId = sessionId.trim();
    const response = await this._request(
      '/v1alpha/sessions/' + encodeURIComponent(cleanId) + ':sendMessage',
      { method: 'POST', body: { prompt: prompt.trim() } }
    );
    return { accepted: true, sessionId: cleanId, response };
  }

  async getSession(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('sessionId is required.');
    }
    const cleanId = sessionId.trim();
    const res = await this._request('/v1alpha/sessions/' + encodeURIComponent(cleanId), { method: 'GET' });
    if (!res || typeof res !== 'object' || Array.isArray(res)) {
      const err = new Error('Jules getSession returned non-object response.');
      err.code = 'JULES_MALFORMED_RESPONSE';
      throw err;
    }
    const reportedId = typeof res.id === 'string' && res.id.trim()
      ? res.id.trim()
      : (typeof res.name === 'string' && res.name.includes('/') ? res.name.split('/').pop().trim() : null);
    const sourceName = res.sourceContext?.source;
    const startingBranch = res.sourceContext?.githubRepoContext?.startingBranch;
    if (reportedId !== cleanId || typeof sourceName !== 'string' || !sourceName.trim()
      || typeof startingBranch !== 'string' || !startingBranch.trim()) {
      const err = new Error('Jules getSession returned incomplete or mismatched session identity/source context.');
      err.code = 'JULES_MALFORMED_RESPONSE';
      throw err;
    }
    return {
      ...res,
      id: cleanId,
      normalizedState: normalizeJulesState(res.state)
    };
  }
}

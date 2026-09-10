(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SecretaryLLMAdapter = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const ALLOWED_INTENT_IDS = [
    'identity.overview',
    'projects.list',
    'projects.artificer',
    'projects.conquest',
    'skills.overview',
    'background.culinary_bridge',
    'contact.options',
    'route.share',
    'fallback.unknown'
  ];

  class SecretaryLLMAdapter {
    /**
     * @param {Object} options Configuration options
     * @param {Object} [options.secretaryEngine] Instance of SecretaryEngine for fact resolution and fallback
     * @param {Function} [options.llmProvider] Custom async function (prompt) => Promise<string|Object>
     * @param {string} [options.apiKey] Optional API key (if using direct client proxy, though server-side proxy is recommended)
     * @param {string} [options.endpoint] Optional LLM endpoint URL
     * @param {number} [options.timeoutMs=3000] Request timeout in milliseconds
     * @param {boolean} [options.enabled=false] Whether LLM adapter is explicitly enabled
     */
    constructor(options = {}) {
      this.secretaryEngine = options.secretaryEngine || null;
      this.llmProvider = options.llmProvider || null;
      this.apiKey = options.apiKey || null;
      this.endpoint = options.endpoint || null;
      this.timeoutMs = options.timeoutMs || 3000;
      this.enabled = Boolean(options.enabled && (options.llmProvider || options.endpoint));
    }

    /**
     * Constructs the system prompt detailing allowed intent IDs and output constraints.
     * @returns {string} System prompt
     */
    buildSystemPrompt() {
      return [
        'You are the intent classification adapter for Jaap Hopman\'s Portfolio Secretary.',
        'Your sole task is to analyze user natural language input and map it to exactly one allowed intent ID.',
        'STRICT RULES:',
        '1. You MUST respond with ONLY a valid JSON object matching: {"intentId": "<INTENT_ID>"}',
        '2. You MUST select <INTENT_ID> from this exact allow-list:',
        `   [${ALLOWED_INTENT_IDS.map(id => `"${id}"`).join(', ')}]`,
        '3. DO NOT invent facts, URLs, tools, or intents outside the allow-list.',
        '4. If the query does not clearly match any allowed intent, respond with {"intentId": "fallback.unknown"}.'
      ].join('\n');
    }

    /**
     * Validates that an intent ID is allowed by the canonical registry.
     * @param {string} intentId
     * @returns {boolean}
     */
    isAllowedIntentId(intentId) {
      return typeof intentId === 'string' && ALLOWED_INTENT_IDS.includes(intentId);
    }

    /**
     * Processes natural language input via optional LLM provider with strict grounding and deterministic fallback.
     * @param {string} rawInput User input
     * @returns {Promise<Object>} SecretaryQueryResponse object grounded in canonical knowledge registry
     */
    async processQuery(rawInput) {
      // If adapter is disabled or missing provider/engine, fall back immediately to deterministic matcher
      if (!this.enabled || !this.secretaryEngine) {
        return this.fallback(rawInput);
      }

      try {
        const systemPrompt = this.buildSystemPrompt();
        let rawResponseText = null;

        if (typeof this.llmProvider === 'function') {
          // Use provided custom provider function with timeout protection
          const providerPromise = this.llmProvider({
            systemPrompt,
            userInput: rawInput,
            apiKey: this.apiKey
          });

          rawResponseText = await this.withTimeout(providerPromise, this.timeoutMs);
        } else if (this.endpoint) {
          // Use fetch endpoint with timeout protection
          const fetchPromise = this.fetchLLMEndpoint(rawInput, systemPrompt);
          rawResponseText = await this.withTimeout(fetchPromise, this.timeoutMs);
        } else {
          return this.fallback(rawInput);
        }

        // Parse LLM response
        const parsed = this.parseLLMResponse(rawResponseText);

        if (parsed && parsed.intentId && this.isAllowedIntentId(parsed.intentId)) {
          // Fact authorization: retrieve grounded answer and tool call strictly from SecretaryEngine
          const groundedResponse = this.secretaryEngine.getIntentById(parsed.intentId);

          if (groundedResponse) {
            return {
              ...groundedResponse,
              adapterSource: 'llm_adapter'
            };
          }
        }

        // If parsed intent is invalid or unknown, fall back
        return this.fallback(rawInput);
      } catch (err) {
        // Any timeout, network error, or parsing failure falls back safely
        return this.fallback(rawInput);
      }
    }

    /**
     * Parses JSON from raw LLM output text.
     * @param {string|Object} rawOutput
     * @returns {Object|null}
     */
    parseLLMResponse(rawOutput) {
      if (!rawOutput) return null;
      if (typeof rawOutput === 'object') return rawOutput;

      try {
        // Strip markdown codeblocks if present (e.g. ```json ... ```)
        const cleaned = String(rawOutput)
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        return JSON.parse(cleaned);
      } catch (err) {
        return null;
      }
    }

    /**
     * Executes fetch request to an external/proxy endpoint with privacy header checks.
     * @param {string} userInput
     * @param {string} systemPrompt
     * @returns {Promise<string>}
     */
    async fetchLLMEndpoint(userInput, systemPrompt) {
      if (typeof fetch === 'undefined') {
        throw new Error('fetch is not available in environment');
      }

      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: `${systemPrompt}\n\nUser input: "${userInput}"`
        })
      });

      if (!res.ok) {
        throw new Error(`LLM endpoint returned status ${res.status}`);
      }

      const data = await res.json();
      return data.output || data.response || data.choices?.[0]?.message?.content || JSON.stringify(data);
    }

    /**
     * Wraps a promise in a timeout.
     * @param {Promise} promise
     * @param {number} ms
     * @returns {Promise}
     */
    withTimeout(promise, ms) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`LLM Adapter request timed out after ${ms}ms`));
        }, ms);

        promise
          .then(res => {
            clearTimeout(timer);
            resolve(res);
          })
          .catch(err => {
            clearTimeout(timer);
            reject(err);
          });
      });
    }

    /**
     * Performs fallback query against deterministic SecretaryEngine matcher.
     * @param {string} rawInput
     * @returns {Object}
     */
    fallback(rawInput) {
      if (this.secretaryEngine && typeof this.secretaryEngine.matchIntent === 'function') {
        return this.secretaryEngine.matchIntent(rawInput);
      }
      return {
        matchedIntentId: 'fallback.unknown',
        confidenceScore: 0.0,
        answerText: 'Ik kan deze vraag momenteel niet verwerken.',
        sourceFile: 'SECRETARY_ARCHITECTURE.md'
      };
    }
  }

  SecretaryLLMAdapter.ALLOWED_INTENT_IDS = ALLOWED_INTENT_IDS;

  return SecretaryLLMAdapter;
}));

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SecretaryEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const ALLOWED_TOOLS = [
    'navigateToSection',
    'navigateToRoute',
    'openProject',
    'openKitchenCV',
    'openShare'
  ];

  const ALLOWED_ANCHORS = [
    '#over',
    '#projecten',
    '#skills',
    '#ervaring',
    '#contact'
  ];

  const ALLOWED_ROUTES = [
    '/',
    '/share',
    '/keuken-cv'
  ];

  const ALLOWED_PROJECT_IDS = [
    'artificer',
    'global-conquest',
    'supermail'
  ];

  /**
   * Validates tool call payload against JSON schema rules defined in SECRETARY_ARCHITECTURE.md
   * @param {Object} toolCall
   * @returns {boolean}
   */
  function validateToolCall(toolCall) {
    if (!toolCall || typeof toolCall !== 'object') return false;
    if (!ALLOWED_TOOLS.includes(toolCall.tool)) return false;

    const params = toolCall.parameters || {};

    switch (toolCall.tool) {
      case 'navigateToSection':
        return typeof params.anchor === 'string' && ALLOWED_ANCHORS.includes(params.anchor);
      case 'navigateToRoute':
        return typeof params.route === 'string' && ALLOWED_ROUTES.includes(params.route);
      case 'openProject':
        return typeof params.projectId === 'string' && ALLOWED_PROJECT_IDS.includes(params.projectId);
      case 'openKitchenCV':
      case 'openShare':
        return true;
      default:
        return false;
    }
  }

  /**
   * Normalizes text input by lowercasing, trimming, and stripping punctuation.
   * @param {string} input
   * @returns {string}
   */
  function normalizeInput(input) {
    if (typeof input !== 'string') return '';
    return input
      .toLowerCase()
      .trim()
      .replace(/[?.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  class SecretaryEngine {
    /**
     * @param {Object} knowledgeData Parsed contents of secretary_knowledge.json
     * @param {Object} options Configuration options
     */
    constructor(knowledgeData, options = {}) {
      if (!knowledgeData || !Array.isArray(knowledgeData.intents)) {
        throw new Error('Invalid knowledge data provided to SecretaryEngine.');
      }
      this.knowledgeData = knowledgeData;
      this.confidenceThreshold = options.confidenceThreshold || 0.35;
      this.llmAdapter = options.llmAdapter || null;
    }

    /**
     * Retrieves grounded intent response by Intent ID directly from knowledge base.
     * @param {string} intentId
     * @returns {Object|null}
     */
    getIntentById(intentId) {
      if (intentId === 'fallback.unknown') {
        return this.getFallbackResponse();
      }

      const intent = this.knowledgeData.intents.find(i => i.intentId === intentId);
      if (!intent) return null;

      const validatedToolCall = (intent.toolCall && validateToolCall(intent.toolCall))
        ? intent.toolCall
        : undefined;

      return {
        matchedIntentId: intent.intentId,
        confidenceScore: 0.95,
        answerText: intent.answerText,
        sourceFile: intent.knowledgeSource,
        toolCall: validatedToolCall,
        suggestedQuestions: intent.suggestedFollowUps || []
      };
    }

    /**
     * Evaluates query input against the intent catalog.
     * @param {string} rawInput
     * @returns {Object} SecretaryQueryResponse object
     */
    matchIntent(rawInput) {
      const normalized = normalizeInput(rawInput);
      if (!normalized) {
        return this.getFallbackResponse();
      }

      let bestMatch = null;
      let highestScore = 0;

      for (const intent of this.knowledgeData.intents) {
        let score = 0;

        // 1. RegEx pattern evaluation (High priority: 0.85 base score)
        if (Array.isArray(intent.patterns)) {
          for (const patternStr of intent.patterns) {
            try {
              const regex = new RegExp(patternStr, 'i');
              if (regex.test(normalized) || regex.test(rawInput)) {
                score = Math.max(score, 0.85);
                break;
              }
            } catch (err) {
              // Ignore invalid regex string in dataset
            }
          }
        }

        // 2. Keyword match evaluation (Score based on matching keyword density)
        if (Array.isArray(intent.keywords)) {
          let keywordMatches = 0;
          for (const keyword of intent.keywords) {
            const normalizedKeyword = normalizeInput(keyword);
            if (normalizedKeyword && normalized.includes(normalizedKeyword)) {
              keywordMatches++;
            }
          }
          if (keywordMatches > 0) {
            const keywordScore = Math.min(0.75, 0.35 + (keywordMatches * 0.15));
            score = Math.max(score, keywordScore);
          }
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = intent;
        }
      }

      if (!bestMatch || highestScore < this.confidenceThreshold) {
        return this.getFallbackResponse();
      }

      const validatedToolCall = (bestMatch.toolCall && validateToolCall(bestMatch.toolCall))
        ? bestMatch.toolCall
        : undefined;

      return {
        matchedIntentId: bestMatch.intentId,
        confidenceScore: Number(highestScore.toFixed(2)),
        answerText: bestMatch.answerText,
        sourceFile: bestMatch.knowledgeSource,
        toolCall: validatedToolCall,
        suggestedQuestions: bestMatch.suggestedFollowUps || []
      };
    }

    /**
     * Asynchronously processes input, checking optional LLM Adapter first before falling back to matchIntent.
     * @param {string} rawInput
     * @returns {Promise<Object>}
     */
    async processQuery(rawInput) {
      if (this.llmAdapter && typeof this.llmAdapter.processQuery === 'function') {
        try {
          return await this.llmAdapter.processQuery(rawInput);
        } catch (err) {
          return this.matchIntent(rawInput);
        }
      }
      return this.matchIntent(rawInput);
    }

    /**
     * Returns standard transparent fallback response when confidence threshold is not met.
     * @returns {Object}
     */
    getFallbackResponse() {
      const fb = this.knowledgeData.fallback || {};
      return {
        matchedIntentId: fb.intentId || 'fallback.unknown',
        confidenceScore: 0.0,
        answerText: fb.answerText || 'Ik kan deze specifieke vraag niet direct beantwoorden.',
        sourceFile: fb.knowledgeSource || 'SECRETARY_ARCHITECTURE.md',
        suggestedQuestions: fb.suggestedQuestions || [
          'Wat doet Jaap?',
          'Welke projecten heeft hij?',
          'Heeft hij ook een keuken-CV?',
          'Hoe neem ik contact op?'
        ]
      };
    }
  }

  /**
   * Executes a validated tool call action against the DOM / browser environment.
   * @param {Object} toolCall The validated tool call payload
   * @param {Object} [options] Optional context overrides (e.g. for testing)
   * @returns {Object} Execution result status { success: boolean, action: string, details?: string }
   */
  function executeToolCall(toolCall, options = {}) {
    if (!validateToolCall(toolCall)) {
      return { success: false, action: 'none', details: 'Invalid tool call payload' };
    }

    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const doc = options.document || (typeof document !== 'undefined' ? document : null);

    if (!win || !doc) {
      return { success: false, action: 'none', details: 'No DOM window context available' };
    }

    const params = toolCall.parameters || {};

    switch (toolCall.tool) {
      case 'navigateToSection': {
        const anchor = params.anchor;
        const targetEl = doc.querySelector(anchor);

        // If on a different route than '/', perform navigation to '/' with anchor
        if (!targetEl && win.location && win.location.pathname !== '/') {
          win.location.href = '/' + anchor;
          return { success: true, action: 'redirect', details: `Redirecting to /${anchor}` };
        }

        if (targetEl) {
          const prefersReducedMotion = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
          targetEl.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
          if (win.history && win.history.pushState) {
            win.history.pushState(null, '', anchor);
          }
          targetEl.focus && targetEl.focus({ preventScroll: true });
          return { success: true, action: 'scrollToSection', details: `Scrolled to ${anchor}` };
        }

        return { success: false, action: 'navigateToSection', details: `Element ${anchor} not found` };
      }

      case 'navigateToRoute': {
        const route = params.route;
        if (win.location) {
          win.location.href = route;
          return { success: true, action: 'navigateToRoute', details: `Navigated to ${route}` };
        }
        return { success: false, action: 'navigateToRoute', details: 'Location context unavailable' };
      }

      case 'openProject': {
        const projectId = params.projectId;
        const selectorMap = {
          'artificer': '.artificer-card',
          'global-conquest': '.conquest-card',
          'supermail': '.supermail-card'
        };

        const targetSelector = selectorMap[projectId] || `#${projectId}`;
        const cardEl = doc.querySelector(targetSelector);

        if (!cardEl && win.location && win.location.pathname !== '/') {
          win.location.href = `/#projecten`;
          return { success: true, action: 'redirect', details: `Redirecting to main portfolio project section` };
        }

        if (cardEl) {
          const prefersReducedMotion = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
          cardEl.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center' });

          // Expand details if available and collapsed
          const detailsEl = cardEl.querySelector('details');
          if (detailsEl && !detailsEl.open) {
            detailsEl.open = true;
          }

          // Visual highlight
          cardEl.classList.add('assistant-highlight');
          setTimeout(() => {
            cardEl.classList.remove('assistant-highlight');
          }, 2500);

          return { success: true, action: 'openProject', details: `Focused project card ${projectId}` };
        }

        return { success: false, action: 'openProject', details: `Project ${projectId} element not found` };
      }

      case 'openKitchenCV': {
        if (win.location) {
          win.location.href = '/keuken-cv';
          return { success: true, action: 'openKitchenCV', details: 'Navigated to /keuken-cv' };
        }
        return { success: false, action: 'openKitchenCV', details: 'Location context unavailable' };
      }

      case 'openShare': {
        if (win.location) {
          win.location.href = '/share';
          return { success: true, action: 'openShare', details: 'Navigated to /share' };
        }
        return { success: false, action: 'openShare', details: 'Location context unavailable' };
      }

      default:
        return { success: false, action: 'none', details: 'Unknown tool' };
    }
  }

  SecretaryEngine.validateToolCall = validateToolCall;
  SecretaryEngine.executeToolCall = executeToolCall;

  return SecretaryEngine;
}));

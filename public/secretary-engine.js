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

  SecretaryEngine.validateToolCall = validateToolCall;

  return SecretaryEngine;
}));

const fs = require('fs');
const path = require('path');
const SecretaryEngine = require('../public/secretary-engine.js');
const SecretaryLLMAdapter = require('../public/secretary-llm-adapter.js');

console.log('Testing Secretary Engine, Knowledge Registry, LLM Adapter & Content Governance...');

// Load knowledge JSON
const knowledgePath = path.join(__dirname, '../public/data/secretary_knowledge.json');
const knowledgeData = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));

const engine = new SecretaryEngine(knowledgeData);

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`✓ ${description}`);
    totalPassed++;
  } else {
    console.error(`✗ ${description}`);
    totalFailed++;
  }
}

// 1. Core Intent Matcher Test Cases
const testCases = [
  {
    query: 'Wat doet Jaap?',
    expectedIntent: 'identity.overview',
    expectedTool: 'navigateToSection',
    expectedParam: '#over'
  },
  {
    query: 'wie is Jaap Hopman?',
    expectedIntent: 'identity.overview',
    expectedTool: 'navigateToSection',
    expectedParam: '#over'
  },
  {
    query: 'welke projecten heeft hij gebouwd?',
    expectedIntent: 'projects.list',
    expectedTool: 'navigateToSection',
    expectedParam: '#projecten'
  },
  {
    query: 'Vertel over Artificer D&D engine',
    expectedIntent: 'projects.artificer',
    expectedTool: 'openProject',
    expectedParam: 'artificer'
  },
  {
    query: 'heeft hij ook Global Conquest gebouwd?',
    expectedIntent: 'projects.conquest',
    expectedTool: 'openProject',
    expectedParam: 'global-conquest'
  },
  {
    query: 'welke skills en tech stack gebruikt hij?',
    expectedIntent: 'skills.overview',
    expectedTool: 'navigateToSection',
    expectedParam: '#skills'
  },
  {
    query: 'heeft hij ook ervaring in de keuken / horeca?',
    expectedIntent: 'background.culinary_bridge',
    expectedTool: 'openKitchenCV',
    expectedParam: undefined
  },
  {
    query: 'hoe neem ik contact op per e-mail?',
    expectedIntent: 'contact.options',
    expectedTool: 'navigateToSection',
    expectedParam: '#contact'
  },
  {
    query: 'waar vind ik de QR code of share pagina?',
    expectedIntent: 'route.share',
    expectedTool: 'openShare',
    expectedParam: undefined
  }
];

console.log('\nEvaluating Enumerated Intent Matcher Queries...');
for (const tc of testCases) {
  const res = engine.matchIntent(tc.query);
  assert(
    res.matchedIntentId === tc.expectedIntent,
    `Query "${tc.query}" matched intent "${res.matchedIntentId}" (expected "${tc.expectedIntent}")`
  );
  assert(
    res.confidenceScore >= 0.35,
    `Query "${tc.query}" confidence score ${res.confidenceScore} >= 0.35`
  );
  assert(
    res.answerText && res.answerText.length > 20,
    `Query "${tc.query}" returned grounded answer text`
  );
  assert(
    res.sourceFile && res.sourceFile.length > 0,
    `Query "${tc.query}" returned source file mapping (${res.sourceFile})`
  );
  if (tc.expectedTool) {
    assert(
      res.toolCall && res.toolCall.tool === tc.expectedTool,
      `Query "${tc.query}" triggered tool call "${res.toolCall ? res.toolCall.tool : 'none'}" (expected "${tc.expectedTool}")`
    );
    if (tc.expectedParam) {
      const firstParamVal = Object.values(res.toolCall.parameters || {})[0];
      assert(
        firstParamVal === tc.expectedParam,
        `Tool call parameter "${firstParamVal}" matched expected "${tc.expectedParam}"`
      );
    }
  }
}

// 2. Fallback Handling Test Case
console.log('\nEvaluating Transparent Fallback Handler...');
const fallbackRes = engine.matchIntent('Wat is de weersverwachting in Tokio morgen?');
assert(
  fallbackRes.matchedIntentId === 'fallback.unknown',
  `Unsupported query returned fallback intent "${fallbackRes.matchedIntentId}"`
);
assert(
  fallbackRes.confidenceScore === 0.0,
  `Fallback response confidence score is 0.0`
);
assert(
  Array.isArray(fallbackRes.suggestedQuestions) && fallbackRes.suggestedQuestions.length >= 3,
  `Fallback response includes suggested follow-up questions`
);

// 3. Tool Call Schema Validation Unit Tests
console.log('\nEvaluating Tool Call Validation Allow-List...');
assert(
  SecretaryEngine.validateToolCall({ tool: 'navigateToSection', parameters: { anchor: '#over' } }) === true,
  'navigateToSection with valid anchor #over is valid'
);
assert(
  SecretaryEngine.validateToolCall({ tool: 'navigateToSection', parameters: { anchor: '#invalidAnchor' } }) === false,
  'navigateToSection with unallowed anchor #invalidAnchor is rejected'
);
assert(
  SecretaryEngine.validateToolCall({ tool: 'openProject', parameters: { projectId: 'artificer' } }) === true,
  'openProject with valid projectId artificer is valid'
);
assert(
  SecretaryEngine.validateToolCall({ tool: 'openProject', parameters: { projectId: 'unauthorized-project' } }) === false,
  'openProject with unauthorized projectId is rejected'
);
assert(
  SecretaryEngine.validateToolCall({ tool: 'executeScript', parameters: { code: 'alert(1)' } }) === false,
  'Arbitrary tool executeScript is strictly rejected'
);

// 4. Tool Execution Engine (executeToolCall) Unit Tests
console.log('\nEvaluating Tool Execution Engine (executeToolCall)...');

// Mock DOM elements & window environment
let mockLocationHref = '/';
let mockPushedState = null;
let scrolledElements = [];
let focusedElements = [];

function createMockElement(selector) {
  let isDetailsOpen = false;
  let classes = new Set();

  return {
    selector,
    scrollIntoView: function(opts) {
      scrolledElements.push({ selector, opts });
    },
    focus: function(opts) {
      focusedElements.push({ selector, opts });
    },
    get open() {
      return isDetailsOpen;
    },
    set open(val) {
      isDetailsOpen = val;
    },
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      contains: (cls) => classes.has(cls)
    },
    querySelector: function(subSelector) {
      if (subSelector === 'details') {
        return {
          get open() { return isDetailsOpen; },
          set open(val) { isDetailsOpen = val; }
        };
      }
      return null;
    }
  };
}

const mockDoc = {
  querySelector: function(selector) {
    if (mockLocationHref !== '/') {
      return null;
    }
    if (['#over', '#projecten', '#skills', '#ervaring', '#contact', '.artificer-card', '.conquest-card', '.supermail-card'].includes(selector)) {
      return createMockElement(selector);
    }
    return null;
  }
};

const mockWin = {
  location: {
    get pathname() { return mockLocationHref; },
    set href(val) { mockLocationHref = val; }
  },
  history: {
    pushState: function(state, title, url) {
      mockPushedState = { state, title, url };
    }
  },
  matchMedia: function() {
    return { matches: false };
  }
};

// Test navigateToSection on current page
mockLocationHref = '/';
scrolledElements = [];
const navSecRes = SecretaryEngine.executeToolCall(
  { tool: 'navigateToSection', parameters: { anchor: '#skills' } },
  { window: mockWin, document: mockDoc }
);
assert(navSecRes.success === true, 'executeToolCall navigateToSection returns success');
assert(navSecRes.action === 'scrollToSection', 'executeToolCall navigateToSection performs scrollToSection');
assert(scrolledElements.length === 1 && scrolledElements[0].selector === '#skills', 'Target element #skills scrolled into view');
assert(mockPushedState && mockPushedState.url === '#skills', 'URL hash updated to #skills via pushState');

// Test navigateToSection when on different route
mockLocationHref = '/keuken-cv';
const navSecCrossRes = SecretaryEngine.executeToolCall(
  { tool: 'navigateToSection', parameters: { anchor: '#contact' } },
  { window: mockWin, document: mockDoc }
);
assert(navSecCrossRes.success === true, 'executeToolCall navigateToSection from different route returns success');
assert(navSecCrossRes.action === 'redirect', 'executeToolCall navigateToSection performs redirect');
assert(mockLocationHref === '/#contact', 'Redirected window location to /#contact');

// Test openProject (artificer)
mockLocationHref = '/';
scrolledElements = [];
const openProjRes = SecretaryEngine.executeToolCall(
  { tool: 'openProject', parameters: { projectId: 'artificer' } },
  { window: mockWin, document: mockDoc }
);
assert(openProjRes.success === true, 'executeToolCall openProject returns success');
assert(openProjRes.action === 'openProject', 'executeToolCall openProject action is openProject');
assert(scrolledElements.length === 1 && scrolledElements[0].selector === '.artificer-card', 'Artificer project card scrolled into view');

// Test openKitchenCV & openShare
const openCVRes = SecretaryEngine.executeToolCall(
  { tool: 'openKitchenCV' },
  { window: mockWin, document: mockDoc }
);
assert(openCVRes.success === true && mockLocationHref === '/keuken-cv', 'openKitchenCV redirected to /keuken-cv');

const openShareRes = SecretaryEngine.executeToolCall(
  { tool: 'openShare' },
  { window: mockWin, document: mockDoc }
);
assert(openShareRes.success === true && mockLocationHref === '/share', 'openShare redirected to /share');

// Test rejection of invalid payload
const invalidExecRes = SecretaryEngine.executeToolCall(
  { tool: 'executeScript', parameters: { script: 'alert(1)' } },
  { window: mockWin, document: mockDoc }
);
assert(invalidExecRes.success === false && invalidExecRes.action === 'none', 'Unauthorized tool call rejected cleanly with success: false');


// 5. Phase 9 Optional LLM Adapter Unit Tests
console.log('\nEvaluating Phase 9 Optional LLM Adapter...');

// 5a. Check disabled by default
const defaultAdapter = new SecretaryLLMAdapter({ secretaryEngine: engine });
assert(defaultAdapter.enabled === false, 'LLM Adapter is disabled by default');

(async () => {
  const disabledRes = await defaultAdapter.processQuery('Kan ik contact opnemen?');
  assert(disabledRes.matchedIntentId === 'contact.options', 'Disabled LLM Adapter falls back seamlessly to deterministic matcher');

  // 5b. Custom mock provider returning valid intent ID
  const mockLLMProvider = async ({ userInput }) => {
    const lower = String(userInput).toLowerCase();
    if (lower.includes('dnd') || lower.includes('artificer')) {
      return JSON.stringify({ intentId: 'projects.artificer' });
    }
    return JSON.stringify({ intentId: 'identity.overview' });
  };

  const enabledAdapter = new SecretaryLLMAdapter({
    secretaryEngine: engine,
    llmProvider: mockLLMProvider,
    enabled: true
  });

  const validLLMRes = await enabledAdapter.processQuery('Tell me about the DnD project');
  assert(validLLMRes.matchedIntentId === 'projects.artificer', 'LLM Adapter maps natural language phrasing to allowed intent ID');
  assert(validLLMRes.adapterSource === 'llm_adapter', 'LLM Adapter response flagged with adapterSource llm_adapter');
  assert(validLLMRes.toolCall && validLLMRes.toolCall.tool === 'openProject', 'LLM Adapter retrieves grounded tool call from SecretaryEngine');
  assert(validLLMRes.answerText && validLLMRes.answerText.includes('Artificer'), 'LLM Adapter response grounds answer text in canonical knowledge registry');

  // 5c. Hallucinated / unauthorized intent ID rejection
  const hallucinatingProvider = async () => {
    return JSON.stringify({ intentId: 'unauthorized.hallucination_intent', answerText: 'Invented facts!' });
  };

  const hallucinationAdapter = new SecretaryLLMAdapter({
    secretaryEngine: engine,
    llmProvider: hallucinatingProvider,
    enabled: true
  });

  const rejectedLLMRes = await hallucinationAdapter.processQuery('Tell me secret info');
  assert(rejectedLLMRes.matchedIntentId !== 'unauthorized.hallucination_intent', 'LLM Adapter strictly rejects unauthorized intent IDs');
  assert(rejectedLLMRes.matchedIntentId === 'fallback.unknown', 'Unauthorized LLM output falls back cleanly to fallback handler');

  // 5d. Malformed JSON / parsing error fallback
  const malformedProvider = async () => 'Not JSON output';
  const malformedAdapter = new SecretaryLLMAdapter({
    secretaryEngine: engine,
    llmProvider: malformedProvider,
    enabled: true
  });

  const malformedRes = await malformedAdapter.processQuery('Hello');
  assert(malformedRes.matchedIntentId === 'identity.overview' || malformedRes.matchedIntentId === 'fallback.unknown', 'Malformed LLM JSON falls back safely');

  // 5e. Timeout protection
  const slowProvider = async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return JSON.stringify({ intentId: 'identity.overview' });
  };

  const timeoutAdapter = new SecretaryLLMAdapter({
    secretaryEngine: engine,
    llmProvider: slowProvider,
    timeoutMs: 50,
    enabled: true
  });

  const timeoutRes = await timeoutAdapter.processQuery('Wie is Jaap?');
  assert(timeoutRes.matchedIntentId === 'identity.overview', 'Timed out LLM request falls back transparently to deterministic matcher');

  // 5f. SecretaryEngine processQuery integration test
  const integratedEngine = new SecretaryEngine(knowledgeData, { llmAdapter: enabledAdapter });
  enabledAdapter.secretaryEngine = integratedEngine;

  const asyncEngineRes = await integratedEngine.processQuery('Vertel over Artificer D&D engine');
  assert(asyncEngineRes.matchedIntentId === 'projects.artificer', 'SecretaryEngine.processQuery delegates correctly to enabled LLM Adapter');


  // 6. Content Governance & Sync Assertions
  console.log('\nEvaluating Content Governance & Repository Sync Assertions...');

  // Read repository source files
  const rootDir = path.join(__dirname, '..');
  const serverJsContent = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');
  const indexEjsContent = fs.readFileSync(path.join(rootDir, 'views/index.ejs'), 'utf8');
  const projectenEjsContent = fs.readFileSync(path.join(rootDir, 'views/partials/projecten.ejs'), 'utf8');
  const skillsEjsContent = fs.readFileSync(path.join(rootDir, 'views/partials/skills.ejs'), 'utf8');
  const overEjsContent = fs.readFileSync(path.join(rootDir, 'views/partials/over.ejs'), 'utf8');
  const ervaringEjsContent = fs.readFileSync(path.join(rootDir, 'views/partials/ervaring.ejs'), 'utf8');
  const footerEjsContent = fs.readFileSync(path.join(rootDir, 'views/partials/footer.ejs'), 'utf8');
  const allViewsContent = [indexEjsContent, projectenEjsContent, skillsEjsContent, overEjsContent, ervaringEjsContent, footerEjsContent].join('\n');

  // 6a. Intent Uniqueness & Mandatory Property Validation
  const seenIntentIds = new Set();
  for (const intent of knowledgeData.intents) {
    assert(!seenIntentIds.has(intent.intentId), `Intent ID "${intent.intentId}" is unique`);
    seenIntentIds.add(intent.intentId);

    assert(Array.isArray(intent.keywords) && intent.keywords.length > 0, `Intent "${intent.intentId}" has non-empty keywords array`);
    assert(Array.isArray(intent.patterns) && intent.patterns.length > 0, `Intent "${intent.intentId}" has non-empty patterns array`);
    assert(typeof intent.answerText === 'string' && intent.answerText.length > 10, `Intent "${intent.intentId}" has valid answer text`);
    assert(typeof intent.knowledgeSource === 'string' && intent.knowledgeSource.length > 0, `Intent "${intent.intentId}" specifies knowledge source`);
  }

  // 6b. Anchor Governance: All tool call anchors must exist in view files
  for (const intent of knowledgeData.intents) {
    if (intent.toolCall && intent.toolCall.tool === 'navigateToSection') {
      const anchor = intent.toolCall.parameters.anchor; // e.g. "#over"
      const targetId = anchor.substring(1); // "over"
      const hasId = allViewsContent.includes(`id="${targetId}"`);
      assert(hasId, `Governance: Section anchor "${anchor}" referenced by intent "${intent.intentId}" exists in template views`);
    }
  }

  // 6c. Route Governance: All tool call routes must exist in Express server.js
  for (const intent of knowledgeData.intents) {
    if (intent.toolCall && intent.toolCall.tool === 'navigateToRoute') {
      const route = intent.toolCall.parameters.route; // e.g. "/share"
      const routePattern = route === '/' ? "app.get('/'" : `app.get('${route}'`;
      const hasRoute = serverJsContent.includes(routePattern);
      assert(hasRoute, `Governance: Route "${route}" referenced by intent "${intent.intentId}" exists in server.js`);
    }
  }

  // 6d. Project ID Governance: All project IDs must exist in projecten.ejs
  const projectMap = {
    'artificer': '.artificer-card',
    'global-conquest': '.conquest-card',
    'supermail': '.supermail-card'
  };

  for (const intent of knowledgeData.intents) {
    if (intent.toolCall && intent.toolCall.tool === 'openProject') {
      const projId = intent.toolCall.parameters.projectId;
      const targetClass = projectMap[projId] ? projectMap[projId].substring(1) : projId;
      const hasProjectClass = projectenEjsContent.includes(targetClass);
      assert(hasProjectClass, `Governance: Project ID "${projId}" referenced by intent "${intent.intentId}" exists in projecten.ejs (class "${targetClass}")`);
    }
  }

  // 6e. Source File Governance: Primary files referenced in knowledgeSource must exist on disk
  for (const intent of knowledgeData.intents) {
    if (intent.knowledgeSource) {
      // Extract file paths from knowledgeSource string (e.g., "POSITIONING.md (§1), views/partials/head.ejs")
      const rawSources = intent.knowledgeSource.split(/,\s*/);
      for (const rawSrc of rawSources) {
        const cleanPath = rawSrc.split(/\s*\(|\s*$/)[0].trim();
        if (cleanPath.endsWith('.md') || cleanPath.endsWith('.ejs') || cleanPath.endsWith('.js') || cleanPath.endsWith('.json')) {
          const fullPath = path.join(rootDir, cleanPath);
          const fileExists = fs.existsSync(fullPath);
          assert(fileExists, `Governance: Knowledge source file "${cleanPath}" referenced by intent "${intent.intentId}" exists on disk`);
        }
      }
    }
  }

  if (totalFailed > 0) {
    console.error(`\nSecretary Engine & Governance tests failed! ${totalFailed} failure(s).`);
    process.exit(1);
  } else {
    console.log(`\nAll ${totalPassed} Secretary Engine, LLM Adapter & Content Governance assertions passed successfully!`);
    process.exit(0);
  }
})();

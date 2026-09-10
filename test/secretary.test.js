const fs = require('fs');
const path = require('path');
const SecretaryEngine = require('../public/secretary-engine.js');

console.log('Testing Secretary Engine & Knowledge Registry...');

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
    // If mock page is not '/', main portfolio section elements are not in DOM
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

if (totalFailed > 0) {
  console.error(`\nSecretary Engine tests failed! ${totalFailed} failure(s).`);
  process.exit(1);
} else {
  console.log(`\nAll ${totalPassed} Secretary Engine assertions passed successfully!`);
  process.exit(0);
}

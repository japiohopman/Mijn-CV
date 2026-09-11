import assert from 'node:assert/strict';
import { parseTaskMetadata, loadAgentProfile } from '../scripts/jules-orchestrator.mjs';

console.log('Running Jules agent metadata regression tests...');

const realIssueStyle = `
## Parent Phase
#63

## Agent
\`architecture-specialist\`

## Context & Problem
Dispatch task through the Jules orchestrator.
`;

const metadata = parseTaskMetadata(realIssueStyle);
assert.equal(metadata.parentPhaseNumber, 63);
assert.equal(metadata.agent, 'architecture-specialist');

const colonStyle = `Parent Phase: #63\nAgent: \`testing-specialist\``;
const colonMetadata = parseTaskMetadata(colonStyle);
assert.equal(colonMetadata.parentPhaseNumber, 63);
assert.equal(colonMetadata.agent, 'testing-specialist');

const headingColonStyle = `## Parent Phase\n#63\n## Agent: performance-specialist`;
const headingColonMetadata = parseTaskMetadata(headingColonStyle);
assert.equal(headingColonMetadata.parentPhaseNumber, 63);
assert.equal(headingColonMetadata.agent, 'performance-specialist');

const profile = loadAgentProfile('architecture-specialist');
assert.match(profile, /Architecture Specialist for Mijn-CV/);

assert.throws(
  () => loadAgentProfile('does-not-exist'),
  /Agent profile .*does-not-exist\.agent\.md.*not found/
);

console.log('✓ Agent metadata regression tests passed.');

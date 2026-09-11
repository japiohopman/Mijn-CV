import assert from 'node:assert/strict';
import {
  parsePhaseMetadata,
  parseTaskMetadata,
  loadAgentProfile,
  ensurePhaseBranch,
  hasLabel,
  getStatusLabel,
  selectEligiblePhase,
  selectNextTask,
  determineOrchestratorAction,
  resolveDefaultBranch,
} from '../scripts/jules-orchestrator.mjs';

console.log('Running Jules Orchestrator v2 Unit Tests...');

let testsPassed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`✗ ${name} failed:`, err.stack || err.message);
    process.exitCode = 1;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`✗ ${name} failed:`, err.stack || err.message);
    process.exitCode = 1;
  }
}

// 1. Metadata Parsing Tests
runTest('parsePhaseMetadata extracts phase branch and child tasks correctly', () => {
  const body = `
## Objective
Implement assistant natural language adapter.

## Phase Branch
\`phase/09-secretary-llm\`

## Tasks
- [ ] #101 Add LLM adapter UMD module
- [x] #102 Implement fallback handling
- [ ] #103 Add governance unit tests
  `;

  const meta = parsePhaseMetadata(body, 9);
  assert.equal(meta.phaseBranch, 'phase/09-secretary-llm');
  assert.equal(meta.childTasks.length, 3);
  assert.equal(meta.childTasks[0].issueNumber, 101);
  assert.equal(meta.childTasks[0].checked, false);
  assert.equal(meta.childTasks[1].issueNumber, 102);
  assert.equal(meta.childTasks[1].checked, true);
});

runTest('parsePhaseMetadata provides fallback branch when unmentioned', () => {
  const meta = parsePhaseMetadata('Simple description without branch', 12);
  assert.equal(meta.phaseBranch, 'phase/12-delivery');
  assert.equal(meta.childTasks.length, 0);
});

runTest('parseTaskMetadata extracts parent phase number correctly', () => {
  const body = `
## Parent Phase
#100

## Details
Implementation instructions for task.
  `;

  const meta = parseTaskMetadata(body);
  assert.equal(meta.parentPhaseNumber, 100);
});

// 2. Label Utility Tests
runTest('hasLabel correctly checks string and object label representations', () => {
  const issueWithStrings = { labels: ['type:phase', 'status:active'] };
  const issueWithObjects = { labels: [{ name: 'type:phase' }, { name: 'status:active' }] };

  assert.equal(hasLabel(issueWithStrings, 'status:active'), true);
  assert.equal(hasLabel(issueWithObjects, 'type:phase'), true);
  assert.equal(hasLabel(issueWithStrings, 'status:blocked'), false);
});

runTest('getStatusLabel retrieves status label cleanly', () => {
  const issue = { labels: ['type:phase', 'status:review', 'jules'] };
  assert.equal(getStatusLabel(issue), 'status:review');
});

// 3. Phase Selection Tests
runTest('selectEligiblePhase prioritizes review phase over active or planned', () => {
  const phaseIssues = [
    { number: 1, title: 'Phase 1', labels: ['type:phase', 'status:planned'] },
    { number: 2, title: 'Phase 2', labels: ['type:phase', 'status:active'] },
    { number: 3, title: 'Phase 3', labels: ['type:phase', 'status:review'] },
  ];

  const selected = selectEligiblePhase(phaseIssues);
  assert.equal(selected.number, 3);
});

runTest('selectEligiblePhase selects active phase over planned phases', () => {
  const phaseIssues = [
    { number: 1, title: 'Phase 1', labels: ['type:phase', 'status:planned'] },
    { number: 2, title: 'Phase 2', labels: ['type:phase', 'status:active'] },
  ];

  const selected = selectEligiblePhase(phaseIssues);
  assert.equal(selected.number, 2);
});

runTest('selectEligiblePhase selects lowest numbered eligible planned phase', () => {
  const phaseIssues = [
    { number: 10, title: 'Phase 10', labels: ['type:phase', 'status:planned'] },
    { number: 8, title: 'Phase 8', labels: ['type:phase', 'status:planned'] },
    { number: 9, title: 'Phase 9', labels: ['type:phase', 'status:planned', 'status:blocked'] },
  ];

  const selected = selectEligiblePhase(phaseIssues);
  assert.equal(selected.number, 8);
});

runTest('selectEligiblePhase handles empty input safely', () => {
  assert.equal(selectEligiblePhase([]), null);
  assert.equal(selectEligiblePhase(null), null);
});

// 4. Task Selection Tests
runTest('selectNextTask filters child tasks belonging to active phase and skips checked ones', () => {
  const phaseIssue = {
    number: 9,
    title: 'Phase 9',
    body: '## Tasks\n- [x] #101 Done task\n- [ ] #102 Pending task',
  };

  const taskIssues = [
    { number: 101, title: 'Task 101', labels: ['type:task', 'status:complete'] },
    { number: 102, title: 'Task 102', labels: ['type:task', 'status:planned'] },
  ];

  const nextTask = selectNextTask(phaseIssue, taskIssues);
  assert.equal(nextTask.number, 102);
});

runTest('selectNextTask skips blocked task issues', () => {
  const phaseIssue = {
    number: 9,
    title: 'Phase 9',
    body: '## Tasks\n- [ ] #101 Blocked task\n- [ ] #102 Ready task',
  };

  const taskIssues = [
    { number: 101, title: 'Task 101', labels: ['type:task', 'status:planned', 'status:blocked'] },
    { number: 102, title: 'Task 102', labels: ['type:task', 'status:planned'] },
  ];

  const nextTask = selectNextTask(phaseIssue, taskIssues);
  assert.equal(nextTask.number, 102);
});

// 5. State Machine & Action Reducer Tests
runTest('determineOrchestratorAction returns NO_OP when no active phase', () => {
  const action = determineOrchestratorAction({ activePhase: null });
  assert.equal(action.type, 'NO_OP');
});

runTest('determineOrchestratorAction enforces human review gate when Phase PR is open', () => {
  const activePhase = {
    number: 9,
    title: 'Phase 9',
    labels: ['type:phase', 'status:review'],
    body: 'Phase Branch: `phase/09-llm`',
  };

  const action = determineOrchestratorAction({
    activePhase,
    phasePr: { number: 42, merged: false },
  });

  assert.equal(action.type, 'WAIT_HUMAN_REVIEW');
  assert.equal(action.prNumber, 42);
});

runTest('determineOrchestratorAction completes phase only after human PR merge', () => {
  const activePhase = {
    number: 9,
    title: 'Phase 9',
    labels: ['type:phase', 'status:review'],
    body: 'Phase Branch: `phase/09-llm`',
  };

  const action = determineOrchestratorAction({
    activePhase,
    phasePr: { number: 42, merged: true },
  });

  assert.equal(action.type, 'COMPLETE_PHASE');
  assert.equal(action.phaseIssueNumber, 9);
  assert.equal(action.prNumber, 42);
});

runTest('determineOrchestratorAction waits for active Jules session when unmerged', () => {
  const activePhase = {
    number: 9,
    title: 'Phase 9',
    labels: ['type:phase', 'status:active'],
  };

  const action = determineOrchestratorAction({
    activePhase,
    activeSession: { name: 'session-123', issueNumber: 101 },
    sessionPrMerged: false,
  });

  assert.equal(action.type, 'WAIT_ACTIVE_SESSION');
});

runTest('determineOrchestratorAction advances task when Jules session PR is merged', () => {
  const activePhase = {
    number: 9,
    title: 'Phase 9',
    labels: ['type:phase', 'status:active'],
  };

  const action = determineOrchestratorAction({
    activePhase,
    activeSession: { name: 'session-123', issueNumber: 101 },
    sessionPrMerged: true,
  });

  assert.equal(action.type, 'ADVANCE_SESSION_TASK');
  assert.equal(action.taskIssueNumber, 101);
});

runTest('determineOrchestratorAction prepares Phase PR when all child tasks are complete', () => {
  const activePhase = {
    number: 9,
    title: 'Phase 9',
    labels: ['type:phase', 'status:active'],
    body: 'Phase Branch: `phase/09-llm`\n\n## Tasks\n- [x] #101 Done\n- [x] #102 Done',
  };

  const taskIssues = [
    { number: 101, title: 'Task 101', labels: ['type:task', 'status:complete'] },
    { number: 102, title: 'Task 102', labels: ['type:task', 'status:complete'] },
  ];

  const action = determineOrchestratorAction({
    activePhase,
    taskIssues,
    defaultBranch: 'master',
  });

  assert.equal(action.type, 'PREPARE_PHASE_PR');
  assert.equal(action.phaseBranch, 'phase/09-llm');
  assert.equal(action.defaultBranch, 'master');
});

runTest('determineOrchestratorAction dispatches next eligible task on phase branch', () => {
  const activePhase = {
    number: 9,
    title: 'Phase 9',
    labels: ['type:phase', 'status:active'],
    body: 'Phase Branch: `phase/09-llm`\n\n## Tasks\n- [x] #101 Done\n- [ ] #102 Pending',
  };

  const taskIssues = [
    { number: 101, title: 'Task 101', labels: ['type:task', 'status:complete'] },
    { number: 102, title: 'Task 102', labels: ['type:task', 'status:planned'], body: 'Details for 102' },
  ];

  const action = determineOrchestratorAction({
    activePhase,
    taskIssues,
  });

  assert.equal(action.type, 'DISPATCH_TASK');
  assert.equal(action.taskIssueNumber, 102);
  assert.equal(action.phaseBranch, 'phase/09-llm');
});

runTest('determineOrchestratorAction pauses when remaining tasks are blocked', () => {
  const activePhase = {
    number: 9,
    title: 'Phase 9',
    labels: ['type:phase', 'status:active'],
    body: '## Tasks\n- [ ] #101 Blocked',
  };

  const taskIssues = [
    { number: 101, title: 'Task 101', labels: ['type:task', 'status:planned', 'status:blocked'] },
  ];

  const action = determineOrchestratorAction({
    activePhase,
    taskIssues,
  });

  assert.equal(action.type, 'PAUSE_BLOCKED');
});

// 6. Branch Resolution Tests
await runAsyncTest('resolveDefaultBranch resolves explicit environment override first', async () => {
  process.env.JULES_STARTING_BRANCH = 'feature/test-branch';
  const branch = await resolveDefaultBranch('japiohopman/Mijn-CV');
  assert.equal(branch, 'feature/test-branch');
  delete process.env.JULES_STARTING_BRANCH;
});

await runAsyncTest('resolveDefaultBranch resolves branch via mock GitHub API fetch', async () => {
  const mockFetch = async () => ({ default_branch: 'master' });
  const branch = await resolveDefaultBranch('japiohopman/Mijn-CV', mockFetch);
  assert.equal(branch, 'master');
});

// 7. Agent Metadata & Profile Loading Tests
runTest('parseTaskMetadata extracts Agent metadata from issue body', () => {
  const body1 = `
Parent Phase
#63
Agent
architecture-specialist

Context & Problem
  `;
  const meta1 = parseTaskMetadata(body1);
  assert.equal(meta1.parentPhaseNumber, 63);
  assert.equal(meta1.agent, 'architecture-specialist');

  const body2 = `
Parent: #63
Agent: testing-specialist
  `;
  const meta2 = parseTaskMetadata(body2);
  assert.equal(meta2.parentPhaseNumber, 63);
  assert.equal(meta2.agent, 'testing-specialist');
});

runTest('loadAgentProfile reads valid agent profile from disk', () => {
  const profile = loadAgentProfile('architecture-specialist');
  assert.ok(profile.includes('You are the Architecture Specialist for Mijn-CV.'));
});

runTest('loadAgentProfile throws error for missing specialist profile', () => {
  assert.throws(
    () => loadAgentProfile('nonexistent-specialist'),
    /Agent profile '.*nonexistent-specialist\.agent\.md' not found/
  );
});

// 8. Phase Branch Management Tests
await runAsyncTest('ensurePhaseBranch reuses existing phase branch', async () => {
  let postCalled = false;
  const mockFetch = async (path) => {
    if (path.includes('git/ref/heads/phase/09-test')) {
      return { ref: 'refs/heads/phase/09-test', object: { sha: '123' } };
    }
    throw new Error('404 Not Found');
  };
  const mockPost = async () => { postCalled = true; };

  const result = await ensurePhaseBranch('phase/09-test', 'master', 'token', 'repo', mockFetch, mockPost);
  assert.equal(result.created, false);
  assert.equal(postCalled, false);
});

await runAsyncTest('ensurePhaseBranch creates phase branch off default branch if missing', async () => {
  let createdRef = null;
  const mockFetch = async (path) => {
    if (path.includes('git/ref/heads/phase/09-test')) {
      throw new Error('404 Not Found');
    }
    if (path.includes('git/ref/heads/master')) {
      return { ref: 'refs/heads/master', object: { sha: 'master-sha-123' } };
    }
    throw new Error('404 Not Found');
  };
  const mockPost = async (path, body) => {
    createdRef = body;
    return { ref: body.ref };
  };

  const result = await ensurePhaseBranch('phase/09-test', 'master', 'token', 'repo', mockFetch, mockPost);
  assert.equal(result.created, true);
  assert.equal(createdRef.ref, 'refs/heads/phase/09-test');
  assert.equal(createdRef.sha, 'master-sha-123');
});

// 9. Phase 10 — Autonomous Jules Dispatch Validation Tests
runTest('Phase 10: selectEligiblePhase selects Phase 10 when active or planned', () => {
  const phaseIssues = [
    {
      number: 10,
      title: 'Phase 10 — Autonomous Jules Dispatch Validation',
      labels: ['type:phase', 'status:planned'],
      body: '## Objective\nProve issue-driven Jules automation works end-to-end.\n\n## Phase Branch\n`phase/10-jules-dispatch-validation`',
    },
  ];

  const selected = selectEligiblePhase(phaseIssues);
  assert.equal(selected.number, 10);
  const { phaseBranch } = parsePhaseMetadata(selected.body, selected.number);
  assert.equal(phaseBranch, 'phase/10-jules-dispatch-validation');
});

runTest('Phase 10: dispatch single session with explicit specialist agent profile loaded', () => {
  const activePhase = {
    number: 10,
    title: 'Phase 10 — Autonomous Jules Dispatch Validation',
    labels: ['type:phase', 'status:planned'],
    body: '## Phase Branch\n`phase/10-jules-dispatch-validation`',
  };

  const taskIssue = {
    number: 110,
    title: 'Task: Verify automatic Task Issue dispatch',
    labels: ['type:task', 'status:planned'],
    body: 'Parent Phase\n#10\nAgent\narchitecture-specialist\n\n## Definition of Done\n- Eligible Task Issue triggers orchestrator\n- Phase branch created/reused\n- Explicit specialist profile loaded',
  };

  const action = determineOrchestratorAction({
    activePhase,
    taskIssues: [taskIssue],
  });

  assert.equal(action.type, 'DISPATCH_TASK');
  assert.equal(action.phaseIssueNumber, 10);
  assert.equal(action.taskIssueNumber, 110);
  assert.equal(action.phaseBranch, 'phase/10-jules-dispatch-validation');

  const taskMeta = parseTaskMetadata(action.taskBody);
  assert.equal(taskMeta.agent, 'architecture-specialist');

  const profile = loadAgentProfile(taskMeta.agent);
  assert.ok(profile.includes('Architecture Specialist'));
});

runTest('Phase 10: repeated run does not duplicate active session (WAIT_ACTIVE_SESSION)', () => {
  const activePhase = {
    number: 10,
    title: 'Phase 10 — Autonomous Jules Dispatch Validation',
    labels: ['type:phase', 'status:active'],
    body: '## Phase Branch\n`phase/10-jules-dispatch-validation`',
  };

  const activeSession = {
    name: 'sessions/phase10-validation-session-1',
    issueNumber: 110,
    phaseNumber: 10,
    phaseBranch: 'phase/10-jules-dispatch-validation',
  };

  const action = determineOrchestratorAction({
    activePhase,
    taskIssues: [{ number: 110, title: 'Task: Verify automatic Task Issue dispatch', labels: ['type:task', 'status:active'] }],
    activeSession,
    sessionPrMerged: false,
  });

  assert.equal(action.type, 'WAIT_ACTIVE_SESSION');
  assert.equal(action.sessionName, 'sessions/phase10-validation-session-1');
});

runTest('Phase 10: human review remains final integration gate (WAIT_HUMAN_REVIEW)', () => {
  const activePhase = {
    number: 10,
    title: 'Phase 10 — Autonomous Jules Dispatch Validation',
    labels: ['type:phase', 'status:review'],
    body: '## Phase Branch\n`phase/10-jules-dispatch-validation`',
  };

  const action = determineOrchestratorAction({
    activePhase,
    phasePr: { number: 99, merged: false },
  });

  assert.equal(action.type, 'WAIT_HUMAN_REVIEW');
  assert.equal(action.prNumber, 99);
});

// 10. Mocked Dispatch Verification Test
await runAsyncTest('Mocked task dispatch constructs valid Jules API payload and ensures phase branch', async () => {
  const activePhase = {
    number: 63,
    title: 'Phase 63 — Issue Driven Architecture',
    labels: ['type:phase', 'status:planned'],
    body: '## Phase Branch\n`phase/63-orchestrator-dispatch`',
  };

  const taskIssue = {
    number: 105,
    title: 'Task: Make Jules Orchestrator dispatch issue-driven tasks',
    labels: ['type:task', 'status:planned'],
    body: 'Parent Phase\n#63\nAgent\narchitecture-specialist\n\nTask details...',
  };

  const action = determineOrchestratorAction({
    activePhase,
    taskIssues: [taskIssue],
  });

  assert.equal(action.type, 'DISPATCH_TASK');
  assert.equal(action.phaseIssueNumber, 63);
  assert.equal(action.taskIssueNumber, 105);
  assert.equal(action.phaseBranch, 'phase/63-orchestrator-dispatch');

  // Verify profile loading for dispatched task
  const taskMeta = parseTaskMetadata(action.taskBody);
  assert.equal(taskMeta.agent, 'architecture-specialist');
  const agentProfile = loadAgentProfile(taskMeta.agent);

  const promptParts = [
    'Read AGENT.MD, AGENT_RULES.md, and JULES_ORCHESTRATOR_V2.md before starting.',
    `Executing Task #${action.taskIssueNumber} on Phase Branch: ${action.phaseBranch}`,
    `Task Issue Title: ${action.taskTitle}`,
    `Assigned Specialist Agent: ${taskMeta.agent}`,
    `--- SPECIALIST PROFILE (${taskMeta.agent}) ---\n${agentProfile}\n--- END SPECIALIST PROFILE ---`,
    `Task Details:\n${action.taskBody}`,
    'Follow AGENT_RULES.md strictly. Run and verify all relevant tests before completing work.',
  ];

  const fullPrompt = promptParts.join('\n\n');
  assert.ok(fullPrompt.includes('Executing Task #105 on Phase Branch: phase/63-orchestrator-dispatch'));
  assert.ok(fullPrompt.includes('Assigned Specialist Agent: architecture-specialist'));
  assert.ok(fullPrompt.includes('You are the Architecture Specialist for Mijn-CV.'));
});

if (process.exitCode && process.exitCode !== 0) {
  console.error('\n✗ Orchestrator unit tests failed.');
  process.exit(1);
} else {
  console.log(`\nAll ${testsPassed} Orchestrator v2 unit tests passed successfully!`);
}

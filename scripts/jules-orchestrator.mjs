#!/usr/bin/env node
/**
 * Jules Queue Orchestrator v2 — Issue-Driven Phase Workflow
 *
 * Primary source of truth: GitHub Issues, GitHub PRs, and Phase Branches.
 * Decoupled from ROADMAP.md checkboxes.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const JULES_API_KEY = process.env.JULES_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const JULES_SOURCE = process.env.JULES_SOURCE || (REPO ? `sources/github/${REPO}` : null);

const STATE_PATH = '.github/jules-queue-state.json';

export function loadState(path = STATE_PATH) {
  if (!existsSync(path)) return { activeSession: null, activePhase: null };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { activeSession: null, activePhase: null };
  }
}

export function saveState(state, path = STATE_PATH) {
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

export async function julesFetch(path, options = {}, apiKey = JULES_API_KEY) {
  const res = await fetch(`https://jules.googleapis.com/v1alpha/${path}`, {
    ...options,
    headers: {
      'X-Goog-Api-Key': apiKey,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Jules API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function githubFetch(path, token = GITHUB_TOKEN, repo = REPO) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = path.startsWith('http') ? path : `https://api.github.com/repos/${repo}/${path}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function githubPost(path, body, token = GITHUB_TOKEN, repo = REPO) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = path.startsWith('http') ? path : `https://api.github.com/repos/${repo}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function githubPatch(path, body, token = GITHUB_TOKEN, repo = REPO) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = path.startsWith('http') ? path : `https://api.github.com/repos/${repo}/${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Resolves default branch of the repository without assuming 'main' or 'master'.
 */
export async function resolveDefaultBranch(repo = REPO, fetchFn = githubFetch, execFn = execSync) {
  const explicitBranch = process.env.JULES_STARTING_BRANCH || process.env.TARGET_BRANCH || null;
  if (explicitBranch) {
    return explicitBranch;
  }

  const errors = [];

  if (repo) {
    try {
      const repoData = await fetchFn('');
      if (repoData && repoData.default_branch) {
        return repoData.default_branch;
      }
    } catch (err) {
      errors.push(`GitHub API metadata resolution failed: ${err.message}`);
    }
  }

  const repoUrl = repo ? `https://github.com/${repo}.git` : null;
  if (repoUrl) {
    try {
      const output = execFn(`git ls-remote --symref ${repoUrl} HEAD`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const match = output.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
      if (match && match[1]) {
        return match[1];
      }
    } catch (err) {
      errors.push(`git ls-remote resolution failed: ${err.message}`);
    }
  }

  throw new Error(
    `Failed to resolve default branch for repository: '${repo || 'unknown'}'.\n` +
    `Attempted methods: GitHub API metadata, git ls-remote --symref\n` +
    `Errors encountered:\n${errors.map(e => ` - ${e}`).join('\n')}`
  );
}

export function extractPrNumber(prUrl) {
  if (!prUrl) return null;
  const match = String(prUrl).match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function hasLabel(issue, labelName) {
  if (!issue || !Array.isArray(issue.labels)) return false;
  return issue.labels.some(l => (typeof l === 'string' ? l : l.name) === labelName);
}

export function getStatusLabel(issue) {
  if (!issue || !Array.isArray(issue.labels)) return 'status:planned';
  const statusLabels = issue.labels
    .map(l => (typeof l === 'string' ? l : l.name))
    .filter(l => l.startsWith('status:'));
  return statusLabels[0] || 'status:planned';
}

export function parsePhaseMetadata(body = '', phaseNumber = null) {
  let phaseBranch = null;

  // Search for explicit branch format e.g. `phase/09-short-name` or Phase Branch: phase/...
  const branchMatch = body.match(/`?(phase\/[a-zA-Z0-9_\-\.]+)/i) ||
                      body.match(/Phase\s+Branch:\s*`?([a-zA-Z0-9_\-\.\/]+)`?/i);
  if (branchMatch) {
    phaseBranch = branchMatch[1].trim();
  } else if (phaseNumber !== null) {
    phaseBranch = `phase/${String(phaseNumber).padStart(2, '0')}-delivery`;
  } else {
    phaseBranch = 'phase/active-delivery';
  }

  // Parse child task references from Markdown checkboxes e.g. - [ ] #101 or - [x] #102
  const tasks = [];
  const taskLines = body.split('\n');
  for (const line of taskLines) {
    const taskMatch = line.match(/^- \[( |x)\]\s*#(\d+)\b(.*)$/i);
    if (taskMatch) {
      tasks.push({
        issueNumber: Number(taskMatch[2]),
        checked: taskMatch[1].toLowerCase() === 'x',
        title: taskMatch[3].trim().replace(/^[-:\s]+/, ''),
      });
    }
  }

  return { phaseBranch, childTasks: tasks };
}

export function parseTaskMetadata(body = '') {
  let parentPhaseNumber = null;
  const match = body.match(/Parent\s+Phase:\s*#(\d+)/i) || body.match(/Parent:\s*#(\d+)/i) || body.match(/#(\d+)/);
  if (match) {
    parentPhaseNumber = Number(match[1]);
  }
  return { parentPhaseNumber };
}

export function selectEligiblePhase(phaseIssues = []) {
  if (!Array.isArray(phaseIssues) || phaseIssues.length === 0) return null;

  // Active or Review phase takes top priority
  const reviewPhase = phaseIssues.find(i => hasLabel(i, 'status:review'));
  if (reviewPhase) return reviewPhase;

  const activePhase = phaseIssues.find(i => hasLabel(i, 'status:active'));
  if (activePhase) return activePhase;

  // Next planned phase
  const plannedPhases = phaseIssues
    .filter(i => hasLabel(i, 'status:planned') && !hasLabel(i, 'status:blocked'))
    .sort((a, b) => a.number - b.number);

  return plannedPhases[0] || null;
}

export function selectNextTask(phaseIssue, taskIssues = []) {
  if (!phaseIssue) return null;
  const { childTasks } = parsePhaseMetadata(phaseIssue.body || '', phaseIssue.number);

  // Filter task issues that belong to this phase
  const eligibleTasks = taskIssues.filter(t => {
    // Exclude completed or blocked tasks
    if (hasLabel(t, 'status:complete') || hasLabel(t, 'status:blocked')) return false;

    // Check if task issue is explicitly referenced in phase issue
    if (childTasks.length > 0) {
      const referenced = childTasks.find(ct => ct.issueNumber === t.number);
      if (referenced && referenced.checked) return false;
      return Boolean(referenced);
    }

    // Check task metadata parent link
    const meta = parseTaskMetadata(t.body || '');
    return meta.parentPhaseNumber === phaseIssue.number;
  });

  // Sort by active first, then issue number
  const activeTask = eligibleTasks.find(t => hasLabel(t, 'status:active'));
  if (activeTask) return activeTask;

  return eligibleTasks.sort((a, b) => a.number - b.number)[0] || null;
}

export function determineOrchestratorAction({
  activePhase,
  taskIssues = [],
  activeSession = null,
  sessionPrMerged = false,
  phasePr = null,
  defaultBranch = 'master',
}) {
  if (!activePhase) {
    return { type: 'NO_OP', reason: 'No active or planned phase issue found.' };
  }

  const phaseStatus = getStatusLabel(activePhase);
  const { phaseBranch, childTasks } = parsePhaseMetadata(activePhase.body || '', activePhase.number);

  // Case 1: Phase is in status:review
  if (phaseStatus === 'status:review') {
    if (phasePr && phasePr.merged) {
      return {
        type: 'COMPLETE_PHASE',
        phaseIssueNumber: activePhase.number,
        phaseBranch,
        prNumber: phasePr.number,
      };
    }
    return {
      type: 'WAIT_HUMAN_REVIEW',
      phaseIssueNumber: activePhase.number,
      phaseBranch,
      prNumber: phasePr?.number || null,
      reason: 'Phase PR is open awaiting human review and merge.',
    };
  }

  // Case 2: Active session in progress
  if (activeSession) {
    if (sessionPrMerged) {
      return {
        type: 'ADVANCE_SESSION_TASK',
        taskIssueNumber: activeSession.issueNumber,
        sessionName: activeSession.name,
      };
    }
    return {
      type: 'WAIT_ACTIVE_SESSION',
      sessionName: activeSession.name,
      taskIssueNumber: activeSession.issueNumber,
      reason: 'Jules session active or awaiting PR merge.',
    };
  }

  // Case 3: Find next task to execute
  const nextTask = selectNextTask(activePhase, taskIssues);

  // Check if all child tasks are finished
  const allChildTasksDone = childTasks.length > 0
    ? childTasks.every(ct => {
        if (ct.checked) return true;
        const matchingTaskIssue = taskIssues.find(t => t.number === ct.issueNumber);
        return matchingTaskIssue ? hasLabel(matchingTaskIssue, 'status:complete') : false;
      })
    : taskIssues.length > 0 && taskIssues.every(t => hasLabel(t, 'status:complete'));

  if (!nextTask && (allChildTasksDone || (childTasks.length === 0 && taskIssues.length === 0))) {
    return {
      type: 'PREPARE_PHASE_PR',
      phaseIssueNumber: activePhase.number,
      phaseBranch,
      defaultBranch,
    };
  }

  if (nextTask) {
    return {
      type: 'DISPATCH_TASK',
      phaseIssueNumber: activePhase.number,
      taskIssueNumber: nextTask.number,
      taskTitle: nextTask.title,
      taskBody: nextTask.body || '',
      phaseBranch,
    };
  }

  return {
    type: 'PAUSE_BLOCKED',
    reason: 'Remaining tasks in active phase are blocked or waiting for input.',
  };
}

export async function main() {
  for (const [name, val] of Object.entries({ JULES_API_KEY, GITHUB_TOKEN, REPO, JULES_SOURCE })) {
    if (!val) throw new Error(`${name} is not set`);
  }

  const state = loadState();
  const defaultBranch = await resolveDefaultBranch();

  console.log(`Resolving issues from repository ${REPO} on default branch ${defaultBranch}...`);

  // Fetch open issues labeled type:phase and type:task
  const phaseIssues = await githubFetch('issues?labels=type:phase,jules&state=open');
  const taskIssues = await githubFetch('issues?labels=type:task,jules&state=open');

  const activePhase = selectEligiblePhase(phaseIssues);
  if (!activePhase) {
    console.log('No eligible active or planned Phase Issues found.');
    return;
  }

  const { phaseBranch } = parsePhaseMetadata(activePhase.body || '', activePhase.number);
  console.log(`Active Phase #${activePhase.number}: "${activePhase.title}" (Branch: ${phaseBranch})`);

  // Search for open Phase PR
  let phasePr = null;
  try {
    const prs = await githubFetch(`pulls?head=${REPO.split('/')[0]}:${phaseBranch}&base=${defaultBranch}&state=all`);
    phasePr = prs[0] || null;
  } catch {
    phasePr = null;
  }

  // Check active Jules session state if present
  let sessionPrMerged = false;
  if (state.activeSession) {
    console.log(`Polling status of active session ${state.activeSession.name}...`);
    try {
      const session = await julesFetch(state.activeSession.name);
      const prOutput = (session.outputs || []).find(o => o.pullRequest)?.pullRequest;
      if (prOutput) {
        const prNum = extractPrNumber(prOutput.url);
        if (prNum) {
          const prData = await githubFetch(`pulls/${prNum}`);
          sessionPrMerged = prData.merged;
        }
      }
    } catch (err) {
      console.warn(`Failed to poll active session ${state.activeSession.name}: ${err.message}`);
    }
  }

  const action = determineOrchestratorAction({
    activePhase,
    taskIssues,
    activeSession: state.activeSession,
    sessionPrMerged,
    phasePr,
    defaultBranch,
  });

  console.log(`Determined orchestrator action: ${action.type}`);

  switch (action.type) {
    case 'WAIT_HUMAN_REVIEW':
      console.log(`Phase PR #${action.prNumber || 'open'} is open awaiting human review. Automation paused.`);
      break;

    case 'WAIT_ACTIVE_SESSION':
      console.log(`Jules session ${action.sessionName} for Task #${action.taskIssueNumber} in progress.`);
      break;

    case 'COMPLETE_PHASE':
      console.log(`Phase PR #${action.prNumber} is merged! Transitioning Phase #${action.phaseIssueNumber} to status:complete.`);
      await githubPatch(`issues/${action.phaseIssueNumber}`, {
        state: 'closed',
        labels: ['type:phase', 'status:complete', 'jules'],
      });
      state.activeSession = null;
      state.activePhase = null;
      saveState(state);
      commitAndPushState();
      break;

    case 'ADVANCE_SESSION_TASK':
      console.log(`Task #${action.taskIssueNumber} PR merged. Advancing phase state.`);
      await githubPatch(`issues/${action.taskIssueNumber}`, {
        state: 'closed',
        labels: ['type:task', 'status:complete', 'jules'],
      });
      state.activeSession = null;
      saveState(state);
      commitAndPushState();
      break;

    case 'PREPARE_PHASE_PR':
      console.log(`All tasks in Phase #${action.phaseIssueNumber} complete. Preparing Phase PR: ${action.phaseBranch} -> ${action.defaultBranch}...`);
      try {
        const newPr = await githubPost('pulls', {
          title: `Phase ${action.phaseIssueNumber} — ${activePhase.title}`,
          head: action.phaseBranch,
          base: action.defaultBranch,
          body: `Closes #${action.phaseIssueNumber}\n\nAutomated Phase PR prepared by Jules Orchestrator v2.\n\n### Review Checklist\n- [ ] Code changes reviewed\n- [ ] Test assertions verified\n- [ ] Human approval prior to merge`,
        });
        console.log(`Created Phase PR #${newPr.number}. Updating Phase Issue status to status:review.`);
      } catch (err) {
        console.warn(`Phase PR creation note: ${err.message}`);
      }
      await githubPatch(`issues/${action.phaseIssueNumber}`, {
        labels: ['type:phase', 'status:review', 'jules'],
      });
      break;

    case 'DISPATCH_TASK': {
      console.log(`Dispatching Task #${action.taskIssueNumber}: "${action.taskTitle}" on branch ${action.phaseBranch}...`);

      // Update task issue label to status:active and phase label to status:active if needed
      await githubPatch(`issues/${action.taskIssueNumber}`, {
        labels: ['type:task', 'status:active', 'jules'],
      });
      if (!hasLabel(activePhase, 'status:active')) {
        await githubPatch(`issues/${action.phaseIssueNumber}`, {
          labels: ['type:phase', 'status:active', 'jules'],
        });
      }

      const promptParts = [
        'Read AGENT.MD, AGENT_RULES.md, and JULES_ORCHESTRATOR_V2.md before starting.',
        `Executing Task #${action.taskIssueNumber} on Phase Branch: ${action.phaseBranch}`,
        `Task Issue Title: ${action.taskTitle}`,
        `Task Details:\n${action.taskBody}`,
        'Follow AGENT_RULES.md strictly. Run and verify all relevant tests before completing work.',
      ];

      const session = await julesFetch('sessions', {
        method: 'POST',
        body: JSON.stringify({
          prompt: promptParts.join('\n\n'),
          sourceContext: { source: JULES_SOURCE, githubRepoContext: { startingBranch: action.phaseBranch } },
          automationMode: 'AUTO_CREATE_PR',
          title: `Task #${action.taskIssueNumber}: ${action.taskTitle.slice(0, 60)}`,
        }),
      });

      state.activeSession = {
        name: session.name,
        issueNumber: action.taskIssueNumber,
        phaseNumber: action.phaseIssueNumber,
        phaseBranch: action.phaseBranch,
        startedAt: new Date().toISOString(),
      };
      saveState(state);
      commitAndPushState();
      break;
    }

    case 'PAUSE_BLOCKED':
      console.log(`Orchestrator paused: ${action.reason}`);
      break;

    default:
      console.log('No action taken.');
      break;
  }
}

function commitAndPushState() {
  try {
    execSync('git config user.name "jules-orchestrator[bot]"');
    execSync('git config user.email "jules-orchestrator@users.noreply.github.com"');
    execSync(`git add ${STATE_PATH}`);
    execSync('git commit -m "chore: advance Jules queue state"');
    execSync('git push');
  } catch (e) {
    console.log('State commit info:', e.message);
  }
}

if (process.argv[1] && (process.argv[1].endsWith('jules-orchestrator.mjs') || process.argv[1].endsWith('jules-orchestrator.js')) && !process.env.JULES_TEST_RUN) {
  main().catch(err => { console.error(err); process.exit(1); });
}

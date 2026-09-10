#!/usr/bin/env node
/**
 * Jules Queue Orchestrator
 *
 * ROADMAP.md is the canonical dispatch queue. A Ready task may optionally
 * reference a GitHub Issue as "Issue #N"; the issue becomes the detailed
 * execution specification passed to Jules.
 *
 * Queue policy:
 * 1. Dispatch the first unchecked task under `### Ready`.
 * 2. When Ready is empty, continue with the first unchecked task under `## Later`.
 * This lets the roadmap move naturally into the next phase without requiring
 * manual queue surgery after the current Ready block is exhausted.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const JULES_API_KEY = process.env.JULES_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const JULES_SOURCE = process.env.JULES_SOURCE || (REPO ? `sources/github/${REPO}` : null);
const EXPLICIT_STARTING_BRANCH = process.env.JULES_STARTING_BRANCH || process.env.TARGET_BRANCH || null;

const STATE_PATH = '.github/jules-queue-state.json';
const ROADMAP_PATH = 'ROADMAP.md';

function loadState() {
  if (!existsSync(STATE_PATH)) return { activeSession: null };
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}
function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function julesFetch(path, options = {}) {
  const res = await fetch(`https://jules.googleapis.com/v1alpha/${path}`, {
    ...options,
    headers: {
      'X-Goog-Api-Key': JULES_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Jules API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function githubFetch(path) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Resolves default branch of the repository without assuming 'main' or 'master'.
 * Strategy:
 * 1. If explicit branch requested in environment (e.g. JULES_STARTING_BRANCH), use that.
 * 2. Resolve default branch from GitHub API metadata.
 * 3. Fall back to resolving remote HEAD branch via `git ls-remote --symref`.
 * 4. Throw detailed diagnostic if resolution fails.
 */
export async function resolveDefaultBranch(repo = REPO, fetchFn = githubFetch, execFn = execSync) {
  const explicitBranch = process.env.JULES_STARTING_BRANCH || process.env.TARGET_BRANCH || null;
  if (explicitBranch) {
    console.log(`Using explicit starting branch override: ${explicitBranch}`);
    return explicitBranch;
  }

  const errors = [];

  if (repo) {
    try {
      const repoData = await fetchFn('');
      if (repoData && repoData.default_branch) {
        console.log(`Resolved default branch via GitHub API for ${repo}: ${repoData.default_branch}`);
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
        console.log(`Resolved default branch via git ls-remote for ${repoUrl}: ${match[1]}`);
        return match[1];
      }
    } catch (err) {
      errors.push(`git ls-remote resolution failed: ${err.message}`);
    }
  }

  throw new Error(
    `Failed to resolve default branch for repository: '${repo || 'unknown'}'.\n` +
    `Repository URL: ${repoUrl || 'N/A'}\n` +
    `Attempted methods: GitHub API metadata, git ls-remote --symref\n` +
    `Errors encountered:\n${errors.map(e => ` - ${e}`).join('\n')}`
  );
}

function extractPrNumber(prUrl) {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function extractIssueNumber(taskText) {
  const match = taskText.match(/\bIssue\s+#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Finds checkbox tasks in the section introduced by `### Ready`.
 *
 * The roadmap intentionally groups Ready tasks under `## Phase N` headings.
 * Therefore a plain "stay inside the ### Ready heading" parser is incorrect:
 * the phase headings are level-2 children of the Ready queue section.
 *
 * We start collecting after `### Ready`, continue through all phase headings,
 * and stop at the next `###`/`##` section that is not a phase heading.
 */
function findTasksUnderHeading(text, headingName) {
  const lines = text.split('\n');
  let inReadyQueue = false;
  const tasks = [];
  const wantedHeading = headingName.trim().toLowerCase();

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);

    if (!inReadyQueue) {
      if (h3 && h3[1].trim().toLowerCase() === wantedHeading) {
        inReadyQueue = true;
      }
      continue;
    }

    // A new top-level section ends the Ready queue. Phase headings are part of it.
    if (h2 && !/^##\s+Phase\s+\d+\b/i.test(line)) {
      break;
    }

    // A later level-3 section (for example `### Later`) also ends the queue.
    if (h3 && h3[1].trim().toLowerCase() !== wantedHeading) {
      break;
    }

    const task = line.match(/^- \[( |x)\]\s*(.+)$/i);
    if (task) {
      tasks.push({
        checked: task[1].toLowerCase() === 'x',
        text: task[2].trim(),
      });
    }
  }

  return tasks;
}

/**
 * Finds checkbox tasks under a level-2 section such as `## Later`.
 * The section ends at the next level-2 heading.
 */
function findTasksUnderSection(text, sectionName) {
  const lines = text.split('\n');
  let inSection = false;
  const tasks = [];
  const wantedSection = sectionName.trim().toLowerCase();

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);

    if (!inSection) {
      if (h2 && h2[1].trim().toLowerCase() === wantedSection) {
        inSection = true;
      }
      continue;
    }

    if (h2) break;

    const task = line.match(/^- \[( |x)\]\s*(.+)$/i);
    if (task) {
      tasks.push({
        checked: task[1].toLowerCase() === 'x',
        text: task[2].trim(),
      });
    }
  }

  return tasks;
}

function getQueue(roadmapText) {
  const readyTasks = findTasksUnderHeading(roadmapText, 'Ready');
  const readyNext = readyTasks.find(t => !t.checked);
  if (readyNext) {
    return { name: 'Ready', tasks: readyTasks, next: readyNext };
  }

  const laterTasks = findTasksUnderSection(roadmapText, 'Later');
  const laterNext = laterTasks.find(t => !t.checked);
  if (laterNext) {
    return { name: 'Later', tasks: laterTasks, next: laterNext };
  }

  return { name: 'Ready', tasks: readyTasks, next: null };
}

function isTaskConfirmedDone(roadmapText, taskText, queueName = 'Ready') {
  const tasks = queueName.toLowerCase() === 'later'
    ? findTasksUnderSection(roadmapText, 'Later')
    : findTasksUnderHeading(roadmapText, 'Ready');
  const match = tasks.find(t => t.text === taskText);
  return match ? match.checked : false;
}

async function getIssueContext(taskText) {
  const issueNumber = extractIssueNumber(taskText);
  if (!issueNumber) return null;

  const issue = await githubFetch(`issues/${issueNumber}`);
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    url: issue.html_url,
  };
}

async function main() {
  for (const [name, val] of Object.entries({ JULES_API_KEY, GITHUB_TOKEN, REPO, JULES_SOURCE })) {
    if (!val) throw new Error(`${name} is not set`);
  }

  const state = loadState();
  const roadmapText = readFileSync(ROADMAP_PATH, 'utf8');
  const queue = getQueue(roadmapText);
  let next = queue.next;
  let activeQueueName = queue.name;
  let stateChanged = false;

  console.log(`Found ${queue.tasks.length} task(s) in active queue '${queue.name}'.`);
  if (queue.name === 'Later' && !findTasksUnderHeading(roadmapText, 'Ready').some(t => !t.checked)) {
    console.log('### Ready is exhausted; continuing with the first unchecked task under ## Later.');
  }

  if (state.activeSession) {
    const stateQueueName = state.activeSession.queueName || 'Ready';
    const stateQueueTasks = stateQueueName.toLowerCase() === 'later'
      ? findTasksUnderSection(roadmapText, 'Later')
      : findTasksUnderHeading(roadmapText, 'Ready');
    const activeTask = stateQueueTasks.find(t => t.text === state.activeSession.task);
    const activeIsCanonicalNext = activeTask && !activeTask.checked && stateQueueName === activeQueueName && (!next || activeTask.text === next.text);

    if (!activeIsCanonicalNext) {
      console.warn(
        `Stale Jules queue state detected: active task "${state.activeSession.task}" ` +
        `in queue '${stateQueueName}' does not match the canonical next task "${next?.text ?? 'none'}" ` +
        `in queue '${activeQueueName}'. Clearing the stale session state so the canonical queue can advance.`
      );
      state.activeSession = null;
      stateChanged = true;
    }
  }

  if (state.activeSession) {
    console.log(`Checking active session ${state.activeSession.name} ...`);
    const session = await julesFetch(state.activeSession.name);
    const prOutput = (session.outputs || []).find(o => o.pullRequest)?.pullRequest;

    if (!prOutput) {
      console.log('No PR yet. Nothing to do this run.');
      if (stateChanged) { saveState(state); commitAndPush(); }
      return;
    }

    const prNumber = extractPrNumber(prOutput.url);
    if (!prNumber) throw new Error(`Could not parse PR number from ${prOutput.url}`);

    const pr = await githubFetch(`pulls/${prNumber}`);
    if (!pr.merged) {
      console.log(`PR #${prNumber} is open but not merged yet — waiting for review.`);
      return;
    }

    if (!isTaskConfirmedDone(roadmapText, state.activeSession.task, state.activeSession.queueName || 'Ready')) {
      console.log(`PR #${prNumber} is merged, but "${state.activeSession.task}" is still unchecked in ROADMAP.md.`);
      return;
    }

    console.log(`"${state.activeSession.task}" is merged AND confirmed done. Advancing the queue.`);
    state.activeSession = null;
    stateChanged = true;
    const refreshedQueue = getQueue(roadmapText);
    next = refreshedQueue.next;
    activeQueueName = refreshedQueue.name;
  }

  if (!state.activeSession) {
    if (!next) {
      console.log('Nothing left unchecked under ### Ready or ## Later (queue empty).');
      if (stateChanged) { saveState(state); commitAndPush(); }
      return;
    }

    console.log(`Dispatching next task from '${activeQueueName}': ${next.text}`);

    const startingBranch = await resolveDefaultBranch();
    console.log(`Starting branch for task execution set to: ${startingBranch}`);

    const issueContext = await getIssueContext(next.text);
    const promptParts = [
      'Read AGENT.MD, AGENT_RULES.md, and ROADMAP.md before starting.',
      `Your task from ROADMAP.md's "${activeQueueName}" queue:`,
      next.text,
    ];

    if (issueContext) {
      promptParts.push(
        `The roadmap task references GitHub Issue #${issueContext.number}. Treat that issue as the authoritative execution specification for this task.`,
        `Issue #${issueContext.number}: ${issueContext.title}\n${issueContext.url}\n\n${issueContext.body}`,
      );
    }

    promptParts.push(
      "Follow AGENT_RULES.md strictly — especially: don't claim something works without running and verifying it, and stay inside the relevant module.",
      'When you are done AND you have personally verified it works (per AGENT_RULES.md §1), ' +
      'edit ROADMAP.md yourself and change this task\'s own checkbox line from ' +
      `"- [ ] ${next.text}" to "- [x] ${next.text}" — in place, don't move or delete the ` +
      'Problem/Goal/Acceptance bullets underneath it. Include that edit in the same PR. ' +
      "If you could not fully verify it, leave the checkbox unchecked and say why in the PR description instead.",
    );

    const session = await julesFetch('sessions', {
      method: 'POST',
      body: JSON.stringify({
        prompt: promptParts.join('\n\n'),
        sourceContext: { source: JULES_SOURCE, githubRepoContext: { startingBranch } },
        automationMode: 'AUTO_CREATE_PR',
        title: next.text.slice(0, 80),
      }),
    });

    state.activeSession = {
      name: session.name,
      task: next.text,
      queueName: activeQueueName,
      issueNumber: issueContext?.number ?? null,
      startedAt: new Date().toISOString(),
    };
    stateChanged = true;
  }

  if (stateChanged) {
    saveState(state);
    commitAndPush();
  }
}

function commitAndPush() {
  execSync('git config user.name "jules-orchestrator[bot]"');
  execSync('git config user.email "jules-orchestrator@users.noreply.github.com"');
  execSync(`git add ${STATE_PATH}`);
  try {
    execSync('git commit -m "chore: advance Jules queue"');
    execSync('git push');
  } catch (e) {
    console.log('Nothing to commit, or push raced with another run:', e.message);
  }
}

if (process.argv[1] && process.argv[1].endsWith('jules-orchestrator.mjs') && !process.env.JULES_TEST_RUN) {
  main().catch(err => { console.error(err); process.exit(1); });
}

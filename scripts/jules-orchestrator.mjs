#!/usr/bin/env node
/**
 * Jules Queue Orchestrator
 *
 * ROADMAP.md is the canonical dispatch queue. A Ready task may optionally
 * reference a GitHub Issue as "Issue #N"; the issue becomes the detailed
 * execution specification passed to Jules.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const JULES_API_KEY = process.env.JULES_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;
const JULES_SOURCE = process.env.JULES_SOURCE || (REPO ? `sources/github/${REPO}` : null);

const STATE_PATH = '.github/jules-queue-state.json';
const ROADMAP_PATH = 'ROADMAP.md';

for (const [name, val] of Object.entries({ JULES_API_KEY, GITHUB_TOKEN, REPO, JULES_SOURCE })) {
  if (!val) throw new Error(`${name} is not set`);
}

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
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function extractPrNumber(prUrl) {
  const match = prUrl.match(/\/pull\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function extractIssueNumber(taskText) {
  const match = taskText.match(/\bIssue\s+#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

/** Finds top-level checkbox lines under a named level-3 heading inside "## Now". */
function findTasksUnderHeading(text, headingName) {
  const lines = text.split('\n');
  let inNow = false;
  let inHeading = false;
  const tasks = [];

  for (const line of lines) {
    if (/^##\s+Now\b/i.test(line)) {
      inNow = true;
      inHeading = false;
      continue;
    }

    if (inNow && /^##\s+[^#]/.test(line)) break;
    if (!inNow) continue;

    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      const actualHeading = h3[1].trim().toLowerCase();
      const wantedHeading = headingName.trim().toLowerCase();
      inHeading = actualHeading === wantedHeading || actualHeading.startsWith(`${wantedHeading} `);
      continue;
    }

    if (!inHeading) continue;

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

function isTaskConfirmedDone(roadmapText, taskText) {
  const tasks = findTasksUnderHeading(roadmapText, 'Ready');
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
  const state = loadState();
  const roadmapText = readFileSync(ROADMAP_PATH, 'utf8');
  const readyTasks = findTasksUnderHeading(roadmapText, 'Ready');
  let next = readyTasks.find(t => !t.checked);
  let stateChanged = false;

  console.log(`Found ${readyTasks.length} task(s) under ### Ready.`);

  if (state.activeSession) {
    const activeTask = readyTasks.find(t => t.text === state.activeSession.task);
    const activeIsCanonicalNext = activeTask && !activeTask.checked && (!next || activeTask.text === next.text);

    if (!activeIsCanonicalNext) {
      console.warn(
        `Stale Jules queue state detected: active task "${state.activeSession.task}" ` +
        `does not match the first unchecked task under ### Ready ("${next?.text ?? 'none'}"). ` +
        'Clearing the stale session state so the canonical queue can advance.'
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

    if (!isTaskConfirmedDone(roadmapText, state.activeSession.task)) {
      console.log(`PR #${prNumber} is merged, but "${state.activeSession.task}" is still unchecked in ROADMAP.md.`);
      return;
    }

    console.log(`"${state.activeSession.task}" is merged AND confirmed done. Advancing the queue.`);
    state.activeSession = null;
    stateChanged = true;
    next = readyTasks.find(t => !t.checked);
  }

  if (!state.activeSession) {
    if (!next) {
      console.log('Nothing left unchecked under ### Ready (queue empty).');
      if (stateChanged) { saveState(state); commitAndPush(); }
      return;
    }

    console.log(`Dispatching next task: ${next.text}`);

    const issueContext = await getIssueContext(next.text);
    const promptParts = [
      'Read AGENT.MD, AGENT_RULES.md, and ROADMAP.md before starting.',
      'Your task from ROADMAP.md\'s "### Ready" list:',
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
        sourceContext: { source: JULES_SOURCE, githubRepoContext: { startingBranch: 'main' } },
        automationMode: 'AUTO_CREATE_PR',
        title: next.text.slice(0, 80),
      }),
    });

    state.activeSession = {
      name: session.name,
      task: next.text,
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

main().catch(err => { console.error(err); process.exit(1); });

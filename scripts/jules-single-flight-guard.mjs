#!/usr/bin/env node
/**
 * Prevent the orchestrator from dispatching while another Jules session for
 * this repository is already active. The state file alone is not sufficient:
 * it can lag behind an externally-created Jules session or lose a race.
 */

import { readFileSync, existsSync } from 'node:fs';

const JULES_API_KEY = process.env.JULES_API_KEY;
const REPO = process.env.GITHUB_REPOSITORY;
const JULES_SOURCE = process.env.JULES_SOURCE || (REPO ? `sources/github/${REPO}` : null);
const STATE_PATH = '.github/jules-queue-state.json';

const BLOCKING_STATES = new Set([
  'QUEUED',
  'PLANNING',
  'AWAITING_PLAN_APPROVAL',
  'IN_PROGRESS',
  'AWAITING_USER_FEEDBACK',
]);

export function loadTrackedSession(path = STATE_PATH) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')).activeSession || null;
  } catch {
    return null;
  }
}

export function findBlockingSessions(sessions = [], trackedSession = null, source = JULES_SOURCE) {
  return sessions.filter(session => {
    if (!session || !BLOCKING_STATES.has(session.state)) return false;
    if (source && session.sourceContext?.source && session.sourceContext.source !== source) return false;
    if (trackedSession?.name && session.name === trackedSession.name) return false;
    return true;
  });
}

export async function listSessions(apiKey = JULES_API_KEY) {
  const response = await fetch('https://jules.googleapis.com/v1alpha/sessions?pageSize=100', {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Jules session listing failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return Array.isArray(data.sessions) ? data.sessions : [];
}

async function main() {
  if (!JULES_API_KEY) throw new Error('JULES_API_KEY is not set');
  if (!REPO) throw new Error('GITHUB_REPOSITORY is not set');

  const trackedSession = loadTrackedSession();
  const sessions = await listSessions();
  const blocking = findBlockingSessions(sessions, trackedSession);

  if (blocking.length === 0) {
    console.log('Jules single-flight guard: no competing active session found.');
    console.log('skip=false');
    return;
  }

  console.log(`Jules single-flight guard: ${blocking.length} competing active session(s) found.`);
  for (const session of blocking) {
    console.log(`- ${session.name} [${session.state}]`);
  }
  console.log('skip=true');
}

if (process.argv[1]?.endsWith('jules-single-flight-guard.mjs') && !process.env.JULES_TEST_RUN) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

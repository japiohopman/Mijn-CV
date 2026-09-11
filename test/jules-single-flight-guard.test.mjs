import assert from 'node:assert/strict';
import { findBlockingSessions } from '../scripts/jules-single-flight-guard.mjs';

const source = 'sources/github/japiohopman/Mijn-CV';
const tracked = { name: 'sessions/tracked' };

assert.deepEqual(
  findBlockingSessions([
    { name: 'sessions/tracked', state: 'IN_PROGRESS', sourceContext: { source } },
    { name: 'sessions/other', state: 'IN_PROGRESS', sourceContext: { source } },
  ], tracked, source).map(session => session.name),
  ['sessions/other']
);

assert.deepEqual(
  findBlockingSessions([
    { name: 'sessions/completed', state: 'COMPLETED', sourceContext: { source } },
    { name: 'sessions/failed', state: 'FAILED', sourceContext: { source } },
    { name: 'sessions/other-repo', state: 'IN_PROGRESS', sourceContext: { source: 'sources/github/other/repo' } },
  ], null, source),
  []
);

console.log('✓ Jules single-flight guard tests passed');

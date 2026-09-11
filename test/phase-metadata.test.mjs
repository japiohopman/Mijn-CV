import assert from 'node:assert/strict';
import { parsePhaseMetadata } from '../scripts/jules-orchestrator.mjs';

const explicit = `
## Objective
The project discusses phase/task orchestration in prose.

## Phase Branch
\`phase/10-jules-dispatch\`

## Tasks
- [ ] #68 Verify automatic dispatch
`;

const meta = parsePhaseMetadata(explicit, 10);
assert.equal(meta.phaseBranch, 'phase/10-jules-dispatch');
assert.equal(meta.childTasks[0].issueNumber, 68);

const proseOnly = `
The implementation uses phase/task concepts and mentions phase/should-not-be-used.
`;
const fallback = parsePhaseMetadata(proseOnly, 11);
assert.equal(fallback.phaseBranch, 'phase/11-delivery');

console.log('✓ phase metadata parsing regression checks passed');

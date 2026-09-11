# Architecture Specification: Jules Orchestrator v2 — Issue-Driven Phase Workflow

## 1. Overview & Vision
The Jules Orchestrator v2 shifts the portfolio's execution model from fragile Markdown checkbox tracking in `ROADMAP.md` to GitHub Issues, Phase Branches, and human-gated Phase PRs.

### Core Principles
- **Strategic Roadmap (`ROADMAP.md`)**: High-level strategic vision, phase ordering, and milestone overviews only. It is no longer a machine-readable task queue.
- **Durable Work State (GitHub Issues)**: GitHub Issues serve as the authoritative state machine for work item contracts, dependencies, execution state, and completion criteria.
- **Phase Delivery Units**: Implementation happens on a dedicated Phase Branch (`phase/<phase-id>-<short-name>`). Multiple task issues are completed sequentially on the phase branch without requiring individual per-task PR merges into `master`/`main`.
- **Human Review Gate**: A phase is completed **only** when its combined Phase PR is approved and merged into `master`/`main` by a human reviewer (Jaap). Jules and the orchestrator cannot unilaterally mark a phase complete.

---

## 2. Phase State Machine & Lifecycle

```
                 +-----------+
                 |  PLANNED  |
                 +-----+-----+
                       |
                       v
                 +-----------+     +-----------+
                 |  ACTIVE   |<--->|  BLOCKED  |
                 +-----+-----+     +-----------+
                       |
                       v
            +---------------------+
            |  READY_FOR_REVIEW   | (Phase PR created)
            +----------+----------+
                       |
                       | [Human Review & Merge]
                       v
                 +-----------+
                 | COMPLETE  |
                 +-----------+
```

### State Definitions
1. **`PLANNED` (`status:planned`)**: The phase or task issue is defined and ready in the backlog.
2. **`ACTIVE` (`status:active`)**: The issue is currently being executed by Jules. Only one phase issue and one task issue may be active at any time.
3. **`BLOCKED` (`status:blocked`)**: Execution is paused due to missing information, external dependencies, or unfulfilled prerequisites.
4. **`READY_FOR_REVIEW` (`status:review`)**: All child task issues belonging to the phase are finished, phase validation has passed, and a Phase PR into `master`/`main` is open.
5. **`COMPLETE` (`status:complete`)**: The Phase PR has been reviewed, approved, and merged into `master`/`main` by Jaap. The phase issue is closed.

---

## 3. GitHub Label Vocabulary

| Label | Category | Purpose |
|-------|----------|---------|
| `type:phase` | Type | Identifies a parent Phase Issue representing a major delivery unit. |
| `type:task` | Type | Identifies a child Task Issue representing a concrete implementation unit. |
| `status:planned` | Lifecycle | Work item is defined and eligible for future execution. |
| `status:active` | Lifecycle | Work item is actively in progress by Jules. |
| `status:blocked` | Lifecycle | Work item is blocked and skipped by orchestrator dispatch. |
| `status:review` | Lifecycle | Phase implementation is finished and Phase PR is awaiting human review. |
| `status:complete` | Lifecycle | Work item is merged into main and closed. |
| `jules` | Scope | Marks an issue as managed by the Jules Orchestrator. |

---

## 4. Issue Contracts & Specifications

### Phase Issue Contract
A parent issue representing an entire phase.

- **Title**: `Phase <N> — <Phase Name>`
- **Labels**: `type:phase`, `status:planned` (or `status:active`), `jules`
- **Body Schema**:
```markdown
## Objective
Brief summary of the phase objective.

## Phase Branch
`phase/09-secretary-llm`

## Tasks
- [ ] #101 Task 1 summary
- [ ] #102 Task 2 summary

## Definition of Done
- [ ] All child task issues implemented and verified
- [ ] Test suite passing
- [ ] Documentation updated
```

### Task Issue Contract
A child issue representing one specific implementation step within a phase.

- **Title**: `Task: <Task Name>`
- **Labels**: `type:task`, `status:planned` (or `status:active`), `jules`
- **Body Schema**:
```markdown
## Parent Phase
#100

## Context & Problem
Description of the issue or requirement.

## Requirements & Acceptance Criteria
- Requirement 1
- Requirement 2

## Files Affected
- `scripts/jules-orchestrator.mjs`
- `test/orchestrator.test.mjs`
```

---

## 5. Execution & Orchestration Flow

1. **Phase Discovery**:
   - The orchestrator fetches all open issues labeled `type:phase` and `jules`.
   - It selects the active phase (`status:active`) or the next planned phase (`status:planned`).
2. **Branch Isolation**:
   - The orchestrator verifies or creates the designated phase branch (`phase/...`) off the default branch (`master`/`main`).
3. **Task Dispatch**:
   - The orchestrator identifies the next uncompleted child Task Issue (`status:planned`).
   - It sets the task label to `status:active` and dispatches a Jules session targeting the `startingBranch = phase/...`.
4. **Sequential Commit Assembly**:
   - Jules completes the task, runs verification, and commits/pushes changes directly to the phase branch.
   - Upon task completion, the orchestrator updates the task label to `status:complete` and checks off the task reference in the parent Phase Issue.
5. **Phase PR Preparation & Human Gate**:
   - When all required task issues under the phase are marked `status:complete`, the orchestrator runs phase-level checks.
   - It creates a PR: `phase/<phase-id>-<short-name>` -> `master`/`main`.
   - It sets the Phase Issue label to `status:review`.
   - **Automation pauses** at this human review gate.
6. **Human Merge & Phase Completion**:
   - Jaap reviews the combined Phase PR, inspects test results and changes, and merges into `master`/`main`.
   - On the next orchestrator run, it detects that the Phase PR for the active phase is merged.
   - It marks the Phase Issue as `status:complete`, closes it, and advances to the next planned phase.

---

## 6. Operator Guide for Jaap

### How to Create a New Phase
1. Create a GitHub Issue with title `Phase <N> — <Title>`.
2. Apply labels: `type:phase`, `status:planned`, `jules`.
3. Specify the phase branch name in the issue body (e.g., ``phase/10-new-feature``).
4. Create child Task Issues with title `Task: <Title>` and labels `type:task`, `status:planned`, `jules`.
5. Link child task issues in the Phase Issue body under `## Tasks` as `- [ ] #<task_issue_number>`.

### How to Review and Merge a Phase
1. When a phase finishes execution, the orchestrator sets the Phase Issue status to `status:review` and creates a PR (e.g. `phase/09-... -> master`).
2. Open the PR on GitHub, review the changes, and verify CI status.
3. Click **Merge pull request**.
4. The orchestrator will automatically detect the merge on its next heartbeat, close the Phase Issue (`status:complete`), and pick up the next planned phase.

# 🔄 Development Autoloop Workflow Specification

This document specifies the **Development Autoloop** workflow architecture adapted from [`japiohopman/development-template/templates/development-autoloop`](https://github.com/japiohopman/development-template/tree/main/templates/development-autoloop) for automated development task management in this portfolio codebase.

---

## 1. Overview & Purpose

Development Autoloop is a reusable GitHub Actions workflow loop designed for safe, deterministic end-to-end task execution:

```
Discover Issue → Run Preflight → Reserve Task (Durable Claim) → Dispatch Task to Coding Agent → Reconcile Reality → PR Contract Gate → Trusted Review Relay → Safe Continuation / Completion
```

The workflow acts as the autonomous coordinator that safely discovers GitHub Issues, checks preconditions, reserves single tasks, dispatches them to coding agents (such as Jules), validates PR evidence, relays trusted review feedback, and reconciles state.

---

## 2. Core Execution Loop Phases

| Phase | Description | Key Rules & Actions |
| --- | --- | --- |
| **1. Issue Discovery** | Paginated scan of active GitHub Issues, labels, dependencies, and state ledger. | Never assumes incomplete API snapshots mean zero work. Evaluates candidates deterministically. |
| **2. Preflight Verification** | Check for active provider sessions, open PRs, or existing claims. | Fails closed if any task state is missing, ambiguous, or in progress. Prevents race conditions. |
| **3. Durable Task Reservation** | Reserve single eligible issue on the state ledger (`AUTOLOOP_STATE_BRANCH`). | Prevents concurrent runs from acquiring or attempting the same task. |
| **4. Plan-First / Guarded Dispatch** | Construct task packet and dispatch to coding agent (Jules). | Plan-first validation; requires explicit confirmation in live mode. Keeps API keys protected in `autoloop-dispatch` environment. |
| **5. State Reconciliation** | Compare agent session state against GitHub Issues, branches, PRs, and claims. | Reconciles provider responses safely rather than blindly retrying timed-out calls. |
| **6. PR Contract Gate** | Validate PR evidence, changed file trees, required checks, and head SHA. | Read-only check confirming governing Issue links, exact head commit tree changes, and clean required CI pass. |
| **7. Trusted Review Relay** | Re-evaluate PR review verdicts from configured trusted reviewers (`trustedReviewers`). | Binds review decisions strictly to the exact PR head SHA. Routes repair feedback back to the existing session without creating replacement sessions. |
| **8. Outcome Explanation** | Audit log posting and status report generation. | Explains reason for block, mutation status, and exact safe next action. |

---

## 3. Comparison & Integration with Orchestrator v2

This repository currently uses **Jules Orchestrator v2** (`JULES_ORCHESTRATOR_V2.md`, `scripts/jules-orchestrator.mjs`) driven by GitHub Issues (`type:phase` and `type:task`), single-flight session guard (`scripts/jules-single-flight-guard.mjs`), dedicated phase branches (`phase/<phase-id>-<short-name>`), and human PR gates.

### Synergy & Architecture Alignment:
- **Phase-Driven Scope:** Orchestrator v2 manages high-level Phase Issues and Task Issue selection.
- **Autoloop Contract Enforcement:** The Development Autoloop PR Contract Gate and Trusted Review Relay complement Orchestrator v2 by ensuring every PR submitted by an agent contains exact head commit evidence, non-empty tree diffs, passing required checks, and verified reviewer feedback before merging into default branch.
- **Fail-Closed Safety:** Both systems strictly enforce single-flight concurrency: only one active session per repository is permitted at any given time.

---

## 4. Required Configuration in Consuming Repositories

When configuring Development Autoloop in `config/autoloop.json`:
- `enabled`: Set to `false` during plan/dry-run modes; enabled explicitly for live dispatch.
- `runMode`: `"dry-run"` (default) or `"live"`.
- `requiredChecks`: Exact list of required GitHub Actions check-run names (e.g., `["build-and-test"]`).
- `trustedReviewers`: Exact GitHub logins authorized to issue binding PR review decisions.
- `stateBranch`: Ledger branch for task claims (defaults to `autoloop-state`).

---

## 5. Security & Environment Protection

1. **Protected Environment:** Store `JULES_API_KEY` strictly inside the GitHub Actions Environment `autoloop-dispatch` restricted to default branch deployments (`main` / `master`).
2. **Head SHA Invalidation:** Any new commit pushed to a PR immediately invalidates previous approval evidence and triggers fresh evaluation of required checks and tree differences.
3. **Human Approval Gate:** Human merge review remains the non-negotiable final integration boundary before code reaches default branch.

## Trusted workflow bootstrap (one-time installation)

The Autoloop PR contract gate and trusted review relay deliberately check out code from the trusted base/default branch. They must never execute checker code taken from an unreviewed pull-request head with elevated permissions.

When first installing these checks, the bootstrap PR itself cannot run the newly introduced checker from its own head: GitHub's `pull_request_target` event uses the workflow from the base branch. If the trusted base does not yet contain the checker, the check may fail with a missing-module error before evaluating PR metadata. **This is a one-time bootstrap condition, not a passing check.** Do not fix it by skipping the checker, adding a no-op script that exits successfully, or checking out the PR head.

Safe bootstrap procedure:

1. Confirm the ordinary, unprivileged CI run and bootstrap regression tests pass on the exact bootstrap head SHA.
2. Independently review the added trusted scripts, their imports, workflow permissions, and the disabled-by-default configuration.
3. Perform the one-time manual bootstrap merge only after that review. Do not enable live dispatch or automatic merging as part of the bootstrap.
4. Open or update a small, real test PR after the merge so both workflows load code from the updated trusted base. Confirm that the PR gate emits a real metadata/check-evidence decision for the current head, and that the review relay validates all of its dependencies before classifying whether provider access is allowed.
5. If a later PR still reports a missing trusted module, treat that as a regression and keep the check failed. Do not bypass the check.

Live task dispatch stays disabled until the durable state store is initialized and the at-most-one-session end-to-end proof is recorded in the relevant Issues. Passing the contract gate never approves or merges a PR; human review remains separate.



## One-time claim-state bootstrap (no Jules dispatch)

A missing state branch is a setup error, not an empty ledger. The runner refuses to select or dispatch work until a versioned claims file is readable.

To initialize it, use the manual GitHub Actions workflow named **Autoloop state bootstrap** from the trusted default branch:
1. Confirm the repository field matches this repository exactly.
2. Enter the exact confirmation text requested by the workflow.
3. The workflow checks that production configuration is still disabled/dry-run, that the target is not the default branch, and that no state branch already exists.
4. It creates only a separate data branch containing a versioned claims.json with an empty claims array. It never calls Jules and does not need the Jules API key.
5. If two bootstrap runs race, GitHub's create-ref operation permits only one to win. The other run verifies the winner's empty state; it never overwrites it. A malformed or non-empty state store is a hard blocker and must be investigated rather than reset.

Do not manually create a non-empty initial ledger, do not delete a broken store to make a test pass, and do not enable live mode as part of bootstrap.

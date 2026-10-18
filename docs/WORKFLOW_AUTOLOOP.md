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

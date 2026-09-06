# 🛑 Agent Ground Rules — Jaap Hopman Portfolio & CV

> Read this alongside [AGENT.MD](./AGENT.MD). ROADMAP.md is the current task list; this document is about *how* you're allowed to work through it.

## 1. Don't mark it `[x]` until you've watched it work
A checked box is a claim that you personally ran the application and observed the behavior — not that you wrote code you believe should produce it. You (Jules) are the one who checks the box, as the last step of your own PR, once you've verified — the orchestrator only reads this file, it never edits it, and no one else will check it for you.
- Run `npm test` (or start `server.js` and run Playwright verification scripts) and check the affected page or behavior before checking a box.
- Edit your task's own line in ROADMAP.md **in place** — `- [ ] **Title**` → `- [x] **Title**` — and leave the `Problem`/`Goal`/`Acceptance` bullets under it exactly where they are. Don't move the task to a different section or reformat surrounding tasks.
- If you can't fully verify it, leave it unchecked and say so explicitly in your PR description. An honest unchecked box is more useful than a false checked one — the queue simply won't advance until a human looks at why.

## 2. Stay inside the task's module
Each ROADMAP.md task names the files/areas it touches. If finishing it genuinely requires touching something outside that scope:
- Say so explicitly in your PR description ("this required editing `server.js`, which is outside this task's stated scope, because X").
- Don't silently refactor unrelated code in passing.

## 3. Every change updates the docs it affects — accurately
If your change makes `README.md`, `GOALS.md`, or component documentation outdated, update it in the same PR.

## 4. Repo hygiene — binaries and verification artifacts
- Verification screenshots and Playwright test output belong in `verification/` or `test-results/` (which are gitignored).
- Do not commit large binary files (>1MB) without flagging them in your PR description first.

## 5. Mobile & Responsive Layout Discipline
- Ensure `overflow-x: clip` or `overflow-x: hidden` is preserved so mobile horizontal scroll never breaks.
- Ensure grid layout cards use `minmax(0, 1fr)` to prevent flex/grid blowouts.
- Test both desktop (1280px+) and mobile (375px/390px) layouts when making visual or template changes.

## 6. When you hit an error, leave a trail
If you hit a build or runtime error while working, fix it if it's in scope and note in your PR description what broke, why, and what fixed it. If you can't fix it, say what you tried.

---
*These rules are enforced by review (you, reading the PR), not by tooling alone.*

# Jules Queue Orchestrator — Setup Guide (japiohopman/Mijn-CV)

Automatically starts the next task from `ROADMAP.md`'s "### Ready" list once you've merged the previous task's PR. Runs as a GitHub Actions "heartbeat" every 15 minutes — no server needed.

This pattern is active across `japiohopman/Mijn-CV`, `japiohopman/three_dragon_ante`, and `japiohopman/artificer`.

## Files Included
- `.github/workflows/jules-orchestrator.yml` — the scheduled workflow
- `.github/workflows/ci.yml` — build/lint/test gate on every push and PR
- `scripts/jules-orchestrator.mjs` — the orchestrator logic (generic — defaults to current `GITHUB_REPOSITORY`)
- `.github/jules-queue-state.json` — tracks active session (`{ "activeSession": null }`)
- `AGENT.MD` / `AGENT_RULES.md` — what Jules reads before starting any task
- `ROADMAP.md` — the dispatch queue (`### Ready` is what gets picked up next)

## One-time manual setup

1. **Install the Jules GitHub app** on `japiohopman/Mijn-CV` if not already installed — via jules.google.com, Settings → Connect GitHub repository.

2. **Create or reuse a Jules API key** — jules.google.com/settings#api → "Create new key" (you can reuse the same API key across your repositories).

3. **Add `JULES_API_KEY` to Repo Secrets**:
   - Go to `japiohopman/Mijn-CV` → Settings → Secrets and variables → Actions → "New repository secret".
   - Name: `JULES_API_KEY`
   - Secret: Paste your API key.

4. **Confirm the Jules source name** (optional check):
   ```sh
   curl 'https://jules.googleapis.com/v1alpha/sources' -H 'X-Goog-Api-Key: YOUR_KEY'
   ```
   Look for `sources/github/japiohopman/Mijn-CV` — that matches what `${{ github.repository }}` evaluates to.

5. **Trigger First Run**:
   - Actions tab → "Jules Queue Orchestrator" → "Run workflow".
   - Check the log: it will dispatch the first `### Ready` task or report that the queue is empty.

## Review Gate & How It Works
1. Orchestrator checks `.github/jules-queue-state.json`.
2. If there is an active session, it checks whether its PR has been **merged** and whether the task line in `ROADMAP.md` is marked `[x]`.
3. Once merged & confirmed done, it advances to the next task in `ROADMAP.md` under `### Ready`.
4. When `### Ready` has no unchecked tasks left, the orchestrator pauses automatically.

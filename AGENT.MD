# 🤖 Agent Entry Point — Jaap Hopman Portfolio & CV

Welcome to Jaap Hopman's Creative Developer Portfolio & CV codebase. If you are an AI agent (Jules or otherwise), read these in order before modifying anything.

## 📍 Read in this order
1. 👉 **[ROADMAP.md](./ROADMAP.md)** — what's in scope *right now*. Start here.
2. 👉 **[AGENT_RULES.md](./AGENT_RULES.md)** — the non-negotiable rules for how you're allowed to work.
3. 👉 **[README.md](./README.md)** — project architecture (Node.js, Express, EJS, MVC, routes, CSS variables).
4. 👉 **[GOALS.md](./GOALS.md)** — overarching project goals and feature specs.

## 🛠️ General Guidelines
- **Groundedness**: verify against actual code (`server.js`, `views/`, `public/`) — docs can drift.
- **Verification**: don't mark a `ROADMAP.md` item `[x]` (or move it) until you've actually run the server (`npm start` or `npm test`) and verified the behavior with screenshots/tests. See AGENT_RULES.md §1.
- **Scope discipline**: work the task assigned in `### Active` / `### Ready`. If you think something else should jump the queue, note it in your PR description instead of doing it silently.
- **Repo hygiene**: no unneeded binary bloat; verification screenshots belong in `verification/` (which is gitignored). See AGENT_RULES.md §4.

---
*Happy coding.*

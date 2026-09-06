# 🗺️ Roadmap — Jaap Hopman Creative Developer Portfolio & CV

This is the canonical dispatch roadmap for the Jules orchestrator on `japiohopman/Mijn-CV`. It defines what is completed, active, and ready for execution.

Jules checks its own boxes: once it has personally verified a task (per AGENT_RULES.md §1), it flips that task's own `- [ ]` to `- [x]` in the same PR — the orchestrator script only reads this file, it never edits it. Your review/merge of the PR is the real checkpoint.

## Now

### Completed Tasks

- [x] **Express & EJS Migration**
  - **Problem:** monolithic single HTML file was hard to maintain and extend.
  - **Goal:** migrate to Express server with modular EJS views and partials (`views/partials/`).
  - **Acceptance:** app runs with `npm start`, all routes (`/`, `/share`, `/keuken-cv`) render correctly.

- [x] **Dedicated Kitchen CV Page**
  - **Problem:** needed a dedicated, printable CV route for kitchen / hospitality leadership experience.
  - **Goal:** add `/keuken-cv` route rendering `views/keuken_cv.ejs` with print optimization.
  - **Acceptance:** `/keuken-cv` renders cleanly and `/keuken_cv` redirects to `/keuken-cv`.

- [x] **Dual-Theme Support & Interactive Components**
  - **Problem:** light and dark mode styling required smooth toggle transitions and interactive elements.
  - **Goal:** implement CSS custom properties theme toggle, interactive avatar cross-fade, and gallery image viewers.
  - **Acceptance:** dark/light theme toggle persists in localStorage; interactive components operate smoothly.

- [x] **Orchestrator & CI Infrastructure Setup**
  - **Problem:** repository lacked automated queue orchestrator and GitHub Actions CI workflow.
  - **Goal:** add `.github/workflows/ci.yml`, `.github/workflows/jules-orchestrator.yml`, `scripts/jules-orchestrator.mjs`, `AGENT.MD`, `AGENT_RULES.md`, and `ROADMAP.md`.
  - **Acceptance:** CI passes cleanly; orchestrator can read queue state and dispatch ready tasks.

---

### Ready

- [x] **CI & Test Suite Optimization — Automated Express Route & Asset Check**
  - **Problem:** CI needs a fast, reliable test script that verifies all Express routes (`/`, `/share`, `/keuken-cv`, `/github_action.png`) and essential static assets without blocking.
  - **Goal:** create `test/server.test.js` or `scripts/test-server.js` and configure `"test"` in `package.json` to perform automated HTTP route assertions.
  - **Acceptance:** `npm test` executes cleanly in local environment and CI, verifying HTTP status 200 for all core routes.

- [x] **Accessibility & Semantic HTML Pass**
  - **Problem:** screen readers and navigation need ARIA labels and landmark audit across partials.
  - **Goal:** audit `views/partials/` for semantic tags (`<nav>`, `<main>`, `<header>`, `<footer>`), `aria-expanded` attributes, and `alt` text on images.
  - **Acceptance:** key interactive elements and images have appropriate alt and ARIA attributes; screen reader navigation passes validation.

- [ ] **Performance & Asset Preloading Pass**
  - **Problem:** WebP avatar assets and font assets should load with minimal layout shift on mobile networks.
  - **Goal:** add `<link rel="preload">` hints for hero avatar images and optimize static asset caching headers in `server.js`.
  - **Acceptance:** page load time is crisp on mobile emulation; no unexpected layout shift on initial render.

- [ ] **SEO & OpenGraph Meta Tags Polish**
  - **Problem:** sharing links on social media / WhatsApp needs rich OpenGraph preview image and descriptions.
  - **Goal:** enhance `views/partials/head.ejs` with OpenGraph (`og:title`, `og:description`, `og:image`, `og:url`) and Twitter Card metadata.
  - **Acceptance:** rich preview metadata renders correctly for both `/` and `/share` routes.

---

## Later

- [ ] **Interactive Project Demos & Sandbox Embeds** — embed live interactive preview widgets for key featured projects.
- [ ] **Analytics & Contact Feedback Form** — add privacy-friendly event tracking and serverless contact form endpoint.

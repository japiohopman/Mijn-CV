# 🗺️ Roadmap — Jaap Hopman Creative Developer Portfolio & CV

This is the canonical dispatch roadmap for the Jules orchestrator on `japiohopman/Mijn-CV`. It defines the order in which the portfolio is improved from a technically sound CV site into a focused, convincing professional portfolio.

## How this roadmap works

- Jules works the **first unchecked task under `### Ready`**.
- Jules must personally verify the completed task before changing its own checkbox from `- [ ]` to `- [x]`, following `AGENT_RULES.md`.
- The orchestrator only reads this file; it never checks tasks itself.
- Human review and merge remain the real checkpoint.
- Tasks are deliberately ordered so that **content and positioning come before visual polish, conversion, and final optimization**.
- Jules must not invent employment history, skills, project results, clients, metrics, testimonials, or other biographical claims. When the repository does not provide enough information, preserve the truth and flag the gap in the PR.

## Product Goal

The goal is not merely to make a prettier CV.

The site should answer, within seconds:

1. **Who is Jaap?**
2. **What does he build?**
3. **What makes his background distinctive?**
4. **What evidence exists that he can do it?**
5. **Why should a recruiter, employer, client, or collaborator continue reading or get in touch?**

The portfolio should feel intentional, confident, technically credible, human, and easy to navigate — not like a collection of technologies or a generic developer template.

---

## Now

### Completed Tasks

- [x] **Express & EJS Migration**
  - **Problem:** monolithic single HTML file was hard to maintain and extend.
  - **Goal:** migrate to Express server with modular EJS views and partials (`views/partials/`).
  - **Acceptance:** app runs with `npm start`, all routes render correctly.

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
  - **Goal:** add automated CI, Jules queue orchestration, agent rules, and canonical roadmap dispatch.
  - **Acceptance:** CI passes cleanly and the orchestrator can read and dispatch roadmap tasks.

- [x] **CI & Test Suite Optimization — Automated Express Route & Asset Check**
  - **Problem:** CI needed a fast, reliable test script for core Express routes and essential static assets.
  - **Goal:** automate HTTP assertions for core routes and assets.
  - **Acceptance:** `npm test` executes cleanly locally and in CI.

- [x] **Accessibility & Semantic HTML Pass**
  - **Problem:** navigation and screen-reader semantics needed an audit.
  - **Goal:** improve landmarks, labels, keyboard navigation, ARIA state, and image alternatives.
  - **Acceptance:** key interactive elements and images have appropriate semantics and accessible states.

- [x] **Performance & Asset Preloading Pass**
  - **Problem:** important visual assets and caching could be improved.
  - **Goal:** add appropriate preload hints and static asset caching.
  - **Acceptance:** no obvious loading regressions or unexpected initial layout movement are introduced.

- [x] **SEO & OpenGraph Meta Tags Polish**
  - **Problem:** shared links lacked complete rich metadata.
  - **Goal:** improve canonical, OpenGraph, and social-card metadata.
  - **Acceptance:** `/` and `/share` expose correct page metadata.

---

### Ready

## Phase 2 — Positioning & Narrative

- [x] **Portfolio Positioning Audit — Define the Core Professional Message**
  - **Problem:** the current site communicates a broad mix of development, AI, design, games, music, and hospitality experience, but does not yet make the central professional value proposition immediately obvious.
  - **Goal:** audit the existing copy and establish one clear positioning statement, supporting message hierarchy, target audiences, and tone. Distinguish core capability from experimentation without erasing the breadth of the profile.
  - **Acceptance:** a concise positioning hierarchy exists in the site copy; hero, about, skills, projects, and CTAs reinforce the same message; no invented claims are introduced.

- [x] **Hero Copy & First Impression — Make the Value Proposition Immediate**
  - **Problem:** the first screen should communicate more than a job title and a list of interests.
  - **Goal:** rewrite the hero so a visitor can understand who Jaap is, what he builds, and what makes his approach distinctive within a few seconds. Preserve the authentic connection between software, creative work, and professional kitchen experience where it strengthens the story.
  - **Acceptance:** hero has a strong primary statement, concise supporting copy, and clear primary/secondary actions; copy is confident rather than generic; desktop and mobile remain balanced.

- [x] **About Narrative — Turn a Biography into a Professional Story**
  - **Problem:** the current biography contains useful material but can read as a collection of background facts rather than a deliberate professional narrative.
  - **Goal:** rewrite the About section around the progression from professional kitchen work and creative disciplines into software development, emphasizing transferable strengths such as execution, systems thinking, preparation, adaptability, and making things real.
  - **Acceptance:** the section reads naturally, has a clear narrative arc, avoids repetition, and makes the unusual career path an advantage rather than an apology.

- [x] **Skills Architecture — Separate Core Strengths from Exploration**
  - **Problem:** a long technology list can make the profile look unfocused even when the underlying experience is broad.
  - **Goal:** restructure skills into meaningful groups such as core development, practical tools/platforms, and experimental/project-based technologies. Use only technologies supported by the existing repository and projects.
  - **Acceptance:** visitors can identify core competencies immediately; secondary and experimental technologies remain visible without competing with the core; no skill is overstated.

## Phase 3 — Evidence & Projects

- [x] **Project Portfolio Structure — Lead with Evidence, Not Technology Names**
  - **Problem:** projects need to demonstrate capability rather than simply list what was used to build them.
  - **Goal:** establish a reusable project-card/detail structure covering what the project is, the problem or goal, Jaap's role, what was built, relevant technology, and the interesting technical or creative challenge.
  - **Acceptance:** featured projects use a consistent information hierarchy; each project communicates its value without requiring the visitor to understand the technology first.

- [x] **Featured Projects Copy Pass — Make the Best Work Stand Out**
  - **Problem:** the strongest projects can be buried among broad descriptions and technology lists.
  - **Goal:** identify the most convincing existing projects and rewrite their descriptions for clarity, specificity, and evidence. Do not fabricate metrics or outcomes; where evidence is missing, describe the implementation honestly.
  - **Acceptance:** a visitor can understand the purpose and significance of every featured project quickly; the strongest work receives the strongest visual and editorial emphasis.

- [x] **Project Detail & Technical Credibility Pass**
  - **Problem:** technically curious visitors need enough substance to trust the work without turning the portfolio into documentation.
  - **Goal:** add concise technical context where useful: architecture, implementation decisions, AI/tooling use, interaction design, or constraints. Keep detail progressive so non-technical visitors are not overwhelmed.
  - **Acceptance:** selected projects contain credible technical depth with clear hierarchy and no unnecessary implementation dump.

## Phase 4 — Conversion & Contact

- [x] **CTA Strategy — Give Every Visitor a Clear Next Step**
  - **Problem:** a strong portfolio can still fail if the visitor does not know what to do next.
  - **Goal:** define a primary contact action and appropriate secondary actions for employment, collaboration, or project discussion. Make CTA language specific and human rather than generic boilerplate where possible.
  - **Acceptance:** primary CTA is visually and semantically obvious; CTAs are consistent across relevant sections; keyboard and mobile interaction work correctly.

- [x] **Contact Experience — Make Reaching Out Feel Effortless**
  - **Problem:** contact should be a natural continuation of the portfolio rather than an afterthought.
  - **Goal:** audit the current contact path and improve clarity, feedback, validation, error handling, spam resistance, and privacy. Reuse existing infrastructure where possible instead of adding unnecessary services.
  - **Acceptance:** successful and failed submissions have clear feedback; no sensitive data is unnecessarily exposed or logged; experience works on mobile and desktop.

- [x] **Kitchen CV Positioning — Connect Both Professional Worlds**
  - **Problem:** the kitchen CV currently exists as a separate route and can feel disconnected from the developer identity.
  - **Goal:** improve the relationship between the main portfolio and the kitchen/hospitality CV so the career history feels intentional. Present hospitality leadership as valuable professional experience and context, not unrelated legacy material.
  - **Acceptance:** navigation between the two profiles is clear; kitchen CV remains accurate and printable; main portfolio explains the relationship without forcing one career story onto every visitor.

## Phase 5 — Visual System & UX

- [x] **Visual Hierarchy Pass — Establish a Deliberate Reading Rhythm**
  - **Problem:** content quality is weakened when every section has equal visual weight.
  - **Goal:** create a clear hierarchy for hero, proof, projects, skills, background, and contact. Use spacing, typography, scale, and contrast to guide attention rather than decorative effects.
  - **Acceptance:** a first-time visitor can scan the page and understand the intended order of information; no section competes unnecessarily with the hero or featured projects.

- [x] **Navigation & Interaction Polish — Make the Site Feel Finished**
  - **Problem:** functional interactions can still feel like prototype controls.
  - **Goal:** audit navigation, theme toggle, image/avatar interactions, buttons, links, focus states, hover states, transitions, and mobile menu behavior. Add motion only where it communicates state or improves orientation.
  - **Acceptance:** interactions have clear feedback, keyboard focus is visible, reduced-motion preferences are respected, and no interaction feels decorative at the expense of usability.

- [x] **Responsive Layout Audit — 375px to Large Desktop**
  - **Problem:** a portfolio is often viewed first on mobile, while desktop needs to communicate polish and confidence.
  - **Goal:** systematically test 375px, 390px, tablet widths, 1280px+, and wide desktop layouts. Fix wrapping, overflow, image cropping, grid behavior, typography, spacing, and touch targets.
  - **Acceptance:** no horizontal scrolling or clipped essential content; grids use safe sizing; navigation and CTAs remain usable at all tested widths.

- [x] **Typography & Content Density Pass**
  - **Problem:** strong copy loses impact when paragraphs, labels, and headings are poorly paced.
  - **Goal:** tune font sizes, line lengths, paragraph spacing, heading rhythm, labels, metadata, and content density. Keep the visual identity restrained and professional rather than turning the portfolio into a UI showcase.
  - **Acceptance:** long-form text is comfortable to read, headings establish clear hierarchy, and project information remains scannable.

## Phase 6 — Technical Quality, Discoverability & Trust

- [x] **SEO Foundation Expansion — Structured Metadata & Page Semantics**
  - **Problem:** basic OpenGraph metadata is not the same as a complete discoverability strategy.
  - **Goal:** audit titles, descriptions, canonical URLs, robots behavior, headings, image metadata, language declarations, structured data opportunities, and page-specific metadata. Only add structured data that is truthful and supported by the site.
  - **Acceptance:** every public page has intentional metadata and semantic structure; social previews remain correct; no duplicate or contradictory metadata is introduced.

- [x] **Performance Audit — Measure Before Optimizing**
  - **Problem:** preload hints and cache headers are useful but do not prove that the site is fast.
  - **Goal:** measure the real loading path and identify the largest remaining costs in images, fonts, CSS, JavaScript, server response, and rendering. Optimize the highest-impact issues first without degrading quality.
  - **Acceptance:** PR includes concrete measurements or repeatable checks, demonstrates improvement where possible, and avoids speculative micro-optimizations.

- [x] **Accessibility Verification — Move Beyond Markup**
  - **Problem:** semantic HTML and ARIA attributes alone do not prove an accessible experience.
  - **Goal:** perform a focused keyboard, focus-order, contrast, reduced-motion, form, image, and screen-reader-oriented audit of actual pages.
  - **Acceptance:** critical flows are keyboard usable, focus is understandable, interactive state is exposed correctly, and known accessibility issues are either fixed or documented.

- [x] **Privacy & Analytics Decision — Measure Only What Is Justified**
  - **Problem:** analytics can add value but can also add complexity, privacy concerns, and unnecessary tracking.
  - **Goal:** determine whether analytics are actually useful for this portfolio. If implemented, choose the smallest privacy-conscious approach and document what is measured and why. If not justified, document the decision instead of adding tracking for its own sake.
  - **Acceptance:** repository contains a clear decision and, if analytics are implemented, no unnecessary personal tracking is introduced.

## Phase 7 — Interactive Proof & Final Polish

- [x] **Interactive Project Demos — Add Proof Where It Strengthens the Portfolio**
  - **Problem:** selected projects are stronger when visitors can experience the result instead of only reading about it.
  - **Goal:** identify projects that genuinely benefit from an interactive preview and add lightweight, resilient embeds or demos. Avoid embedding everything and avoid creating a performance problem.
  - **Acceptance:** only high-value projects receive demos; embeds have loading/error/fallback behavior; mobile usability and performance remain acceptable.

- [x] **Share & Presentation Quality — Make the Portfolio Look Good Everywhere**
  - **Problem:** links are often encountered outside the site itself, through social platforms, messaging apps, or direct sharing.
  - **Goal:** audit `/share`, social preview imagery, page titles, descriptions, favicons/icons, and visual consistency when the site is opened from an external link.
  - **Acceptance:** shared links present an intentional identity and useful context; preview assets are correct and do not misrepresent the page.

- [x] **Final Portfolio QA — Content, UX, Accessibility, Performance & Technical Integrity**
  - **Problem:** improvements made in isolation can introduce inconsistencies elsewhere.
  - **Goal:** perform a final end-to-end audit of every public route and important interaction, covering copy consistency, links, forms, responsive behavior, accessibility, console/runtime errors, tests, SEO metadata, performance regressions, and print output for the kitchen CV.
  - **Acceptance:** `npm test` passes; all public routes are checked; no known high-severity UX or runtime issue remains; PR documents what was tested and any intentionally deferred work.

---

## Later

- [x] **Phase 8 — Portfolio Secretary: Product & Architecture Definition**
  - **Problem:** visitors can navigate the portfolio, but they still have to understand the site's structure themselves. A lightweight conversational interface could act as a digital secretary that answers practical questions and takes visitors directly to the relevant content.
  - **Goal:** define a deterministic, non-LLM assistant architecture before adding any AI service. The first version should understand a controlled set of intents/questions, answer only from repository-backed content, and expose explicit navigation/action tools.
  - **Design direction:** treat the assistant as a small query engine rather than a chatbot that "pretends to think". Keep the knowledge base separate from UI rendering and make every available action explicit and testable.
  - **Acceptance:** architecture is documented, supported intents are enumerated, answer sources are identified, navigation/tool contracts are defined, and there is a clear boundary between deterministic logic and any future LLM adapter. No external AI dependency is introduced in this phase.

- [x] **Phase 8 — Assistant Knowledge Registry & Intent Engine**
  - **Problem:** free-form questions cannot be answered reliably unless the site has a canonical set of facts and mappings.
  - **Goal:** create a small structured knowledge registry for professional identity, projects, skills, career/background, contact options, routes, and common visitor questions. Add deterministic intent matching for queries such as "wat doet Jaap?", "welke projecten heeft hij?", "heeft hij ook een keuken-cv?", "waar staat Project X?", and "hoe neem ik contact op?".
  - **Acceptance:** answers come from structured site data rather than duplicated hard-coded prose; unsupported questions receive a transparent fallback; intent matching is predictable, small, and unit-testable.

- [ ] **Phase 8 — Assistant Tool Calls & Navigation Actions**
  - **Problem:** answering a question is less useful when the visitor still has to find the destination manually.
  - **Goal:** implement explicit assistant actions such as `navigateToRoute`, `navigateToSection`, `openProject`, `openShare`, and `openKitchenCV`. Tool results should be structured and rendered by the UI; the assistant should never fabricate URLs or actions outside the allow-list.
  - **Acceptance:** relevant questions can trigger a visible action such as “Bekijk project”, “Open keuken-CV”, or “Ga naar contact”; every action resolves to a known route/anchor; keyboard navigation and normal browser navigation remain fully functional without the assistant.

- [ ] **Phase 8 — Secretary UI & Conversational UX**
  - **Problem:** the assistant needs to feel like part of the portfolio rather than a generic floating chat widget.
  - **Goal:** design a compact chat/secretary interface with an input, conversation history, suggested questions, clear action buttons, loading-free deterministic responses, and accessible focus/keyboard behavior. Positioning and wording should reinforce "site secretary" rather than imply human or AI consciousness.
  - **Acceptance:** the interface is usable on mobile and desktop, does not obstruct core content, has clear empty/error states, respects reduced motion, and remains useful with JavaScript failure or when the assistant is unavailable.

- [ ] **Phase 8 — Assistant Test Matrix & Content Governance**
  - **Problem:** a conversational layer can silently become inaccurate as the portfolio changes.
  - **Goal:** add automated tests for intent matching, answer selection, tool-call validation, route resolution, and fallback behavior. Document the knowledge registry as part of the site's content architecture so future portfolio edits update the secretary intentionally.
  - **Acceptance:** core intents and every exposed tool have automated coverage; invalid tool targets are rejected; changing a project or route cannot leave stale assistant links without a failing test or explicit content update.

- [ ] **Phase 9 — Optional LLM Adapter (Future, Not Part of MVP)**
  - **Problem:** deterministic matching will eventually become limiting for natural-language questions and broader discovery.
  - **Goal:** only after the deterministic secretary is proven useful, define an optional LLM adapter that maps natural language onto the same canonical knowledge registry and tool contracts. The LLM must not become the source of truth or gain unrestricted navigation capabilities.
  - **Acceptance:** the deterministic assistant remains the fallback; LLM output is constrained to known intents/tools and repository-backed facts; provider credentials and privacy implications are explicitly handled before any production rollout.

- [ ] **Ongoing Portfolio Content Iteration** — revisit project evidence, screenshots, demos, and case-study depth as real work is added.
- [ ] **Additional Interactive Experiments** — add only experiments that strengthen the professional story rather than expanding the technology list for its own sake.

---

## Definition of Done for the Roadmap

The portfolio is considered substantially complete when:

- the first screen communicates a clear professional identity;
- the career story is distinctive and coherent;
- core skills are obvious without hiding useful breadth;
- featured projects provide evidence rather than only technology names;
- visitors have a clear path to contact or continue exploring;
- the kitchen/hospitality background strengthens rather than confuses the narrative;
- the visual system is consistent and restrained;
- mobile and desktop layouts are deliberately tested;
- accessibility is verified through actual interaction, not only markup inspection;
- SEO and sharing metadata are intentional;
- performance decisions are measurement-driven;
- automated tests protect important behavior;
- the secretary, when implemented, can answer supported questions from canonical site data and navigate through validated actions;
- Jules has personally verified each completed task before checking it off;
- and the final result feels like a finished professional portfolio rather than an evolving developer experiment.

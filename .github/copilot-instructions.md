# Mijn-CV Repository Instructions

## Source of truth
- `ROADMAP.md` is strategic documentation, not the execution queue.
- GitHub Issues define executable work and phase/task state.
- Phase branches are integration boundaries; the phase PR into `master` is the human review gate.
- Do not invent parallel sources of truth for the same domain data or workflow state.
- Inspect existing architecture and documentation before introducing a new abstraction.

## Repository architecture
- This repository is an Express + EJS portfolio/CV application.
- Keep server, presentation, content/data, automation, and tests clearly separated.
- Reuse existing routes, partials, utilities, and data structures before adding alternatives.
- Prefer small, composable modules over large multi-purpose scripts.
- Keep browser behavior progressive and avoid unnecessary client-side frameworks.

## Work management
- A Task Issue must be completed as part of its parent Phase Issue.
- Multiple tasks in one phase belong on the same phase branch.
- Do not create a task-specific PR into `master` unless the phase contract explicitly requires it.
- Never mark a phase complete merely because code was committed. Phase completion requires the combined Phase PR to be human-reviewed and merged.
- Do not use ROADMAP checkboxes as an orchestration mechanism.

## Git and change discipline
- Work only on the branch supplied by the task/phase contract.
- Keep commits focused and explain architectural changes clearly.
- Do not rewrite unrelated files or perform broad cleanup without a requirement.
- Do not modify secrets or commit credentials.
- Preserve existing working automation unless the task explicitly changes it.

## UI and accessibility
- Preserve the site's existing visual identity unless redesign is part of the task.
- Favor semantic HTML, keyboard accessibility, responsive layouts, clear focus states, and predictable interaction feedback.
- Avoid adding dependencies for problems that can be solved with the existing stack.

## Assets and content
- Reuse canonical assets and existing asset paths before adding duplicates.
- Keep asset naming and directory structure predictable.
- Do not silently replace production content with placeholders.

## Testing and evidence
- Run the repository's relevant automated tests before claiming completion.
- For browser-facing work, perform an appropriate runtime or browser check when the change can affect presentation or interaction.
- Report what was verified, what could not be verified, and any remaining uncertainty.
- Do not claim a test passed unless it actually ran successfully.

## Specialist agents
Specialist profiles under `.github/agents/` provide focused expertise. They complement these repository-wide rules; they do not override them.

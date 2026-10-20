# Trusted Autoloop bootstrap verification

This documentation-only change verifies the trusted PR contract gate and review relay after bootstrap PR #89 and the Markdown evidence fix in PR #91.

## Safety boundaries
- No Jules session is created.
- No provider secret is needed or exposed by this test.
- Autoloop remains disabled and in `dry-run`.
- Repair dispatch, scheduled dispatch, and automatic merge remain disabled.
- A passing contract gate does not approve or merge a pull request.

## Verification record
The pull request's `Verification` section records the exact head SHA and changed path. The trusted gate must accept both when wrapped in Markdown inline-code formatting, verify successful checks for the exact SHA, and produce a real decision. The review relay must load from the current trusted base, complete its read-only/no-provider decision, and not create a session.

Issue: #85

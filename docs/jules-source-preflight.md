# Jules Source Preflight

The Jules queue orchestrator validates the configured Jules source and starting branch before creating a session.

A `400 FAILED_PRECONDITION` from `POST /v1alpha/sessions` is not automatically a code-format error. Check that the repository is connected to Jules and that the requested starting branch is visible in the Jules source.

# Automatic Jules Dispatch Validation

The Jules Queue Orchestrator is intended to discover eligible GitHub Phase and Task Issues automatically.

A Phase Issue defines the implementation branch. A Task Issue must declare its parent phase and primary specialist agent. The orchestrator creates or reuses the phase branch, loads the repository-wide and specialist instructions, and starts the Jules session.

Issue events trigger the orchestrator immediately; the scheduled heartbeat remains as recovery. Human review remains the final phase integration gate.

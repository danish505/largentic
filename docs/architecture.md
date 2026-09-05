# V2 Architecture

Largentic V2 is a TypeScript CLI that coordinates a durable four-stage workflow:

```text
planner -> implementer -> tester -> reviewer
```

The CLI creates a run under `.largentic/runs/<run-id>/`. The run directory is the source of truth for stage handoffs, state, and audit events.

## Stage artifacts

- Planner writes `plan.md`.
- Implementer reads `plan.md` and returns `implementation.md`.
- Tester reads the plan and implementation and returns `test-results.md`.
- Reviewer reads all preceding artifacts and returns `review.md`.

The engine writes each artifact at the run root and preserves attempt-specific results under `attempts/<attempt>/`.

## State and events

`state.json` stores the current status, attempt number, timestamps, and failure information. Updates are written atomically. `events.jsonl` is append-only and records stage starts, completions, failures, approvals, retries, and termination.

## Providers

The engine depends on the `AgentProvider` interface. V2 ships with a Codex CLI provider for production use and a deterministic fake provider for tests.

## Project configuration

`lh init` creates `.largentic/config.yaml` and the required native Codex files under `.codex/`. Initialization templates are stored in the repository's `templates/` directory.

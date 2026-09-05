# V2 File Handoff Contract

Largentic V2 uses the run directory as the durable handoff boundary:

```text
.largentic/runs/<run-id>/
```

Each active run contains:

```text
manifest.json
state.json
events.jsonl
plan.md
implementation.md
test-results.md
review.md
attempts/<attempt>/
```

The workflow is:

```text
planner     -> plan.md
implementer -> implementation.md
tester      -> test-results.md
reviewer    -> review.md
```

The engine writes the final artifact at the run root and keeps attempt-specific stage result JSON and Markdown files under `attempts/<attempt>/`. Chat output is not the source of truth.

## State

Keep state and reports concise and factual. Do not place secrets, full command logs, stack traces, or large diffs in `state.json`. Store raw output in an ignored project-local location when it is needed for diagnosis.

The legacy V1 handoff contract under `harness/` is separate from this V2 contract.

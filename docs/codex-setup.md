# Codex Setup for Largentic V2

Largentic V2 uses the native Codex agent configuration in the target project's `.codex/` directory.

## Project files

Run:

```bash
lh init
```

This creates:

```text
.largentic/config.yaml
.largentic/task.md
.largentic/runs/
.codex/config.toml
.codex/global-rules.md
.codex/agents/planner.toml
.codex/agents/implementer.toml
.codex/agents/tester.toml
.codex/agents/reviewer.toml
```

The V2 engine passes the current run ID and run directory to each agent. Agents return their stage artifact as the final Markdown response; the engine persists it under `.largentic/runs/<run-id>/`.

## Requirements

- Node.js 20+
- Git
- Codex CLI for production runs

For Laravel projects, also install PHP and Composer. Browser checks should use the project's own Playwright configuration when applicable.

## Running

```bash
lh doctor
lh run "Describe the task"
```

Use `lh status <run-id>`, `lh inspect <run-id>`, and `lh report <run-id>` to inspect a run.

The legacy V1 `harness/` directory is independent and is not required by V2.

Make focused, reversible changes. Preserve unrelated worktree changes and existing project conventions. Never place secrets in code or logs. Add appropriate tests for new behavior and regression coverage for bug fixes.

## Project Memory

Read `.largentic/memory.md` before planning, implementing, testing, or reviewing when it exists. Treat the repository as the source of truth when memory and repository evidence differ.

The memory file is concise, durable project context: verified architecture decisions, conventions, reliable commands, and non-obvious operational constraints. Never store secrets, credentials, personal data, raw command output, temporary debugging notes, task-specific plans, or run state there.

The implementer maintains memory after completing work: retain useful verified entries; add newly confirmed, reusable knowledge; and remove entries that are stale, duplicated, vague, or contradicted by repository evidence. Do not rewrite memory merely for formatting.

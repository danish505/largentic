## Largentic V2 Harness Execution Protocol

When the Captain asks to run the harness:

1. Read `.codex/global-rules.md` and the current task.
2. Use the planner agent to write `.largentic/runs/<run-id>/plan.md`.
3. Use the implementer agent to read the plan and implement the patch.
4. Use the tester agent to write `.largentic/runs/<run-id>/test-results.md`.
5. Use the reviewer agent to write `.largentic/runs/<run-id>/review.md`.
6. If the tester fails, repeat implementer -> tester.
7. If the review fails, repeat implementer -> tester -> reviewer.
8. Use the run files as the source of truth, not chat output.

Testing:
- Assume PHPUnit unless the project specifies another test runner.
- Bug fixes should include regression tests when practical.
- New behavior should include unit and/or feature tests as appropriate.
- Use Laravel helpers such as `actingAs()`, `assertStatus()`, `assertJson()`, and `assertDatabaseHas()`.
- Use fakes where appropriate: `Mail::fake()`, `Notification::fake()`, `Queue::fake()`, `Event::fake()`, `Storage::fake()`, and `Http::fake()`.
- Run `npm run build` when TypeScript or other frontend assets are affected.

Git safety:
- Inspect `git status` before editing.
- Do not overwrite unrelated dirty files.
- Keep patches focused.

File handoff:
- The active run directory is `.largentic/runs/<run-id>/`.
- Keep `plan.md`, `implementation.md`, `test-results.md`, and `review.md` concise and factual.
- Put raw command output in the run directory or another ignored project-local location.
- Do not commit local state, logs, diffs, secrets, or `.env` files.

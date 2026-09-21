# Contributing

Thanks for considering a contribution.

## Guidelines

- Keep agent instructions concise and practical.
- Preserve the file-based handoff contract.
- Avoid project-specific company/client details.
- Do not commit logs, artifacts, secrets, or local state.
- Prefer examples over real project output.

## Profiles

- Built-in profiles belong in `profiles/<id>/` and must be declarative YAML plus referenced Markdown assets; profile loading must never execute code.
- Project-local profiles are manually authored in `.largentic/profiles/<id>/`. Do not add profile creation or scaffolding commands.
- Keep `generic` framework-neutral. Laravel/PHP guidance belongs only in `laravel` assets.
- Validate asset paths against traversal and escaping symlinks. Test malformed manifests and unknown IDs.
- Update generic, Laravel, and local-profile fixtures when changing resolution or materialization behavior.
- Keep the estimated profile prompt content within the budget in `src/profiles/size-budget.ts`.

## Verification

Run `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:package`. The package output must include `profiles/` and `schemas/`.

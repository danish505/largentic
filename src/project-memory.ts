import * as fs from 'fs';
import * as path from 'path';
import { HARNESS_DIR_NAME } from './constants.js';

export const PROJECT_MEMORY_FILE = 'memory.md';

const PROJECT_MEMORY_TEMPLATE = `# Project Memory

Use this file for small, durable facts that help future Codex runs work safely and consistently.

## Retention rules

- Keep verified architecture decisions, project conventions, reliable commands, and non-obvious operational constraints.
- Do not record secrets, credentials, personal data, raw logs, temporary debugging notes, task-specific plans, or run status.
- Remove entries that are stale, duplicated, vague, or contradicted by the repository.
- Keep each entry concise and include the relevant path or evidence when useful.

## Entries

<!-- Add verified, reusable knowledge here. -->
`;

export function projectMemoryPath(cwd: string): string {
  return path.join(cwd, HARNESS_DIR_NAME, PROJECT_MEMORY_FILE);
}

/** Create the project memory only when it does not already exist. */
export function ensureProjectMemory(cwd: string): string {
  const memoryPath = projectMemoryPath(cwd);
  if (!fs.existsSync(memoryPath)) {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    fs.writeFileSync(memoryPath, PROJECT_MEMORY_TEMPLATE, 'utf8');
  }
  return memoryPath;
}

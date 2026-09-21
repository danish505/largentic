import { RunManager, isRunStatus } from '../../engine/run-manager.js';
import type { RunStatus } from '../../types.js';

export interface RunSelectionOptions { latest?: boolean; status?: string; }

export interface RunSelection { runId: string; warnings: string[]; }

export function resolveRunId(manager: RunManager, runId: string | undefined, options: RunSelectionOptions = {}): RunSelection {
  if ((runId ? 1 : 0) + (options.latest ? 1 : 0) !== 1) throw new Error('Provide exactly one run ID or --latest.');
  if (runId) return { runId, warnings: [] };
  if (options.status && !isRunStatus(options.status)) throw new Error(`Invalid status: ${options.status}`);
  const { summaries, warnings } = manager.listSummaries();
  const summary = summaries.find((item) => !options.status || item.status === options.status);
  if (!summary) throw new Error(options.status ? `No valid runs found with status ${options.status}.` : 'No valid runs found.');
  return { runId: summary.runId, warnings };
}

export function runsCommand(cwd: string, options: { limit?: string; status?: string; latest?: boolean } = {}): void {
  try {
    if (options.status && !isRunStatus(options.status)) throw new Error(`Invalid status: ${options.status}`);
    if (options.latest && options.limit !== undefined) throw new Error('--latest cannot be combined with --limit.');
    const limit = options.latest ? 1 : parseLimit(options.limit);
    const { summaries, warnings } = new RunManager(cwd).listSummaries();
    const selected = summaries.filter((item) => !options.status || item.status === options.status).slice(0, limit);
    if (selected.length === 0) console.log('No runs found.');
    else {
      console.log('Run ID                     Status                     Attempt  Updated                   Task');
      selected.forEach((item) => console.log(`${item.runId}  ${item.status.padEnd(25)}  ${String(item.attempt).padEnd(7)}  ${item.updatedAt}  ${item.task.replace(/\s+/g, ' ').slice(0, 80)}`));
    }
    warnings.forEach((warning) => console.error(`⚠ ${warning}`));
  } catch (error: unknown) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 10;
  if (!/^[1-9]\d*$/.test(value)) throw new Error('--limit must be a positive base-10 integer.');
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)) throw new Error('--limit must be a positive safe integer.');
  return limit;
}

export function validRunStatus(value: string): value is RunStatus { return isRunStatus(value); }

import * as fs from 'fs';
import * as path from 'path';
import { ulid } from 'ulid';
import type { RunManifest, RunState, RunStatus } from '../types.js';
import { StateStore } from '../state/state-store.js';
import { HARNESS_DIR_NAME } from '../constants.js';

const SCHEMA_VERSION = '2.0' as const;

export interface RunPaths {
  runDir: string;
  manifestFile: string;
  stateFile: string;
  eventsFile: string;
  attemptDir: (n: number) => string;
}

export interface LoadedRun { runDir: string; paths: RunPaths; manifest: RunManifest; state: RunState; }
export interface RunSummary { runId: string; task: string; profile: string; provider: string; status: RunStatus; attempt: number; updatedAt: string; }
export interface RunListResult { summaries: RunSummary[]; warnings: string[]; }

type MetadataFailure = 'invalid_id' | 'not_found' | 'unavailable' | 'invalid_json' | 'invalid_metadata';

class RunMetadataError extends Error {
  constructor(readonly runId: string | null, readonly reason: MetadataFailure) {
    super(publicMessage(runId, reason));
  }
}

export class RunManager {
  private baseDir: string;

  constructor(cwd: string) {
    this.baseDir = path.join(cwd, HARNESS_DIR_NAME, 'runs');
  }

  create(task: string, options: { profile: string; provider: string; gitBranch?: string; gitCommit?: string }): { runId: string; paths: RunPaths; manifest: RunManifest } {
    const runId = ulid();
    const runDir = path.join(this.baseDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, 'attempts', '1'), { recursive: true });

    const manifest: RunManifest = {
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      task,
      profile: options.profile,
      provider: options.provider,
      created_at: new Date().toISOString(),
      cwd: process.cwd(),
      git_branch: options.gitBranch,
      git_commit: options.gitCommit,
    };

    const paths = this.buildPaths(runDir);
    fs.writeFileSync(paths.manifestFile, JSON.stringify(manifest, null, 2), 'utf8');

    const store = new StateStore(runDir);
    store.initialize(runId);

    return { runId, paths, manifest };
  }

  load(runId: string): LoadedRun {
    if (!isRunId(runId)) throw new RunMetadataError(null, 'invalid_id');
    const runDir = path.join(this.baseDir, runId);
    const paths = this.buildPaths(runDir);
    let manifest: RunManifest;
    let state: RunState;
    try {
      if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) throw new RunMetadataError(runId, 'not_found');
      manifest = JSON.parse(fs.readFileSync(paths.manifestFile, 'utf8')) as RunManifest;
      state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8')) as RunState;
    } catch (error: unknown) {
      if (error instanceof RunMetadataError) throw error;
      if (error instanceof SyntaxError) throw new RunMetadataError(runId, 'invalid_json');
      throw new RunMetadataError(runId, 'unavailable');
    }
    try { validateLoadedRun(runId, manifest, state); } catch { throw new RunMetadataError(runId, 'invalid_metadata'); }
    return { runDir, paths, manifest, state };
  }

  list(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];
    return fs.readdirSync(this.baseDir).filter((entry) => {
      try { return fs.statSync(path.join(this.baseDir, entry)).isDirectory(); } catch { return false; }
    });
  }

  listSummaries(): RunListResult {
    if (!fs.existsSync(this.baseDir)) return { summaries: [], warnings: [] };
    const warnings: string[] = [];
    const summaries: RunSummary[] = [];
    let entries: string[];
    try { entries = fs.readdirSync(this.baseDir); } catch { return { summaries, warnings: ['Skipping unavailable run directory.'] }; }
    for (const entry of entries) {
      try {
        const candidate = path.join(this.baseDir, entry);
        if (!fs.statSync(candidate).isDirectory()) continue;
        if (!isRunId(entry)) {
          warnings.push('Skipping invalid run directory.');
          continue;
        }
        const loaded = this.load(entry);
        summaries.push({ runId: entry, task: loaded.manifest.task, profile: loaded.manifest.profile, provider: loaded.manifest.provider, status: loaded.state.status, attempt: loaded.state.attempt, updatedAt: loaded.state.updated_at });
      } catch (error: unknown) {
        if (error instanceof RunMetadataError) warnings.push(listWarning(error));
        else if (isRunId(entry)) warnings.push(`Skipping run ${entry}: metadata unavailable.`);
        else warnings.push('Skipping unavailable run directory.');
      }
    }
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { summaries, warnings };
  }

  private buildPaths(runDir: string): RunPaths {
    return {
      runDir,
      manifestFile: path.join(runDir, 'manifest.json'),
      stateFile:    path.join(runDir, 'state.json'),
      eventsFile:   path.join(runDir, 'events.jsonl'),
      attemptDir:   (n: number) => path.join(runDir, 'attempts', String(n)),
    };
  }
}

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && [
    'created', 'planning', 'awaiting_plan_approval', 'implementing', 'testing',
    'testing_failed', 'reviewing', 'awaiting_review_approval', 'review_rejected',
    'approved', 'cancelled', 'failed', 'blocked',
  ].includes(value);
}

function validateLoadedRun(runId: string, manifest: RunManifest, state: RunState): void {
  const manifestRecord = manifest as unknown as Record<string, unknown>;
  const stateRecord = state as unknown as Record<string, unknown>;
  if (manifestRecord.schema_version !== SCHEMA_VERSION || stateRecord.schema_version !== SCHEMA_VERSION) throw new Error(`Run ${runId} has an unsupported schema version.`);
  if (manifest.run_id !== runId || state.run_id !== runId || !nonEmpty(manifest.run_id) || !nonEmpty(state.run_id)) throw new Error(`Run ${runId} has inconsistent run IDs.`);
  if (!isRunStatus(state.status) || !Number.isInteger(state.attempt) || state.attempt < 0) throw new Error(`Run ${runId} has invalid state fields.`);
  if (!validDate(manifest.created_at) || !validDate(state.created_at) || !validDate(state.updated_at)) throw new Error(`Run ${runId} has invalid timestamps.`);
  for (const key of ['task', 'profile', 'provider', 'cwd'] as const) if (!nonEmpty(manifest[key])) throw new Error(`Run ${runId} has invalid manifest field ${key}.`);
  for (const key of ['git_branch', 'git_commit'] as const) if (manifest[key] !== undefined && typeof manifest[key] !== 'string') throw new Error(`Run ${runId} has invalid manifest field ${key}.`);
  for (const key of ['failure_reason', 'transition_actor'] as const) if (state[key] !== undefined && typeof state[key] !== 'string') throw new Error(`Run ${runId} has invalid state field ${key}.`);
}

function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function validDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isRunId(value: string): boolean { return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value); }
function publicMessage(runId: string | null, reason: MetadataFailure): string {
  if (reason === 'invalid_id') return 'Invalid run ID.';
  if (reason === 'not_found') return `Run ${runId} was not found.`;
  if (reason === 'invalid_json') return `Run ${runId} metadata is not valid JSON.`;
  if (reason === 'unavailable') return `Run ${runId} metadata is unavailable.`;
  return `Run ${runId} metadata is invalid.`;
}
function listWarning(error: RunMetadataError): string {
  if (!error.runId) return 'Skipping invalid run directory.';
  return `Skipping run ${error.runId}: ${error.reason === 'invalid_json' ? 'metadata is not valid JSON' : error.reason === 'invalid_metadata' ? 'metadata is invalid' : 'metadata unavailable'}.`;
}
